import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { openWorld, review } from './lib/world-session.mjs'

// Render the actual mist-sky fragment at neighboring directions, then inspect the same meridian in-scene.
// Run alone against BASE_URL / CHROME_PATH. No shader/noise formula is reproduced by this verifier.
const OUT = 'artifacts/black-mist-sky'
const report = { checks: [], probes: [], frames: [], errors: [], failure: null }
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const eye = [0, 500, 0],
  epsilon = 0.00001
const ray = (elevation, angle) => [-Math.cos(angle), elevation, Math.sin(angle)]
const directions = [],
  pairs = []
for (const elevation of [0.2, 0.7, 1.5, 5]) {
  const addPair = (name, a, b) => {
    const start = directions.length
    directions.push(a, b)
    pairs.push({ name, elevation, start })
  }
  addPair('former-atan-meridian', [-1, elevation, -epsilon], [-1, elevation, epsilon])
  for (const angle of [-Math.PI / 2, -0.6, 0.6, Math.PI / 2])
    addPair(`control-${angle}`, ray(elevation, angle - epsilon), ray(elevation, angle + epsilon))
}
const zenithStart = directions.length
for (let index = 0; index < 12; index++) {
  const angle = (index / 12) * Math.PI * 2
  directions.push([Math.cos(angle) * 0.0001, 1, Math.sin(angle) * 0.0001])
}
directions.push([0, 1, 0])
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear', { width: 1280, height: 720 })
report.errors = errors

async function probe(time) {
  return page.evaluate(
    async ({ directions, time }) => {
      const { BLACK_MIST_UNIFORMS } = await window.__liveImport('/src/world/blackMist/materials.ts')
      const originalTime = BLACK_MIST_UNIFORMS.uMistTime.value
      // Only the test's synchronous offscreen draw sees this fixed uniform. Restore it before any scene frame.
      try {
        BLACK_MIST_UNIFORMS.uMistTime.value = time
        return window.__blackMist.skyProbe(directions)
      } finally {
        BLACK_MIST_UNIFORMS.uMistTime.value = originalTime
      }
    },
    { directions, time },
  )
}

async function capture(name, direction) {
  const look = direction.map((value, axis) => eye[axis] + value * 1000)
  await review(page, [eye, look], 220)
  const filename = `${OUT}/${name}.png`,
    bytes = await page.screenshot({ path: filename })
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const center = [0, 0, 0]
  for (let y = info.height / 2 - 2; y <= info.height / 2 + 2; y++)
    for (let x = info.width / 2 - 2; x <= info.width / 2 + 2; x++) {
      for (let channel = 0; channel < 3; channel++)
        center[channel] += data[(y * info.width + x) * info.channels + channel] / 25
    }
  const frame = { name, filename, eye, direction, center }
  report.frames.push(frame)
  return frame
}

try {
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 180000 })
  await page.evaluate(() => {
    window.__blackMist.hold(true)
    window.__blackMist.seek(55)
    window.__blackMist.skip()
    window.__blackMist.hold(true)
    window.__ui.setHudHidden(true)
  })
  check(
    'the actual renderer exposes the live sky diagnostic',
    await page.evaluate(() => typeof window.__blackMist.skyProbe === 'function'),
  )
  for (const quality of ['high', 'mid', 'low']) {
    await page.evaluate(async (quality) => {
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      useWorldStore.getState().setQuality(quality, false)
    }, quality)
    await page.waitForTimeout(300)
    for (const time of [0, 12.5, 47]) {
      const result = await probe(time)
      check(
        `${quality}/${time}s uses the compiled live mist-sky material`,
        result.material === 'BlackMistSkyVeil' &&
          result.time === time &&
          result.corruption > 0.95 &&
          result.samples.length === directions.length &&
          result.samples.every(
            (sample) =>
              sample.rgba.length === 4 &&
              sample.rgba.every((value) => Number.isFinite(value) && value >= 0 && value <= 255),
          ),
      )
      const measurements = pairs.map(({ name, elevation, start }) => ({
        name,
        elevation,
        a: result.samples[start].rgba,
        b: result.samples[start + 1].rgba,
        jump: difference(result.samples[start].rgba, result.samples[start + 1].rgba),
      }))
      const controls = measurements.filter((pair) => pair.name !== 'former-atan-meridian')
      const meridians = measurements.filter((pair) => pair.name === 'former-atan-meridian')
      check(
        `${quality}/${time}s has no rendered discontinuity across the former atan branch`,
        meridians.every((pair) => pair.jump <= 3) &&
          Math.max(...meridians.map((pair) => pair.jump)) <=
            Math.max(3, Math.max(...controls.map((pair) => pair.jump)) * 3),
      )
      const pole = result.samples.slice(zenithStart).map((sample) => sample.rgba)
      check(
        `${quality}/${time}s approaches zenith continuously from every azimuth`,
        pole.every((rgba) => difference(rgba, pole.at(-1)) <= 3),
      )
      report.probes.push({ quality, time, material: result.material, meridians, controls, zenith: pole })
    }
    for (const [label, elevation] of [
      ['low', 0.2],
      ['high', 0.7],
    ]) {
      const left = await capture(`${quality}-meridian-${label}-left`, ray(elevation, (-0.5 * Math.PI) / 180))
      await capture(`${quality}-meridian-${label}-center`, ray(elevation, 0))
      const right = await capture(`${quality}-meridian-${label}-right`, ray(elevation, (0.5 * Math.PI) / 180))
      check(
        `${quality}/${label} full-scene center remains smooth when looking across the meridian`,
        difference(left.center, right.center) < 14,
      )
    }
    await capture(`${quality}-zenith`, [0, 1, 0.001])
    await capture(`${quality}-east-control`, [1, 0.7, 0])
  }
  check('sky direction changes and offscreen sampling cause no browser or shader errors', errors.length === 0)
} catch (error) {
  report.failure = error.stack ?? String(error)
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
