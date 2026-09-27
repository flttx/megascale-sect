import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { openWorld, review, telemetry, VIEWS } from './lib/world-session.mjs'

/*
 * Render budget check: every review view on every quality tier (plus a storm pass on high) must stay
 * within MAX_DRAW_CALLS. FPS is reported (median of samples) and only enforced when MIN_FPS is set,
 * since it depends on the machine. Writes artifacts/perf.json; exits 1 on any budget breach or page error.
 * Env: QUALITIES (default "high,mid,low"), MIN_FPS, plus the session env (BASE_URL, CHROME_PATH).
 */

const MAX_DRAW_CALLS = 400
const MIN_FPS = Number(process.env.MIN_FPS || 0)
const QUALITIES = (process.env.QUALITIES || 'high,mid,low').split(',')
const viewport = { width: Number(process.env.WIDTH || 1600), height: Number(process.env.HEIGHT || 900) }
if (!Object.values(viewport).every((v) => Number.isInteger(v) && v >= 320)) throw new Error('WIDTH/HEIGHT must be integers >= 320')
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function measure(page) {
  const samples = []
  for (let i = 0; i < 5; i++) { samples.push(await telemetry(page)); await page.waitForTimeout(350) }
  return {
    fps: Math.round(median(samples.map((s) => s.fps))),
    drawCalls: Math.max(...samples.map((s) => s.drawCalls)),
    triangles: Math.max(...samples.map((s) => s.triangles)),
  }
}

const runs = []
const errors = []
for (const quality of QUALITIES) {
  for (const weather of quality === 'high' ? ['clear', 'storm'] : ['clear']) {
    const { browser, page, errors: pageErrors } = await openWorld(`?quality=${quality}&hours=15&weather=${weather}&kunAt=40`, viewport)
    const views = weather === 'storm' ? ['hero', 'road'] : Object.keys(VIEWS)
    for (const view of views) {
      await review(page, VIEWS[view], 2200)
      const result = { quality, weather, view, ...await measure(page) }
      runs.push(result)
      console.log(`${quality.padEnd(4)} ${weather.padEnd(5)} ${view.padEnd(10)} ${String(result.fps).padStart(4)} fps  ${String(result.drawCalls).padStart(3)} calls  ${(result.triangles / 1e6).toFixed(2)}M tris`)
    }
    await page.evaluate(async () => {
      window.__environmentReview(null)
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      useWorldStore.getState().setCameraMode('player')
      window.__kunSetTime(40)
    })
    await page.waitForTimeout(300)
    assert.ok(await page.evaluate(() => window.__interact.visitOrb('orb_kun_0')), 'kun performance view must be reachable')
    await page.waitForTimeout(2200)
    assert.ok(await page.evaluate(() => !!window.__playerSnapshot().aboard && window.__playerSnapshot().cameraDistance < 20), 'measure the real camera aboard the kun')
    const deck = { quality, weather, view: 'kun-deck', ...await measure(page) }
    runs.push(deck)
    console.log(`${quality} ${weather} kun-deck ${deck.fps} fps ${deck.drawCalls} calls`)
    errors.push(...pageErrors.map((e) => `${quality}/${weather}: ${e}`))
    await browser.close()
  }
}

const breaches = runs.filter((r) => r.drawCalls > MAX_DRAW_CALLS || (MIN_FPS && r.fps < MIN_FPS))
await fs.mkdir('artifacts', { recursive: true })
await fs.writeFile(process.env.PERF_OUT || 'artifacts/perf.json', JSON.stringify({ viewport, cpuThrottle: Number(process.env.CPU_THROTTLE || 1), maxDrawCalls: MAX_DRAW_CALLS, minFps: MIN_FPS || null, runs, breaches, errors }, null, 2))
const worst = runs.reduce((a, b) => (b.drawCalls > a.drawCalls ? b : a))
console.log(`worst: ${worst.drawCalls} calls (${worst.quality}/${worst.weather}/${worst.view}); budget ${MAX_DRAW_CALLS}`)
if (breaches.length) console.log('BUDGET BREACH', JSON.stringify(breaches))
if (errors.length) console.log('PAGE ERRORS', JSON.stringify(errors.slice(0, 8)))
process.exit(breaches.length || errors.length ? 1 : 0)
