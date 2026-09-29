import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { launchBrowser } from './lib/chrome.mjs'

await fs.mkdir('artifacts/r9', { recursive: true })
const browser = await launchBrowser({ args: ['--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = [], report = {}
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error' && !/warning X\d+/.test(message.text())) errors.push(message.text()) })
try {
  const start = Date.now()
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.enter-button')?.disabled === false, null, { timeout: 180000 })
  report.readyMs = Date.now() - start
  const modules = () => page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /\.(m?js)(\?|$)/.test(name)))
  report.initialModules = await modules()
  assert.ok(!report.initialModules.some((name) => /PhotoMode-|ScrollOverlay-/.test(name)), 'optional panels must not load with the entry bundle')
  await page.getByRole('button', { name: /进入仙宗|Enter the sect/ }).click(); await page.waitForFunction(() => document.pointerLockElement)
  let before = Date.now()
  await page.keyboard.press('Tab'); await page.locator('.scroll-tabs').waitFor()
  report.firstScrollMs = Date.now() - before
  assert.ok((await modules()).some((name) => /ScrollOverlay-/.test(name)))
  await page.locator('.scroll-close').click(); await page.waitForFunction(() => document.pointerLockElement)
  await page.locator('.scroll-dialog').waitFor({ state: 'detached' })
  before = Date.now()
  await page.keyboard.press('p'); await page.locator('.photo-panel').waitFor()
  report.firstPhotoMs = Date.now() - before
  assert.ok((await modules()).some((name) => /PhotoMode-/.test(name)))
  await page.keyboard.press('p'); await page.evaluate(() => document.exitPointerLock())
  await page.locator('.settings-dialog').waitFor()
  await page.getByRole('button', { name: '极致', exact: true }).click()
  await page.locator('.settings-dialog .character-picker button').nth(1).click()
  await page.waitForTimeout(1500)
  await page.locator('.settings-resume').click(); await page.waitForFunction(() => document.pointerLockElement)
  await page.locator('.settings-dialog').waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.__lostCanvas = document.querySelector('canvas')
    window.__restore = window.__lostCanvas.getContext('webgl2').getExtension('WEBGL_lose_context')
    window.__restore.loseContext()
  })
  await page.getByRole('heading', { name: '正在恢复画面' }).waitFor()
  await page.evaluate(() => window.__restore.restoreContext())
  await page.waitForFunction(() => document.querySelector('canvas') !== window.__lostCanvas && !document.querySelector('.graphics-recovery'), null, { timeout: 20000 })
  await page.locator('.settings-dialog').waitFor()
  assert.equal(await page.locator('.settings-dialog .character-picker button').nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: '极致', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.locator('.settings-resume').click(); await page.waitForFunction(() => document.pointerLockElement)
  await page.locator('.settings-dialog').waitFor({ state: 'detached' })
  await page.keyboard.press('Tab'); await page.locator('.scroll-tabs').waitFor()
  await page.locator('.scroll-close').click()
  await page.locator('.scroll-dialog').waitFor({ state: 'detached' })
  await page.keyboard.press('p'); await page.locator('.photo-panel').waitFor()
  await page.screenshot({ path: 'artifacts/r9/production-restored.png' })
  assert.deepEqual(errors, [])
  console.log('PASS production lazy panels, quality switch and WebGL recovery', JSON.stringify(report))
} catch (error) {
  report.failure = await page.evaluate(() => ({ text: document.body.innerText, focus: document.activeElement?.outerHTML, locked: !!document.pointerLockElement }))
  await page.screenshot({ path: 'artifacts/r9/loading-failure.png' })
  throw error
} finally {
  await fs.writeFile('artifacts/r9/loading.json', JSON.stringify({ ...report, errors }, null, 2))
  await browser.close()
}
