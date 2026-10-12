import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

/**
 * First-sight stalls: from a cold browser, wait for the GPU warm-up, then glide the review camera (no teleports)
 * past everything R21 added — huabiao and banner avenues, the outer regions' pavilions, tomb gate, dragon shrine and
 * plank walkway, by day and again at night. Any shader program compiled on
 * the way, or a long frame, means the warm-up missed something. Writes artifacts/hitch/report.json.
 */
const LIMIT = { programs: 0, frameMs: 100, over50: 3 }
const SEGMENT_S = 3
// [eye, look] waypoints; the camera eases between consecutive ones.
const ROUTE = [
  [
    [0, 40, 40],
    [0, 30, -100],
  ],
  [
    [30, 32, -70],
    [0, 28, -140],
  ],
  [
    [90, 120, -150],
    [0, 200, -300],
  ],
  [
    [-160, 140, -120],
    [-200, 110, -170],
  ],
  [
    [-120, 230, -250],
    [0, 260, -320],
  ],
  [
    [150, 260, -1700],
    [215, 160, -2005],
  ],
  [
    [262, 162, -1945],
    [215, 158, -2005],
  ],
  [
    [1400, 300, -1200],
    [2000, 220, -600],
  ],
  [
    [2245, 222, -470],
    [2290, 215, -520],
  ],
  [
    [2520, 240, -300],
    [2400, 190, -250],
  ],
  [
    [600, 260, -700],
    [-1200, 160, -500],
  ],
  [
    [-1760, 150, -505],
    [-1830, 155, -500],
  ],
  [
    [-900, 220, 1200],
    [0, 70, 2500],
  ],
  [
    [0, 72, 2510],
    [0, 70, 2580],
  ],
]

const out = 'artifacts/hitch'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear')
const report = { errors, failure: null }
try {
  await page.waitForFunction(
    () => window.__gpuWarmup && !window.__gpuWarmup().pending && window.__gpuWarmup().runs > 0,
    null,
    {
      timeout: 120000,
    },
  )
  await page.waitForTimeout(1500)
  const glide = (route, seconds, hours) =>
    page.evaluate(
      ([route, seconds, hours]) =>
        new Promise((done) => {
          const renderer = window.__postfx().renderer
          if (hours !== null) window.__setTimeOfDay(hours)
          const before = renderer.info.programs.length,
            frames = []
          let start = 0,
            last = 0
          const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
          const step = (now) => {
            if (!start) start = last = now
            else frames.push(now - last)
            last = now
            const t = (now - start) / 1000 / seconds,
              k = Math.min(route.length - 1.0001, t)
            const i = Math.floor(k),
              f = k - i,
              s = f * f * (3 - 2 * f)
            window.__environmentReview(lerp(route[i][0], route[i + 1][0], s), lerp(route[i][1], route[i + 1][1], s))
            if (t < route.length - 1) requestAnimationFrame(step)
            else done({ before, after: renderer.info.programs.length, frames })
          }
          requestAnimationFrame(step)
        }),
      [route, seconds, hours],
    )
  // Start the review camera at the first waypoint, then fly by day and back along the hall at night.
  await page.evaluate((view) => window.__environmentReview(...view), ROUTE[0])
  await page.waitForTimeout(2500)
  const day = await glide(ROUTE, SEGMENT_S, null)
  const night = await glide(ROUTE.slice(0, 6), SEGMENT_S, 21)
  const summarise = ({ before, after, frames }) => {
    // The first frame of a glide carries the review-mode switch; it is not a first-sight stall.
    const timed = frames.slice(1)
    return {
      programsAdded: after - before,
      frames: timed.length,
      worstMs: +Math.max(...timed).toFixed(1),
      over50: timed.filter((ms) => ms > 50).length,
      over100: timed.filter((ms) => ms > 100).length,
      p95Ms: +[...timed].sort((a, b) => a - b)[Math.floor(timed.length * 0.95)].toFixed(1),
    }
  }
  report.day = summarise(day)
  report.night = summarise(night)
  report.warmup = await page.evaluate(() => window.__gpuWarmup())
  console.log(`day   ${JSON.stringify(report.day)}`)
  console.log(`night ${JSON.stringify(report.night)}`)
  for (const [name, r] of [
    ['day', report.day],
    ['night', report.night],
  ]) {
    assert.ok(r.programsAdded <= LIMIT.programs, `${name}: ${r.programsAdded} shader programs compiled on first sight`)
    assert.ok(r.worstMs <= LIMIT.frameMs, `${name}: worst frame ${r.worstMs} ms`)
    assert.ok(r.over50 <= LIMIT.over50, `${name}: ${r.over50} frames over 50 ms`)
  }
  assert.deepEqual(errors, [])
  console.log('PASS no first-sight stalls along the R21 additions')
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
