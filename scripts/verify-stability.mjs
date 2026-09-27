import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=high&hours=15')
await fs.mkdir('artifacts/stability', { recursive: true })
try {
  const audio = await page.evaluate(async () => {
    const { mixer } = await window.__liveImport('/src/world/audio/mixer.ts')
    const context = mixer.audioContext, volumes = mixer.getVolumes()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 300))
    const suspended = context.state
    delete document.hidden
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 300))
    return { suspended, resumed: context.state, volumes, after: mixer.getVolumes() }
  })
  assert.equal(audio.suspended, 'suspended'); assert.equal(audio.resumed, 'running')
  assert.deepEqual(audio.volumes, audio.after)
  console.log('PASS hidden audio suspends and resumes with volumes intact')
  await page.evaluate(() => window.__interact.visitOrb(0))
  await page.waitForTimeout(800)
  const checkpoint = await page.evaluate(async () => {
    const save = await window.__liveImport('/src/ui/save.ts')
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    const { useUiStore } = await window.__liveImport('/src/ui/uiStore.ts')
    useWorldStore.getState().setFov(78)
    if (useWorldStore.getState().soundEnabled) useWorldStore.getState().toggleSound()
    save.flushSave()
    return { position: save.safePosition(), orbs: useUiStore.getState().orbs, fov: 78, muted: true }
  })
  assert.ok(checkpoint.orbs.length > 0)
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.__playerSnapshot().phase === 'FLIGHT')
  for (const mode of ['restored', 'timeout']) {
    const expectedPosition = mode === 'restored' ? checkpoint.position : await page.evaluate(async () => {
      const save = await window.__liveImport('/src/ui/save.ts'); save.flushSave(); return save.safePosition()
    })
    await page.evaluate(() => {
      window.__oldCanvas = document.querySelector('canvas')
      window.__lostContext = window.__oldCanvas.getContext('webgl2').getExtension('WEBGL_lose_context')
      window.__lostContext.loseContext()
    })
    await page.getByRole('heading', { name: '正在恢复画面' }).waitFor()
    await page.keyboard.press('f')
    assert.deepEqual(await page.evaluate(() => window.__playerSnapshot().keys), [])
    if (mode === 'restored') {
      await page.screenshot({ path: 'artifacts/stability/lost.png' })
      await page.evaluate(() => window.__lostContext.restoreContext())
    } else {
      await page.getByRole('button', { name: '重试恢复画面' }).waitFor({ timeout: 18000 })
      await page.screenshot({ path: 'artifacts/stability/retry.png' })
      await page.getByRole('button', { name: '重试恢复画面' }).click()
    }
    await page.waitForFunction(() => !document.querySelector('.graphics-recovery'), null, { timeout: 20000 })
    await page.waitForTimeout(1300)
    const restored = await page.evaluate(async () => {
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      const { useUiStore } = await window.__liveImport('/src/ui/uiStore.ts')
      return { snapshot: window.__playerSnapshot(), orbs: useUiStore.getState().orbs, fov: useWorldStore.getState().fov,
        muted: !useWorldStore.getState().soundEnabled, newCanvas: document.querySelector('canvas') !== window.__oldCanvas }
    })
    assert.ok(restored.newCanvas)
    assert.deepEqual(restored.orbs, checkpoint.orbs); assert.equal(restored.fov, checkpoint.fov); assert.equal(restored.muted, true)
    assert.ok(Math.hypot(...restored.snapshot.position.map((v, i) => v - [expectedPosition.x, expectedPosition.y, expectedPosition.z][i])) < 0.3)
    assert.equal(restored.snapshot.aboard, null); assert.equal(restored.snapshot.phase, 'GROUND')
    assert.ok(restored.snapshot.telemetry.drawCalls > 100, 'replacement canvas actually renders the world')
    await page.screenshot({ path: `artifacts/stability/${mode}.png` })
    await page.getByRole('button', { name: '继续游戏并锁定视角' }).click()
    await page.waitForFunction(() => window.__ui.state().locked)
    await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w')
    assert.ok(Math.abs((await page.evaluate(() => window.__playerSnapshot().position))[2] - expectedPosition.z) > 0.1)
    console.log('PASS WebGL', mode, 'new canvas, saved footing, preserved progress/settings, real input')
  }
  assert.deepEqual(errors, [])
  await fs.writeFile('artifacts/stability/report.json', JSON.stringify({ audio, checkpoint, errors }, null, 2))
} finally { await browser.close() }
