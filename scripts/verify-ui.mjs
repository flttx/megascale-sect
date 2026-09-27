import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld, installLiveImports } from './lib/world-session.mjs'

const { browser, page, errors } = await openWorld('?quality=low')
const report = {}
await fs.mkdir('artifacts/r9', { recursive: true })
try {
  await page.evaluate(() => document.exitPointerLock())
  const settings = page.locator('.settings-dialog')
  await settings.waitFor()
  await settings.locator('.character-picker button').nth(1).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__playerSnapshot().character === 'female')
  const mute = settings.getByRole('button', { name: '静音', exact: true })
  await mute.click(); assert.equal(await mute.getAttribute('aria-pressed'), 'true')
  await page.waitForTimeout(800)
  report.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yunque.save.v2')).settings)
  assert.equal(report.saved.character, 'female'); assert.equal(report.saved.soundEnabled, false)
  await page.screenshot({ path: 'artifacts/r9/settings.png' })
  await page.reload({ waitUntil: 'domcontentloaded' }); await installLiveImports(page)
  await page.waitForFunction(() => !document.querySelector('.enter-button')?.disabled && window.__playerSnapshot()?.characterReady?.female)
  assert.equal(await page.evaluate(() => window.__playerSnapshot().character), 'female')
  await page.getByRole('button', { name: /进入仙宗/ }).click()
  await page.waitForFunction(() => document.pointerLockElement)
  console.log('PASS settings character and mute, saved and restored after refresh')

  await page.keyboard.press('Tab'); await page.getByRole('tabpanel').waitFor()
  assert.equal(await page.locator('[role="tab"][aria-controls]').count(), 1)
  await page.getByRole('tab').nth(2).click()
  const bars = await page.getByRole('progressbar').evaluateAll((nodes) => nodes.map((n) => ({ label: n.getAttribute('aria-label'), value: n.getAttribute('aria-valuenow') })))
  assert.ok(bars.length > 5 && bars.every((b) => b.label && b.value !== null))
  await page.keyboard.press('ArrowLeft')
  const target = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-controls')
  assert.equal(await page.locator(`#${target}`).count(), 1)
  await page.locator('.scroll-close').click(); await page.waitForFunction(() => document.pointerLockElement)
  console.log('PASS existing ARIA targets, named progress bars and keyboard tabs')

  await page.keyboard.press('p'); await page.waitForFunction(() => window.__ui.state().cameraMode === 'photo')
  const downloads = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.evaluate(async () => {
    const { exportPhoto } = await window.__liveImport('/src/ui/photoExport.ts')
    const NativeDate = Date, fixed = Date.now()
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])) } }
    try { exportPhoto(document.querySelector('canvas')); exportPhoto(document.querySelector('canvas')) }
    finally { window.Date = NativeDate }
  })
  await page.waitForFunction(() => window.__ui.state().photos >= 2)
  await page.waitForTimeout(200)
  assert.equal(downloads.length, 2); assert.notEqual(downloads[0], downloads[1]); report.downloads = downloads
  await page.keyboard.press('Escape')
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock() })
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => window.__ui.state().cameraMode), 'player')
  assert.equal(await settings.count(), 0, 'photo Esc returns to the scene without opening settings')
  await page.locator('canvas').click(); await page.waitForFunction(() => document.pointerLockElement)
  await page.keyboard.press('p'); await page.evaluate(() => document.exitPointerLock())
  await page.waitForTimeout(400)
  assert.equal(await settings.count(), 0, 'browser-driven loss exits photo without settings')
  assert.equal(await page.evaluate(() => window.__ui.state().cameraMode), 'player')
  await page.keyboard.press('Escape'); await settings.waitFor()
  await page.evaluate(() => {
    window.__nativeLock = HTMLCanvasElement.prototype.requestPointerLock
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('test cooldown', 'NotAllowedError'))
  })
  await settings.locator('.settings-resume').click()
  assert.ok(await settings.getByRole('alert').isVisible())
  await page.evaluate(() => { HTMLCanvasElement.prototype.requestPointerLock = window.__nativeLock })
  await settings.locator('.settings-resume').click(); await page.waitForFunction(() => document.pointerLockElement)
  console.log('PASS photo Esc/lost lock, unique burst downloads and lock-refusal retry')

  await page.waitForTimeout(1200)
  report.profile = await page.evaluate(async () => {
    const { uiRenderProfile } = await window.__liveImport('/src/ui/renderProfile.ts')
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    const world = useWorldStore.getState(); world.setNotice(null)
    await new Promise(requestAnimationFrame)
    for (const key of Object.keys(uiRenderProfile)) delete uiRenderProfile[key]
    for (let i = 0; i < 60; i++) {
      world.setTelemetry({ ...useWorldStore.getState().telemetry, fps: 70 + i })
      await new Promise(requestAnimationFrame)
    }
    return { ...uiRenderProfile }
  })
  assert.equal(report.profile.interface?.commits ?? 0, 0, 'irrelevant telemetry must not commit Interface')
  assert.equal(report.profile.debug?.commits ?? 0, 0, 'closed DebugHud must not mount')
  await page.keyboard.press('F3'); await page.locator('.debug-hud').waitFor()
  await page.keyboard.press('F3'); await page.locator('.debug-hud').waitFor({ state: 'detached' })
  console.log('PASS React Profiler: no idle Interface/DebugHud commits over 60 telemetry updates')

  report.audio = await page.evaluate(async () => {
    const sounds = await window.__liveImport('/src/world/interact/sounds.ts')
    const { mixer } = await window.__liveImport('/src/world/audio/mixer.ts')
    mixer.reverbSend('sfx') // Establish the persistent bus before measuring per-voice nodes.
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect
    const active = new Set()
    AudioNode.prototype.connect = function (...args) { active.add(this); return Reflect.apply(connect, this, args) }
    AudioNode.prototype.disconnect = function (...args) { active.delete(this); return Reflect.apply(disconnect, this, args) }
    try {
      for (let i = 0; i < 10; i++) sounds.playChime()
      sounds.playBell(); sounds.playTeleport(); sounds.playAttune()
      AudioNode.prototype.connect = connect
      const created = active.size
      await new Promise((resolve) => setTimeout(resolve, 14500))
      return { created, connectedAfter: active.size }
    } finally { AudioNode.prototype.connect = connect; AudioNode.prototype.disconnect = disconnect }
  })
  assert.ok(report.audio.created > 100); assert.equal(report.audio.connectedAfter, 0)
  console.log('PASS short audio voices disconnect every created node', report.audio)
  assert.deepEqual(errors, [])
} finally {
  await fs.mkdir('artifacts/r9', { recursive: true })
  await fs.writeFile('artifacts/r9/ui-report.json', JSON.stringify({ ...report, errors }, null, 2))
  await browser.close()
}
