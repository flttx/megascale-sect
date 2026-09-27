import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: process.env.SOFTWARE ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--use-angle=d3d11'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error' && !/warning X\d+/.test(message.text())) errors.push(message.text()) })
try {
await fs.mkdir('artifacts', { recursive: true })
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.innerText.includes('WORLD READY'), null, { timeout: 120000 })
await page.waitForTimeout(2000)
await page.screenshot({ path: 'artifacts/intro.png' })
await page.getByRole('button', { name: /进入仙宗/ }).click()
await page.waitForFunction(() => window.__playerSnapshot?.().ready && !!document.pointerLockElement)
await page.waitForTimeout(1200)
await page.screenshot({ path: 'artifacts/spawn.png' })
await page.keyboard.press('F3')
await page.waitForTimeout(700)
const initial = await page.locator('.debug-hud').innerText()
await page.keyboard.press('f')
await page.waitForFunction(() => window.__playerSnapshot().phase === 'FLIGHT')
await page.keyboard.down('w')
await page.waitForTimeout(2000)
await page.keyboard.up('w')
await page.waitForTimeout(700)
const flight = await page.locator('.debug-hud').innerText()
await page.screenshot({ path: 'artifacts/flight.png' })
const renderer = await page.evaluate(() => {
  const context = document.querySelector('canvas')?.getContext('webgl2')
  const extension = context?.getExtension('WEBGL_debug_renderer_info')
  return extension ? context?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
})
console.log(JSON.stringify({ renderer, initial, flight, errors }, null, 2))
assert.equal(await page.evaluate(() => window.__playerSnapshot().phase), 'FLIGHT')
assert.ok(await page.evaluate(() => window.__playerSnapshot().telemetry.drawCalls > 100), 'world must render')
assert.deepEqual(errors, [], 'browser errors fail smoke')
} finally { await browser.close() }
