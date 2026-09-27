import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=low')
try {
  const result = await page.evaluate(async () => {
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const { createPlayerRuntime, requestFlightToggle, stepPlayer } = await window.__liveImport('/src/world/player/playerMotion.ts')
    const { registerWalkables, registerColliders } = await window.__liveImport('/src/world/surfaces.ts')
    const { groundHeight, terrainGradient } = await window.__liveImport('/src/world/worldLayout.ts')
    const checks = []
    const offGround = registerWalkables([{ kind: 'disc', x: 900, z: 900, y: 500, radius: 20 }])
    const offProp = registerColliders([{ kind: 'cylinder', x: 900, z: 898.85, radius: 0.6, minY: 500, maxY: 504 }])
    try {
      const r = createPlayerRuntime(); r.ready = true; r.position.set(900, 500, 900)
      requestFlightToggle(r)
      checks.push(['summon chooses clear side', r.phase === 'SUMMONING' && Math.abs(r.destination.x - 900) > 1])
      r.phase = 'FLIGHT'; r.position.set(900, 510, 898.85)
      checks.push(['landing rejects blocked descent', !!requestFlightToggle(r) && r.phase === 'FLIGHT'])
    } finally { offProp(); offGround() }
    const routes = []
    outer: for (let x = -900; x <= 900; x += 30) for (let z = -900; z <= 900; z += 30) {
      const h = groundHeight(x, z), gradient = terrainGradient(x, z)
      if (h === null || !gradient || Math.hypot(gradient.x, gradient.z) < 5) continue
      const yaw = Math.atan2(-gradient.x, gradient.z)
      const runs = [20, 60, 144].map((fps) => {
        const r = createPlayerRuntime(); r.phase = 'FLIGHT'; r.position.set(x, h + 0.55, z); r.yaw = r.facing = yaw; r.pitch = 0
        r.velocity.set(Math.sin(yaw) * 140, 0, -Math.cos(yaw) * 140)
        let rise = 0, pierced = false
        const path = [{ time: 0, position: r.position.toArray() }]
        for (let n = 0; n < fps; n++) {
          const y = r.position.y; stepPlayer(r, new Vector3(0, 0, -1), true, 1 / fps)
          rise = Math.max(rise, r.position.y - y)
          const floor = groundHeight(r.position.x, r.position.z, r.position.y)
          pierced ||= floor !== null && r.position.y < floor + 0.54
          path.push({ time: (n + 1) / fps, position: r.position.toArray() })
        }
        return { fps, position: r.position.toArray(), rise, pierced, path }
      })
      routes.push({ x, z, runs })
      if (routes.length === 3) break outer
    }
    return { checks, routes }
  })
  for (const [name, ok] of result.checks) { assert.ok(ok, name); console.log('PASS', name) }
  assert.equal(result.routes.length, 3, 'Need three real steep-cliff fixtures')
  for (const route of result.routes) {
    const { x, z, runs } = route
    for (const run of runs) assert.ok(!run.pierced, `terrain penetration at ${x}/${z}/${run.fps}`)
    const at = (run, time) => {
      const frame = time * run.fps, lo = Math.floor(frame), hi = Math.min(run.fps, lo + 1), mix = frame - lo
      return run.path[lo].position.map((v, i) => v + (run.path[hi].position[i] - v) * mix)
    }
    let maxDifference = 0
    for (let i = 1; i <= 20; i++) {
      const time = i / 20, reference = at(runs.at(-1), time)
      for (const run of runs) maxDifference = Math.max(maxDifference, Math.hypot(...at(run, time).map((v, axis) => v - reference[axis])))
    }
    route.maxDifference = maxDifference
    assert.ok(maxDifference < 1, `whole trajectory ${x}/${z}: ${maxDifference} m`)
  }
  console.log('PASS three cliffs at 20/60/144 fps', JSON.stringify(result.routes.map(({ x, z, maxDifference }) => ({ x, z, maxDifference }))))
  assert.deepEqual(errors, [])
  await fs.mkdir('artifacts/motion', { recursive: true })
  await fs.writeFile('artifacts/motion/report.json', JSON.stringify(result, null, 2))
} finally { await browser.close() }
