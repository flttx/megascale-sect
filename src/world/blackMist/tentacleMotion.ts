import {
  BufferAttribute,
  InstancedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Uniform,
  Vector3,
} from 'three'
import type { BufferGeometry } from 'three'

export const TENTACLE_MOTION_JOINTS = 12
export const TENTACLE_MOTION_PHASES = 8
export const TENTACLE_MOTION_VERSION = 'tripo-centreline-dq-12x8-full-muscle-v3'
const VERSION = TENTACLE_MOTION_VERSION

/** Authored angular parameters, shared verbatim with offline clearance; radians and radians/second. */
export const TENTACLE_MOTION_PARAMETERS = {
  rootHeight: 0.065,
  rootBlendHeight: 0.23,
  rootBlendRound: 0.1,
  envelopeStart: 0.01,
  envelopeSpan: 0.085,
  bindingContrast: 0.35,
  distalStart: 0.5,
  distalSpan: 0.5,
  waveBase: 0.14,
  waveArch: 0.075,
  waveFrequency: 0.3,
  waveDelay: 3.2,
  waveHeightMix: 0.8,
  loopStart: 1,
  loopEnd: 9,
  loopWaveScale: 0.8,
  tailCoilGain: 1.4,
  coilAmplitude: 0.09,
  coilFrequency: 0.17,
  coilDelay: 2.0,
  coilPhase: 0.73,
  liftBase: 0.036,
  liftDistal: 0.012,
  liftFrequency: 0.23,
  liftDelay: 2.3,
  liftPhase: 1.17,
  twistAmplitude: 0.035,
  twistFrequency: 0.11,
  twistDelay: 1.9,
  twistPhase: 0.91,
  phaseStep: 2.3999632297,
  speedBase: 0.9,
  speedStride: 0.028,
  speedModulo: 5,
} as const

export type TentacleBehaviorPhase = 'idle' | 'tracking' | 'windup' | 'strike' | 'recover'
export interface TentacleBehaviorPose {
  seed: number
  phase: TentacleBehaviorPhase
  progress: number
  sequence: number
  /** Target in this normalized model's local space, read from the shared threat clock. */
  localTarget: readonly [number, number, number] | null
  /** Capture the preceding pose once, including an aborted anticipation. */
  recoveryFrom?: TentacleBehaviorSnapshot
}
export interface TentacleBehaviorSnapshot {
  phase: TentacleBehaviorPhase
  progress: number
  sequence: number
  direction: [number, number, number]
  lean: number
  yaw: number
  tail: number
  idleDirection: number
}
export const TENTACLE_INTERACTION_LIMITS = {
  idleLean: 0.032,
  windupLean: 0.1,
  strikeLean: 0.3,
  aimYaw: 0.25,
  tailCurl: 0.12,
} as const

/**
 * Measured muscle centreline in the original Tripo GLB scene's metres, before normalization.
 * It follows the broad ascending shaft, the upper curl, then the thinner right-hand crook/tip.
 * Inspecting the actual YZ projection is essential: height alone identifies both sides of a curl.
 * Source: abyss-tentacle-2e1ea6a1, reproduced by the offline point-cloud inspection.
 */
const SOURCE_CHAIN: readonly (readonly [number, number, number])[] = [
  [0, -0.48986, -0.255],
  [0, -0.335, -0.25],
  [0, -0.105, -0.295],
  [0, 0.145, -0.3],
  [0, 0.335, -0.19],
  [0, 0.402, -0.015],
  [0, 0.315, 0.19],
  [0, 0.115, 0.275],
  [0, -0.105, 0.235],
  [0, -0.205, 0.135],
  [0, -0.075, 0.375],
  [0, -0.168, 0.444],
]
const SOURCE_RADII = [0.18, 0.175, 0.16, 0.135, 0.105, 0.087, 0.073, 0.06, 0.044, 0.032, 0.017, 0.006]
const SOURCE_HEIGHT = 0.9796774

export interface TentacleMotionRig {
  sourceNormalization: Matrix4
  rest: Vector3[]
  lengths: number[]
  totalLength: number
  unitHeight: number
  bounds: TentacleMotionBounds
  interactive: boolean
  behavior: (TentacleBehaviorSnapshot | null)[]
  time: Uniform<number>
  strength: Uniform<number>
  rotations: Uniform<Float32Array>
  duals: Uniform<Float32Array>
  posed: Vector3[][]
  lastTime: number
  lastStrength: number
  lastBehaviorKey: string
}

const boundGeometry = new WeakMap<BufferGeometry, TentacleMotionRig>()
const patchedMaterials = new WeakMap<MeshStandardMaterial, TentacleMotionRig>()
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
const rootEase = (value: number) => {
  const t = Math.max(0, Math.min(1, value)),
    round = TENTACLE_MOTION_PARAMETERS.rootBlendRound
  if (t < round) return (0.5 * (t - (round / Math.PI) * Math.sin((Math.PI * t) / round))) / (1 - round)
  if (t > 1 - round)
    return 1 - (0.5 * (1 - t - (round / Math.PI) * Math.sin((Math.PI * (1 - t)) / round))) / (1 - round)
  return (t - round / 2) / (1 - round)
}

const seeded = (seed: number, index: number) => {
  const value = Math.sin(seed * 127.1 + index * 311.7 + 19.73) * 43758.5453
  return value - Math.floor(value)
}

/** Seeded smooth direction changes and a finite anticipation/swing/recovery gesture. */
export function sampleTentacleBehavior(time: number, pose: TentacleBehaviorPose): TentacleBehaviorSnapshot {
  const limits = TENTACLE_INTERACTION_LIMITS,
    interval = 10 + seeded(pose.seed, 0) * 4,
    segment = Math.floor(time / interval)
  const first = seeded(pose.seed, segment + 1) * Math.PI * 2,
    second = seeded(pose.seed, segment + 2) * Math.PI * 2
  const directionChange = Math.atan2(Math.sin(second - first), Math.cos(second - first))
  const idleDirection = first + directionChange * ease(time / interval - segment)
  const progress = Math.max(0, Math.min(1, pose.progress))
  const attention =
    pose.phase === 'idle'
      ? 0
      : pose.phase === 'tracking' || pose.phase === 'windup'
        ? ease(progress)
        : pose.phase === 'recover'
          ? 1 - ease(progress)
          : 1
  const target = pose.localTarget
  const dx = target?.[0] ?? Math.sin(idleDirection),
    dz = target ? target[2] - 0.24 : Math.cos(idleDirection)
  const distance = Math.hypot(dx, dz),
    x = distance > 0.001 ? dx / distance : Math.sin(idleDirection),
    z = distance > 0.001 ? dz / distance : Math.cos(idleDirection)
  const lean =
    pose.phase === 'windup'
      ? -limits.windupLean * ease(progress)
      : pose.phase === 'strike'
        ? -limits.windupLean + (limits.strikeLean + limits.windupLean) * ease(progress / 0.6)
        : pose.phase === 'recover'
          ? limits.strikeLean * (1 - ease(progress))
          : 0
  const tail =
    pose.phase === 'windup'
      ? limits.tailCurl * ease(progress)
      : pose.phase === 'strike'
        ? limits.tailCurl * (1 - 2 * ease(progress))
        : pose.phase === 'recover'
          ? -limits.tailCurl * (1 - ease(progress))
          : 0
  if (pose.phase === 'recover' && pose.recoveryFrom) {
    const from = pose.recoveryFrom,
      fade = 1 - ease(progress)
    return {
      phase: pose.phase,
      progress,
      sequence: pose.sequence,
      direction: [...from.direction],
      lean: from.lean * fade,
      yaw: from.yaw * fade,
      tail: from.tail * fade,
      idleDirection,
    }
  }
  return {
    phase: pose.phase,
    progress,
    sequence: pose.sequence,
    direction: [x, 0, z],
    lean,
    yaw: Math.max(-limits.aimYaw, Math.min(limits.aimYaw, Math.atan2(dx, 0.25 + Math.abs(dz)))) * attention,
    tail,
    idleDirection,
  }
}

export interface TentacleMotionBounds {
  angles: number[]
  lateral: number[]
  center: number[]
  centerX: number[]
  absoluteAngles: number[]
  absoluteLateral: number[]
  relativeAngles: number[][]
  jointCurl: number[]
  jointLift: number[]
  jointTwist: number[]
  maxFrequency: number
  speedSlots: number[]
  sphereExpansion: number
  proof: string
}

function jointAmplitudes(joint: number) {
  const p = TENTACLE_MOTION_PARAMETERS,
    s = joint / (TENTACLE_MOTION_JOINTS - 1)
  const envelope = joint === 0 ? 0 : ease((s - p.envelopeStart) / p.envelopeSpan)
  const distal = ease((s - p.distalStart) / p.distalSpan)
  const height = (SOURCE_CHAIN[joint][1] - SOURCE_CHAIN[0][1]) / SOURCE_HEIGHT
  const waveProgress = s * (1 - p.waveHeightMix) + height * p.waveHeightMix
  return {
    s,
    waveProgress,
    envelope,
    distal,
    wave: envelope * (p.waveBase + p.waveArch * Math.sin(Math.PI * s)),
    coil: envelope * p.coilAmplitude * distal,
    lift: envelope * (p.liftBase + s * p.liftDistal),
    twist: envelope * p.twistAmplitude,
  }
}

type Harmonic = [number, number]
interface MuscleProfile {
  wave: Harmonic
  coil: Harmonic
  lift: Harmonic
  twist: Harmonic
}
const magnitude = (value: Harmonic) => Math.hypot(value[0], value[1])
const difference = (a: Harmonic, b: Harmonic): Harmonic => [a[0] - b[0], a[1] - b[1]]
const scaled = (a: Harmonic, scale: number): Harmonic => [a[0] * scale, a[1] * scale]
const coefficient = (amplitude: number, lag: number): Harmonic => [
  amplitude * Math.cos(lag),
  -amplitude * Math.sin(lag),
]
const emptyProfile = (): MuscleProfile => ({ wave: [0, 0], coil: [0, 0], lift: [0, 0], twist: [0, 0] })

/** Analytic harmonic profiles coordinate the source's closed basal muscle ring. */
function muscleProfiles(): { baseline: MuscleProfile; deviations: MuscleProfile[] } {
  const p = TENTACLE_MOTION_PARAMETERS
  const raw = Array.from({ length: TENTACLE_MOTION_JOINTS }, (_, joint) => {
    const a = jointAmplitudes(joint)
    return {
      wave: coefficient(a.wave, a.waveProgress * p.waveDelay),
      coil: coefficient(a.coil, a.s * p.coilDelay),
      lift: coefficient(a.lift, a.s * p.liftDelay),
      twist: coefficient(a.twist, a.s * p.twistDelay),
    }
  })
  const baseline = raw[p.loopStart],
    deviations = raw.map(emptyProfile)
  const window = (joint: number) => Math.sin(((joint - p.loopStart) / (p.loopEnd - p.loopStart)) * Math.PI)
  let yy = 0,
    yz = 0,
    zz = 0,
    liftDenominator = 0
  const jacobians = Array.from({ length: TENTACLE_MOTION_JOINTS }, () => ({ y: 0, z: 0, length: 0, window: 0 }))
  for (let joint = p.loopStart + 1; joint < p.loopEnd; joint++) {
    const segmentY = SOURCE_CHAIN[joint + 1][1] - SOURCE_CHAIN[joint][1],
      segmentZ = SOURCE_CHAIN[joint + 1][2] - SOURCE_CHAIN[joint][2]
    const w = window(joint),
      length = Math.hypot(segmentY, segmentZ),
      jy = -segmentZ,
      jz = segmentY
    jacobians[joint] = { y: jy, z: jz, length, window: w }
    deviations[joint] = {
      wave: scaled(difference(raw[joint].wave, baseline.wave), w * p.loopWaveScale),
      coil: scaled(difference(raw[joint].coil, baseline.coil), w * p.loopWaveScale),
      lift: scaled(raw[joint].lift, w * p.loopWaveScale),
      twist: scaled(raw[joint].twist, w * p.loopWaveScale),
    }
    yy += w * jy * jy
    yz += w * jy * jz
    zz += w * jz * jz
    liftDenominator += w * length
  }
  const determinant = yy * zz - yz * yz
  for (const channel of ['wave', 'coil'] as const)
    for (let component = 0; component < 2; component++) {
      let dy = 0,
        dz = 0
      for (let joint = p.loopStart + 1; joint < p.loopEnd; joint++) {
        dy += jacobians[joint].y * deviations[joint][channel][component]
        dz += jacobians[joint].z * deviations[joint][channel][component]
      }
      const cy = (zz * dy - yz * dz) / determinant,
        cz = (yy * dz - yz * dy) / determinant
      for (let joint = p.loopStart + 1; joint < p.loopEnd; joint++) {
        const j = jacobians[joint]
        deviations[joint][channel][component] -= j.window * (j.y * cy + j.z * cz)
      }
    }
  for (let component = 0; component < 2; component++) {
    let dx = 0
    for (let joint = p.loopStart + 1; joint < p.loopEnd; joint++)
      dx += jacobians[joint].length * deviations[joint].lift[component]
    for (let joint = p.loopStart + 1; joint < p.loopEnd; joint++)
      deviations[joint].lift[component] -= (jacobians[joint].window * dx) / liftDenominator
  }
  // The right-hand appendage branches at the returning muscle. Its root remains
  // near the collar while its longer outgoing segment has independent slow curl.
  deviations[p.loopEnd] = {
    ...emptyProfile(),
    coil: scaled(raw[p.loopEnd].coil, p.tailCoilGain),
    lift: scaled(raw[p.loopEnd].lift, 0.35),
  }
  for (let joint = p.loopEnd + 1; joint < TENTACLE_MOTION_JOINTS; joint++)
    deviations[joint] = {
      wave: difference(raw[joint].wave, baseline.wave),
      coil: scaled(raw[joint].coil, p.tailCoilGain),
      lift: scaled(raw[joint].lift, 0.5),
      twist: raw[joint].twist,
    }
  return { baseline, deviations }
}
const MUSCLE_PROFILES = muscleProfiles()

/** All-time trigonometric/FK caps, independent of sampled clocks, phase slots or strength in [0,1]. */
export function tentacleMotionBounds(
  rig: Pick<TentacleMotionRig, 'rest' | 'unitHeight'>,
  interactive = false,
): TentacleMotionBounds {
  const angles: number[] = [],
    lateral: number[] = [],
    center: number[] = [],
    centerX: number[] = []
  const jointCurl: number[] = [],
    jointLift: number[] = [],
    jointTwist: number[] = []
  const p = TENTACLE_MOTION_PARAMETERS
  const { baseline, deviations } = MUSCLE_PROFILES,
    baselineSide = magnitude(baseline.lift) + magnitude(baseline.twist)
  const baselineAngle = magnitude(baseline.wave) + magnitude(baseline.coil) + baselineSide
  const deltaSides = deviations.map((a) => magnitude(a.lift) + magnitude(a.twist))
  const absoluteAngles = deviations.map((a, joint) =>
    joint === 0 ? 0 : baselineAngle + magnitude(a.wave) + magnitude(a.coil) + deltaSides[joint],
  )
  const absoluteLateral = deviations.map((_, joint) => (joint === 0 ? 0 : baselineSide + deltaSides[joint]))
  if (interactive)
    for (let joint = 1; joint < TENTACLE_MOTION_JOINTS; joint++) {
      const tail = TENTACLE_INTERACTION_LIMITS.tailCurl * ease((joint - 8) / 3)
      absoluteAngles[joint] +=
        TENTACLE_INTERACTION_LIMITS.idleLean +
        TENTACLE_INTERACTION_LIMITS.strikeLean +
        TENTACLE_INTERACTION_LIMITS.aimYaw +
        tail
      absoluteLateral[joint] +=
        TENTACLE_INTERACTION_LIMITS.idleLean +
        TENTACLE_INTERACTION_LIMITS.strikeLean +
        TENTACLE_INTERACTION_LIMITS.aimYaw
    }
  const curlDifference = (i: number, j: number) =>
    magnitude(difference(deviations[i].wave, deviations[j].wave)) +
    magnitude(difference(deviations[i].coil, deviations[j].coil))
  const relativeAngles = deviations.map((_, i) =>
    deviations.map((__, j) =>
      i === j
        ? 0
        : i === 0 || j === 0
          ? absoluteAngles[Math.max(i, j)]
          : Math.min(
              absoluteAngles[i] + absoluteAngles[j],
              curlDifference(i, j) +
                deltaSides[i] +
                deltaSides[j] +
                (interactive
                  ? TENTACLE_INTERACTION_LIMITS.tailCurl * Math.abs(ease((i - 8) / 3) - ease((j - 8) / 3))
                  : 0),
            ),
    ),
  )
  let angle = 0,
    side = 0,
    displacement = 0,
    displacementX = 0
  for (let joint = 0; joint < TENTACLE_MOTION_JOINTS; joint++) {
    if (joint) {
      const length = rig.rest[joint].distanceTo(rig.rest[joint - 1])
      displacement += length * 2 * Math.sin(absoluteAngles[joint - 1] / 2)
      displacementX += length * 2 * Math.sin(absoluteLateral[joint - 1] / 2)
    }
    const previous = deviations[Math.max(0, joint - 1)],
      a = deviations[joint]
    const curl =
      joint === 1 ? magnitude(baseline.wave) + magnitude(baseline.coil) : joint ? curlDifference(joint - 1, joint) : 0
    const lift = joint === 1 ? magnitude(baseline.lift) : magnitude(a.lift) + magnitude(previous.lift)
    const twist = joint === 1 ? magnitude(baseline.twist) : magnitude(a.twist) + magnitude(previous.twist)
    angle += joint ? relativeAngles[joint - 1][joint] : 0
    side += joint ? lift + twist : 0
    angles.push(angle)
    lateral.push(side)
    center.push(displacement)
    centerX.push(displacementX)
    jointCurl.push(curl)
    jointLift.push(lift)
    jointTwist.push(twist)
  }
  if (interactive) {
    const base = tentacleMotionBounds(rig),
      common =
        TENTACLE_INTERACTION_LIMITS.idleLean +
        TENTACLE_INTERACTION_LIMITS.strikeLean +
        TENTACLE_INTERACTION_LIMITS.aimYaw
    let tailError = 0
    for (let joint = 1; joint < TENTACLE_MOTION_JOINTS; joint++) {
      const parentTail = TENTACLE_INTERACTION_LIMITS.tailCurl * ease((joint - 1 - 8) / 3)
      tailError += rig.rest[joint].distanceTo(rig.rest[joint - 1]) * 2 * Math.sin(parentTail / 2)
      const lever = rig.rest[joint].distanceTo(rig.rest[1]),
        rotate = 2 * Math.sin(common / 2)
      // The common target gesture rotates the WHOLE closed ring about rest1 once.
      // It is not a fresh rotation/error on every FK segment around the returning loop.
      center[joint] = base.center[joint] + rotate * lever + tailError
      centerX[joint] = Math.min(
        center[joint],
        base.centerX[joint] + Math.sin(common) * lever + rotate * base.center[joint] + tailError,
      )
    }
    displacement = Math.max(...center)
  }
  const speedSlots = Array.from(
    { length: TENTACLE_MOTION_PHASES },
    (_, slot) => p.speedBase + ((slot * 3) % p.speedModulo) * p.speedStride,
  )
  const maximum = Math.max(...absoluteAngles),
    denominator = Math.cos(maximum / 2)
  const maxPivotLever = Math.max(...rig.rest.map((point) => point.distanceTo(rig.rest[0])))
  const sphereExpansion =
    2 * Math.sin(maximum / 2) * 2 * rig.unitHeight +
    (displacement + 2 * Math.sin(maximum / 2) * maxPivotLever) / denominator
  return {
    angles,
    lateral,
    absoluteAngles,
    absoluteLateral,
    relativeAngles,
    center,
    centerX,
    jointCurl,
    jointLift,
    jointTwist,
    speedSlots,
    maxFrequency:
      Math.max(p.waveFrequency, p.coilFrequency, p.liftFrequency, p.twistFrequency) * Math.max(...speedSlots),
    sphereExpansion,
    proof:
      'Closed-ring deviations are fixed linear projections of shared sine/cosine coefficients; their Euclidean coefficient norms are all-time caps. A common baseline B cancels in relative Q=B*D comparisons. Interactive common gesture A factors once about rest1; centre bounds rotate the rest lever plus the base FK residual, with separate distal-tail segment errors. Strength is 0..1; no root-merge or post-palette displacement is used.',
  }
}

/**
 * Pass exactly the high-detail sourceNormalization used when baking the imported geometry.
 * The caller's geometry must already contain Float32 positions/normals/tangents transformed by
 * sourceNormalization × originalMesh.matrixWorld. Both LODs use this same rest rig and time.
 * No geometry, textures, skeletons, frame callbacks or GPU resources are owned by this rig.
 */
export function createTentacleMotionRig(
  sourceNormalization: Matrix4,
  livingTime?: Uniform<number>,
  options?: { interactive?: boolean },
): TentacleMotionRig {
  const rest = SOURCE_CHAIN.map((point) => new Vector3(...point).applyMatrix4(sourceNormalization))
  const lengths = [0]
  for (let i = 1; i < rest.length; i++) lengths.push(lengths[i - 1] + rest[i].distanceTo(rest[i - 1]))
  const e = sourceNormalization.elements
  const unitHeight = SOURCE_HEIGHT * Math.hypot(e[4], e[5], e[6])
  const interactive = options?.interactive ?? false,
    bounds = tentacleMotionBounds({ rest, unitHeight }, interactive)
  const rig: TentacleMotionRig = {
    sourceNormalization: sourceNormalization.clone(),
    rest,
    lengths,
    totalLength: lengths[lengths.length - 1],
    unitHeight,
    bounds,
    interactive,
    behavior: Array.from({ length: TENTACLE_MOTION_PHASES }, () => null),
    time: livingTime ?? new Uniform(0),
    strength: new Uniform(1),
    rotations: new Uniform(new Float32Array(TENTACLE_MOTION_JOINTS * TENTACLE_MOTION_PHASES * 4)),
    duals: new Uniform(new Float32Array(TENTACLE_MOTION_JOINTS * TENTACLE_MOTION_PHASES * 4)),
    posed: Array.from({ length: TENTACLE_MOTION_PHASES }, () => rest.map((point) => point.clone())),
    lastTime: NaN,
    lastStrength: NaN,
    lastBehaviorKey: '',
  }
  updateTentacleMotion(rig, rig.time.value)
  return rig
}

/** CPU forward kinematics for eight stable per-instance phase palettes; no per-vertex trigonometry. */
export function updateTentacleMotion(
  rig: TentacleMotionRig,
  time: number,
  strength = 1,
  behaviors?: readonly TentacleBehaviorPose[],
) {
  if (!Number.isFinite(time) || !Number.isFinite(strength)) return
  const amount = Math.max(0, Math.min(1, strength))
  rig.time.value = time
  rig.strength.value = amount
  const behaviorKey =
    rig.interactive && behaviors
      ? behaviors
          .map(
            (pose) =>
              `${pose.seed}:${pose.sequence}:${pose.phase}:${pose.progress}:${pose.localTarget?.join(',') ?? ''}:${pose.recoveryFrom?.lean ?? ''}`,
          )
          .join('|')
      : ''
  if (rig.lastTime === time && rig.lastStrength === amount && rig.lastBehaviorKey === behaviorKey) return
  rig.lastTime = time
  rig.lastStrength = amount
  rig.lastBehaviorKey = behaviorKey
  const rotation = new Quaternion(),
    parent = new Quaternion(),
    planar = new Quaternion(),
    lateral = new Quaternion(),
    axial = new Quaternion(),
    baselineRotation = new Quaternion(),
    intentRotation = new Quaternion(),
    yawRotation = new Quaternion()
  const e = rig.sourceNormalization.elements
  const xAxis = new Vector3(e[0], e[1], e[2]).normalize(),
    yAxis = new Vector3(e[4], e[5], e[6]).normalize(),
    zAxis = new Vector3(e[8], e[9], e[10]).normalize()
  const crossAxis = new Vector3(),
    offset = new Vector3(),
    translation = new Vector3(),
    intentAxis = new Vector3()
  for (let phaseSlot = 0; phaseSlot < TENTACLE_MOTION_PHASES; phaseSlot++) {
    parent.identity()
    const p = TENTACLE_MOTION_PARAMETERS
    const phase = phaseSlot * p.phaseStep,
      speed = rig.bounds.speedSlots[phaseSlot]
    const harmonicTimes = {
      wave: time * p.waveFrequency * speed + phase,
      coil: time * p.coilFrequency * speed + phase * p.coilPhase,
      lift: time * p.liftFrequency * speed + phase * p.liftPhase,
      twist: time * p.twistFrequency * speed + phase * p.twistPhase,
    }
    const harmonics: Record<keyof MuscleProfile, Harmonic> = {
      wave: [Math.sin(harmonicTimes.wave), Math.cos(harmonicTimes.wave)],
      coil: [Math.sin(harmonicTimes.coil), Math.cos(harmonicTimes.coil)],
      lift: [Math.sin(harmonicTimes.lift), Math.cos(harmonicTimes.lift)],
      twist: [Math.sin(harmonicTimes.twist), Math.cos(harmonicTimes.twist)],
    }
    const evaluate = (profile: MuscleProfile, channel: keyof MuscleProfile) =>
      amount * (profile[channel][0] * harmonics[channel][0] + profile[channel][1] * harmonics[channel][1])
    offset.subVectors(rig.rest[2], rig.rest[1]).normalize()
    crossAxis.crossVectors(offset, xAxis).normalize()
    planar.setFromAxisAngle(
      xAxis,
      evaluate(MUSCLE_PROFILES.baseline, 'wave') + evaluate(MUSCLE_PROFILES.baseline, 'coil'),
    )
    lateral.setFromAxisAngle(crossAxis, evaluate(MUSCLE_PROFILES.baseline, 'lift'))
    axial.setFromAxisAngle(offset, evaluate(MUSCLE_PROFILES.baseline, 'twist'))
    baselineRotation.copy(planar).multiply(lateral).multiply(axial).normalize()
    const behavior =
      rig.interactive && behaviors?.[phaseSlot] ? sampleTentacleBehavior(time, behaviors[phaseSlot]) : null
    rig.behavior[phaseSlot] = behavior
    if (behavior) {
      const idle = TENTACLE_INTERACTION_LIMITS.idleLean * amount
      intentAxis
        .copy(xAxis)
        .multiplyScalar(-Math.cos(behavior.idleDirection))
        .addScaledVector(zAxis, Math.sin(behavior.idleDirection))
      intentRotation.setFromAxisAngle(intentAxis, idle)
      baselineRotation.premultiply(intentRotation)
      // Positive lean bends the ascending shaft toward the sensed target.
      intentAxis.copy(xAxis).multiplyScalar(behavior.direction[2]).addScaledVector(zAxis, -behavior.direction[0])
      intentRotation.setFromAxisAngle(intentAxis, behavior.lean * amount)
      yawRotation.setFromAxisAngle(yAxis, behavior.yaw * amount)
      baselineRotation.premultiply(intentRotation).premultiply(yawRotation).normalize()
    }
    for (let joint = 0; joint < TENTACLE_MOTION_JOINTS; joint++) {
      const a = MUSCLE_PROFILES.deviations[joint],
        point = rig.posed[phaseSlot][joint]
      if (joint === 0) point.copy(rig.rest[0])
      else
        point
          .copy(rig.posed[phaseSlot][joint - 1])
          .add(offset.subVectors(rig.rest[joint], rig.rest[joint - 1]).applyQuaternion(parent))
      // Propagating shaft contractions arrive later at the crook. A slower curl and
      // axial twist add weight to the flesh while the one rigid root stays anchored.
      const curl = evaluate(a, 'wave') + evaluate(a, 'coil') + (behavior?.tail ?? 0) * ease((joint - 8) / 3) * amount
      const lift = evaluate(a, 'lift'),
        twist = evaluate(a, 'twist')
      if (joint + 1 < rig.rest.length) offset.subVectors(rig.rest[joint + 1], rig.rest[joint]).normalize()
      else offset.subVectors(rig.rest[joint], rig.rest[joint - 1]).normalize()
      crossAxis.crossVectors(offset, xAxis).normalize()
      planar.setFromAxisAngle(xAxis, curl)
      lateral.setFromAxisAngle(crossAxis, lift)
      axial.setFromAxisAngle(offset, twist)
      // These are desired absolute muscle orientations. Their adjacent differences
      // are the local joint bends, avoiding an ever-growing accumulated crook angle.
      rotation.copy(baselineRotation).multiply(planar).multiply(lateral).multiply(axial).normalize()
      if (joint === 0) rotation.identity()
      parent.copy(rotation)
      translation.copy(rig.rest[joint]).applyQuaternion(rotation).multiplyScalar(-1).add(point)
      const index = (phaseSlot * TENTACLE_MOTION_JOINTS + joint) * 4
      rig.rotations.value[index] = rotation.x
      rig.rotations.value[index + 1] = rotation.y
      rig.rotations.value[index + 2] = rotation.z
      rig.rotations.value[index + 3] = rotation.w
      // Dual part = .5 * translationQuaternion * rotationQuaternion.
      rig.duals.value[index] =
        0.5 * (translation.x * rotation.w + translation.y * rotation.z - translation.z * rotation.y)
      rig.duals.value[index + 1] =
        0.5 * (-translation.x * rotation.z + translation.y * rotation.w + translation.z * rotation.x)
      rig.duals.value[index + 2] =
        0.5 * (translation.x * rotation.y - translation.y * rotation.x + translation.z * rotation.w)
      rig.duals.value[index + 3] =
        -0.5 * (translation.x * rotation.x + translation.y * rotation.y + translation.z * rotation.z)
    }
  }
}

type Four = [number, number, number, number]
interface SkinBinding {
  joints: Four
  weights: Four
}
function bindingInfluences(point: Vector3, rig: TentacleMotionRig): Float64Array {
  const direction = new Vector3(),
    relative = new Vector3(),
    nearest = new Vector3()
  const sourceScale = rig.sourceNormalization.getMaxScaleOnAxis()
  const candidates: { joint: number; blend: number; score: number }[] = []
  let best = Infinity
  for (let i = 0; i + 1 < rig.rest.length; i++) {
    direction.subVectors(rig.rest[i + 1], rig.rest[i])
    const t = Math.max(0, Math.min(1, relative.subVectors(point, rig.rest[i]).dot(direction) / direction.lengthSq()))
    nearest.copy(rig.rest[i]).addScaledVector(direction, t)
    const radius = (SOURCE_RADII[i] * (1 - t) + SOURCE_RADII[i + 1] * t) * sourceScale
    // A thick muscle's surface must not accidentally bind to the thin returning tip nearby.
    const score = point.distanceToSquared(nearest) / (radius * radius + 0.004 * sourceScale * sourceScale)
    best = Math.min(best, score)
    candidates.push({ joint: i, blend: ease(t), score })
  }
  const p = TENTACLE_MOTION_PARAMETERS
  const influences = new Float64Array(TENTACLE_MOTION_JOINTS)
  for (const candidate of candidates) {
    const weight = Math.exp(-(candidate.score - best) * p.bindingContrast)
    influences[candidate.joint] += weight * (1 - candidate.blend)
    influences[candidate.joint + 1] += weight * candidate.blend
  }
  const total = influences.reduce((sum, value) => sum + value, 0)
  for (let joint = 0; joint < influences.length; joint++) influences[joint] /= total
  return influences
}

function skinBinding(point: Vector3, rig: TentacleMotionRig): SkinBinding {
  const p = TENTACLE_MOTION_PARAMETERS
  if (point.y <= rig.rest[0].y + rig.unitHeight * p.rootHeight) return { joints: [0, 1, 2, 3], weights: [1, 0, 0, 0] }
  const influences = bindingInfluences(point, rig)
  const rootPin =
    1 - rootEase((point.y - rig.rest[0].y - rig.unitHeight * p.rootHeight) / (rig.unitHeight * p.rootBlendHeight))
  const rootWeight = rootPin + (1 - rootPin) * influences[0]
  // Root anchoring has its own permanent support. It cannot enter/leave a top-four
  // ranking and amplify the collar's derivative when its weight crosses another bone.
  const ordered = Array.from(influences, (weight, joint) => ({ joint, weight }))
    .slice(1)
    .sort((a, b) => b.weight - a.weight)
  const cutoff = ordered[3].weight
  const selected = ordered
    .slice(0, 3)
    .map((entry) => ({ joint: entry.joint, weight: Math.max(0, entry.weight - cutoff) }))
  const sum = selected.reduce((total, entry) => total + entry.weight, 0)
  return {
    joints: [...selected.map((entry) => entry.joint), 0] as Four,
    weights: [...selected.map((entry) => ((1 - rootWeight) * entry.weight) / sum), rootWeight] as Four,
  }
}

/** Add local skin weights to the caller-owned real GLB geometry without replacing any anatomy or UV. */
export function bindTentacleMotionGeometry(geometry: BufferGeometry, rig: TentacleMotionRig, instanceCapacity = 32) {
  if (boundGeometry.get(geometry) === rig) return
  const position = geometry.getAttribute('position')
  if (!position || !Number.isInteger(instanceCapacity) || instanceCapacity < 1)
    throw new Error('Tentacle motion requires owned normalized geometry')
  const joints = new Float32Array(position.count * 4),
    weights = new Float32Array(position.count * 4),
    point = new Vector3()
  let motionRadius = 0
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    const binding = skinBinding(point, rig)
    joints.set(binding.joints, i * 4)
    weights.set(binding.weights, i * 4)
    let maximumAngle = 0,
      translationBound = 0,
      totalWeight = 0
    for (let influence = 0; influence < 4; influence++) {
      const joint = binding.joints[influence],
        weight = weights[i * 4 + influence]
      maximumAngle = Math.max(maximumAngle, rig.bounds.absoluteAngles[joint])
      translationBound +=
        weight *
        (rig.bounds.center[joint] +
          2 * Math.sin(rig.bounds.absoluteAngles[joint] / 2) * point.distanceTo(rig.rest[joint]))
      totalWeight += weight
    }
    // Recenter each rigid DQ transform at this real vertex. The normalized blend's
    // translation is bounded by the weighted dual norms / positive real norm.
    motionRadius = Math.max(motionRadius, translationBound / (totalWeight * Math.cos(maximumAngle / 2)))
  }
  geometry.setAttribute('aTentacleJoints', new BufferAttribute(joints, 4))
  geometry.setAttribute('aTentacleWeights', new BufferAttribute(weights, 4))
  geometry.setAttribute('aTentaclePhase', new InstancedBufferAttribute(new Float32Array(instanceCapacity), 1))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += motionRadius * 1.0001
  geometry.userData.tentacleMotion = {
    version: VERSION,
    bound: true,
    joints: TENTACLE_MOTION_JOINTS,
    phaseSlots: TENTACLE_MOTION_PHASES,
    deformationBound: motionRadius,
  }
  boundGeometry.set(geometry, rig)
}

/** Call with the same index as setMatrixAt after each LOD bucket compaction; use a stable site slot. */
export function setTentacleInstancePhase(geometry: BufferGeometry, index: number, phaseSlot: number) {
  const phase = geometry.getAttribute('aTentaclePhase')
  if (
    !(phase instanceof InstancedBufferAttribute) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= phase.count ||
    !Number.isFinite(phaseSlot)
  ) {
    throw new Error('Tentacle phase must match its bound instance capacity')
  }
  const slot = ((Math.floor(phaseSlot) % TENTACLE_MOTION_PHASES) + TENTACLE_MOTION_PHASES) % TENTACLE_MOTION_PHASES
  if (phase.getX(index) === slot) return
  phase.setX(index, slot)
  phase.needsUpdate = true
}

const SKIN_HEAD = /* glsl */ `
  #define TENTACLE_CENTRELINE_DQ
  uniform vec4 uTentacleRotations[96]; uniform vec4 uTentacleDuals[96];
  uniform float uTentacleLivingTime;
  attribute vec4 aTentacleJoints; attribute vec4 aTentacleWeights; attribute float aTentaclePhase;
  vec3 tentacleRotate(vec4 q, vec3 p) { return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p); }
  void tentacleSkin(out vec4 rotation, out vec3 translation) {
    int phase = int(clamp(floor(aTentaclePhase + 0.5), 0.0, 7.0)) * 12;
    vec4 reference = uTentacleRotations[phase + int(aTentacleJoints.x)];
    vec4 realPart = vec4(0.0), dualPart = vec4(0.0);
    for (int influence = 0; influence < 4; influence++) {
      int joint = phase + int(aTentacleJoints[influence]);
      vec4 r = uTentacleRotations[joint], d = uTentacleDuals[joint];
      if (dot(reference, r) < 0.0) { r = -r; d = -d; }
      realPart += r * aTentacleWeights[influence]; dualPart += d * aTentacleWeights[influence];
    }
    float inverseLength = inversesqrt(max(dot(realPart, realPart), 0.000001));
    rotation = realPart * inverseLength;
    dualPart *= inverseLength;
    dualPart -= rotation * dot(rotation, dualPart);
    translation = 2.0 * (rotation.w * dualPart.xyz - dualPart.w * rotation.xyz + cross(rotation.xyz, dualPart.xyz));
  }
`

/** Stock physical lighting and normal maps remain intact; only the real mesh's local skin pose changes. */
export function patchTentacleMotionMaterial(material: MeshStandardMaterial, rig: TentacleMotionRig) {
  if (patchedMaterials.get(material) === rig) return
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey.call(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.uTentacleRotations = rig.rotations
    shader.uniforms.uTentacleDuals = rig.duals
    shader.uniforms.uTentacleLivingTime = rig.time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKIN_HEAD}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec4 tentacleRotation; vec3 tentacleTranslation;
        tentacleSkin(tentacleRotation, tentacleTranslation);
        objectNormal = tentacleRotate(tentacleRotation, objectNormal);
        #ifdef USE_TANGENT
          objectTangent = tentacleRotate(tentacleRotation, objectTangent);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = tentacleRotate(tentacleRotation, transformed) + tentacleTranslation;`,
      )
  }
  material.customProgramCacheKey = () => `${previousKey}|${VERSION}`
  material.userData.tentacleMotion = {
    version: VERSION,
    patched: true,
    joints: TENTACLE_MOTION_JOINTS,
    phaseSlots: TENTACLE_MOTION_PHASES,
  }
  material.needsUpdate = true
  patchedMaterials.set(material, rig)
}

function deformPoint(
  point: Vector3,
  binding: SkinBinding,
  rig: TentacleMotionRig,
  phaseSlot: number,
  out = new Vector3(),
): Vector3 {
  const slot = ((Math.floor(phaseSlot) % TENTACLE_MOTION_PHASES) + TENTACLE_MOTION_PHASES) % TENTACLE_MOTION_PHASES
  const rotations = rig.rotations.value,
    duals = rig.duals.value
  const reference = (slot * TENTACLE_MOTION_JOINTS + binding.joints[0]) * 4
  const rotation = [0, 0, 0, 0],
    dual = [0, 0, 0, 0]
  for (let influence = 0; influence < 4; influence++) {
    const index = (slot * TENTACLE_MOTION_JOINTS + binding.joints[influence]) * 4
    let dot = 0
    for (let k = 0; k < 4; k++) dot += rotations[reference + k] * rotations[index + k]
    const weight = binding.weights[influence] * (dot < 0 ? -1 : 1)
    for (let k = 0; k < 4; k++) {
      rotation[k] += rotations[index + k] * weight
      dual[k] += duals[index + k] * weight
    }
  }
  const length = Math.hypot(...rotation)
  for (let k = 0; k < 4; k++) {
    rotation[k] /= length
    dual[k] /= length
  }
  const orthogonality = rotation.reduce((sum, value, k) => sum + value * dual[k], 0)
  for (let k = 0; k < 4; k++) dual[k] -= rotation[k] * orthogonality
  const [x, y, z, w] = rotation,
    [dx, dy, dz, dw] = dual,
    px = point.x,
    py = point.y,
    pz = point.z
  const tx = 2 * (y * pz - z * py),
    ty = 2 * (z * px - x * pz),
    tz = 2 * (x * py - y * px)
  return out.set(
    px + w * tx + y * tz - z * ty + 2 * (w * dx - dw * x + y * dz - z * dy),
    py + w * ty + z * tx - x * tz + 2 * (w * dy - dw * y + z * dx - x * dz),
    pz + w * tz + x * ty - y * tx + 2 * (w * dz - dw * z + x * dy - y * dx),
  )
}

/** Apply the exact geometry-binding field to an actual normalized GLB vertex for offline inspection. */
export function deformTentaclePoint(rig: TentacleMotionRig, localPoint: Vector3, phaseSlot = 0): Vector3 {
  return deformPoint(localPoint, skinBinding(localPoint, rig), rig, phaseSlot)
}

/** Offline verification reads the same four Float32 weights/joints bound to the actual shader draw. */
export function evaluateTentacleMotionVertex(
  geometry: BufferGeometry,
  rig: TentacleMotionRig,
  index: number,
  out: Vector3,
  phaseSlot = 0,
): Vector3 {
  const joints = geometry.getAttribute('aTentacleJoints'),
    weights = geometry.getAttribute('aTentacleWeights')
  const binding: SkinBinding = {
    joints: [joints.getX(index), joints.getY(index), joints.getZ(index), joints.getW(index)],
    weights: [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)],
  }
  out.fromBufferAttribute(geometry.getAttribute('position'), index)
  return deformPoint(out, binding, rig, phaseSlot, out)
}

/** CPU reference uses the same dual-quaternion palette and blend weights as the actual vertex shader. */
export function sampleTentacleMotion(rig: TentacleMotionRig, progress: number, phaseSlot = 0) {
  const s = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)),
    length = s * rig.totalLength
  let joint = 0
  while (joint + 2 < rig.lengths.length && rig.lengths[joint + 1] < length) joint++
  const t = (length - rig.lengths[joint]) / (rig.lengths[joint + 1] - rig.lengths[joint])
  const rest = rig.rest[joint].clone().lerp(rig.rest[joint + 1], t)
  const posed = deformTentaclePoint(rig, rest, phaseSlot)
  return {
    s,
    phaseSlot,
    rest: rest.toArray(),
    posed: posed.toArray(),
    time: rig.time.value,
    strength: rig.strength.value,
  }
}

export interface TentacleContactSection {
  s: number
  indices: number[]
  rest: Vector3[]
}

/** Four actual GLB surface vertices around each distal muscle cross-section.
 * Contact publishers deform these imported vertices with the very same DQ buffers.
 * The returning curl is sampled along its measured arc, never by a long empty-space chord.
 */
export function tentacleContactSourceSections(
  geometry: BufferGeometry,
  rig: TentacleMotionRig,
  count = 14,
): TentacleContactSection[] {
  const position = geometry.getAttribute('position'),
    point = new Vector3(),
    axis = new Vector3(1, 0, 0)
  const sourceScale = rig.sourceNormalization.getMaxScaleOnAxis()
  return Array.from({ length: count }, (_, index) => {
    const s = 0.52 + (0.48 * index) / (count - 1),
      length = s * rig.totalLength
    let joint = 0
    while (joint + 2 < rig.lengths.length && rig.lengths[joint + 1] < length) joint++
    const t = (length - rig.lengths[joint]) / (rig.lengths[joint + 1] - rig.lengths[joint])
    const center = rig.rest[joint].clone().lerp(rig.rest[joint + 1], t)
    const tangent = rig.rest[joint + 1].clone().sub(rig.rest[joint]).normalize(),
      cross = tangent.clone().cross(axis).normalize()
    const radius = (SOURCE_RADII[joint] * (1 - t) + SOURCE_RADII[joint + 1] * t) * sourceScale
    const targets = [axis, axis.clone().negate(), cross, cross.clone().negate()].map((direction) =>
      center.clone().addScaledVector(direction, radius),
    )
    const indices = targets.map((target) => {
      let best = Infinity,
        chosen = 0
      for (let candidate = 0; candidate < position.count; candidate++) {
        point.fromBufferAttribute(position, candidate)
        const distance = point.distanceToSquared(target)
        if (distance < best) {
          best = distance
          chosen = candidate
        }
      }
      return chosen
    })
    return { s, indices, rest: indices.map((vertex) => new Vector3().fromBufferAttribute(position, vertex)) }
  })
}

export function tentacleMotionSnapshot(rig: TentacleMotionRig, time = rig.time.value, phaseSlot = 0) {
  let sampledRig = rig
  if (time !== rig.lastTime) {
    sampledRig = createTentacleMotionRig(rig.sourceNormalization, new Uniform(time))
    updateTentacleMotion(sampledRig, time, rig.strength.value)
  }
  return {
    version: VERSION,
    parameters: TENTACLE_MOTION_PARAMETERS,
    time,
    phaseSlot,
    strength: sampledRig.strength.value,
    unitHeight: rig.unitHeight,
    root: sampleTentacleMotion(sampledRig, 0, phaseSlot),
    mid: sampleTentacleMotion(sampledRig, 0.5, phaseSlot),
    tip: sampleTentacleMotion(sampledRig, 1, phaseSlot),
    lower: sampleTentacleMotion(sampledRig, 0.12, phaseSlot),
    shaft: sampleTentacleMotion(sampledRig, 0.24, phaseSlot),
    crook: sampleTentacleMotion(sampledRig, 0.65, phaseSlot),
    bones: sampledRig.rest.map((point, joint) => ({
      joint,
      rest: point.toArray(),
      posed: sampledRig.posed[phaseSlot][joint].toArray(),
    })),
  }
}
