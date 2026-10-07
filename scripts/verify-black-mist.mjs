import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { openWorld, installLiveImports, review, VIEWS } from './lib/world-session.mjs'

// End-to-end mode entry, cinematic ownership, pause/skip, sound, and the explorable aftermath.
// Uses the same clock and rendered scene as play. BASE_URL and CHROME_PATH follow world-session.
const OUT = 'artifacts/black-mist'
const viewport = { width: 1600, height: 900 }
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=mid&hours=15&weather=clear', viewport)
const report = { checks: [], frames: [], errors, failure: null }
const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())
const check = (name, value) => {
  assert.ok(value, name)
  report.checks.push(name)
  console.log('PASS', name)
}
const hold = (value) => page.evaluate((held) => window.__blackMist.hold(held), value)
async function seek(seconds) {
  await page.evaluate((time) => {
    window.__blackMist.hold(true)
    window.__blackMist.seek(time)
  }, seconds)
  await page.waitForTimeout(750)
  return snapshot()
}
async function capture(name) {
  const buffer = await page.screenshot({ path: `${OUT}/${name}.png` })
  const inner = await sharp(buffer)
    .extract({ left: 0, top: 105, width: viewport.width, height: 585 })
    .greyscale()
    .toBuffer()
  const {
    channels: [luma],
  } = await sharp(inner).stats()
  const frame = { name, mean: Number(luma.mean.toFixed(1)), std: Number(luma.stdev.toFixed(1)) }
  report.frames.push(frame)
  check(`rendered frame ${name} has visible depth`, frame.mean > 7 && frame.mean < 240 && frame.std > 5)
}
async function focusWorld() {
  await page.locator('canvas').click({ position: { x: 1200, y: 350 } })
  await page.waitForFunction(() => !!document.pointerLockElement)
}
try {
  // A fresh title-screen choice exercises the actual user path, including the audio gesture.
  await page.evaluate(() => {
    if (document.pointerLockElement) document.exitPointerLock()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await installLiveImports(page)
  await page.waitForFunction(() => document.querySelector('.enter-button')?.disabled === false, null, {
    timeout: 180000,
  })
  await page.locator('input[name="world-experience"][value="black-mist"]').check()
  check(
    'title screen offers a distinct Black Mist experience',
    (await page.locator('.intro-screen').getAttribute('data-experience')) === 'black-mist',
  )
  check('English is the first-visit mode language', await page.evaluate(() => document.documentElement.lang === 'en'))
  await page.screenshot({ path: `${OUT}/intro.png` })
  await page.locator('.enter-button').click()
  await page.waitForFunction(() => window.__blackMist?.snapshot().cinematic && window.__ui.state().started)
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 70000 })
  await page.waitForTimeout(500)
  check(
    'entry starts cinematic without pointer lock',
    await page.evaluate(() => !document.pointerLockElement && window.__ui.state().cameraMode === 'cinematic'),
  )
  check(
    'cinematic has accessible skip and sound controls',
    (await page.locator('.black-mist-skip').getAttribute('aria-label')) !== null &&
      (await page.locator('.black-mist-cinema-actions button[aria-pressed]').count()) === 1,
  )

  const beforeMove = await page.evaluate(() => window.__playerSnapshot().position)
  await page.locator('canvas').focus()
  await page.keyboard.down('w')
  await page.waitForTimeout(450)
  await page.keyboard.up('w')
  const afterMove = await page.evaluate(() => window.__playerSnapshot().position)
  check(
    'WASD cannot move the player during the cinematic',
    beforeMove.every((value, i) => Math.abs(value - afterMove[i]) < 0.01),
  )
  await page.keyboard.press('p')
  await page.keyboard.press('e')
  await page.keyboard.press('f')
  check(
    'cinematic blocks photo and interaction',
    await page.evaluate(() => window.__ui.state().cameraMode === 'cinematic' && !window.__ui.state().overlay),
  )

  // Actual Esc opens settings and freezes both the event clock and camera.
  await page.keyboard.press('Escape')
  await page.locator('.settings-dialog').waitFor()
  const paused = await snapshot()
  await page.waitForTimeout(550)
  const pausedLater = await snapshot()
  check(
    'Esc settings freezes cinematic time and camera',
    paused.manualPaused &&
      pausedLater.paused &&
      paused.elapsed === pausedLater.elapsed &&
      paused.camera.every((value, i) => value === pausedLater.camera[i]),
  )
  await page.locator('.settings-dialog .language-picker').getByRole('button', { name: '中文' }).click()
  check(
    'Chinese cinematic labels and accessible skip name are localized',
    (await page.locator('.black-mist-skip').getAttribute('aria-label')) === '跳过过场，进入异变世界',
  )
  await page.locator('.settings-dialog .language-picker').getByRole('button', { name: 'English' }).click()
  await page.locator('.settings-resume').click()
  await page.locator('.settings-dialog').waitFor({ state: 'detached' })
  check(
    'resuming cinematic keeps the mouse free',
    await page.evaluate(() => !document.pointerLockElement && window.__blackMist.snapshot().cinematic),
  )

  // Sound controls use the shared master switch; runtime audio state confirms real graph gating.
  const sound = page.locator('.black-mist-cinema-actions button[aria-pressed]')
  await sound.click()
  await page.waitForTimeout(250)
  const muted = await snapshot()
  check(
    'cinematic mute gates its audio graph',
    (await sound.getAttribute('aria-pressed')) === 'false' && !muted.audio.audible,
  )
  await sound.click()
  await page.waitForTimeout(250)
  check(
    'cinematic sound resumes after unmuting',
    (await sound.getAttribute('aria-pressed')) === 'true' && (await snapshot()).audio.audible,
  )

  for (const time of [0, 8, 18, 29, 36, 39, 45, 48, 53, 64]) {
    const state = await seek(time)
    check(
      `timeline ${time}s is cinematic with a finite moving front`,
      state.cinematic &&
        Number.isFinite(state.front) &&
        state.camera.every(Number.isFinite) &&
        state.corruption >= 0 &&
        state.corruption <= 1,
    )
    await capture(`cinematic-${String(time).padStart(2, '0')}`)
    if (time >= 53)
      check(
        `eldritch mutation is visible at ${time}s`,
        state.landmarks.every((landmark) => landmark.visible && landmark.scale.some((value) => value > 0.9)),
      )
  }
  const visibleNames = (await snapshot()).sceneNames
  check(
    'the scene preserves exploration without added disciple or player-combat actors',
    Array.isArray(visibleNames) && !visibleNames.some((name) => /disciple|playerCombat|invasionWar|npc/i.test(name)),
  )
  const coreIsSolid = () =>
    page.evaluate(async () => {
      const { insideAnyCollider } = await window.__liveImport('/src/world/surfaces.ts')
      const { ARMILLARY } = await window.__liveImport('/src/world/colossi/layout.ts')
      return insideAnyCollider(...ARMILLARY.position, 0)
    })
  check('the consumed instrument leaves no invisible flight blocker', !(await coreIsSolid()))

  for (const [time, cue] of [
    [27.8, 'front-impact'],
    [34, 'watcher-apparition'],
    [34.8, 'sect-impact'],
    [37, 'behemoth-apparition'],
    [40, 'kun-mutation'],
    [42.8, 'world-transformation'],
    [46, 'turtle-mutation'],
  ]) {
    await seek(time)
    await hold(false)
    await page.waitForFunction((id) => window.__blackMist.snapshot().audio.cues.includes(id), cue, { timeout: 10000 })
    await hold(true)
    check(`cinematic audio plays synchronized ${cue}`, (await snapshot()).audio.cues.includes(cue))
  }

  // Button skip preserves a fully transformed world, then its CTA acquires real pointer lock.
  await page.locator('.black-mist-skip').click()
  await page.waitForFunction(() => window.__blackMist.snapshot().awaitingExplore)
  const handoff = await snapshot()
  check(
    'skip completes transformation and offers exploration',
    !handoff.cinematic && handoff.phase === 'aftermath' && handoff.corruption === 1,
  )
  await page.screenshot({ path: `${OUT}/handoff.png` })
  await hold(false)
  await page.locator('.black-mist-explore').click()
  await page.waitForFunction(() => !!document.pointerLockElement && !window.__blackMist.snapshot().awaitingExplore)
  check('exploration CTA locks the pointer and keeps the mutation', (await snapshot()).corruption === 1)
  const start = await page.evaluate(() => window.__playerSnapshot().position)
  await page.keyboard.down('w')
  await page.waitForTimeout(850)
  await page.keyboard.up('w')
  const moved = await page.evaluate(() => window.__playerSnapshot().position)
  check('walking continues in the altered world', Math.hypot(moved[0] - start[0], moved[2] - start[2]) > 1)

  await page.keyboard.press('f')
  await page.waitForFunction(() => window.__playerSnapshot().phase === 'FLIGHT', null, { timeout: 15000 })
  const flightStart = await page.evaluate(() => window.__playerSnapshot().position)
  await page.keyboard.down('w')
  await page.keyboard.down('Space')
  try {
    await page.waitForFunction(
      (start) => {
        const state = window.__playerSnapshot(),
          p = state.position
        return state.phase === 'FLIGHT' && Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]) > 3
      },
      flightStart,
      { timeout: 10000 },
    )
  } finally {
    await page.keyboard.up('w')
    await page.keyboard.up('Space')
  }
  const flightMoved = await page.evaluate(() => window.__playerSnapshot().position)
  check(
    'sword flight remains usable after the transformation',
    Math.hypot(flightMoved[0] - flightStart[0], flightMoved[1] - flightStart[1], flightMoved[2] - flightStart[2]) > 3,
  )
  await page.keyboard.press('p')
  await page.waitForFunction(() => window.__ui.state().cameraMode === 'photo')
  await page.locator('.photo-panel').waitFor()
  const photoCount = await page.evaluate(() => window.__ui.state().photos)
  const download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  const photo = await download
  await page.waitForFunction((count) => window.__ui.state().photos > count, photoCount)
  check(
    'photo mode exports the mutated world',
    photo.suggestedFilename().endsWith('.png') && (await snapshot()).corruption === 1,
  )
  await page.keyboard.press('p')
  await page.waitForFunction(() => window.__ui.state().cameraMode === 'player')
  if (!(await page.evaluate(() => !!document.pointerLockElement))) await focusWorld()

  const stele = await page.evaluate(() => window.__interact.sites().find((site) => site.kind === 'stele'))
  assert.ok(stele, 'an exploration stele must exist')
  await page.evaluate((id) => window.__interact.standAt(id), stele.id)
  await page.waitForTimeout(750)
  await page.keyboard.press('e')
  await page.locator('.lore-dialog').waitFor()
  check(
    'existing exploration interactions work in the aftermath',
    (await page.evaluate(() => window.__ui.state().overlay?.kind === 'lore')) && (await snapshot()).corruption === 1,
  )
  await page.keyboard.press('e')
  await page.locator('.lore-dialog').waitFor({ state: 'detached' })
  await review(page, VIEWS.hero, 1300)
  await capture('aftermath-hero')
  await review(page, VIEWS.overview, 1300)
  await capture('aftermath-overview')

  await page.evaluate(() => window.__environmentReview(null))
  if (!(await page.evaluate(() => !!document.pointerLockElement))) await focusWorld()
  await page.keyboard.press('h')
  check('H can hide the exploration HUD', await page.evaluate(() => window.__ui.state().hudHidden))
  await page.keyboard.press('Escape')
  // Headless keyboard dispatch does not always perform Chrome's native Esc lock release.
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.evaluate(() => document.exitPointerLock())
  await page.locator('.settings-dialog').waitFor()
  await page.locator('.settings-dialog').getByRole('button', { name: 'Replay cinematic', exact: true }).click()
  await page.waitForFunction(() => window.__blackMist.snapshot().cinematic && !window.__ui.state().hudHidden)
  check('replay restores cinematic controls after H hid the HUD', await page.locator('.black-mist-skip').isVisible())
  check('replay restores the unaltered instrument collider', await coreIsSolid())
  await seek(18)
  await hold(false)
  await page.locator('canvas').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__blackMist.snapshot().awaitingExplore)
  check('Space skips through the keyboard path', !(await snapshot()).cinematic && (await snapshot()).corruption === 1)

  // A return to normal exploration must release shared shader uniforms as well as scene actors.
  const normal = await page.evaluate(async () => {
    const { stopBlackMist } = await window.__liveImport('/src/world/blackMist/runtime.ts')
    const { BLACK_MIST_UNIFORMS } = await window.__liveImport('/src/world/blackMist/materials.ts')
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    window.__blackMist.hold(false)
    stopBlackMist()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return {
      active: window.__blackMist.snapshot().active,
      mode: useWorldStore.getState().gameMode,
      corruption: BLACK_MIST_UNIFORMS.uMistCorruption.value,
      amount: BLACK_MIST_UNIFORMS.uMistAmount.value,
    }
  })
  check(
    'normal exploration clears mutation and all shared shader state',
    !normal.active && normal.mode === 'exploration' && normal.corruption === 0 && normal.amount === 0,
  )
  check('normal exploration restores the original instrument collider', await coreIsSolid())
  check('WebGL and browser report no errors', errors.length === 0)
} catch (error) {
  report.failure = error.stack ?? String(error)
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
