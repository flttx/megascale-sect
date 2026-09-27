import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld, review, VIEWS } from './lib/world-session.mjs'

await fs.mkdir('artifacts/r9', { recursive: true })
const report = []
for (const rate of [1, 4]) {
  process.env.CPU_THROTTLE = String(rate)
  const { browser, page, errors } = await openWorld(`?quality=${rate === 1 ? 'high' : 'low'}&hours=15&weather=clear&kunAt=40&profileGpu`,
    rate === 1 ? { width: 1600, height: 900 } : { width: 1280, height: 720 })
  try {
    await page.waitForFunction(() => window.__postfx?.().composer)
    const hardware = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info')
      return { renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency }
    })
    const cpu = async (aboard) => page.evaluate(async (aboard) => {
      const { kunProfile } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
      Object.assign(kunProfile, { enabled: true, indexes: 0, indexMs: 0, maxIndexMs: 0, anchors: 0, anchorMs: 0 })
      const start = performance.now()
      try {
        for (let i = 0; i < 120; i++) await new Promise(requestAnimationFrame)
        return { aboard, frames: 120, elapsedMs: performance.now() - start, ...kunProfile }
      } finally { kunProfile.enabled = false }
    }, aboard)
    const away = await cpu(false)
    assert.equal(away.indexes, 0, 'distant kun must not rebuild a spatial index')
    assert.ok(await page.evaluate(() => window.__interact.visitOrb('orb_kun_0')))
    await page.waitForFunction(() => !!window.__playerSnapshot().aboard)
    const aboard = await cpu(true)
    assert.ok(aboard.indexes > 100 && aboard.anchors > 100, 'measure live skinned queries')
    const skin = []
    for (const time of [40, 80, 149]) {
      await page.evaluate((t) => window.__kunSetTime(t), time); await page.waitForTimeout(80)
      skin.push(await page.evaluate(async () => (await window.__liveImport('/src/world/colossi/kunDeck.ts')).kunSkinError()))
    }
    assert.ok(skin.every((s) => s.vertices > 1000 && s.maximum < 1e-7), 'cached palette must match reference skinning')
    const staticGround = await page.evaluate(async () => {
      const { groundHeight, terrainGradient } = await window.__liveImport('/src/world/worldLayout.ts')
      const start = performance.now(), iterations = 10000
      let sum = 0
      for (let i = 0; i < iterations; i++) {
        const x = (i % 20) * 0.03, z = 145 - (i % 30) * 0.03
        sum += groundHeight(x, z, 3) ?? 0
        sum += terrainGradient(x, z, 3)?.x ?? 0
      }
      return { iterations, microsecondsPerPair: (performance.now() - start) * 1000 / iterations, checksum: sum }
    })
    await review(page, VIEWS.road, 2000)
    // Isolate effects only in this diagnostic URL. Normal render budgets use the production pass grouping.
    const gpu = await page.evaluate(async () => {
      const { composer, renderer } = window.__postfx(), gl = renderer.getContext()
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      if (!ext) return { supported: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' }
      const pending = [], records = [], restore = []
      let disjoint = false
      for (const pass of composer.passes.filter((p) => p.enabled)) {
        const record = { name: pass.configuration?.aoSamples !== undefined ? 'N8AO' : pass.effects?.map((e) => e.name).join('+') || (pass.name !== 'Pass' && pass.name) || pass.constructor.name, samples: [], submitted: 0 }
        records.push(record)
        const original = pass.render
        pass.render = function (...args) {
          if (record.submitted >= 40) return original.apply(this, args)
          const query = gl.createQuery()
          gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
          try { return original.apply(this, args) }
          finally { gl.endQuery(ext.TIME_ELAPSED_EXT); record.submitted++; pending.push({ query, record }) }
        }
        restore.push(() => { pass.render = original })
      }
      try {
        const deadline = performance.now() + 15000
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame)
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { disjoint = true; break }
          for (let i = pending.length - 1; i >= 0; i--) {
            const { query, record } = pending[i]
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
            record.samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
            gl.deleteQuery(query); pending.splice(i, 1)
          }
          if (records.every((r) => r.samples.length >= 40)) break
        }
      } finally { restore.forEach((fn) => fn()); pending.forEach(({ query }) => gl.deleteQuery(query)) }
      return { supported: true, disjoint, isolatedEffects: true, passes: records.map(({ name, samples }) => {
        samples.sort((a, b) => a - b)
        return { name, samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)] ?? null, p95Ms: samples[Math.floor(samples.length * 0.95)] ?? null }
      }) }
    })
    if (gpu.supported && !gpu.disjoint) assert.ok(gpu.passes.every((p) => p.samples === 40 && p.medianMs >= 0))
    assert.deepEqual(errors, [])
    report.push({ cpuThrottle: rate, hardware, away, aboard, skin, staticGround, gpu })
    console.log('PASS profile', rate, JSON.stringify(report.at(-1)))
  } finally { await browser.close(); await fs.writeFile('artifacts/r9/profile.json', JSON.stringify(report, null, 2)) }
}
