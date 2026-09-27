import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

const { browser, page, errors } = await openWorld('?quality=low')
try {
  const results = await page.evaluate(async () => {
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const { stepGround } = await window.__liveImport('/src/world/player/GroundController.tsx')
    const { registerWalkables } = await window.__liveImport('/src/world/surfaces.ts')
    const results = []
    for (const fps of [20, 60, 144]) {
      const release = registerWalkables([{ kind: 'disc', x: 950, z: 950, y: 500, radius: 20 }])
      const p = new Vector3(950, 500, 950), v = new Vector3(), input = new Vector3()
      let peak = 0, impact = 0, frames = 0
      try {
        do {
          const state = stepGround(p, v, input, 0, false, frames === 0, 1 / fps)
          peak = Math.max(peak, p.y - 500); impact = state.touchdown; frames++
        } while (!impact && frames < fps * 2)
      } finally { release() }
      const steps = []
      for (const drop of [0.3, 0.45, 3]) for (const sprint of [false, true]) {
        const release = registerWalkables([
          { kind: 'disc', x: 950, z: 950, y: 500 - drop, radius: 20 },
          { kind: 'disc', x: 950, z: 950, y: 500, radius: 2 },
        ])
        p.set(950, 500, 948.01); v.set(0, 0, sprint ? -10 : -5.5)
        try {
          const state = stepGround(p, v, new Vector3(0, 0, -1), 0, sprint, drop > 0.45, 1 / fps)
          steps.push({ drop, sprint, ...state, y: p.y })
        } finally { release() }
      }
      results.push({ fps, peak, impact, duration: frames / fps, steps })
    }
    return results
  })
  await fs.mkdir('artifacts/framerate', { recursive: true })
  await fs.writeFile(`artifacts/framerate/${process.env.BASELINE ? 'before' : 'report'}.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
  for (const result of results) {
    assert.ok(Math.abs(result.peak - 1.3) < 0.01, `jump height ${result.fps}: ${result.peak}`)
    assert.ok(Math.abs(result.duration - 2 * Math.sqrt(2 * 28 * 1.3) / 28) <= 1 / result.fps, 'landing time within one frame')
    for (const step of result.steps) {
      assert.equal(step.grounded, step.drop <= 0.45, `step ${result.fps}/${step.drop}/${step.sprint}`)
      assert.equal(step.touchdown, 0, 'steps do not play the landing animation')
    }
  }
  const trails = await page.evaluate(async () => {
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const { WakeHistory, WAKE_INTERVAL, WAKE_COUNT } = await window.__liveImport('/src/world/player/wakeHistory.ts')
    return [20, 60, 144].map((fps) => {
      const trail = new WakeHistory(), p = new Vector3()
      trail.update(p, 196, 0, 0)
      for (let i = 1; i <= fps; i++) { p.set(0, -100 * i / fps, 168 * i / fps); trail.update(p, p.length() * fps / i, 1 / fps, 0) }
      const length = trail.points[0].distanceTo(trail.points.at(-1))
      const expected = p.length() * WAKE_INTERVAL * (WAKE_COUNT - 1)
      p.addScalar(0.5); trail.update(p, 196, 1 / fps, 1)
      return { fps, length, expected, reset: trail.points.every((v) => v.distanceTo(p) < 1e-9) }
    })
  })
  for (const t of trails) { assert.ok(Math.abs(t.length - t.expected) < 1e-4, JSON.stringify(t)); assert.ok(t.reset, 'small teleports reset the trail') }
  console.log('PASS fixed-duration sword wake and relocation', JSON.stringify(trails))
  assert.deepEqual(errors, [])
  console.log('PASS frame-independent jumps, steps and cliff exits')
} finally { await browser.close() }
