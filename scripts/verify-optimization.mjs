import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = [], report = {}
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const state = () => page.evaluate(() => window.__playerSnapshot())
const phase = (p) => page.waitForFunction((phase) => window.__playerSnapshot?.().phase === phase, p)
await fs.mkdir('artifacts/optimization', { recursive: true })
try {
  const start = Date.now()
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => { const r = window.__playerSnapshot?.().characterReady; return r?.male && r?.female }, null, { timeout: 120000 })
  await page.getByRole('button', { name: /进入仙宗/ }).click()
  report.readyMs = Date.now() - start
  report.assets = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/characters/')).map((r) => ({ name: r.name.split('/').slice(-2).join('/'), bytes: r.encodedBodySize, durationMs: r.duration })))
  // Per character: optimized rig and sword, plus the small baked-clip file.
  assert.equal(report.assets.length, 6)
  assert.ok(report.assets.every((r) => r.name.endsWith('.optimized.glb') || r.name.endsWith('/anim.glb')))
  assert.ok(report.assets.reduce((n, r) => n + r.bytes, 0) < 12000000)
  await page.waitForTimeout(500)
  await page.keyboard.down('Alt')
  await page.evaluate(() => { const e = new MouseEvent('mousemove', { bubbles: true, altKey: true }); Object.defineProperty(e, 'movementX', { value: Math.PI / 2 / 0.0025 }); window.dispatchEvent(e) })
  await page.keyboard.down('w')
  const feet = await page.evaluate(() => new Promise((resolve) => {
    const results = []
    function sample() {
      const s = window.__playerSnapshot()
      results.push({ stride: s.stride, feet: s.feet })
      if (results.length < 100) requestAnimationFrame(sample); else resolve(results)
    }
    requestAnimationFrame(sample)
  }))
  await page.keyboard.up('w')
  await page.screenshot({ path: 'artifacts/optimization/male-walk-side.png' })
  await page.keyboard.up('Alt')
  const locked = feet.flatMap((s) => s.feet).filter((f) => f.locked)
  report.footPlant = { lockedSamples: locked.length, averageErrorM: locked.reduce((n, f) => n + f.error, 0) / locked.length, maxErrorM: Math.max(...locked.map((f) => f.error)) }
  assert.ok(locked.length > 20)
  assert.ok(report.footPlant.averageErrorM < 0.13, 'Stance anchors must constrain feet')
  await page.waitForTimeout(900)
  const stopped = await state()
  assert.equal(typeof stopped.stride, 'number', 'Snapshot must expose the clip layer stride')
  await page.waitForTimeout(400)
  assert.equal((await state()).stride, stopped.stride, 'Gait must stop when position stops')
  report.switches = []
  for (const character of ['female', 'male', 'female', 'male']) {
    const then = Date.now()
    await page.keyboard.press(character === 'male' ? '1' : '2')
    await page.waitForFunction((character) => { const s = window.__playerSnapshot(); return s.character === character && s.ready && s.sword === `Sword_${character}` }, character)
    report.switches.push({ character, ms: Date.now() - then })
  }
  await page.keyboard.press('2')
  await page.keyboard.down('Alt')
  await page.evaluate(() => { const e = new MouseEvent('mousemove', { bubbles: true, altKey: true }); Object.defineProperty(e, 'movementX', { value: Math.PI / 2 / 0.0025 }); window.dispatchEvent(e) })
  await page.keyboard.down('w'); await page.keyboard.down('Shift')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'artifacts/optimization/female-run-side.png' })
  await page.keyboard.up('w'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  await page.keyboard.press('1')
  await page.keyboard.press('f')
  await phase('SUMMONING')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'artifacts/optimization/summon.png' })
  await phase('FLIGHT')
  await page.keyboard.down('Space')
  await page.waitForTimeout(1000)
  await page.keyboard.up('Space')
  await page.keyboard.down('Shift')
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  const boost = await state()
  report.boost = { speed: Math.hypot(...boost.velocity), fov: boost.fov, cameraDistance: boost.cameraDistance, audio: boost.audio }
  assert.ok(report.boost.speed > 55 && boost.fov > 76)
  assert.ok(boost.cameraDistance < 9, 'High speed must not leave the character far ahead of the camera')
  assert.ok(boost.audio.rms > 0.00001 && boost.audio.windLevel > 0.3)
  assert.ok(boost.audio.events.includes('summon') && boost.audio.events.includes('sword-contact'))
  await page.keyboard.down('Alt')
  await page.evaluate(() => { const e = new MouseEvent('mousemove', { bubbles: true, altKey: true }); Object.defineProperties(e, { movementX: { value: 350 }, movementY: { value: -80 } }); window.dispatchEvent(e) })
  await page.waitForTimeout(250)
  const orbit = await state()
  assert.equal(orbit.yaw, boost.yaw); assert.equal(orbit.pitch, boost.pitch)
  await page.screenshot({ path: 'artifacts/optimization/boost-wake.png' })
  await page.keyboard.up('Alt')
  await page.keyboard.down('x')
  const brakeStart = await state()
  await page.waitForTimeout(600)
  const brake = await state()
  report.brake = { speed: Math.hypot(...brake.velocity), distanceM: Math.hypot(...brake.position.map((p, i) => p - brakeStart.position[i])) }
  assert.ok(report.brake.speed < 0.15, 'X must brake even while forward/boost are held')
  await page.keyboard.up('w'); await page.keyboard.up('Shift'); await page.keyboard.up('x')
  await page.keyboard.press('m')
  await page.waitForTimeout(400)
  const muted = await state()
  assert.ok(muted.audio.muted && muted.audio.rms < 0.00001, `Mute must silence the output: ${muted.audio.rms}`)
  await page.keyboard.press('m')
  await page.waitForTimeout(350)
  assert.ok((await state()).audio.rms > 0.00001, 'Unmute must restore wind')
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForTimeout(400)
  const paused = await state()
  assert.ok(paused.audio.paused && paused.audio.rms < 0.00001)
  await page.locator('.settings-resume').click()
  await page.waitForTimeout(500)
  assert.ok((await state()).audio.rms > 0.00001, 'Resume must restore live audio')
  await page.keyboard.press('f')
  await phase('GROUND')
  report.final = await state()
  assert.ok(report.final.audio.events.includes('recall') && report.final.audio.events.includes('land'))
  report.simulation = await page.evaluate(async () => {
    const { createPlayerRuntime, stepPlayer } = await import('/src/world/player/playerMotion.ts')
    const simulate = (hz) => {
      const s = createPlayerRuntime(); s.phase = 'FLIGHT'; s.position.set(0, 100, 140); s.pitch = 0
      const input = s.velocity.clone().set(0, 0, -1)
      for (let i = 0; i < hz * 2; i++) stepPlayer(s, input, true, 1 / hz)
      const cruise = { position: s.position.toArray(), speed: s.velocity.length() }
      s.yaw = 0.8
      for (let i = 0; i < hz / 3; i++) stepPlayer(s, input, true, 1 / hz)
      const bank = s.bank
      s.braking = true
      for (let i = 0; i < hz; i++) stepPlayer(s, input, true, 1 / hz)
      return { cruise, bank, stopped: s.velocity.length() }
    }
    return { hz30: simulate(30), hz120: simulate(120) }
  })
  assert.ok(Math.abs(report.simulation.hz30.cruise.position[2] - report.simulation.hz120.cruise.position[2]) < 1)
  assert.ok(Math.abs(report.simulation.hz30.bank) > 0.1 && report.simulation.hz30.stopped === 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ...report, final: { phase: report.final.phase, fps: report.final.telemetry.fps }, errors }, null, 2))
} finally {
  await fs.writeFile('artifacts/optimization/report.json', JSON.stringify({ ...report, errors }, null, 2))
  await browser.close()
}
