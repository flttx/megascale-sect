import { InstancedBufferAttribute, BufferAttribute, Matrix4, Quaternion, Uniform, Vector2, Vector3 } from 'three'
import type { BufferGeometry, MeshStandardMaterial } from 'three'

const SLOTS = 8
const PIVOT = new Vector3(0, 0.025, 0.075)
const RX = 0.315,
  RY = 0.235,
  CENTER_Y = 0.028
export interface EyeMotionRig {
  angles: Uniform<Vector2[]>
  strength: Uniform<number>
  slot: Uniform<number>
  pivot: Uniform<Vector3>
  seed: number
  time: number
  target: Vector2
}

const ramp = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** Inspected open globe in the real Tripo mesh: eyelids and posterior socket are fixed. */
function ocularMask(point: Vector3, gradient: Vector3) {
  const x = point.x / RX,
    y = (point.y - CENTER_Y) / RY,
    radius = Math.hypot(x, y)
  const radialT = Math.max(0, Math.min(1, (radius - 0.58) / 0.42))
  const frontT = Math.max(0, Math.min(1, (point.z - 0.17) / 0.075))
  const radial = 1 - ramp(radialT),
    front = ramp(frontT)
  const dr = radialT > 0 && radialT < 1 ? (-6 * radialT * (1 - radialT)) / 0.42 : 0
  const dz = frontT > 0 && frontT < 1 ? (6 * frontT * (1 - frontT)) / 0.075 : 0
  gradient.set(
    radius > 1e-7 ? (dr * front * x) / (RX * radius) : 0,
    radius > 1e-7 ? (dr * front * y) / (RY * radius) : 0,
    radial * dz,
  )
  return radial * front
}

export function createEyeMotionRig(seed = 0): EyeMotionRig {
  return {
    angles: new Uniform(Array.from({ length: SLOTS }, () => new Vector2())),
    strength: new Uniform(1),
    slot: new Uniform(0),
    pivot: new Uniform(PIVOT.clone()),
    seed,
    time: 0,
    target: new Vector2(),
  }
}

/** Preserve all original vertices, UVs and triangles, tagging only the moving ocular tissue. */
export function bindEyeMotionGeometry(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'),
    weights = new Float32Array(position.count),
    gradients = new Float32Array(position.count * 3)
  const point = new Vector3(),
    gradient = new Vector3()
  let globe = 0,
    socket = 0,
    transition = 0
  let coreIndex = 0,
    socketIndex = 0,
    bestZ = -Infinity
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    const weight = ocularMask(point, gradient)
    weights[i] = weight
    gradient.toArray(gradients, i * 3)
    if (weight > 0.999) {
      globe++
      if (point.z > bestZ) {
        bestZ = point.z
        coreIndex = i
      }
    } else if (weight < 0.001) {
      socket++
      if (point.x > position.getX(socketIndex)) socketIndex = i
    } else transition++
  }
  geometry.setAttribute('aEyeMask', new BufferAttribute(weights, 1))
  geometry.setAttribute('aEyeMaskGradient', new BufferAttribute(gradients, 3))
  geometry.userData.eyeMotion = {
    globe,
    socket,
    transition,
    pivot: PIVOT.toArray(),
    axis: '+Z',
    coreIndex,
    socketIndex,
  }
  // The iris stays under the original lid; reserve a small bound for its rotation.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.035
  return geometry
}

export function setEyeInstancePhase(geometry: BufferGeometry, index: number, slot: number) {
  let attribute = geometry.getAttribute('aEyePhaseSlot') as InstancedBufferAttribute | undefined
  if (!attribute || attribute.count <= index) {
    const values = new Float32Array(Math.max(index + 1, attribute?.count ?? 0, 32))
    if (attribute) values.set(attribute.array as Float32Array)
    attribute = new InstancedBufferAttribute(values, 1)
    geometry.setAttribute('aEyePhaseSlot', attribute)
  }
  attribute.setX(index, Math.max(0, Math.min(SLOTS - 1, Math.round(slot))))
  attribute.needsUpdate = true
}

/** Long fixations separated by short eased saccades, with bounded slow pursuit. */
export function updateEyeMotion(rig: EyeMotionRig, time: number, strength = 1, target?: Vector2) {
  rig.time = Math.max(0, Number.isFinite(time) ? time : 0)
  rig.strength.value = Math.max(0, Math.min(1, strength))
  if (target) rig.target.set(Math.max(-0.12, Math.min(0.12, target.x)), Math.max(-0.05, Math.min(0.05, target.y)))
  for (let slot = 0; slot < SLOTS; slot++) {
    const phase = rig.seed * 0.713 + slot * 1.971,
      t = rig.time + phase * 2.3,
      period = 5.4 + slot * 0.29
    const segment = Math.floor(t / period),
      progress = t - segment * period,
      settle = ramp(progress / 0.24)
    const scan = (step: number, axis: number) =>
      Math.sin(step * (axis ? 2.31 : 1.73) + phase * (axis ? 1.37 : 0.81)) * (axis ? 0.083 : 0.205)
    const yaw =
      scan(segment - 1, 0) * (1 - settle) +
      scan(segment, 0) * settle +
      rig.target.x +
      Math.sin(rig.time * 0.37 + phase) * 0.008
    const pitch =
      scan(segment - 1, 1) * (1 - settle) +
      scan(segment, 1) * settle +
      rig.target.y +
      Math.sin(rig.time * 0.29 + phase * 1.4) * 0.003
    rig.angles.value[slot].set(Math.max(-0.235, Math.min(0.235, yaw)), Math.max(-0.105, Math.min(0.105, pitch)))
  }
}

/** Rigid rotation in the ocular core, fixed outer socket, exact Jacobian for transition normals. */
export function patchEyeMotionMaterial(material: MeshStandardMaterial, rig: EyeMotionRig) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.uEyeAngles = rig.angles
    shader.uniforms.uEyeStrength = rig.strength
    shader.uniforms.uEyePivot = rig.pivot
    shader.uniforms.uEyeSingleSlot = rig.slot
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aEyeMask; attribute vec3 aEyeMaskGradient;
        uniform vec2 uEyeAngles[8]; uniform float uEyeStrength; uniform vec3 uEyePivot; uniform float uEyeSingleSlot;
        #ifdef USE_INSTANCING
          attribute float aEyePhaseSlot;
        #endif`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float eyeSlot = uEyeSingleSlot;
        #ifdef USE_INSTANCING
          eyeSlot = aEyePhaseSlot;
        #endif
        vec2 eyeAngles = uEyeAngles[int(clamp(floor(eyeSlot + 0.5), 0.0, 7.0))] * uEyeStrength;
        float eyeYaw = eyeAngles.x * aEyeMask, eyePitch = eyeAngles.y * aEyeMask;
        float eyc = cos(eyeYaw), eys = sin(eyeYaw), epc = cos(eyePitch), eps = sin(eyePitch);
        mat3 eyeY = mat3(eyc, 0.0, -eys, 0.0, 1.0, 0.0, eys, 0.0, eyc);
        mat3 eyeX = mat3(1.0, 0.0, 0.0, 0.0, epc, eps, 0.0, -eps, epc);
        mat3 eyeRotation = eyeY * eyeX;
        vec3 eyeOffset = position - uEyePivot, eyePitched = eyeX * eyeOffset;
        vec3 eyeDerivative = eyeAngles.x * vec3(-eys * eyePitched.x + eyc * eyePitched.z, 0.0, -eyc * eyePitched.x - eys * eyePitched.z)
          + eyeAngles.y * eyeY * vec3(0.0, -eps * eyeOffset.y - epc * eyeOffset.z, epc * eyeOffset.y - eps * eyeOffset.z);
        vec3 eyeNormal = eyeRotation * objectNormal, eyeGradient = eyeRotation * aEyeMaskGradient;
        float eyeDet = max(0.25, 1.0 + dot(eyeGradient, eyeDerivative));
        objectNormal = eyeNormal - eyeGradient * (dot(eyeDerivative, eyeNormal) / eyeDet);
        #ifdef USE_TANGENT
          objectTangent = eyeRotation * objectTangent + eyeDerivative * dot(aEyeMaskGradient, objectTangent);
        #endif`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = uEyePivot + eyeRotation * eyeOffset;')
  }
  material.customProgramCacheKey = () => 'eldritch-ocular-tissue-rotation-1'
  material.userData.eyeMotion = true
}

const rotation = new Quaternion(),
  matrix = new Matrix4(),
  eyeEulerY = new Quaternion(),
  eyeEulerX = new Quaternion()
const yAxis = new Vector3(0, 1, 0),
  xAxis = new Vector3(1, 0, 0),
  scratch = new Vector3()
export function evaluateEyeVertex(
  geometry: BufferGeometry,
  rig: EyeMotionRig,
  index: number,
  slot: number,
  out: Vector3,
) {
  out.fromBufferAttribute(geometry.getAttribute('position'), index)
  const weight = geometry.getAttribute('aEyeMask')?.getX(index) ?? 0,
    angle = rig.angles.value[Math.max(0, Math.min(7, slot))]
  rotation
    .copy(eyeEulerY.setFromAxisAngle(yAxis, angle.x * weight * rig.strength.value))
    .multiply(eyeEulerX.setFromAxisAngle(xAxis, angle.y * weight * rig.strength.value))
  return out.sub(rig.pivot.value).applyQuaternion(rotation).add(rig.pivot.value)
}

export function eyeMotionSnapshot(rig: EyeMotionRig, geometry: BufferGeometry, slot = 0) {
  const position = geometry.getAttribute('position'),
    mask = geometry.getAttribute('aEyeMask')
  const core = geometry.userData.eyeMotion.coreIndex as number,
    socket = geometry.userData.eyeMotion.socketIndex as number
  const sample = (index: number) => ({
    index,
    weight: mask.getX(index),
    rest: scratch.fromBufferAttribute(position, index).toArray(),
    posed: evaluateEyeVertex(geometry, rig, index, slot, scratch).toArray(),
  })
  matrix.makeRotationFromQuaternion(
    rotation
      .copy(eyeEulerY.setFromAxisAngle(yAxis, rig.angles.value[slot].x * rig.strength.value))
      .multiply(eyeEulerX.setFromAxisAngle(xAxis, rig.angles.value[slot].y * rig.strength.value)),
  )
  return {
    time: rig.time,
    yaw: rig.angles.value[slot].x * rig.strength.value,
    pitch: rig.angles.value[slot].y * rig.strength.value,
    socketMatrix: new Matrix4().identity().toArray(),
    eyeballMatrix: matrix.toArray(),
    roles: geometry.userData.eyeMotion,
    samples: { socket: sample(socket), eyeball: sample(core) },
    shaderPatched: true,
  }
}
