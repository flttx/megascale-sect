import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

/**
 * Feel telemetry with real keys through the game loop: ground start/stop/sprint/reverse/turn/jump and stairs, sword
 * summon, cruise/boost take-up, boosted turns, braking and landing. Writes artifacts/feel/<label>.json so a later pass
 * can be compared with the baseline. Mouse sweeps are emulated by turning the runtime yaw at a fixed rate.
 */
const label = process.argv[2] ?? 'latest'
const out = 'artifacts/feel'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear')
const report = { label, errors, scenarios: {}, failure: null }

await page.evaluate(async () => {
  const { getPlayerRuntime, teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
  const camera = window.__postfx().composer.passes.find((p) => p.camera).camera
  let samples = null,
    sweep = 0,
    last = performance.now()
  const frame = (now) => {
    const runtime = getPlayerRuntime()
    if (runtime && sweep) runtime.yaw += (sweep * (now - last)) / 1000
    last = now
    if (samples && runtime) {
      const s = window.__playerSnapshot()
      const [vx, vy, vz] = s.velocity
      samples.push({
        t: performance.now() / 1000,
        phase: s.phase,
        speed: Math.hypot(vx, vz),
        vy,
        heading: Math.atan2(vx, -vz),
        yaw: s.yaw,
        bank: s.bank,
        fov: s.fov,
        y: s.position[1],
        pos: s.position,
        camera: camera.position.toArray(),
        camDist: s.cameraDistance,
      })
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  window.__feel = {
    start: () => (samples = []),
    stop: () => {
      const result = samples
      samples = null
      return result
    },
    sweep: (rate) => (sweep = rate),
    place: (position, yaw) => teleportPlayer(position, yaw),
  }
})

const keys = (list, action) => Promise.all(list.map((key) => page.keyboard[action](key)))
async function record(name, position, yaw, actions) {
  await page.evaluate(([p, y]) => window.__feel.place(p, y), [position, yaw])
  await page.waitForTimeout(600)
  await page.evaluate(() => window.__feel.start())
  for (const [kind, value, wait] of actions) {
    if (kind === 'down' || kind === 'up') await keys(value, kind)
    if (kind === 'press') await page.keyboard.press(value)
    if (kind === 'sweep') await page.evaluate((rate) => window.__feel.sweep(rate), value)
    await page.waitForTimeout(wait)
  }
  await page.evaluate(() => window.__feel.sweep(0))
  const samples = await page.evaluate(() => window.__feel.stop())
  report.scenarios[name] = { samples }
  return samples
}

const PLAYER = { jog: 5.5, sprint: 10, cruise: 45, boost: 140 }
const firstAt = (samples, test, from = 0) => {
  for (let i = from; i < samples.length; i++) if (test(samples[i])) return i
  return -1
}
const timeTo = (samples, test, from = 0) => {
  const i = firstAt(samples, test, from)
  return i < 0 ? null : +(samples[i].t - samples[from].t).toFixed(3)
}
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const deg = (r) => +((r * 180) / Math.PI).toFixed(1)
/**
 * Follow-camera jitter: camera positions resampled every 50 ms (frame intervals in a headless browser are uneven),
 * then acceleration from second differences, as p50/p95 in m/s².
 */
function cameraJerk(samples, step = 0.05) {
  const points = []
  for (let t = samples[0].t, i = 1; t <= samples.at(-1).t; t += step) {
    while (i < samples.length - 1 && samples[i].t < t) i++
    const a = samples[i - 1],
      b = samples[i],
      k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0
    points.push(a.camera.map((c, n) => c + (b.camera[n] - c) * k))
  }
  const acc = []
  for (let i = 2; i < points.length; i++)
    acc.push(Math.hypot(...points[i].map((c, n) => (c - 2 * points[i - 1][n] + points[i - 2][n]) / (step * step))))
  acc.sort((a, b) => a - b)
  return { p50: +acc[Math.floor(acc.length * 0.5)].toFixed(1), p95: +acc[Math.floor(acc.length * 0.95)].toFixed(1) }
}

try {
  // A clear, level 60 m line on the summit plaza for the ground runs.
  const line = await page.evaluate(async () => {
    const { groundHeight } = await window.__liveImport('/src/world/worldLayout.ts')
    const { bodyInsideAnyCollider } = await window.__liveImport('/src/world/surfaces.ts')
    for (const z of [-140, -150, -100, -90, -180, -200])
      for (const x0 of [-120, -100, 40, 60, 80]) {
        const y0 = groundHeight(x0, z)
        let ok = y0 !== null
        for (let d = 0; ok && d <= 60; d += 0.5) {
          const y = groundHeight(x0 + d, z)
          ok = y !== null && Math.abs(y - y0) < 0.3 && !bodyInsideAnyCollider(x0 + d, y + 0.45, y + 1.7, z, 0.6)
        }
        if (ok) return [x0, y0, z]
      }
    return null
  })
  assert.ok(line, 'no clear level line on the plaza')
  const east = Math.PI / 2

  let s = await record('ground-start-stop', line, east, [
    ['down', ['w'], 2000],
    ['up', ['w'], 1500],
  ])
  const peak = Math.max(...s.map((x) => x.speed))
  const stopFrom = firstAt(s, (x) => x.t - s[0].t > 2.0)
  const stopIndex = firstAt(s, (x) => x.speed < 0.1, stopFrom)
  report.scenarios['ground-start-stop'].metrics = {
    toJog90: timeTo(s, (x) => x.speed >= PLAYER.jog * 0.9),
    peak: +peak.toFixed(2),
    stopTime: stopIndex < 0 ? null : +(s[stopIndex].t - s[stopFrom].t).toFixed(3),
    stopDistance:
      stopIndex < 0
        ? null
        : +Math.hypot(s[stopIndex].pos[0] - s[stopFrom].pos[0], s[stopIndex].pos[2] - s[stopFrom].pos[2]).toFixed(2),
  }

  s = await record('ground-sprint-reverse', line, east, [
    ['down', ['Shift', 'w'], 2500],
    ['up', ['w'], 0],
    ['down', ['s'], 1500],
    ['up', ['s', 'Shift'], 300],
  ])
  const flip = firstAt(s, (x) => x.t - s[0].t > 2.5)
  report.scenarios['ground-sprint-reverse'].metrics = {
    toSprint90: timeTo(s, (x) => x.speed >= PLAYER.sprint * 0.9),
    reverseTime: timeTo(s, (x) => Math.abs(angle(x.heading - (s[flip].heading + Math.PI))) < 0.3 && x.speed > 3, flip),
  }

  s = await record('ground-sprint-turn', line, east, [
    ['down', ['Shift', 'w'], 1500],
    ['sweep', Math.PI, 1000],
    ['sweep', 0, 600],
    ['up', ['w', 'Shift'], 300],
  ])
  const turning = s.filter((x) => x.t - s[0].t > 1.6 && x.t - s[0].t < 2.5 && x.speed > 2)
  report.scenarios['ground-sprint-turn'].metrics = {
    headingLagDeg: deg(Math.max(...turning.map((x) => Math.abs(angle(x.yaw - x.heading))))),
    minSpeedInTurn: +Math.min(...turning.map((x) => x.speed)).toFixed(2),
    camera: cameraJerk(s),
  }

  s = await record('ground-jump', line, east, [
    ['down', ['w'], 800],
    ['press', 'Space', 1600],
    ['up', ['w'], 200],
  ])
  const base = s[0].y
  const lift = firstAt(s, (x) => x.y > base + 0.05)
  const land = lift < 0 ? -1 : firstAt(s, (x) => x.y <= base + 0.02, lift + 3)
  report.scenarios['ground-jump'].metrics = {
    apex: +(Math.max(...s.map((x) => x.y)) - base).toFixed(2),
    airtime: lift < 0 || land < 0 ? null : +(s[land].t - s[lift].t).toFixed(3),
    landingSpeed: land < 0 ? null : +s[Math.min(s.length - 1, land + 3)].speed.toFixed(2),
  }

  // Stairs and slope: sprint from spawn up the main road through the gate.
  const spawn = await page.evaluate(
    async () => (await window.__liveImport('/src/world/worldLayout.ts')).LAYOUT.spawn.position,
  )
  s = await record('ground-road-climb', spawn, 0, [
    ['down', ['Shift', 'w'], 16000],
    ['up', ['w', 'Shift'], 200],
  ])
  const climbing = s.filter((x) => x.t - s[0].t > 1.5 && x.t - s[0].t < 16)
  report.scenarios['ground-road-climb'].metrics = {
    rise: +(Math.max(...s.map((x) => x.y)) - s[0].y).toFixed(2),
    stallFrames: climbing.filter((x) => x.speed < PLAYER.sprint * 0.5).length,
    frames: climbing.length,
    meanSpeed: +(climbing.reduce((n, x) => n + x.speed, 0) / climbing.length).toFixed(2),
    camera: cameraJerk(s),
  }

  // Summon from the plaza, then cruise, boost, a boosted 90°/s sweep, release.
  s = await record('flight-summon', line, east, [['press', 'f', 4000]])
  report.scenarios['flight-summon'].metrics = {
    toFlight: timeTo(s, (x) => x.phase === 'FLIGHT'),
    phases: [...new Set(s.map((x) => x.phase))],
    lift: +(Math.max(...s.map((x) => x.y)) - s[0].y).toFixed(2),
  }

  const sky = [0, 260, 600]
  s = await record('flight-cruise-boost', sky, 0, [
    ['down', ['w'], 3000],
    ['down', ['Shift'], 4000],
    ['sweep', Math.PI / 2, 2000],
    ['sweep', 0, 1000],
    ['up', ['w', 'Shift'], 3000],
  ])
  const boostFrom = firstAt(s, (x) => x.t - s[0].t > 3)
  const sweepFrom = firstAt(s, (x) => x.t - s[0].t > 7.1),
    sweepTo = firstAt(s, (x) => x.t - s[0].t > 9.0)
  const releaseFrom = firstAt(s, (x) => x.t - s[0].t > 10)
  const inSweep = s.slice(sweepFrom, sweepTo)
  report.scenarios['flight-cruise-boost'].metrics = {
    toCruise90: timeTo(s, (x) => x.speed >= PLAYER.cruise * 0.9),
    toBoost90: timeTo(s, (x) => x.speed >= PLAYER.boost * 0.9, boostFrom),
    sweepHeadingLagDeg: deg(Math.max(...inSweep.map((x) => Math.abs(angle(x.yaw - x.heading))))),
    sweepBankDeg: deg(Math.max(...inSweep.map((x) => Math.abs(x.bank)))),
    sweepMinSpeed: +Math.min(...inSweep.map((x) => x.speed)).toFixed(1),
    fovRange: [Math.min(...s.map((x) => x.fov)), Math.max(...s.map((x) => x.fov))].map((v) => +v.toFixed(1)),
    camDistRange: [Math.min(...s.map((x) => x.camDist)), Math.max(...s.map((x) => x.camDist))].map(
      (v) => +v.toFixed(2),
    ),
    brakeTo2: timeTo(s, (x) => x.speed < 2, releaseFrom),
    camera: cameraJerk(s),
  }

  s = await record('flight-landing', [line[0], line[1] + 8, line[2]], east, [['press', 'f', 4000]])
  report.scenarios['flight-landing'].metrics = {
    toGround: timeTo(s, (x) => x.phase === 'GROUND'),
    phases: [...new Set(s.map((x) => x.phase))],
  }

  for (const [name, scenario] of Object.entries(report.scenarios)) {
    console.log(`${name}: ${JSON.stringify(scenario.metrics)}`)
    assert.ok(scenario.samples.length > 30, `${name}: frames recorded`)
  }
  assert.ok(report.scenarios['flight-summon'].metrics.toFlight !== null, 'summon reaches flight')
  assert.ok(report.scenarios['flight-landing'].metrics.toGround !== null, 'landing reaches ground')
  assert.deepEqual(errors, [])
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  // Samples stay in the report for plotting; metrics summarise them.
  await fs.writeFile(`${out}/${label}.json`, JSON.stringify(report))
  await browser.close()
}
