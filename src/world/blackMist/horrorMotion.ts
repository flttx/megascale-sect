import { BufferAttribute, Matrix4, MeshStandardMaterial, Quaternion, Uniform, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { horrorFacing } from './horrorLayout.ts'
import type { HorrorSourceType, HorrorPlacement } from './horrorLayout.ts'

type Point = [number, number, number]
type Four = [number, number, number, number]
export type HorrorMotionPhase = 'walk' | 'settle' | 'roar' | 'recover'
export interface HorrorMotionSample {
  time: number
  cycle: number
  cycleTime: number
  period: number
  phase: HorrorMotionPhase
  offset: Point
  velocity: Point
  yawOffset: number
  angularVelocity: number
  gaitTime: number
  gaitDistance: number
  turnAngle: number
  stepStrength: number
  headLift: number
  roarStrength: number
  roarStart: number
  roarEnd: number
  roarEvent: boolean
  roarEventId: string
}
export const HORROR_MOTION_LIMITS = {
  watcher: { displacement: 0.09 },
  behemoth: { displacement: 0.18 },
  maxJointFrequency: 2.7,
} as const
/** Culling reserve only; clearance uses actual posed source vertices, never this as a body radius. */
export const HORROR_ATTACK_LIMITS = {
  displacement: 0.8,
  headYaw: 0.22,
  headPitch: 0.16,
  upperAngle: 0.24,
  lowerAngle: 0.42,
} as const
const VERSION = 'horror-articulated-dq-9-threat-v2'
export interface HorrorAttackPose {
  phase: 'idle' | 'tracking' | 'windup' | 'strike' | 'recover'
  progress: number
  sequence: number
  localTarget: Point | null
  hand: 0 | 1
  recoveryFrom?: readonly [Point, Point]
  windupFrom?: readonly [Point, Point]
  recoveryAttention?: number
  windupHead?: Four
  recoveryHead?: Four
}
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
const modulo = (value: number, range: number) => ((value % range) + range) % range
const clampAngle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value))

function ellipseArc(rx: number, rz: number, start: number, span: number): number {
  const intervals = 24,
    step = span / intervals
  let sum = 0
  for (let i = 0; i <= intervals; i++) {
    const angle = start + i * step,
      speed = Math.hypot(rx * Math.sin(angle), rz * Math.cos(angle))
    sum += speed * (i === 0 || i === intervals ? 1 : i % 2 ? 4 : 2)
  }
  return (sum * step) / 3
}

/** One deterministic total cycle: traverse the bounded path, plant, raise the head/roar, recover. */
export function sampleHorrorMotion(placement: HorrorPlacement, time: number): HorrorMotionSample {
  const period = placement.patrol.period,
    hold = placement.roar.hold,
    settle = 2.8,
    recover = 4
  const walk = period - settle - hold - recover,
    offset = placement.roar.offset ?? 0
  const timeValue = Number.isFinite(time) ? Math.max(0, time) : 0
  const cycle = Math.floor((timeValue + offset) / period),
    cycleTime = modulo(timeValue + offset, period)
  const walkTime = Math.min(walk, cycleTime),
    ramp = Math.min(4, walk * 0.12)
  let travel: number, speed: number
  if (walkTime < ramp) {
    travel = (0.5 * (walkTime - (ramp / Math.PI) * Math.sin((Math.PI * walkTime) / ramp))) / (walk - ramp)
    speed = 0.5 * (1 - Math.cos((Math.PI * walkTime) / ramp))
  } else if (walkTime > walk - ramp) {
    const remaining = walk - walkTime
    travel = 1 - (0.5 * (remaining - (ramp / Math.PI) * Math.sin((Math.PI * remaining) / ramp))) / (walk - ramp)
    speed = 0.5 * (1 - Math.cos((Math.PI * remaining) / ramp))
  } else {
    travel = (walkTime - ramp / 2) / (walk - ramp)
    speed = 1
  }
  const baseYaw = horrorFacing(placement),
    rx = placement.patrol.radiusX,
    rz = placement.patrol.radiusZ
  // Default start/end tangent faces the sect: there is no instant whole-body turn at a roar.
  const start = placement.patrol.startAngle ?? Math.atan2(-Math.sin(baseYaw) / rx, Math.cos(baseYaw) / rz)
  const angle = start + travel * Math.PI * 2,
    rate = ((Math.PI * 2) / (walk - ramp)) * speed
  const vx = -rx * Math.sin(angle) * rate,
    vz = rz * Math.cos(angle) * rate
  const tangentYaw = Math.atan2(-rx * Math.sin(angle), rz * Math.cos(angle))
  const yawOffset = clampAngle(tangentYaw - baseYaw)
  const angularVelocity = (-rx * rz * rate) / (rx * rx * Math.sin(angle) ** 2 + rz * rz * Math.cos(angle) ** 2)
  const tangentStart = Math.atan2(-rx * Math.sin(start), rz * Math.cos(start)),
    rawTurn = tangentYaw - tangentStart
  const turnAngle = rawTurn - Math.PI * 2 * Math.round((rawTurn + travel * Math.PI * 2) / (Math.PI * 2))
  const gaitDistance = cycle * ellipseArc(rx, rz, start, Math.PI * 2) + ellipseArc(rx, rz, start, travel * Math.PI * 2)
  const roarStart = walk + settle,
    roarEnd = roarStart + hold
  const phase: HorrorMotionPhase =
    cycleTime < walk ? 'walk' : cycleTime < roarStart ? 'settle' : cycleTime < roarEnd ? 'roar' : 'recover'
  const inRoar = cycleTime - roarStart
  const roarStrength = phase === 'roar' ? ease(inRoar / 0.8) * ease((roarEnd - cycleTime) / 1.1) : 0
  const headLift =
    phase === 'settle'
      ? 0.18 * ease((cycleTime - walk) / settle)
      : phase === 'roar'
        ? 0.18 + roarStrength * 0.82
        : phase === 'recover'
          ? 0.18 * (1 - ease((cycleTime - roarEnd) / recover))
          : 0
  return {
    time: timeValue,
    cycle,
    cycleTime,
    period,
    phase,
    offset: [rx * Math.cos(angle), 0, rz * Math.sin(angle)],
    velocity: [vx, 0, vz],
    yawOffset,
    angularVelocity,
    gaitTime: cycle * walk + walkTime,
    gaitDistance,
    turnAngle: cycle * Math.PI * -2 + turnAngle,
    stepStrength: phase === 'walk' ? speed : 0,
    headLift,
    roarStrength,
    roarStart,
    roarEnd,
    roarEvent: phase === 'roar' && inRoar >= 0.45,
    roarEventId: `${placement.id}:${cycle}`,
  }
}

interface Limb {
  side: number
  upper: number
  lower: number
  shoulder: Vector3
  elbow: Vector3
  foot: Vector3
  phase: number
}
export interface HorrorRig {
  id: HorrorSourceType
  time: Uniform<number>
  roar: Uniform<number>
  phase: number
  attack: HorrorAttackPose | null
  rotations: Uniform<Float32Array>
  duals: Uniform<Float32Array>
  rest: Vector3[]
  posed: Vector3[]
  sample: HorrorMotionSample | null
  limbs: Limb[]
  feet: { id: string; contact: boolean; target: Vector3; posed: Vector3 }[]
}

/** Anatomical controls measured from the real GLB's normalized +Z-facing orthographic projections. */
export function createHorrorRig(id: HorrorSourceType, phase = 0): HorrorRig {
  const watcher = id === 'watcher'
  const shoulderY = watcher ? 0.53 : 0.63,
    elbowY = watcher ? 0.29 : 0.31,
    footY = watcher ? 0.095 : 0.035
  const shoulderX = watcher ? 0.17 : 0.31,
    elbowX = watcher ? 0.24 : 0.46,
    footX = watcher ? 0.22 : 0.44
  const elbowZ = watcher ? 0.14 : -0.07,
    footZ = watcher ? 0.13 : 0.04
  const rest = [
    new Vector3(0, 0.48, -0.02),
    new Vector3(0, 0.64, 0.04),
    new Vector3(-shoulderX, shoulderY, 0.035),
    new Vector3(-elbowX, elbowY, elbowZ),
    new Vector3(shoulderX, shoulderY, 0.035),
    new Vector3(elbowX, elbowY, elbowZ),
    new Vector3(-0.13, 0.32, -0.21),
    new Vector3(0.13, 0.32, -0.21),
    new Vector3(0, 0.57, 0.19),
  ]
  const limbs: Limb[] = [-1, 1].map((side, index) => ({
    side,
    upper: index ? 4 : 2,
    lower: index ? 5 : 3,
    shoulder: rest[index ? 4 : 2],
    elbow: rest[index ? 5 : 3],
    foot: new Vector3(side * footX, footY, footZ),
    phase: index * Math.PI,
  }))
  const rotations = new Float32Array(36)
  for (let i = 0; i < 9; i++) rotations[i * 4 + 3] = 1
  return {
    id,
    phase,
    attack: null,
    time: new Uniform(0),
    roar: new Uniform(0),
    rotations: new Uniform(rotations),
    duals: new Uniform(new Float32Array(36)),
    rest,
    posed: rest.map((point) => point.clone()),
    sample: null,
    limbs,
    feet: limbs.map((limb, index) => ({
      id: index ? 'right-wrist' : 'left-wrist',
      contact: true,
      target: limb.foot.clone(),
      posed: limb.foot.clone(),
    })),
  }
}

function writeDual(rig: HorrorRig, joint: number, rotation: Quaternion, posedPivot: Vector3) {
  const translation = posedPivot.clone().sub(rig.rest[joint].clone().applyQuaternion(rotation)),
    i = joint * 4
  rig.posed[joint].copy(posedPivot)
  const r = rig.rotations.value,
    d = rig.duals.value,
    x = rotation.x,
    y = rotation.y,
    z = rotation.z,
    w = rotation.w
  r[i] = x
  r[i + 1] = y
  r[i + 2] = z
  r[i + 3] = w
  d[i] = 0.5 * (translation.x * w + translation.y * z - translation.z * y)
  d[i + 1] = 0.5 * (-translation.x * z + translation.y * w + translation.z * x)
  d[i + 2] = 0.5 * (translation.x * y - translation.y * x + translation.z * w)
  d[i + 3] = -0.5 * (translation.x * x + translation.y * y + translation.z * z)
}

function limbPose(rig: HorrorRig, limb: Limb, target: Vector3, bob: number) {
  const shoulder = limb.shoulder.clone().add(new Vector3(0, bob, 0)),
    reach = target.clone().sub(shoulder)
  const l1 = limb.elbow.distanceTo(limb.shoulder),
    l2 = limb.foot.distanceTo(limb.elbow)
  const distance = Math.max(Math.abs(l1 - l2) + 0.001, Math.min(l1 + l2 - 0.002, reach.length()))
  reach.normalize()
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance),
    height = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const bend = limb.elbow
    .clone()
    .sub(limb.shoulder)
    .addScaledVector(reach, -limb.elbow.clone().sub(limb.shoulder).dot(reach))
    .normalize()
  const elbow = shoulder.clone().addScaledVector(reach, along).addScaledVector(bend, height)
  const foot = shoulder.clone().addScaledVector(reach, distance)
  const upper = new Quaternion().setFromUnitVectors(
    limb.elbow.clone().sub(limb.shoulder).normalize(),
    elbow.clone().sub(shoulder).normalize(),
  )
  const lower = new Quaternion().setFromUnitVectors(
    limb.foot.clone().sub(limb.elbow).normalize(),
    foot.clone().sub(elbow).normalize(),
  )
  const limit = (rotation: Quaternion, angle: number) => {
    const measured = 2 * Math.acos(Math.max(-1, Math.min(1, rotation.w)))
    if (measured > angle) rotation.slerpQuaternions(new Quaternion(), rotation.clone(), angle / measured)
  }
  // Static source skin cannot accommodate a folded-over 170-degree forearm.
  // A shared bounded cone keeps every DQ pair in one positive hemisphere and
  // preserves exact bone lengths; the visible hand stops at its anatomical reach.
  limit(upper, HORROR_ATTACK_LIMITS.upperAngle)
  limit(lower, HORROR_ATTACK_LIMITS.lowerAngle)
  elbow.copy(limb.elbow).sub(limb.shoulder).applyQuaternion(upper).add(shoulder)
  foot.copy(limb.foot).sub(limb.elbow).applyQuaternion(lower).add(elbow)
  writeDual(rig, limb.upper, upper, shoulder)
  writeDual(rig, limb.lower, lower, elbow)
  return foot
}

/** Real limb-chain IK and stop/roar articulation; the DQ palette is shared by both geometry LODs. */
export function updateHorrorRig(
  rig: HorrorRig,
  placement: HorrorPlacement,
  sample: HorrorMotionSample,
  baseYaw = horrorFacing(placement),
  attack?: HorrorAttackPose,
) {
  rig.sample = sample
  rig.time.value = sample.time
  rig.roar.value = sample.roarStrength
  rig.attack = attack ?? null
  const progress = Math.max(0, Math.min(1, attack?.progress ?? 0)),
    preparing = attack?.phase === 'windup',
    swinging = attack?.phase === 'strike',
    recovering = attack?.phase === 'recover'
  const attention =
    !attack || attack.phase === 'idle'
      ? 0
      : preparing || attack.phase === 'tracking'
        ? ease(progress)
        : recovering
          ? (attack.recoveryAttention ?? 1) * (1 - ease(progress))
          : 1
  const active = sample.stepStrength,
    yaw = baseYaw + sample.yawOffset
  const speed = Math.hypot(sample.velocity[0], sample.velocity[2]),
    radius = placement.height * (rig.id === 'watcher' ? 0.3 : 0.5)
  const strideLength = placement.height * (rig.id === 'watcher' ? 0.14 : 0.16)
  const gait = ((sample.gaitDistance + Math.abs(sample.turnAngle) * radius) / strideLength) * Math.PI * 2 + rig.phase
  const bob = active * (-0.026 + 0.005 * Math.cos(gait * 2))
  const neutral = new Quaternion(),
    body = rig.rest[0].clone().add(new Vector3(0, bob, 0))
  writeDual(rig, 0, neutral, body)
  const localTarget = attack?.localTarget
  const aimedYaw = localTarget
    ? Math.max(
        -HORROR_ATTACK_LIMITS.headYaw,
        Math.min(HORROR_ATTACK_LIMITS.headYaw, Math.atan2(localTarget[0], Math.max(0.05, localTarget[2]))),
      )
    : 0
  const headYaw = Math.sin(baseYaw - yaw) * placement.patrol.yawLimit * 0.55 * (1 - attention) + aimedYaw * attention
  const aimedPitch = localTarget
    ? -Math.atan2(localTarget[1] - 0.64, Math.max(0.15, Math.hypot(localTarget[0], localTarget[2])))
    : 0
  const headPitch =
    Math.max(-HORROR_ATTACK_LIMITS.headPitch, Math.min(HORROR_ATTACK_LIMITS.headPitch, aimedPitch)) * attention -
    sample.headLift * 0.14 * (1 - attention) -
    (preparing ? ease(progress) * 0.1 : swinging ? 0.1 * (1 - ease(progress)) : 0)
  const head = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), headYaw)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), headPitch))
  if (preparing && attack?.windupHead)
    head.slerpQuaternions(new Quaternion(...attack.windupHead), head.clone(), ease(progress))
  if (recovering && attack?.recoveryHead) {
    const neutralHead = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(baseYaw - yaw) * placement.patrol.yawLimit * 0.55)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -sample.headLift * 0.14))
    head.slerpQuaternions(new Quaternion(...attack.recoveryHead), neutralHead, ease(progress))
  }
  writeDual(rig, 1, head, rig.rest[1].clone().add(new Vector3(0, bob, 0)))
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw)
  const forwardVelocity = new Vector3(
    cos * sample.velocity[0] - sin * sample.velocity[2],
    0,
    sin * sample.velocity[0] + cos * sample.velocity[2],
  )
  for (const [index, limb] of rig.limbs.entries()) {
    const cycle = modulo(gait + limb.phase, Math.PI * 2) / (Math.PI * 2),
      contact = cycle < 0.64 || active < 0.001
    const forward = forwardVelocity
      .clone()
      .add(
        new Vector3(
          sample.angularVelocity * limb.foot.z * placement.height,
          0,
          -sample.angularVelocity * limb.foot.x * placement.height,
        ),
      )
    const footSpeed = forward.length()
    if (footSpeed > 0.001) forward.normalize()
    else forward.set(0, 0, 1)
    const stride = Math.min(
      rig.id === 'watcher' ? 0.09 : 0.12,
      ((strideLength / placement.height) * footSpeed) / Math.max(1, speed + Math.abs(sample.angularVelocity) * radius),
    )
    const swing = (cycle - 0.64) / 0.36
    const h00 = 2 * swing ** 3 - 3 * swing ** 2 + 1,
      h10 = swing ** 3 - 2 * swing ** 2 + swing
    const h01 = -2 * swing ** 3 + 3 * swing ** 2,
      h11 = swing ** 3 - swing ** 2
    const travel = contact
      ? stride * (0.5 - cycle / 0.64)
      : stride * (-0.5 * h00 + 0.5 * h01 - (0.36 / 0.64) * (h10 + h11))
    const lift = contact ? 0 : Math.sin(swing * Math.PI) ** 2 * (rig.id === 'watcher' ? 0.035 : 0.045)
    const target = limb.foot.clone().addScaledVector(forward, travel * active)
    target.y += lift * active
    if (attack && (preparing || swinging || recovering)) {
      if (index === attack.hand) {
        const raised =
          rig.id === 'watcher' ? new Vector3(limb.side * 0.4, 0.3, -0.05) : new Vector3(limb.side * 0.4, 0.25, 0.05)
        const strike = localTarget ? new Vector3(...localTarget) : limb.foot.clone().add(new Vector3(0, 0.18, 0.35))
        const reach = limb.shoulder.distanceTo(limb.elbow) + limb.elbow.distanceTo(limb.foot)
        strike
          .sub(limb.shoulder)
          .clampLength(0.04, reach * 0.96)
          .add(limb.shoulder)
        if (preparing)
          target
            .copy(attack.windupFrom ? new Vector3(...attack.windupFrom[index]) : limb.foot)
            .lerp(raised, ease(progress))
        else if (swinging) target.copy(raised).lerp(strike, ease(progress / 0.7))
        else
          target
            .copy(attack.recoveryFrom ? new Vector3(...attack.recoveryFrom[index]) : strike)
            .lerp(limb.foot, ease(progress))
      } else if (recovering && attack.recoveryFrom)
        target.set(...attack.recoveryFrom[index]).lerp(limb.foot, ease(progress))
      else
        target
          .copy(preparing && attack.windupFrom ? new Vector3(...attack.windupFrom[index]) : limb.foot)
          .lerp(
            limb.foot.clone().add(new Vector3(0, 0.018 * attention, -0.025 * attention)),
            preparing ? ease(progress) : 1,
          )
    }
    const posed = limbPose(rig, limb, target, bob)
    rig.feet[index].contact = contact
    rig.feet[index].target.copy(target)
    rig.feet[index].posed.copy(posed)
  }
  for (const [index, side] of [-1, 1].entries()) {
    const leg = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), active * Math.sin(gait + (index ? 0 : Math.PI)) * 0.12)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), active * side * Math.sin(gait + index) * 0.035))
    writeDual(rig, index + 6, leg, rig.rest[index + 6].clone().add(new Vector3(0, bob, 0)))
  }
  const jaw = head
    .clone()
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), sample.roarStrength * 0.2 + attention * 0.06))
  writeDual(rig, 8, jaw, rig.rest[8].clone().sub(rig.rest[1]).applyQuaternion(head).add(rig.posed[1]))
}

/** CPU and GPU use the same confined chest expansion before articulated skinning. */
export function sampleHorrorBreathing(point: Vector3, time: number, phase: number, roar = 0): Vector3 {
  const y = Math.max(0, Math.min(1, (point.y - 0.16) / 0.72)),
    envelope = Math.sin(y * Math.PI) ** 2
  const amount = 0.008 + 0.009 * Math.sin(time * 0.53 + phase) + roar * 0.018
  return new Vector3(
    point.x * (1 + amount * envelope),
    point.y + amount * envelope * 0.035,
    point.z * (1 + amount * envelope * 0.75),
  )
}

function binding(point: Vector3, rig: HorrorRig): { joints: Four; weights: Four } {
  const w = new Float64Array(9),
    x = Math.abs(point.x),
    watcher = rig.id === 'watcher'
  const side = point.x < 0 ? -1 : 1,
    arm =
      ease((x - (watcher ? 0.105 : 0.235)) / (watcher ? 0.12 : 0.2)) *
      (1 - ease((point.y - 0.65) / 0.18)) *
      (watcher ? ease((point.z + 0.12) / 0.17) : ease((point.z + 0.32) / 0.2))
  const armLow = ease(((watcher ? 0.4 : 0.44) - point.y) / 0.23)
  w[side < 0 ? 2 : 4] = arm * (1 - armLow)
  w[side < 0 ? 3 : 5] = arm * armLow
  const rear = (1 - arm) * ease((0.36 - point.y) / 0.18) * ease((-0.06 - point.z) / 0.18) * ease((x - 0.045) / 0.07)
  w[side < 0 ? 6 : 7] = rear
  const head = ease((point.y - 0.58) / 0.14) * ease((point.z + 0.04) / 0.17) * (1 - ease((x - 0.19) / 0.16))
  w[1] = (1 - arm - rear) * head
  const jaw =
    ease((point.z - 0.1) / 0.15) *
    (1 - ease((point.y - 0.56) / 0.12)) *
    (1 - ease((x - 0.1) / 0.12)) *
    ease((point.y - 0.38) / 0.12)
  w[8] = (1 - arm - rear) * (1 - head) * jaw
  w[0] = Math.max(0, 1 - w.reduce((sum, value) => sum + value, 0))
  const ranked = Array.from(w, (weight, joint) => ({ weight, joint })).sort((a, b) => b.weight - a.weight)
  const cutoff = ranked[4].weight,
    selected = ranked.slice(0, 4).map((entry) => ({ joint: entry.joint, weight: Math.max(0, entry.weight - cutoff) }))
  const sum = selected.reduce((total, entry) => total + entry.weight, 0)
  return {
    joints: selected.map((entry) => entry.joint) as Four,
    weights: selected.map((entry) => entry.weight / sum) as Four,
  }
}

/** Only caller-owned, fully normalized real GLB geometry is bound; authored positions and maps stay intact. */
export function bindHorrorGeometry(geometry: BufferGeometry, rig: HorrorRig) {
  const positions = geometry.getAttribute('position'),
    joints = new Float32Array(positions.count * 4),
    weights = new Float32Array(positions.count * 4),
    p = new Vector3()
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i)
    const data = binding(p, rig)
    joints.set(data.joints, i * 4)
    weights.set(data.weights, i * 4)
  }
  geometry.setAttribute('aHorrorJoints', new BufferAttribute(joints, 4))
  geometry.setAttribute('aHorrorWeights', new BufferAttribute(weights, 4))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += HORROR_ATTACK_LIMITS.displacement
  geometry.userData.horrorMotion = { bound: true, version: VERSION, joints: 9, weights: 4 }
}

const SKIN = /* glsl */ `
  uniform vec4 uHorrorRotations[9]; uniform vec4 uHorrorDuals[9];
  attribute vec4 aHorrorJoints; attribute vec4 aHorrorWeights;
  vec3 horrorRotate(vec4 q, vec3 p) { return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p); }
  void horrorSkin(out vec4 rotation, out vec3 translation) {
    vec4 reference = uHorrorRotations[int(aHorrorJoints.x)], r = vec4(0.0), d = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      int joint = int(aHorrorJoints[i]); vec4 qr = uHorrorRotations[joint], qd = uHorrorDuals[joint];
      if (dot(reference, qr) < 0.0) { qr = -qr; qd = -qd; }
      r += qr * aHorrorWeights[i]; d += qd * aHorrorWeights[i];
    }
    float inverseLength = inversesqrt(max(dot(r, r), 0.000001)); rotation = r * inverseLength; d *= inverseLength;
    d -= rotation * dot(rotation, d);
    translation = 2.0 * (rotation.w * d.xyz - d.w * rotation.xyz + cross(rotation.xyz, d.xyz));
  }
`

/** Compose after the existing breathing Jacobian and before projection; normals/tangents keep PBR detail. */
export function patchHorrorMotionMaterial(material: MeshStandardMaterial, rig: HorrorRig) {
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey.call(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.uHorrorRotations = rig.rotations
    shader.uniforms.uHorrorDuals = rig.duals
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKIN}`)
      .replace(
        '#include <defaultnormal_vertex>',
        `vec4 horrorRotation; vec3 horrorTranslation;
        horrorSkin(horrorRotation, horrorTranslation);
        objectNormal = horrorRotate(horrorRotation, objectNormal);
        #ifdef USE_TANGENT
          objectTangent = horrorRotate(horrorRotation, objectTangent);
        #endif
        #include <defaultnormal_vertex>`,
      )
      .replace(
        '#include <project_vertex>',
        'transformed = horrorRotate(horrorRotation, transformed) + horrorTranslation;\n#include <project_vertex>',
      )
  }
  material.customProgramCacheKey = () => `${key}|${VERSION}`
  material.userData.horrorMotion = { patched: true, version: VERSION, joints: 9, weights: 4 }
  material.needsUpdate = true
}

interface DualPalette {
  rotations: Uniform<Float32Array>
  duals: Uniform<Float32Array>
}
/** Shared actual-buffer DQ evaluator, also usable for aTentacleJoints/Weights plus a 12×phase palette. */
export function evaluateDQVertex(
  geometry: BufferGeometry,
  palette: DualPalette,
  index: number,
  out: Vector3,
  jointName = 'aHorrorJoints',
  weightName = 'aHorrorWeights',
  jointOffset = 0,
  input?: Vector3,
): Vector3 {
  const joints = geometry.getAttribute(jointName),
    weights = geometry.getAttribute(weightName),
    rotations = palette.rotations.value,
    duals = palette.duals.value
  const reference = (jointOffset + joints.getX(index)) * 4,
    r = [0, 0, 0, 0],
    d = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const offset = (jointOffset + joints.getComponent(index, i)) * 4,
      weight = weights.getComponent(index, i)
    let dot = 0
    for (let k = 0; k < 4; k++) dot += rotations[reference + k] * rotations[offset + k]
    const sign = dot < 0 ? -1 : 1
    for (let k = 0; k < 4; k++) {
      r[k] += rotations[offset + k] * weight * sign
      d[k] += duals[offset + k] * weight * sign
    }
  }
  const length = Math.hypot(...r)
  for (let k = 0; k < 4; k++) {
    r[k] /= length
    d[k] /= length
  }
  const dot = r.reduce((sum, value, k) => sum + value * d[k], 0)
  for (let k = 0; k < 4; k++) d[k] -= r[k] * dot
  const v = new Vector3(r[0], r[1], r[2]),
    dual = new Vector3(d[0], d[1], d[2])
  const translation = dual
    .clone()
    .multiplyScalar(r[3])
    .addScaledVector(v, -d[3])
    .add(new Vector3().crossVectors(v, dual))
    .multiplyScalar(2)
  return out
    .copy(input ?? new Vector3().fromBufferAttribute(geometry.getAttribute('position'), index))
    .applyQuaternion(new Quaternion(r[0], r[1], r[2], r[3]))
    .add(translation)
}

export function evaluateHorrorMotionVertex(
  geometry: BufferGeometry,
  rig: HorrorRig,
  index: number,
  out: Vector3,
): Vector3 {
  const rest = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), index)
  const input = sampleHorrorBreathing(rest, rig.time.value, rig.phase, rig.roar.value)
  return evaluateDQVertex(geometry, rig, index, out, 'aHorrorJoints', 'aHorrorWeights', 0, input)
}

export function horrorRigSnapshot(rig: HorrorRig) {
  return {
    attack: rig.attack,
    joints: rig.rest.map((rest, joint) => ({
      joint,
      rest: rest.toArray(),
      posed: rig.posed[joint].toArray(),
      rotation: Array.from(rig.rotations.value.slice(joint * 4, joint * 4 + 4)),
    })),
    feet: rig.feet.map((foot) => ({
      id: foot.id,
      contact: foot.contact,
      target: foot.target.toArray(),
      posed: foot.posed.toArray(),
    })),
  }
}

/** Shared root transform for numerical clearance audits and render-facing placement. */
export function sampleHorrorPlacement(placement: HorrorPlacement, time: number) {
  const motion = sampleHorrorMotion(placement, time)
  const position = new Vector3(...placement.position).add(new Vector3(...motion.offset)),
    yaw = horrorFacing(placement) + motion.yawOffset
  return {
    motion,
    position,
    yaw,
    matrix: new Matrix4().compose(
      position,
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
      new Vector3().setScalar(placement.height),
    ),
  }
}
