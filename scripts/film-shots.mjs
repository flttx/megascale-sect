// Shot list for scripts/record-film.mjs. World metres; the sun sets west (−x) at 18:00.
import { CatmullRomCurve3, Vector3 } from 'three'

const lerp = (a, b, t) => a + (b - a) * t
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** A centripetal spline through `points`, sampled by arc length (one point is a fixed position). */
function track(points) {
  if (points.length === 1) { const p = new Vector3(...points[0]); return () => p.clone() }
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'centripetal')
  curve.arcLengthDivisions = 600
  return (u) => curve.getPointAt(u)
}

const tracks = new WeakMap()
/**
 * The camera pose `u` (0…1) through a shot. `ease` blends linear travel (0) toward a smoothstep (1): scenery shots
 * dissolve into each other while still moving, so they only soften their ends.
 */
export function shotPose(shot, u) {
  let t = tracks.get(shot)
  if (!t) { t = { eye: track(shot.eye), look: track(shot.look) }; tracks.set(shot, t) }
  const e = lerp(u, smoothstep(0, 1, u), shot.ease ?? 0.5)
  const [fovA, fovB] = Array.isArray(shot.fov) ? shot.fov : [shot.fov ?? 50, shot.fov ?? 50]
  const [rollA, rollB] = Array.isArray(shot.roll) ? shot.roll : [shot.roll ?? 0, shot.roll ?? 0]
  return { eye: t.eye(e).toArray(), look: t.look(e).toArray(), fov: lerp(fovA, fovB, e), roll: lerp(rollA, rollB, e), rel: shot.rel ?? null, lookRel: shot.lookRel ?? null }
}

/** Scouting stills: one frame each at a candidate pose. */
export const STILLS = [
  { id: 'reveal_a', hours: 17, eye: [0, 30, 820], look: [0, 90, -320], fov: 45 },
  { id: 'reveal_b', hours: 17, eye: [0, 120, 300], look: [0, 70, -320], fov: 48 },
  { id: 'turtle', hours: 17.2, turtleAt: 0, rel: 'turtle', eye: [320, 120, -260], look: [0, 30, 0], fov: 45 },
  { id: 'chained', hours: 17.2, eye: [-420, 220, -40], look: [-790, 230, -260], fov: 48 },
  { id: 'guardian', hours: 17.2, eye: [260, 120, -120], look: [460, 180, -420], fov: 50 },
  { id: 'tomb', hours: 17.4, eye: [-1900, 220, 80], look: [-2200, 200, -300], fov: 50 },
  { id: 'sage', hours: 17.4, eye: [0, 260, -1650], look: [0, 280, -2175], fov: 50 },
  { id: 'dragon', hours: 17.4, eye: [1750, 320, -160], look: [2200, 420, -420], fov: 50 },
  { id: 'skygate', hours: 17.6, eye: [260, 60, 1500], look: [0, 60, 2000], fov: 50 },
  { id: 'armillary', hours: 17.2, eye: [260, 420, -40], look: [0, 520, -330], fov: 50 },
  { id: 'kunrise', hours: 17, kunAt: 18, eye: [330, 150, 330], look: [40, 150, 420], fov: 55 },
  { id: 'crane_isle', hours: 17, eye: [380, 170, 380], look: [330, 145, 300], fov: 50 },
  // Candidates for the kun shot and the far ends of the moving shots.
  { id: 'kun_a', hours: 17.1, kunAt: 76, eye: [-330, 470, -1000], lookRel: 'kun', look: [0, 0, 0], fov: 50 },
  { id: 'kun_b', hours: 17.1, kunAt: 80, eye: [-200, 260, -250], lookRel: 'kun', look: [0, -60, 0], fov: 45 },
  { id: 'kun_c', hours: 17.1, kunAt: 60, eye: [500, 420, -500], lookRel: 'kun', look: [0, 0, 0], fov: 45 },
  { id: 'guardian_lo', hours: 17.2, eye: [260, 60, -120], look: [460, 120, -420], fov: 50 },
  { id: 'turtle_b', hours: 17.2, turtleAt: 9, rel: 'turtle', eye: [250, 110, -330], look: [0, 30, 0], fov: 45 },
  { id: 'chained_end', hours: 17.2, eye: [-540, 245, -40], look: [-790, 240, -260], fov: 48 },
  { id: 'tomb_end', hours: 17.4, eye: [-2050, 170, -40], look: [-2230, 180, -330], fov: 50 },
  { id: 'gate_end', hours: 17.6, eye: [120, 20, 1650], look: [0, 60, 2000], fov: 50 },
  { id: 'flight_open', hours: 17.4, kunAt: 5, eye: [-320, 175, 150], look: [0, 0, 700], fov: 50 },
]

// ---- Part two: the flight. The player hovers on the sword over the cloud sea as the kun breaches ahead, chases it
// up its sunlit left flank (trailing it, so it stays in view ahead-right), then peels away west toward 锁云屿 into the sunset.

const START = { position: [-140, 40, 1240], yaw: 0.25, pitch: 0 }
const KEY_W = 3, PILOT = 3, PEEL = [36, 40]

/**
 * A point on the lane `lateral` m off the kun's left (sunlit) flank, `ahead` m past it along its heading: steering
 * at it holds the player parallel to the kun at that offset, gaining 5 m/s on it.
 */
function kunLane(state, { lateral, ahead = 400, up = 20 }) {
  const [fx, fy, fz] = state.kunForward, h = Math.hypot(fx, fz) || 1
  // Its local +X (left) is up × forward.
  const lx = fz / h, lz = -fx / h
  return [state.kun[0] + lx * lateral + fx * ahead, state.kun[1] + up + fy * ahead, state.kun[2] + lz * lateral + fz * ahead]
}

const WEST = [-800, 345, -265]

const flight = {
  id: 'flight', seconds: 64, hours: 17.35, kunAt: 1, showPlayer: true, player: START,
  // Opens wide behind the hovering player with the breach ahead, then cranes onto their shoulder and hands over to the rig.
  shots: [{ seconds: 4.4, ease: 1, eye: [[-300, 115, 1400], [-200, 70, 1310], [-142, 42, 1247]], look: [[20, -40, 700], [-60, 10, 960], [-127, 41, 1192]], fov: [50, 72] }],
  blend: (t) => 1 - smoothstep(2.4, 4.4, t),
  frame(t, state) {
    const keys = []
    if (Math.round(t * 60) === Math.round(KEY_W * 60)) keys.push(['keydown', 'KeyW'])
    if (t < PILOT || !state || state.phase !== 'FLIGHT') return { keys }
    const lane = kunLane(state, { lateral: lerp(190, 165, smoothstep(8, 28, t)), ahead: 260 }), w = smoothstep(PEEL[0], PEEL[1], t)
    const target = lane.map((v, k) => lerp(v, WEST[k], w))
    return { keys, pilot: { target, omega: 1.1, maxRate: 0.4, pitchOmega: 0.9, minPitch: -0.45, maxPitch: 0.6 } }
  },
}

// ---- Part one: scenery, late afternoon turning to sunset (≈9 s each, dissolved 1 s into the next).
export const SEGMENTS = [
  { id: 's1_reveal', seconds: 9, kunAt: 100, turtleAt: 0, hours: 16.9, shots: [{ eye: [[0, 30, 820], [0, 50, 620], [0, 66, 450]], look: [[0, 90, -320], [0, 88, -320]], fov: 45 }] },
  { id: 's2_kun', seconds: 9, hours: 17.1, kunAt: 60, turtleAt: 0, shots: [{ eye: [[520, 420, -470], [460, 440, -545]], look: [[0, -10, 0], [0, -10, 0]], lookRel: 'kun', fov: 45 }] },
  { id: 's3_chained', seconds: 9, kunAt: 100, turtleAt: 0, hours: 17.2, shots: [{ eye: [[-400, 215, -20], [-470, 230, -10], [-540, 245, -40]], look: [[-790, 230, -260], [-790, 240, -260]], fov: 48 }] },
  { id: 's4_guardian', seconds: 9, kunAt: 100, turtleAt: 0, hours: 17.2, shots: [{ eye: [[260, 60, -120], [250, 170, -150]], look: [[460, 120, -420], [460, 200, -420]], fov: 50 }] },
  { id: 's5_turtle', seconds: 9, hours: 17.25, turtleAt: 0, shots: [{ eye: [[360, 90, -120], [320, 100, -240], [250, 110, -330]], look: [[0, 30, 0], [0, 30, 0]], rel: 'turtle', fov: 45 }] },
  { id: 's6_tomb', seconds: 9, kunAt: 100, turtleAt: 0, hours: 17.4, shots: [{ eye: [[-1900, 220, 80], [-1990, 205, 0]], look: [[-2200, 200, -300], [-2230, 195, -320]], fov: 50 }] },
  { id: 's7_gate', seconds: 9, kunAt: 100, turtleAt: 0, hours: 17.6, shots: [{ eye: [[260, 60, 1500], [190, 45, 1570]], look: [[0, 60, 2000], [0, 60, 2000]], fov: 50 }] },
  flight,
]

// ---- The walkthrough (HUD on, gameplay camera): a scripted player works through the core features chapter by chapter.

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const press = (code) => [['keydown', code], ['keyup', code]]
const hold = (...codes) => codes.map((code) => ['keydown', code])
const lift = (...codes) => codes.map((code) => ['keyup', code])

/**
 * Runs `steps` in order. A step may send `keys` and run `act(page)` as it starts, steers with `pilot` (object, or a
 * function of state and time) while it lasts, and ends after `for` seconds or once `until(state, elapsed)` holds.
 */
function script(steps) {
  let index = 0, started = null
  return (t, state) => {
    const out = { keys: [], acts: [] }
    while (state && index < steps.length) {
      const step = steps[index]
      if (started === null) { started = t; out.keys.push(...(step.keys ?? [])); if (step.act) out.acts.push(step.act) }
      const elapsed = t - started
      if ((step.for !== undefined && elapsed >= step.for) || step.until?.(state, elapsed)) { index++; started = null; continue }
      if (step.pilot) out.pilot = typeof step.pilot === 'function' ? step.pilot(state, t) : step.pilot
      break
    }
    if (out.acts.length) { const acts = out.acts; out.act = async (page, s) => { for (const act of acts) await act(page, s) } }
    delete out.acts
    return out
  }
}

const WALK = { omega: 2.4, maxRate: 1, pitch: 0.06 }
const walkTo = (target, radius = 2, extra = {}) => ({ pilot: { target, ...WALK }, until: (s) => flat(s.p, target) < radius, ...extra })
const face = (target, seconds, extra = {}) => ({ pilot: { target, ...WALK }, for: seconds, ...extra })
/** The page-side module call, for UI a player would click (the weather altar's menu). */
/** Down the pilgrim road: steer at a point 30 m further along it, which a sprint can never circle. */
const roadAhead = (s) => ({ target: [0, 1.4, s.p[2] - 30], ...WALK })
const call = (module, name, ...args) => (page) => page.evaluate(async ({ module, name, args }) => (await window.__liveImport(module))[name](...args), { module, name, args })

// 1. On foot up the pilgrim road: a spirit light, a stele read, a sprint and a jump, then the sword, up the stairs and away east.
const ground = {
  id: 'w_ground', seconds: 31, hours: 16.2, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'male',
  player: { position: [0.3, 0, 147], yaw: -0.05, pitch: 0.06 },
  frame: script([
    { for: 0.6 },
    walkTo([-3.1, 1.4, 128], 1.5, { keys: hold('KeyW') }),
    { pilot: { target: [9.4, 0, 118.6], ...WALK }, until: (s) => flat(s.p, [11.5, 0, 118]) < 3.1 },
    face([11.5, 1.2, 118], 0.8, { keys: lift('KeyW') }),
    { keys: press('KeyE'), for: 3.4 },
    face([-4.2, 1.4, 96], 1.1, { keys: press('KeyE') }),
    { keys: hold('ShiftLeft', 'KeyW'), pilot: roadAhead, until: (s) => s.p[2] < 97 },
    { keys: press('Space'), pilot: roadAhead, for: 1.2 },
    { pilot: roadAhead, until: (s) => s.p[2] < 82 },
    { keys: press('Space'), pilot: roadAhead, for: 1.4 },
    { keys: [...lift('ShiftLeft'), ...press('KeyF')], pilot: { target: [0, 30, -40], ...WALK }, for: 2.7 },
    // Up the stairs, then a bank east past the side tower and out over the platform's edge to the cloud sea.
    { pilot: { target: [0, 40, -140], omega: 1, maxRate: 0.35, pitchOmega: 0.8, minPitch: -0.2, maxPitch: 0.32 }, until: (s) => s.p[2] < -40 },
    { pilot: { target: [520, 140, 10], omega: 1.2, maxRate: 0.55, pitchOmega: 0.8, minPitch: -0.2, maxPitch: 0.3 }, for: 60 },
  ]),
}

// 2. A wind stream: the south spoke carries the flier down past the sky gate at twice flying speed.
const SOUTH = [[0, 220, 700], [0, 150, 1100], [0, 60, 1450], [0, 0, 1750], [0, -10, 2000]]
const alongSouth = (z) => {
  for (let k = 1; k < SOUTH.length; k++) if (z <= SOUTH[k][2]) { const [a, b] = [SOUTH[k - 1], SOUTH[k]], u = Math.max(0, (z - a[2]) / (b[2] - a[2])); return [0, lerp(a[1], b[1], u), z] }
  return SOUTH[SOUTH.length - 1]
}
const wind = {
  id: 'w_wind', seconds: 12, hours: 16.4, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'male',
  player: { position: [0, 226, 590], yaw: Math.PI, pitch: -0.05 },
  frame: script([
    { keys: hold('KeyW'), pilot: (s) => ({ target: alongSouth(s.p[2] + 260), omega: 1.2, maxRate: 0.3, pitchOmega: 1, minPitch: -0.4, maxPitch: 0.2 }), for: 60 },
  ]),
}

// 3. The kun: fly in over its back heading into the sunset, land, walk its deck and open the scroll map aboard.
const kunAhead = (s, up = 0) => [s.kun[0] + s.kunForward[0] * 400, s.kun[1] + up, s.kun[2] + s.kunForward[2] * 400]
const kun = {
  id: 'w_kun', seconds: 16, hours: 16.5, kunAt: 80, turtleAt: 0, showPlayer: true, hud: true, character: 'male',
  player: { position: [0, 600, -1100], kun: [4, 16, -30], pitch: -0.12 },
  frame: script([
    { keys: hold('KeyW'), pilot: (s) => ({ target: kunAhead(s), omega: 1.2, maxRate: 0.3, pitch: -0.12 }), for: 1.6 },
    { keys: [...lift('KeyW'), ...press('KeyF')], pilot: (s) => ({ target: kunAhead(s), omega: 1.2, maxRate: 0.3, pitch: -0.08 }), until: (s) => s.phase === 'GROUND' },
    { pilot: (s) => ({ target: kunAhead(s), omega: 1.2, maxRate: 0.3, pitch: 0.02 }), for: 0.6 },
    { keys: hold('KeyW'), pilot: (s) => ({ target: kunAhead(s), omega: 1.2, maxRate: 0.3, pitch: 0.02 }), for: 3.2 },
    { keys: [...lift('KeyW'), ...press('Tab')], for: 3.6 },
    { keys: press('Tab'), pilot: (s) => ({ target: kunAhead(s), omega: 1.2, maxRate: 0.3, pitch: 0.02 }), for: 60 },
  ]),
}

// 4. Photo mode on the pine isle overlook: the camera pulls back and up, two filters, the vignette, a shot.
const photo = {
  id: 'w_photo', seconds: 12, hours: 16.75, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'male',
  player: { position: [-314, 30, -110], yaw: -1.17, pitch: 0.02 },
  frame: script([
    { for: 1 },
    { keys: press('KeyP'), for: 0.8 },
    { keys: hold('KeyS', 'KeyE'), for: 1.6 },
    { keys: [...lift('KeyS', 'KeyE'), ...press('KeyF')], for: 1.2 },
    { keys: press('KeyF'), for: 1.2 },
    { keys: press('KeyV'), for: 1.2 },
    { keys: press('Enter'), for: 1.8 },
    { keys: press('KeyP'), for: 60 },
  ]),
}

// 5. Switch to the female wanderer on the forecourt, walk to the Sky Altar and call down snow.
const altar = {
  id: 'w_altar', seconds: 20, hours: 16.3, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'male',
  player: { position: [42, 24, -113], yaw: 1.23, pitch: 0.05 },
  frame: script([
    { for: 0.8 },
    { keys: press('Digit2'), for: 1.8 },
    walkTo([56.8, 24, -118], 1.2, { keys: hold('KeyW') }),
    face([62, 25.5, -118], 0.6, { keys: lift('KeyW') }),
    { keys: press('KeyE'), for: 2.4 },
    { act: call('/src/world/interact/actions.ts', 'chooseWeather', 'snow'), for: 1 },
    face([20, 30, -150], 60),
  ]),
}

// 5b. A little later, the snow has settled over the forecourt (the edit cuts here from the altar).
const snow = {
  id: 'w_snow', seconds: 8, hours: 16.3, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'female', weather: 'snow',
  player: { position: [46, 24, -116], yaw: 0.3, pitch: 0.14 },
  frame: script([
    { for: 0.5 },
    { keys: hold('KeyW'), pilot: (s) => ({ target: [s.p[0] + 9, 26, s.p[2] - 30], ...WALK, pitch: 0.14 }), for: 60 },
  ]),
}

// 6. Meditation on the back-cliff cushion: six hours pass in eight seconds, noon to sunset over the cloud sea.
const meditate = {
  id: 'w_meditate', seconds: 14, hours: 11.8, kunAt: 100, turtleAt: 0, showPlayer: true, hud: true, character: 'female',
  player: { position: [-50, 24, -497], yaw: 0, pitch: 0.05 },
  frame: script([
    { for: 0.6 },
    { keys: hold('KeyW'), pilot: { target: [-50, 24, -505], ...WALK }, until: (s) => s.nearby === 'meditation_back' },
    { keys: [...lift('KeyW'), ...press('KeyE')], for: 60 },
  ]),
}

SEGMENTS.push(ground, wind, kun, photo, altar, snow, meditate)
