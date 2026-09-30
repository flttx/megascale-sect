import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=low&turtleAt=0&hours=15&weather=clear', undefined, { language: 'zh' })
await fs.mkdir('artifacts/turtle', { recursive: true })
const snapshot = () => page.evaluate(() => window.__playerSnapshot())
/** Turtle-local (x, z) → world, along the turtle as it swims and turns. */
const LOCAL = `(s, lx, lz) => [Math.cos(s.heading) * lx + Math.sin(s.heading) * lz + s.center.x, -Math.sin(s.heading) * lx + Math.cos(s.heading) * lz + s.center.z]`
/** Runs along turtle-local waypoints on foot; rejects on leaving the back or taking longer than 12 s a leg. */
async function walk(route) {
  await page.keyboard.down('Shift'); await page.keyboard.down('w')
  try {
    return await page.evaluate(async ({ route, LOCAL }) => {
      const { turtleState } = await window.__liveImport('/src/world/colossi/turtleDeck.ts')
      const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
      const toWorld = (0, eval)(LOCAL)
      let leg = 0, start = performance.now()
      return new Promise((resolve, reject) => {
        const tick = () => {
          const r = getPlayerRuntime(), [x, z] = toWorld(turtleState, ...route[leg])
          const gap = Math.hypot(r.position.x - x, r.position.z - z)
          if (gap < 1.2) {
            if (++leg === route.length) { resolve(gap); return }
            start = performance.now()
          } else if (!r.aboard || performance.now() - start > 12000) {
            const dx = r.position.x - turtleState.center.x, dz = r.position.z - turtleState.center.z, c = Math.cos(turtleState.heading), n = Math.sin(turtleState.heading)
            const at = [c * dx - n * dz, r.position.y - turtleState.center.y, n * dx + c * dz].map((v) => v.toFixed(1))
            reject(Error(`walk to ${route[leg]}: stopped at local ${at}, gap ${gap.toFixed(1)}, aboard ${!!r.aboard}`)); return
          }
          r.yaw = Math.atan2(x - r.position.x, -(z - r.position.z))
          requestAnimationFrame(tick)
        }
        tick()
      })
    }, { route, LOCAL })
  } finally { await page.keyboard.up('w'); await page.keyboard.up('Shift') }
}
try {
  await page.waitForFunction(async () => (await window.__liveImport('/src/world/colossi/turtleDeck.ts')).turtleState.ready, null, { timeout: 180000 })
  // Every turtle orb floats 1.5 m over standable, open deck (not a canopy or roof: the walk below reaches it).
  const spots = await page.evaluate(async () => {
    const D = await window.__liveImport('/src/world/colossi/turtleDeck.ts')
    const { ORBS, orbPosition } = await window.__liveImport('/src/world/interact/orbs.ts')
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    return ORBS.filter((o) => o.turtleIndex !== undefined).map((o) => {
      const p = orbPosition(o, new Vector3()), hit = p && D.turtleDeckHit(p.x, p.z, p.y)
      const open = hit && D.turtleClearance(new Vector3(p.x, hit.y + 0.2, p.z), new Vector3(0, 1, 0), 3)
      return { id: o.id, lift: hit && p.y - hit.y, normalY: hit?.normalY, open }
    })
  })
  assert.deepEqual(spots.map((s) => s.id), ['orb_turtle_0', 'orb_turtle_1', 'orb_turtle_2'])
  for (const s of spots) {
    assert.ok(Math.abs(s.lift - 1.5) < 0.01, `${s.id} lift ${s.lift}`)
    assert.ok(s.normalY >= Math.cos(40 * Math.PI / 180), `${s.id} normal ${s.normalY}`)
    assert.ok(s.open >= 3, `${s.id} is covered ${s.open} m above the deck`)
  }
  // Board the pavilion's terrace away from the orbs, then walk around the pavilion to each of them.
  const boarded = await page.evaluate(async (LOCAL) => {
    const D = await window.__liveImport('/src/world/colossi/turtleDeck.ts')
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const [x, z] = (0, eval)(LOCAL)(D.turtleState, -20, -14), hit = D.turtleDeckHit(x, z)
    return teleportPlayer([x, hit.y + 0.3, z], Math.PI - D.turtleState.heading)
  }, LOCAL)
  assert.ok(boarded)
  await page.waitForTimeout(800)
  assert.equal((await snapshot()).aboard?.surfaceId, 'turtle')
  await walk([[0, -14], [-20, -14], [-20, -52]])
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'artifacts/turtle/rear-corner.png' })
  await walk([[20, -52]])
  await page.waitForTimeout(300)
  const collected = await page.evaluate(() => window.__interact.orbs().filter((o) => o.collected).map((o) => o.id))
  assert.deepEqual(collected.sort(), ['orb_turtle_0', 'orb_turtle_1', 'orb_turtle_2'])
  assert.equal((await snapshot()).aboard?.surfaceId, 'turtle', 'the walk stays on the back')
  assert.deepEqual(errors, [])
  console.log('PASS three turtle orbs over open deck, collected on foot', JSON.stringify(spots))
} finally {
  await browser.close()
}
