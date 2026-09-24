import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { openWorld, review, VIEWS } from './lib/world-session.mjs'

/*
 * Visual regression sweep in one session: key views across the day (06/12/17.5/22 h), every weather at the
 * hero view, and a lightning strike. Each frame (HUD hidden) is checked for luminance mean/stddev so a black,
 * blown-out or flat (fog/NaN smear) frame fails. Writes artifacts/visual/*.png plus contact.png; exits 1 on failure.
 */

const OUT = 'artifacts/visual'
const TIMES = [6, 12, 17.5, 22]
const TIME_VIEWS = ['hero', 'forecourt', 'isle', 'overview']
const WEATHERS = ['mist', 'rain', 'snow', 'storm']
const LIMITS = { minMean: 10, maxMean: 235, minStd: 6 }
const THUMB = { width: 320, height: 180 }

await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=12&weather=clear')
await page.evaluate(() => { window.__ui.setHudHidden(true); window.__setWeather('clear') })

const frames = []
async function capture(name, extra = {}) {
  const buffer = await page.screenshot()
  const file = path.join(OUT, `${name}.png`)
  await fs.writeFile(file, buffer)
  const { channels: [luma] } = await sharp(buffer).greyscale().stats()
  const frame = { name, file, mean: Math.round(luma.mean * 10) / 10, std: Math.round(luma.stdev * 10) / 10, ...extra }
  frame.ok = frame.mean >= LIMITS.minMean && frame.mean <= LIMITS.maxMean && frame.std >= LIMITS.minStd && extra.ok !== false
  frames.push(frame)
  console.log(`${frame.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} mean ${String(frame.mean).padStart(5)}  std ${String(frame.std).padStart(5)}`)
}

for (const hours of TIMES) {
  await page.evaluate((h) => window.__setTimeOfDay(h), hours)
  for (const view of TIME_VIEWS) {
    await review(page, VIEWS[view], 1600)
    await capture(`t${String(hours).replace('.', '_')}-${view}`)
  }
}

await page.evaluate(() => window.__setTimeOfDay(15))
for (const kind of WEATHERS) {
  await page.evaluate((k) => window.__setWeather(k), kind)
  await review(page, VIEWS.hero, 2200)
  const state = await page.evaluate(() => window.__weatherState())
  // Precipitation must actually be on screen when its weather is up.
  const drawn = kind === 'snow' ? state.snowDrawn > 0 : kind === 'rain' || kind === 'storm' ? state.rainDrawn > 0 : true
  await capture(`w-${kind}`, { ok: drawn, rainDrawn: state.rainDrawn, snowDrawn: state.snowDrawn })
}

// Storm is still up: strike and grab the flash while it is bright.
await page.evaluate(() => window.__strikeLightning())
await page.waitForTimeout(90)
const flash = await page.evaluate(() => window.__weatherState().flash)
await capture('w-lightning', { ok: flash > 0.05, flash: Math.round(flash * 100) / 100 })
const stormMean = frames.find((f) => f.name === 'w-storm').mean
const lightning = frames.at(-1)
if (lightning.mean <= stormMean) { lightning.ok = false; console.log(`FAIL lightning frame not brighter than storm (${lightning.mean} <= ${stormMean})`) }
await browser.close()

// Contact sheet: one row per time of day, then the weather row.
const columns = Math.max(TIME_VIEWS.length, WEATHERS.length + 1)
const rows = TIMES.length + 1
const label = (text, ok) => Buffer.from(`<svg width="${THUMB.width}" height="22"><rect width="100%" height="100%" fill="${ok ? '#000a' : '#b00c'}"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${text}</text></svg>`)
const tiles = await Promise.all(frames.map(async (frame, index) => {
  const row = index < TIMES.length * TIME_VIEWS.length ? Math.floor(index / TIME_VIEWS.length) : TIMES.length
  const column = index < TIMES.length * TIME_VIEWS.length ? index % TIME_VIEWS.length : index - TIMES.length * TIME_VIEWS.length
  const input = await sharp(frame.file).resize(THUMB.width, THUMB.height)
    .composite([{ input: label(`${frame.name}  μ${frame.mean} σ${frame.std}`, frame.ok), top: 0, left: 0 }]).png().toBuffer()
  return { input, top: row * THUMB.height, left: column * THUMB.width }
}))
await sharp({ create: { width: columns * THUMB.width, height: rows * THUMB.height, channels: 3, background: '#111' } })
  .composite(tiles).png().toFile(path.join(OUT, 'contact.png'))

const failed = frames.filter((f) => !f.ok)
await fs.writeFile(path.join(OUT, 'visual.json'), JSON.stringify({ limits: LIMITS, frames, errors }, null, 2))
console.log(`${frames.length - failed.length}/${frames.length} frames ok; contact sheet ${OUT}/contact.png`)
if (errors.length) console.log('PAGE ERRORS', JSON.stringify(errors.slice(0, 8)))
process.exit(failed.length || errors.length ? 1 : 0)
