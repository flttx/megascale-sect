// Final clip builder: Tripo-native preset clips (retargeted onto the mixamo rig by retarget.mjs)
// → cut / loop-fixed / in-place clips → public/assets/characters/<c>/anim.glb + build-report.json.
//   node asset-pipeline/anim/build.mjs [male|female|all] [--no-write]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Quaternion, Vector3 } from 'three'
import { loadTarget, retarget, hipsLocal, targetWorld, BONES, PREFIX } from './retarget.mjs'
import { writeAnimGlb } from './writer.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const FPS = 30
const HEIGHT_M = { male: 1.75, female: 1.7 } // characterAssets.ts: 1 skeleton unit = height metres
const FEET = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']
// Contact = lowest foot joint below h (units above rest) AND ankle world speed below s (units/s).
// press: stationary stances keep both soles on the ground every frame (the source lets a relaxed foot hover).
const LOCK = { idle: { h: 0.05, s: 0.15, press: true }, walk: { h: 0.01, s: 0.35 }, run: { h: 0.02, s: 0.9 }, sprint: { h: 0.03, s: 1.2 }, stand_on_sword: { h: 0.05, s: 0.15, press: true } }
const ARM_BONES = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand']
const I = new Quaternion()

// ---------- pose helpers (pose = { rot: Map(bone → local quat), hips: world Vector3 }) ----------
const clonePose = (p) => ({ rot: new Map([...p.rot].map(([b, q]) => [b, q.clone()])), hips: p.hips.clone() })
function mixPose(a, b, t) {
  const rot = new Map()
  for (const [bone, q] of a.rot) rot.set(bone, q.clone().slerp(b.rot.get(bone), t))
  return { rot, hips: a.hips.clone().lerp(b.hips, t) }
}
/** Pose of a retargeted source at time t (seconds), interpolated between native keys. */
function poseAt(src, t) {
  const { times, frames } = src
  let i = 0
  while (i < times.length - 2 && times[i + 1] <= t) i++
  const a = Math.min(1, Math.max(0, (t - times[i]) / (times[i + 1] - times[i])))
  return mixPose(frames[i], frames[i + 1], a)
}
/** Uniform 30 fps samples over [frame a, frame b] of the source (native key indices), N intervals. */
function cut(src, a, b, N) {
  const t0 = src.times[Math.floor(a)] + (a % 1) * (src.times[1] - src.times[0])
  const t1 = src.times[Math.floor(b)] + (b % 1) * (src.times[1] - src.times[0])
  return Array.from({ length: N + 1 }, (_, i) => poseAt(src, t0 + (t1 - t0) * i / N))
}
/** Piecewise-linear time warp: knots [[srcFrame, outFrame], ...] → out frames 0..last. */
function warp(src, knots) {
  const N = knots[knots.length - 1][1]
  const out = []
  for (let i = 0; i <= N; i++) {
    let k = 0
    while (k < knots.length - 2 && knots[k + 1][1] <= i) k++
    const [s0, o0] = knots[k], [s1, o1] = knots[k + 1]
    const f = s0 + (s1 - s0) * (i - o0) / (o1 - o0)
    out.push(poseAt(src, src.times[0] + f * (src.times[1] - src.times[0])))
  }
  return out
}
/** Make frame N identical to frame 0: distribute the per-bone seam error linearly (right-multiplied). */
function fixLoop(frames) {
  const N = frames.length - 1
  let seam = 0
  for (const b of frames[0].rot.keys()) {
    const q0 = frames[0].rot.get(b), err = q0.clone().invert().multiply(frames[N].rot.get(b))
    seam = Math.max(seam, q0.angleTo(frames[N].rot.get(b)))
    frames.forEach((f, i) => f.rot.get(b).multiply(I.clone().slerp(err, i / N).invert()).normalize())
  }
  return seam * 180 / Math.PI
}
/** Root-motion removal: subtract the linear hips trend (xz travel and y seam), keep residual sway + bob. */
function inPlace(frames, restHips) {
  const N = frames.length - 1
  const d = frames[N].hips.clone().sub(frames[0].hips)
  const res = frames.map((f, i) => f.hips.clone().addScaledVector(d, -i / N))
  const mean = res.slice(0, N).reduce((m, v) => m.add(v), new Vector3()).divideScalar(N)
  frames.forEach((f, i) => f.hips.set(restHips.x + res[i].x - mean.x, res[i].y, restHips.z + res[i].z - mean.z))
  return { dist: Math.hypot(d.x, d.z), dir: new Vector3(d.x, 0, d.z).normalize() }
}
const world = (T, f) => targetWorld(T, f)
const footRel = (T, W, b) => W.get(PREFIX + b).p.y - T.restW.get(PREFIX + b).p.y
/** Lowest foot/toe joint relative to its rest height (≈ sole on the ground at 0). */
const groundOf = (T, frames) => Math.min(...frames.map((f) => { const W = world(T, f); return Math.min(...FEET.map((b) => footRel(T, W, b))) }))
const shiftY = (frames, dy) => frames.forEach((f) => { f.hips.y += dy })
/** Enforce quaternion hemisphere continuity per bone. */
function continuity(frames) {
  for (const b of frames[0].rot.keys()) for (let i = 1; i < frames.length; i++) {
    const p = frames[i - 1].rot.get(b), q = frames[i].rot.get(b)
    if (p.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  }
}
const smooth = (x) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v) }

/** Two-bone leg IK: place the ankle at `target` (world), keep the current knee plane, set foot world orientation. */
function legIK(T, frame, side, target, footQ) {
  const up = side + 'UpLeg', lo = side + 'Leg', ft = side + 'Foot'
  let W = world(T, frame)
  const a = W.get(PREFIX + up).p.clone(), b = W.get(PREFIX + lo).p.clone(), c = W.get(PREFIX + ft).p.clone()
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c)
  const toT = target.clone().sub(a)
  const dist = Math.min((l1 + l2) * 0.9995, Math.max(Math.abs(l1 - l2) + 1e-4, toT.length()))
  const dir = toT.normalize()
  const tgt = a.clone().addScaledVector(dir, dist)
  const bend = b.clone().sub(a)
  bend.addScaledVector(dir, -bend.dot(dir))
  if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(dir, -dir.x)
  bend.normalize()
  const along = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist)
  const knee = a.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)))
  const qUp = new Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), knee.clone().sub(a).normalize()).multiply(W.get(PREFIX + up).q)
  frame.rot.set(up, W.get(PREFIX + 'Hips').q.clone().invert().multiply(qUp).normalize())
  W = world(T, frame)
  const b2 = W.get(PREFIX + lo).p.clone(), c2 = W.get(PREFIX + ft).p.clone()
  const qLo = new Quaternion().setFromUnitVectors(c2.sub(b2).normalize(), tgt.clone().sub(b2).normalize()).multiply(W.get(PREFIX + lo).q)
  frame.rot.set(lo, qUp.clone().invert().multiply(qLo).normalize())
  frame.rot.set(ft, qLo.clone().invert().multiply(footQ).normalize())
}

/**
 * Contact clean-up for in-place loops: wherever a foot is on the ground and nearly still in world space, pin the
 * ankle to a point that travels at exactly -body velocity (anchored at mid-stance, pressed onto the ground)
 * and solve the leg by IK. One frame either side of a contact is blended halfway to avoid pops.
 * Stationary loops (no locomotion) pin each contact to its mid-stance position.
 */
function lockFeet(T, clip, { h: C, s: S, press = false }) {
  const F = clip.frames, N = F.length - 1
  const v = clip.loco ? clip.dir.clone().multiplyScalar(clip.cycleU / (N / FPS)) : new Vector3()
  const W = F.map((f) => world(T, f))
  const targets = F.map(() => ({}))
  const contacts = {}
  let correction = 0
  for (const side of ['Left', 'Right']) {
    const A = PREFIX + side + 'Foot', B = PREFIX + side + 'ToeBase'
    const rA = T.restW.get(A).p.y, rB = T.restW.get(B).p.y
    const h = W.slice(0, N).map((w) => Math.min(w.get(A).p.y - rA, w.get(B).p.y - rB))
    const speed = (i) => W[(i + 1) % N].get(A).p.clone().sub(W[(i - 1 + N) % N].get(A).p).multiplyScalar(FPS / 2).add(v).setY(0).length()
    const on = h.map((x, i) => x < C && speed(i) < S)
    contacts[side] = on
    const runs = []
    if (on.every(Boolean)) runs.push(Array.from({ length: N }, (_, i) => i))
    else for (let i = 0; i < N; i++) if (on[i] && !on[(i - 1 + N) % N]) { const r = []; for (let j = i; on[j % N] && r.length < N; j++) r.push(j); runs.push(r) }
    for (const r of runs) {
      let m = r[0]
      for (const j of r) if (h[j % N] < h[m % N]) m = j
      const hMin = Math.max(0, h[m % N])
      const anchor = W[m % N].get(A).p.clone().addScaledVector(v, m / FPS)
      const apply = (j, w) => {
        const i = ((j % N) + N) % N
        const p = W[i].get(A).p, t = anchor.clone().addScaledVector(v, -j / FPS)
        const tgt = p.clone().lerp(new Vector3(t.x, p.y - (press ? Math.max(0, h[i]) : hMin), t.z), w)
        correction = Math.max(correction, tgt.distanceTo(p))
        targets[i][side] = { tgt, q: W[i].get(A).q.clone() }
      }
      if (r.length < N) { apply(r[0] - 1, 0.5); apply(r[r.length - 1] + 1, 0.5) }
      for (const j of r) apply(j, 1)
    }
  }
  F.slice(0, N).forEach((f, i) => { for (const side of Object.keys(targets[i])) legIK(T, f, side, targets[i][side].tgt, targets[i][side].q) })
  F[N] = clonePose(F[0])
  clip.lockCorrectionM = correction
  return contacts
}

// ---------- clip recipes ----------
const loaders = {}
async function src(c, T, name) {
  const key = `${c}/${name}`
  if (!loaders[key]) loaders[key] = retarget(path.join(HERE, 'tripo', c, `${name}.glb`), T)
  return loaders[key]
}
const sec = (s, f) => s.times[f] - s.times[0]

/** Locomotion / stance loop from a source window. `speed` (m/s) optionally sets the playback rate. */
async function loopClip(c, T, { source, from, to, speedMS, timeScale = 1, loco }) {
  const s = await src(c, T, source)
  const dur = sec(s, to) - sec(s, from)
  let N = Math.round(dur * FPS / timeScale)
  let frames = cut(s, from, to, N)
  const travel = frames[N].hips.clone().sub(frames[0].hips)
  const naturalUps = Math.hypot(travel.x, travel.z) / dur
  if (speedMS) N = Math.round(dur * FPS * naturalUps * HEIGHT_M[c] / speedMS)
  if (speedMS) frames = cut(s, from, to, N)
  const seam = fixLoop(frames)
  return { frames, seam, window: [from, to], sourceDur: dur, naturalUps, loco }
}

/** Pitch bones forward about the world lateral axis (character faces +X): world' = R · world, children follow. */
function pitchForward(T, frames, degByBone) {
  const axis = new Vector3(0, 1, 0).cross(new Vector3(1, 0, 0))
  for (const f of frames) for (const [bone, deg] of degByBone) {
    const local = f.rot.get(bone)
    const parent = world(T, f).get(PREFIX + bone).q.clone().multiply(local.clone().invert())
    const R = new Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180)
    f.rot.set(bone, parent.clone().invert().multiply(R).multiply(parent).multiply(local).normalize())
  }
}
const SPRINT_LEAN = [['Spine', 4], ['Spine1', 4], ['Spine2', 4], ['Neck', -4], ['Head', -3]] // +12° trunk, gaze kept up

/**
 * stand_on_sword: the surf source folds the chest ~50° over the knees and twists the head 90° toward the board tip,
 * which drives the long hair into the rear shoulder. Straighten most of the fold, turn the chest toward the tip, keep
 * the head looking forward (with its source micro-motion), stand a little taller and re-plant both feet by IK.
 */
const SWORD = { straighten: 0.75, chestYawDeg: 35, headPitchDeg: 10, raiseU: 0.03 }
function swordStance(T, clip) {
  const F = clip.frames, N = F.length - 1
  const Y = new Vector3(0, 1, 0), lateral = Y.clone().cross(new Vector3(1, 0, 0))
  const parentOf = (W, f, bone) => W.get(PREFIX + bone).q.clone().multiply(f.rot.get(bone).clone().invert())
  const worldRot = (f, bone, R) => { // world' = R · world for bone, children follow
    const P = parentOf(world(T, f), f, bone)
    f.rot.set(bone, P.clone().invert().multiply(R).multiply(P).multiply(f.rot.get(bone)).normalize())
  }
  const restHead = T.restW.get(PREFIX + 'Head').q, restNeck = T.restW.get(PREFIX + 'Neck').q
  const restChestInv = T.restW.get(PREFIX + 'Spine2').q.clone().invert()
  const look = new Quaternion().setFromAxisAngle(lateral, SWORD.headPitchDeg * Math.PI / 180).multiply(restHead)
  const head0Inv = world(T, F[0]).get(PREFIX + 'Head').q.clone().invert()
  const yaw = new Quaternion().setFromAxisAngle(Y, SWORD.chestYawDeg * Math.PI / 180)
  F.slice(0, N).forEach((f) => {
    const W = world(T, f)
    const feet = ['Left', 'Right'].map((side) => [side, W.get(PREFIX + side + 'Foot').p.clone(), W.get(PREFIX + side + 'Foot').q.clone()])
    const headQ = W.get(PREFIX + 'Head').q.clone().multiply(head0Inv).multiply(look)
    const up = Y.clone().applyQuaternion(W.get(PREFIX + 'Spine2').q.clone().multiply(restChestInv))
    const step = new Quaternion().slerp(new Quaternion().setFromUnitVectors(up, Y), SWORD.straighten / 3)
    for (const b of ['Spine', 'Spine1', 'Spine2']) worldRot(f, b, step)
    worldRot(f, 'Spine', yaw)
    // neck halfway between the chest-carried neck and the forward-looking head; head exactly on target
    const W2 = world(T, f)
    const neckW = W2.get(PREFIX + 'Neck').q.clone().slerp(headQ.clone().multiply(restHead.clone().invert()).multiply(restNeck), 0.5)
    f.rot.set('Neck', parentOf(W2, f, 'Neck').invert().multiply(neckW).normalize())
    f.rot.set('Head', neckW.clone().invert().multiply(headQ).normalize())
    f.hips.y += SWORD.raiseU
    for (const [side, p, q] of feet) legIK(T, f, side, p, q)
  })
  // centre both (pinned) feet on the rest feet midpoint so they sit on the sword line under the root
  const mid = (Wf) => Wf.get(PREFIX + 'LeftFoot').p.clone().add(Wf.get(PREFIX + 'RightFoot').p).multiplyScalar(0.5)
  const d = mid(world(T, F[0])).sub(mid(T.restW))
  F.slice(0, N).forEach((f) => { f.hips.x -= d.x; f.hips.z -= d.z })
  F[N] = clonePose(F[0])
  clip.stance = SWORD
}

/** Sprint: flee_02 legs / pelvis / spine / head, arms from the run cycle phase-matched on the left thigh. */
async function sprintClip(c, T, { timeScale }) {
  const legs = await loopClip(c, T, { source: 'flee_02', from: 40, to: 57, timeScale, loco: true })
  const run = await loopClip(c, T, { source: 'run', from: 11, to: 30, loco: true })
  const phaseOf = (frames) => {
    // index where the left knee is furthest forward of the hips (glTF +X)
    let best = 0, bx = -Infinity
    frames.slice(0, -1).forEach((f, i) => { const W = world(T, f); const x = W.get(PREFIX + 'LeftLeg').p.x - W.get(PREFIX + 'Hips').p.x; if (x > bx) { bx = x; best = i } })
    return best
  }
  const nL = legs.frames.length - 1, nR = run.frames.length - 1
  const iL = phaseOf(legs.frames), iR = phaseOf(run.frames)
  legs.frames.forEach((f, i) => {
    const ph = (((i - iL) / nL) % 1 + 1) % 1
    const x = (iR + ph * nR) % nR, k = Math.floor(x)
    const a = run.frames[k], b = run.frames[k + 1]
    for (const bone of ARM_BONES) f.rot.set(bone, a.rot.get(bone).clone().slerp(b.rot.get(bone), x - k))
  })
  legs.seam = Math.max(legs.seam, fixLoop(legs.frames))
  pitchForward(T, legs.frames, SPRINT_LEAN)
  legs.window = [40, 57]
  legs.armsFrom = { source: 'run', window: [11, 30], phase: { legs: iL, run: iR } }
  legs.extraLeanDeg = 12
  return legs
}

async function buildClips(c, T) {
  const restHips = T.restW.get(PREFIX + 'Hips').p.clone()
  const standY = restHips.y
  const clips = {}

  // idle / walk / run / sprint / stand_on_sword: loops
  const loopSpecs = {
    idle: { source: 'idle', from: 5, to: 125 },
    walk: { source: 'walk', from: 0, to: 70, speedMS: 1.5, loco: true },
    run: { source: 'run', from: 11, to: 30, speedMS: 5.5, loco: true },
    stand_on_sword: { source: 'surf', from: 58, to: 88 },
  }
  for (const [name, spec] of Object.entries(loopSpecs)) clips[name] = { ...(await loopClip(c, T, spec)), source: spec.source, loop: true }
  clips.sprint = { ...(await sprintClip(c, T, { timeScale: 1.25 })), source: 'flee_02+run', loop: true }
  for (const name of ['idle', 'walk', 'run', 'sprint', 'stand_on_sword']) {
    const clip = clips[name]
    const ip = inPlace(clip.frames, restHips)
    clip.cycleU = ip.dist
    clip.dir = ip.dir
    shiftY(clip.frames, -groundOf(T, clip.frames))
    clip.contacts = lockFeet(T, clip, LOCK[name])
  }
  swordStance(T, clips.stand_on_sword)

  const jd = await src(c, T, 'jump_down')
  const feetMid = (f) => { const W = world(T, f); return W.get(PREFIX + 'LeftFoot').p.clone().add(W.get(PREFIX + 'RightFoot').p).multiplyScalar(0.5) }
  const restFeetMid = T.restW.get(PREFIX + 'LeftFoot').p.clone().add(T.restW.get(PREFIX + 'RightFoot').p).multiplyScalar(0.5)

  // jump: the second hop of the `jump` preset (a standing vertical jump, src 11..26) warped onto fixed marks that the
  // game samples by phase (characterClips.ts JUMP_MARKS): crouch at 3, lift-off at 6, apex at 11, legs reaching for the
  // ground at 16 (30 fps). jump_down, the old source, steps off a ledge: bent 94° and pitched 28° forward at take-off,
  // then a seated tuck all the way down.
  const hop = await src(c, T, 'jump')
  const hopAt = (f) => poseAt(hop, hop.times[0] + f * (hop.times[1] - hop.times[0]))
  const lowest = (f) => { const W = world(T, f); return Math.min(...FEET.map((b) => footRel(T, W, b))) }
  {
    const LIFT = 6
    const frames = warp(hop, [[11, 0], [13, 3], [16.5, LIFT], [21.5, 11], [26, 16]])
    const platform = groundOf(T, frames.slice(0, LIFT))
    const liftDrift = feetMid(frames[LIFT]).sub(restFeetMid), liftAt = frames[LIFT].hips.clone()
    frames.forEach((f, i) => {
      if (i < LIFT) {
        // On the ground: the crouch and push-off over feet planted on their rest spots.
        const drift = feetMid(f).sub(restFeetMid)
        f.hips.x -= drift.x; f.hips.z -= drift.z; f.hips.y -= platform
        return
      }
      // In the air the game carries the body, so the hips drift back over the root and stay at standing height; the
      // lowest foot sits on the root at lift-off and again as the legs reach down, and tucks up under the body between.
      const u = (i - LIFT) / (frames.length - 1 - LIFT)
      const w = smooth(u), ax = liftAt.x - liftDrift.x, az = liftAt.z - liftDrift.z
      f.hips.set(ax + (restHips.x - ax) * w, standY, az + (restHips.z - az) * w)
      f.hips.y -= lowest(f) * (1 - Math.sin(Math.PI * u))
    })
    clips.jump = { frames, loop: false, source: 'jump', window: [11, 26], liftOff: LIFT / FPS, marks: { crouch: 3 / FPS, apex: 11 / FPS, reach: 16 / FPS }, platform }
  }

  // fall: legs hanging a little apart, arms up and out: the hop's descent (src 22.5 / 25.5) rocked slowly, arms a quarter
  // cycle out of phase.
  {
    const A = hopAt(22.5), B = hopAt(25.5)
    const N = 36
    const frames = Array.from({ length: N + 1 }, (_, i) => {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)
      const wa = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i / N - 0.25))
      const p = mixPose(A, B, w)
      for (const b of ARM_BONES) p.rot.set(b, A.rot.get(b).clone().slerp(B.rot.get(b), wa))
      p.hips.set(restHips.x, standY, restHips.z)
      return p
    })
    clips.fall = { frames, loop: true, source: 'jump', window: [22.5, 25.5] }
  }

  // land: touchdown → crouch → stand (src 62..95) warped to 0.5 s, crouch depth reduced, feet locked by IK.
  {
    const K = 0.55 // fraction of the source crouch kept
    const frames = warp(jd, [[62, 0], [73, 6], [95, 15]])
    const ground = groundOf(T, frames.slice(3))
    const S = frames[frames.length - 1]
    const endMid = feetMid(S)
    const shift = endMid.clone().sub(restFeetMid).setY(ground)
    const srcW = frames.map((f) => world(T, f))
    const endW = srcW[srcW.length - 1]
    const touch = frames.findIndex((f, i) => Math.min(footRel(T, srcW[i], 'LeftFoot'), footRel(T, srcW[i], 'RightFoot')) - ground < 0.02)
    const Sx = S.hips.clone().sub(shift)
    frames.forEach((f, i) => {
      const h = f.hips.clone().sub(shift)
      const std = clonePose(S)
      const blended = mixPose(f, std, 1 - K)
      f.rot = blended.rot
      f.hips.copy(h.lerp(Sx, 1 - K))
      for (const side of ['Left', 'Right']) {
        const b = PREFIX + side + 'Foot'
        const tgt = srcW[i].get(b).p.clone().sub(shift)
        const lock = endW.get(b).p.clone().sub(shift)
        const w = smooth((i - touch + 2) / 2)
        tgt.x += (lock.x - tgt.x) * w; tgt.z += (lock.z - tgt.z) * w
        tgt.y = Math.max(tgt.y, T.restW.get(b).p.y)
        legIK(T, f, side, tgt, srcW[i].get(b).q)
      }
    })
    clips.land = { frames, loop: false, source: 'jump_down', window: [62, 95], ground, touchdown: touch / FPS, crouchKept: K }
  }
  return clips
}

// ---------- measurement ----------
const restLean = (T, dir) => { const d = T.restW.get(PREFIX + 'Neck').p.clone().sub(T.restW.get(PREFIX + 'Hips').p); return Math.atan2(d.dot(dir), d.y) }
function measure(c, T, name, clip) {
  const N = clip.frames.length - 1
  const dur = N / FPS
  const W = clip.frames.map((f) => world(T, f))
  const minFoot = Math.min(...W.map((w) => Math.min(...FEET.map((b) => footRel(T, w, b)))))
  const out = { name, frames: N + 1, duration: +dur.toFixed(4), loop: clip.loop, source: clip.source, window: clip.window }
  if (clip.seam !== undefined) out.loopSeamFixedDeg = +clip.seam.toFixed(2)
  out.minFootAboveRest = +minFoot.toFixed(4)
  const hy = clip.frames.map((f) => f.hips.y)
  out.hipsY = [+Math.min(...hy).toFixed(4), +Math.max(...hy).toFixed(4)]
  if (clip.loco) {
    const ups = clip.cycleU / dur
    Object.assign(out, {
      metresPerCycle: +(clip.cycleU * HEIGHT_M[c]).toFixed(3), unitsPerCycle: +clip.cycleU.toFixed(4),
      speedUnitsPerSec: +ups.toFixed(4), speedMS: +(ups * HEIGHT_M[c]).toFixed(3),
      playbackRate: +(clip.sourceDur / dur).toFixed(3), headingDeg: +(Math.atan2(-clip.dir.z, clip.dir.x) * 180 / Math.PI).toFixed(2),
    })
    // Foot slide: over contact frame pairs the ankle must move at exactly -body velocity.
    const slide = {}
    for (const side of ['Left', 'Right']) {
      const b = PREFIX + side + 'Foot'
      let max = 0, sum = 0, n = 0
      for (let i = 0; i < N; i++) {
        if (!clip.contacts[side][i] || !clip.contacts[side][(i + 1) % N]) continue
        const v = W[i + 1].get(b).p.clone().sub(W[i].get(b).p).multiplyScalar(FPS).addScaledVector(clip.dir, ups).setY(0).length() * HEIGHT_M[c]
        max = Math.max(max, v); sum += v; n++
      }
      slide[side] = { contactFrames: clip.contacts[side].filter(Boolean).length, maxMS: +max.toFixed(3), meanMS: +(n ? sum / n : 0).toFixed(3) }
    }
    out.footSlide = slide
    // mean trunk pitch (hips → neck) toward the travel direction relative to the rest pose, + = forward
    const lean = W.slice(0, N).reduce((sum, w) => { const d = w.get(PREFIX + 'Neck').p.clone().sub(w.get(PREFIX + 'Hips').p); return sum + Math.atan2(d.dot(clip.dir), d.y) }, 0) / N - restLean(T, clip.dir)
    out.trunkLeanDeg = +(lean * 180 / Math.PI).toFixed(1)
  } else if (clip.contacts) {
    // stationary loop: how far each ankle wanders while in contact
    const drift = {}
    for (const side of ['Left', 'Right']) {
      const b = PREFIX + side + 'Foot'
      const pts = W.slice(0, N).filter((_, i) => clip.contacts[side][i]).map((w) => w.get(b).p.clone().setY(0))
      const mean = pts.reduce((m, p) => m.add(p), new Vector3()).divideScalar(Math.max(1, pts.length))
      drift[side] = { contactFrames: pts.length, maxM: +(Math.max(0, ...pts.map((p) => p.distanceTo(mean))) * HEIGHT_M[c]).toFixed(4) }
    }
    out.footDrift = drift
  }
  if (clip.lockCorrectionM !== undefined) out.footLockMaxCorrectionM = +(clip.lockCorrectionM * HEIGHT_M[c]).toFixed(4)
  for (const k of ['liftOff', 'marks', 'touchdown', 'platform', 'ground', 'crouchKept', 'armsFrom', 'extraLeanDeg', 'stance']) if (clip[k] !== undefined) out[k] = typeof clip[k] === 'number' ? +clip[k].toFixed(4) : clip[k]
  return out
}

function pack(T, name, clip) {
  continuity(clip.frames)
  const N = clip.frames.length
  const rot = new Map()
  for (const b of BONES) {
    const arr = new Float32Array(N * 4)
    clip.frames.forEach((f, i) => arr.set(f.rot.get(b).toArray(), i * 4))
    rot.set(b, arr)
  }
  const hips = new Float32Array(N * 3)
  clip.frames.forEach((f, i) => hips.set(hipsLocal(T, f.hips).toArray(), i * 3))
  return { name, times: Float32Array.from({ length: N }, (_, i) => i / FPS), rot, hips }
}

const ORDER = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'stand_on_sword']
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all'
const write = !process.argv.includes('--no-write')
const report = fs.existsSync(path.join(HERE, 'build-report.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'build-report.json'), 'utf8')) : {}
for (const c of which === 'all' ? ['male', 'female'] : [which]) {
  const T = await loadTarget(path.join(ROOT, 'public/assets/characters', c, 'rig.optimized.glb'))
  const clips = await buildClips(c, T)
  const rows = ORDER.map((n) => measure(c, T, n, clips[n]))
  for (const r of rows) process.stdout.write(`${c} ${JSON.stringify(r)}\n`)
  const out = path.join(ROOT, 'public/assets/characters', c, 'anim.glb')
  if (write) {
    await writeAnimGlb(T, ORDER.map((n) => pack(T, n, clips[n])), out)
    process.stdout.write(`${c} wrote ${out} ${fs.statSync(out).size} bytes\n`)
  }
  for (const k of Object.keys(loaders)) delete loaders[k]
  report[c] = { heightM: HEIGHT_M[c], file: path.relative(ROOT, out).replace(/\\/g, '/'), bytes: write ? fs.statSync(out).size : null, clips: rows }
}
fs.writeFileSync(path.join(HERE, 'build-report.json'), JSON.stringify(report, null, 2))
