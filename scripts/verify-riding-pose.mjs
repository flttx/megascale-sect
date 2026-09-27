import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 2000, height: 1500 } })
const errors = [], poses = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await fs.mkdir('artifacts/riding-pose', { recursive: true })
const snapshot = () => page.evaluate(() => window.__playerSnapshot(true))
const phase = (p) => page.waitForFunction((p) => window.__playerSnapshot?.().phase === p, p)
async function orbit(angle) {
  await page.evaluate((angle) => {
    const e = new MouseEvent('mousemove', { bubbles: true, altKey: true })
    Object.defineProperty(e, 'movementX', { value: angle / 0.0025 })
    window.dispatchEvent(e)
  }, angle)
  await page.waitForTimeout(700)
}
async function capture(name) {
  const image = await page.screenshot({ path: `artifacts/riding-pose/${name}.png` })
  // One NaN from any shader is smeared across the whole frame by bloom (flight black frames, R5b). Only the
  // centre half is measured, clear of the HUD; stats() reads the encoded input, so greyscale into a new buffer.
  const { width, height } = await sharp(image).metadata()
  const centre = await sharp(image).extract({ left: width >> 2, top: height >> 2, width: width >> 1, height: height >> 1 }).greyscale().toBuffer()
  const { channels: [luma] } = await sharp(centre).stats()
  assert.ok(luma.mean > 8, `${name}: black frame (mean luma ${luma.mean.toFixed(1)})`)
  const state = await snapshot()
  poses.push({ name, phase: state.phase, ridingPose: state.ridingPose, contact: state.ridingContact })
  return state
}
function check(state) {
  const joint = (name) => state.ridingPose.find((p) => p.name.endsWith(name)).local
  const left = joint('LeftFoot'), right = joint('RightFoot'), lh = joint('LeftHand'), rh = joint('RightHand')
  assert.ok(right[2] - left[2] > 0.38, 'Feet must be staggered along the blade')
  assert.ok(Math.abs(left[0]) < 0.06 && Math.abs(right[0]) < 0.06, 'Both feet must be on the narrow blade')
  assert.ok(Math.abs(left[1]) < 0.07 && Math.abs(right[1]) < 0.07, 'Feet must remain at deck height')
  assert.ok(lh[2] > 0.09 && rh[2] > 0.09, 'Both hands must be behind the back')
  assert.ok(Math.hypot(...lh.map((v, i) => v - rh[i])) < 0.09, 'Wrists must meet behind the waist')
  assert.equal(state.ridingContact.length, 2)
  for (const contact of state.ridingContact) {
    assert.ok(Number.isFinite(contact.gap), 'The blade must be directly below each foot')
    assert.ok(Math.abs(contact.gap) < 0.012, 'Boot soles must meet the blade within 12 mm')
  }
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => { const r = window.__playerSnapshot?.().characterReady; return r?.male && r?.female }, null, { timeout: 120000 })
  await page.getByRole('button', { name: /进入仙宗/ }).click({ timeout: 120000 })
  for (const character of ['male', 'female']) {
    await page.waitForFunction(() => document.pointerLockElement !== null)
    await page.waitForFunction(() => window.__playerSnapshot?.().ready)
    await page.waitForTimeout(400)
    await page.keyboard.press(character === 'male' ? '1' : '2')
    await page.keyboard.press('f'); await phase('BOARDING')
    await page.waitForTimeout(1050)
    await capture(`${character}-touchdown`)
    await phase('FLIGHT'); await page.waitForTimeout(600)
    check(await capture(`${character}-rear`))
    await page.keyboard.down('Alt')
    await orbit(Math.PI / 2)
    check(await capture(`${character}-side`))
    await orbit(Math.PI / 2)
    await capture(`${character}-front`)
    await page.keyboard.up('Alt')
    await page.keyboard.down('Space'); await page.waitForTimeout(650); await page.keyboard.up('Space')
    await page.keyboard.down('w'); await page.keyboard.down('Shift'); await page.waitForTimeout(650)
    check(await capture(`${character}-moving`))
    await page.keyboard.down('x'); await page.waitForTimeout(450)
    check(await capture(`${character}-braking`))
    await page.keyboard.up('x'); await page.keyboard.up('w'); await page.keyboard.up('Shift')
    await page.keyboard.down('d'); await page.waitForTimeout(250)
    const turning = await capture(`${character}-banking`)
    check(turning)
    assert.ok(Math.abs(turning.bank) > 0.04, 'Check foot contact while the sword is banked')
    await page.keyboard.up('d')
    await page.keyboard.down('x'); await page.waitForTimeout(450); await page.keyboard.up('x')
    // Screenshot/geometry readback can take long enough to drift off the road.
    // Return above its center before requesting the grounded landing sequence.
    if ((await snapshot()).position[0] > 0.5) {
      await page.keyboard.down('a')
      await page.waitForFunction(() => window.__playerSnapshot().position[0] < 0.5)
      await page.keyboard.up('a')
      await page.keyboard.down('x'); await page.waitForTimeout(450); await page.keyboard.up('x')
    }
    await page.keyboard.press('f'); await phase('GROUND'); await page.waitForTimeout(600)
    await capture(`${character}-ground`)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ poses: poses.map((p) => ({ name: p.name, contact: p.contact })), errors }, null, 2))
} finally {
  await fs.writeFile('artifacts/riding-pose/report.json', JSON.stringify({ poses, errors }, null, 2))
  await browser.close()
}
