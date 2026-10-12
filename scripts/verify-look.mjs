import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { openWorld, review, VIEWS } from './lib/world-session.mjs'

/**
 * Look baseline for art passes: fixed views × times of day in clear weather, HUD hidden, one contact sheet per time.
 *   node scripts/verify-look.mjs <label>            capture artifacts/look/<label>/
 *   node scripts/verify-look.mjs --compare <a> <b>  side-by-side sheets of two captures (no browser)
 * Frames are checked only for being neither black, blown out nor flat; judging the look is a human review.
 */
const OUT = 'artifacts/look'
const TIMES = [6, 12, 15, 17.5]
const SHOTS = {
  ...Object.fromEntries(
    ['hero', 'road', 'forecourt', 'isle', 'pillars', 'overview', 'north', 'east', 'west', 'south'].map((v) => [
      v,
      VIEWS[v],
    ]),
  ),
  // Eye height on the summit plaza toward the main hall: the human-scale read of the colossal architecture.
  plazaEye: [
    [36, 25.7, -96],
    [0, 60, -320],
  ],
  // Skimming the cloud sea among the pillars.
  cloudSkim: [
    [-180, -70, 160],
    [-520, -40, -260],
  ],
}
const THUMB = { width: 480, height: 270 }
const LIMITS = { minMean: 10, maxMean: 235, minStd: 6 }
const tag = (hours) => `t${String(hours).replace('.', '_')}`

async function sheet(files, columns, file) {
  const rows = Math.ceil(files.length / columns)
  const tiles = await Promise.all(
    files.map(async (input, i) => ({
      input: await sharp(input).resize(THUMB.width, THUMB.height).toBuffer(),
      left: (i % columns) * THUMB.width,
      top: Math.floor(i / columns) * THUMB.height,
    })),
  )
  await sharp({
    create: { width: columns * THUMB.width, height: rows * THUMB.height, channels: 3, background: '#000' },
  })
    .composite(tiles)
    .png()
    .toFile(file)
}

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3)
  const dir = path.join(OUT, `${a}-vs-${b}`)
  await fs.mkdir(dir, { recursive: true })
  for (const hours of TIMES)
    for (const name of Object.keys(SHOTS)) {
      const pair = [a, b].map((label) => path.join(OUT, label, `${tag(hours)}-${name}.png`))
      await sheet(pair, 2, path.join(dir, `${tag(hours)}-${name}.png`))
    }
  console.log(`compare sheets in ${dir}`)
} else {
  const label = process.argv[2] ?? 'latest'
  const dir = path.join(OUT, label)
  await fs.mkdir(dir, { recursive: true })
  const { browser, page, errors } = await openWorld('?quality=high&hours=12&weather=clear')
  let failed = 0
  try {
    await page.evaluate(() => {
      window.__ui.setHudHidden(true)
      window.__setWeather('clear')
    })
    for (const hours of TIMES) {
      await page.evaluate((h) => window.__setTimeOfDay(h), hours)
      const files = []
      for (const [name, view] of Object.entries(SHOTS)) {
        await review(page, view, 2000)
        const file = path.join(dir, `${tag(hours)}-${name}.png`)
        const buffer = await page.screenshot()
        await fs.writeFile(file, buffer)
        const {
          channels: [luma],
        } = await sharp(await sharp(buffer).greyscale().toBuffer()).stats()
        const ok = luma.mean >= LIMITS.minMean && luma.mean <= LIMITS.maxMean && luma.stdev >= LIMITS.minStd
        if (!ok) failed++
        console.log(
          `${ok ? 'ok  ' : 'FAIL'} ${tag(hours)}-${name} mean ${luma.mean.toFixed(1)} std ${luma.stdev.toFixed(1)}`,
        )
        files.push(file)
      }
      await sheet(files, 4, path.join(dir, `${tag(hours)}-sheet.png`))
    }
    if (errors.length) console.log(`errors: ${errors.join(' | ')}`)
    if (failed || errors.length) process.exitCode = 1
  } finally {
    await browser.close()
  }
}
