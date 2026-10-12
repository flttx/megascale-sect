import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { openWorld } from './lib/world-session.mjs'

// Measure the first switch in a fresh browser and the delayed warm-up, not just steady-state FPS.
const maxFrameMs = Number(process.env.MAX_SWITCH_FRAME_MS || 2500)
assert.ok(Number.isFinite(maxFrameMs) && maxFrameMs > 0, 'MAX_SWITCH_FRAME_MS must be positive')
const out = 'artifacts/quality-switch'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear')
const report = { maxFrameMs, runs: [], errors, failure: null }
try {
  await page.waitForFunction(
    () => {
      const warm = window.__gpuWarmup()
      return warm.runs > 0 && !warm.pending && !warm.failed
    },
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__ui.setHudHidden(true))
  for (const level of ['mid', 'low', 'high', 'low', 'mid', 'high']) {
    const result = await page.evaluate(async (quality) => {
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      const { renderer } = window.__postfx()
      const before = renderer.info.programs.length
      let last = performance.now(),
        worst = 0,
        frames = 0,
        smooth = 0
      const start = last
      useWorldStore.getState().setQuality(quality, false)
      // Include the 600 ms deferred warm-up and all frames until it finishes.
      while (performance.now() - start < 30000) {
        await new Promise(requestAnimationFrame)
        const now = performance.now(),
          dt = now - last
        last = now
        worst = Math.max(worst, dt)
        frames++
        smooth = dt < 50 ? smooth + 1 : 0
        if (now - start >= 3000 && smooth >= 10 && !window.__gpuWarmup().pending) break
      }
      return {
        quality,
        worstMs: Math.round(worst),
        elapsedMs: Math.round(performance.now() - start),
        frames,
        smooth,
        programsBefore: before,
        programsAfter: renderer.info.programs.length,
        lighting: window.__lightingStats(),
        warmup: window.__gpuWarmup(),
        drawCalls: window.__playerSnapshot().telemetry.drawCalls,
      }
    }, level)
    report.runs.push(result)
    console.log(JSON.stringify(result))
    assert.ok(result.smooth >= 10, `${level}: frames must recover`)
    assert.ok(result.worstMs <= maxFrameMs, `${level}: ${result.worstMs} ms exceeds ${maxFrameMs} ms`)
    assert.ok(!result.warmup.pending && !result.warmup.failed, `${level}: warm-up must complete`)
    assert.equal(result.lighting.cascades, 4, 'all tiers retain the same shader light slots')
    const active = level === 'high' ? 4 : level === 'mid' ? 3 : 0
    assert.equal(result.lighting.activeCascades, active)
    assert.equal(result.lighting.updatingMaps, active, 'low must not redraw shadow maps')
    assert.deepEqual(
      result.lighting.mapSizes,
      level === 'low' ? [1, 1, 1, 1] : level === 'mid' ? [1, 2048, 2048, 2048] : [2048, 2048, 2048, 2048],
    )
    assert.ok(result.drawCalls <= 400, 'switch must preserve the draw-call budget')
    const screenshot = await page.screenshot({ path: `${out}/${report.runs.length}-${level}.png` })
    const {
      channels: [luma],
    } = await sharp(await sharp(screenshot).greyscale().toBuffer()).stats()
    result.luma = { mean: luma.mean, stdev: luma.stdev }
    assert.ok(luma.mean > 10 && luma.mean < 235 && luma.stdev > 6, 'scene must remain lit and nonblank')
  }
  await page.evaluate(async () => {
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    for (const level of ['mid', 'low', 'high', 'low']) {
      useWorldStore.getState().setQuality(level, false)
      await new Promise(requestAnimationFrame)
    }
  })
  await page.waitForFunction(() => window.__lightingStats().activeCascades === 0 && !window.__gpuWarmup().pending)
  await page.evaluate(() => {
    window.__qualityLostCanvas = document.querySelector('canvas')
    window.__qualityRestore = window.__qualityLostCanvas.getContext('webgl2').getExtension('WEBGL_lose_context')
    window.__qualityRestore.loseContext()
  })
  await page.locator('.graphics-recovery').waitFor()
  await page.evaluate(() => window.__qualityRestore.restoreContext())
  await page.waitForFunction(
    () => {
      const warm = window.__gpuWarmup?.()
      return (
        document.querySelector('canvas') !== window.__qualityLostCanvas &&
        !document.querySelector('.graphics-recovery') &&
        warm?.runs > 0 &&
        !warm.pending &&
        window.__lightingStats?.().activeCascades === 0
      )
    },
    null,
    { timeout: 120000 },
  )
  report.recovered = await page.evaluate(() => ({ lighting: window.__lightingStats(), warmup: window.__gpuWarmup() }))
  assert.equal(report.recovered.lighting.updatingMaps, 0)
  assert.deepEqual(report.recovered.lighting.mapSizes, [1, 1, 1, 1])
  assert.equal(report.recovered.warmup.failed, false)
  assert.deepEqual(errors, [])
  console.log('PASS quality switches, shadow tiers, warm-up, scene visibility, rapid changes and WebGL recovery')
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
