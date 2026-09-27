import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=high&kunAt=40&hours=15&weather=clear')
const report = []
await fs.mkdir('artifacts/kun', { recursive: true })
const snapshot = () => page.evaluate(() => window.__playerSnapshot())
const phase = (p) => page.waitForFunction((p) => window.__playerSnapshot().phase === p, p, { timeout: 30000 })
async function visit(index = 0) {
  return page.evaluate(async (i) => {
    const { kunOrbPosition, kunState } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const p = kunOrbPosition(i, new Vector3())
    return p && teleportPlayer([p.x, p.y - 1.4, p.z], Math.PI - kunState.heading)
  }, index)
}
async function drift(address) {
  return page.evaluate(async (a) => {
    const { evaluateDeckAnchor } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
    const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    return getPlayerRuntime().position.distanceTo(evaluateDeckAnchor(a, new Vector3()))
  }, address)
}
async function resetTime(t) {
  await page.evaluate(async (t) => {
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    if (!teleportPlayer([0, 0.2, 150], 0)) throw Error('reset requires a stable player phase')
    window.__kunSetTime(t)
  }, t)
  await page.waitForTimeout(200)
}
async function watchLaunch() {
  await page.evaluate(() => {
    let previous = window.__playerSnapshot()
    window.__launchResult = null
    const tick = () => {
      const next = window.__playerSnapshot()
      if (previous.phase === 'BOARDING' && next.phase === 'FLIGHT') {
        window.__launchResult = {
          speedChange: Math.hypot(...next.velocity.map((v, i) => v - previous.velocity[i] - previous.carrierVelocity[i])),
          step: Math.hypot(...next.position.map((v, i) => v - previous.position[i] - next.carrierDelta[i])),
        }
        return
      }
      previous = next
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
async function walkTo(index) {
  await page.keyboard.down('Shift'); await page.keyboard.down('w')
  try {
    return await page.evaluate(async (index) => {
      const { kunOrbPosition } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
      const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
      const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
      const target = new Vector3(), start = performance.now()
      return new Promise((resolve, reject) => {
        const tick = () => {
          const r = getPlayerRuntime(), p = kunOrbPosition(index, target)
          const gap = Math.hypot(r.position.x - p.x, r.position.z - p.z)
          if (gap < 1.4) { resolve(gap); return }
          if (!r.aboard || performance.now() - start > 12000) { reject(Error(`walk to orb ${index}: gap ${gap}, aboard ${!!r.aboard}`)); return }
          r.yaw = Math.atan2(p.x - r.position.x, -(p.z - r.position.z))
          requestAnimationFrame(tick)
        }
        tick()
      })
    }, index)
  } finally { await page.keyboard.up('w'); await page.keyboard.up('Shift') }
}
try {
  await page.waitForFunction(async () => (await window.__liveImport('/src/world/colossi/kunDeck.ts')).kunState.ready, null, { timeout: 180000 })
  const safe = await page.evaluate(async () => {
    const save = await window.__liveImport('/src/ui/save.ts'); save.flushSave(); return save.safePosition()
  })
  for (const [key, character] of [['1', 'male'], ['2', 'female']]) {
    await resetTime(40)
    await page.keyboard.press(key)
    await page.waitForFunction((c) => window.__playerSnapshot().character === c && window.__playerSnapshot().ready, character)
    assert.ok(await visit())
    await page.waitForTimeout(500)
    const initial = await snapshot(); assert.ok(initial.aboard)
    await page.waitForTimeout(5000)
    const standing = await snapshot(), standingDrift = await drift(initial.aboard)
    const feet = standing.feet.filter((f) => f.locked)
    const footError = feet.reduce((sum, f) => sum + f.error, 0) / feet.length
    report.push({ character, standingDrift, footError, speed: standing.clips.speed })
    assert.ok(standingDrift < 0.3, `standing drift ${standingDrift}`)
    assert.ok(feet.length === 2 && footError < 0.05, `standing feet ${JSON.stringify(standing.feet)}`)
    assert.ok(standing.clips.speed < 0.12, 'Carried idle must not play a running clip')
    await page.screenshot({ path: `artifacts/kun/${character}-standing.png` })
    await page.keyboard.down('w')
    const walkFeet = []
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100)
      walkFeet.push(...(await snapshot()).feet.filter((f) => f.locked).map((f) => f.error))
    }
    await page.screenshot({ path: `artifacts/kun/${character}-walking.png` })
    await page.keyboard.up('w')
    const walkingFootError = walkFeet.reduce((a, b) => a + b, 0) / walkFeet.length
    assert.ok(walkFeet.length && walkingFootError < 0.05, `walking feet ${walkingFootError}`)
    await page.waitForTimeout(900)
    assert.ok((await snapshot()).aboard, 'walk remains on deck')
    assert.ok(await drift(initial.aboard) > 4, 'walking changes the position relative to the deck')
    const beforeJump = await snapshot()
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.__playerSnapshot().inAir)
    await page.waitForFunction(() => !window.__playerSnapshot().inAir && !!window.__playerSnapshot().aboard)
    const jumpDrift = await drift(beforeJump.aboard)
    assert.ok(jumpDrift < 0.5, `jump drift ${jumpDrift}`)
    await watchLaunch()
    await page.keyboard.press('f'); await phase('FLIGHT')
    await page.waitForFunction(() => window.__launchResult)
    const launch = await page.evaluate(() => window.__launchResult)
    assert.ok(launch.step < 0.3 && launch.speedChange < 5, JSON.stringify(launch))
    const flight = await snapshot()
    assert.equal(flight.aboard, null)
    await page.screenshot({ path: `artifacts/kun/${character}-flight.png` })
    await page.keyboard.press('f'); await phase('GROUND')
    assert.ok((await snapshot()).aboard, 'landing reattaches')
    const beforeScroll = await snapshot()
    await page.keyboard.press('Tab'); await page.waitForTimeout(1500)
    assert.ok(await drift(beforeScroll.aboard) < 0.3, 'scroll keeps carrying the player')
    await page.keyboard.press('Tab')
    if (!(await page.evaluate(() => !!document.pointerLockElement))) await page.getByRole('button', { name: '继续游戏并锁定视角' }).click()
    report.push({ character, walkingFootError, jumpDrift, launch })
    console.log('PASS', character, JSON.stringify({ standingDrift, footError, walkingFootError, jumpDrift, launch }))
  }
  await resetTime(40); await visit(0)
  for (let i = 1; i < 6; i++) { await walkTo(i); await page.waitForTimeout(200) }
  const collected = await page.evaluate(async () => {
    const save = await window.__liveImport('/src/ui/save.ts'); save.flushSave()
    const { ORB_COUNT } = await window.__liveImport('/src/world/interact/orbs.ts')
    return { ids: window.__interact.orbs().filter((o) => o.collected).map((o) => o.id), total: ORB_COUNT, saved: JSON.parse(localStorage.getItem(save.SAVE_KEY)) }
  })
  assert.equal(collected.total, 66)
  assert.deepEqual(collected.ids.sort(), Array.from({ length: 6 }, (_, i) => `orb_kun_${i}`))
  assert.deepEqual(collected.saved.position, safe, 'never save a position on the moving deck')
  assert.deepEqual(collected.saved.orbs.sort(), collected.ids)
  await page.keyboard.press('Tab')
  const marker = page.locator('[data-orb-id="orb_kun_5"]')
  await marker.waitFor()
  const firstX = await marker.getAttribute('cx')
  await page.waitForTimeout(1000)
  assert.notEqual(await marker.getAttribute('cx'), firstX, 'map orb follows the kun')
  await page.screenshot({ path: 'artifacts/kun/map.png' })
  await page.keyboard.press('Tab')
  console.log('PASS six orbs, 66 total, moving map, static checkpoint')
  const edge = await page.evaluate(async () => {
    const { registerWalkables } = await window.__liveImport('/src/world/surfaces.ts')
    const { stepGround } = await window.__liveImport('/src/world/player/GroundController.tsx')
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const release = registerWalkables([{ kind: 'moving', hitAt: (x, z) => Math.hypot(x - 2000, z - 2000) < 5 ? { y: 500, normal: [0, 1, 0], normalY: 1, surfaceId: 'kun' } : null }])
    const p = new Vector3(2000, 500, 1995.05), v = new Vector3(0, 0, -5.5)
    try {
      const result = stepGround(p, v, new Vector3(0, 0, -1), 0, false, false, 1 / 60)
      return { p: p.toArray(), v: v.toArray(), grounded: result.grounded }
    } finally { release() }
  })
  assert.ok(edge.p[2] < 1995 && edge.v[1] < 0 && !edge.grounded, 'walk off a flat carrier edge')
  const beforeMenu = await snapshot()
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForTimeout(5000)
  assert.ok(await drift(beforeMenu.aboard) < 0.3, 'menus keep carrying the player')
  await page.getByRole('button', { name: '继续游戏并锁定视角' }).click()
  for (const [key, character] of [['1', 'male'], ['2', 'female']]) {
    await page.keyboard.press(key)
    await resetTime(116); await visit(); await page.waitForTimeout(300)
    const edge = await snapshot()
    assert.ok(Math.abs(edge.position[0]) > 1100, 'test starts beyond ordinary boundary')
    await watchLaunch(); await page.keyboard.press('f'); await phase('FLIGHT')
    await page.waitForFunction(() => window.__launchResult)
    const exterior = await snapshot(), launch = await page.evaluate(() => window.__launchResult)
    assert.ok(Math.abs(exterior.position[0]) > 1100 && Math.abs(exterior.position[0] - edge.position[0]) < 150, 'outside takeoff must not snap into the boundary')
    assert.ok(launch.step < 0.3 && launch.speedChange < 5)
    await resetTime(149); await visit(); await page.waitForTimeout(250)
    assert.ok((await snapshot()).aboard)
    await page.evaluate(() => document.exitPointerLock())
    await phase('FLIGHT')
    const rescued = await snapshot()
    assert.equal(rescued.aboard, null)
    assert.ok(rescued.position[1] > -24, `rescue before cloud floor: ${rescued.position[1]}`)
    report.push({ character, exterior: exterior.position, rescue: rescued.position, launch })
    console.log('PASS', character, 'outside launch, menu rescue at', rescued.position[1])
    await page.getByRole('button', { name: '继续游戏并锁定视角' }).click()
    await resetTime(20)
    assert.equal((await snapshot()).aboard, null, 'teleport clears carrier anchors')
    const refused = await page.evaluate(async () => {
      const motion = await window.__liveImport('/src/world/player/playerMotion.ts')
      const { kunOrbPosition } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
      const runtime = motion.createPlayerRuntime(); runtime.ready = true; runtime.phase = 'FLIGHT'
      kunOrbPosition(0, runtime.position).y += 8
      return { reason: motion.requestFlightToggle(runtime), phase: runtime.phase }
    })
    assert.equal(refused.phase, 'FLIGHT'); assert.ok(refused.reason.includes('平飞'))
  }
  await resetTime(148.5)
  await page.evaluate(async () => {
    const { kunOrbPosition } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const p = kunOrbPosition(0, new Vector3()); teleportPlayer([p.x, p.y + 100, p.z])
  })
  await page.keyboard.press('f'); await phase('LANDING')
  await page.evaluate(() => document.exitPointerLock())
  await phase('FLIGHT')
  assert.equal((await snapshot()).aboard, null, 'unfinished landing cancels at 150 even in a menu')
  console.log('PASS flat deck edge and closing docking window')
  assert.deepEqual(errors, [])
  console.log('PASS menu carry and no browser errors')
} finally {
  await fs.writeFile('artifacts/kun/report.json', JSON.stringify({ report, errors }, null, 2))
  await browser.close()
}
