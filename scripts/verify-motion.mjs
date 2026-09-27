import assert from 'node:assert/strict'
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
        for (let n = 0; n < fps; n++) {
          const y = r.position.y; stepPlayer(r, new Vector3(0, 0, -1), true, 1 / fps)
          rise = Math.max(rise, r.position.y - y)
          const floor = groundHeight(r.position.x, r.position.z, r.position.y)
          pierced ||= floor !== null && r.position.y < floor + 0.54
        }
        return { fps, position: r.position.toArray(), rise, pierced }
      })
      routes.push({ x, z, runs })
      if (routes.length === 3) break outer
    }
    return { checks, routes }
  })
  for (const [name, ok] of result.checks) { assert.ok(ok, name); console.log('PASS', name) }
  assert.equal(result.routes.length, 3, 'Need three real steep-cliff fixtures')
  for (const { x, z, runs } of result.routes) {
    for (const run of runs) assert.ok(!run.pierced, `terrain penetration at ${x}/${z}/${run.fps}`)
    const ref = runs.at(-1).position
    for (const run of runs) assert.ok(Math.hypot(...run.position.map((v, i) => v - ref[i])) < 1, `frame-rate route ${JSON.stringify({ x, z, runs })}`)
  }
  console.log('PASS three cliffs at 20/60/144 fps', JSON.stringify(result.routes))
  assert.deepEqual(errors, [])
} finally { await browser.close() }
