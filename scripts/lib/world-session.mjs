import { launchBrowser } from './chrome.mjs'

/**
 * Shared headless session for the verify scripts: launches Chrome against the dev server, enters the
 * world and drives the DEV review camera. Env: BASE_URL (default http://127.0.0.1:5173/), CHROME_PATH.
 */

/** Review camera views: [eye, look]. */
export const VIEWS = {
  hero: [[0, 40, 210], [0, 60, -200]],
  road: [[0, 9, 150], [0, 14, 60]],
  forecourt: [[0, 36, -62], [0, 28, -170]],
  isle: [[-262, 44, -72], [-302, 31, -102]],
  pillars: [[-400, 160, -100], [-800, 80, -350]],
  overview: [[0, 420, 520], [0, 0, -300]],
  back: [[0, 200, -700], [0, 0, -300]],
  north: [[0, 260, -1300], [0, 250, -2400]],
  east: [[1500, 300, 300], [2200, 220, -500]],
  west: [[-1500, 200, 300], [-2200, 60, -450]],
  tomb: [[-2080, 152, -150], [-2200, 200, -330]],
  south: [[0, 120, 1100], [0, 40, 2450]],
  world: [[1600, 900, 2200], [0, 0, -800]],
}

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173/'
/** Known-harmless console noise (D3D shader compiler warnings, three deprecation notices). */
const NOISE = [/warning X\d+/, /THREE\.Clock: This module has been deprecated/]

/** `language` pins the UI language ('zh' for scripts that assert Chinese copy); English is the first-visit default. */
export async function openWorld(query = '', viewport = { width: 1600, height: 900 }, { language } = {}) {
  const browser = await launchBrowser({ headless: true, args: ['--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const rate = Number(process.env.CPU_THROTTLE || 1)
  if (!Number.isFinite(rate) || rate < 1) { await browser.close(); throw new Error('CPU_THROTTLE must be a number >= 1') }
  if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate })
  const errors = []
  const record = (text) => { if (!NOISE.some((pattern) => pattern.test(text))) errors.push(text.slice(0, 300)) }
  page.on('pageerror', (error) => record(error.message))
  page.on('console', (message) => { if (message.type() === 'error') record(message.text()) })
  await page.goto(new URL(query, BASE_URL).href, { waitUntil: 'domcontentloaded' })
  await page.evaluate((value) => { localStorage.clear(); if (value) localStorage.setItem('yunque.language', value) }, language)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('WORLD READY') && window.__playerSnapshot?.().characterReady?.male, null, { timeout: 180000 })
  await page.locator('.enter-button').click()
  await page.waitForTimeout(2500)
  // Vite can retain timestamped module URLs after an edit, even on a fresh page. Use the instance the app loaded.
  await installLiveImports(page)
  return { browser, page, errors }
}

export async function installLiveImports(page) {
  await page.evaluate(() => {
    const modules = new Map()
    window.__liveImport = (path) => {
      if (!modules.has(path)) {
        const entry = performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === path)
        modules.set(path, import(entry?.name ?? path))
      }
      return modules.get(path)
    }
  })
}

/** Moves the review camera and waits for streaming, LOD buckets and weather blends to settle. */
export async function review(page, [eye, look], settle = 1800) {
  await page.evaluate(([e, l]) => window.__environmentReview(e, l), [eye, look])
  await page.waitForTimeout(settle)
}

export const telemetry = (page) => page.evaluate(() => window.__playerSnapshot().telemetry)
