import { Vector3 } from 'three'
import { groundHeight, insideStructure, LAYOUT, terrainGradient } from '../worldLayout'
import { bodyInsideAnyCollider } from '../surfaces'

/** Horizontal probe for slope checks, and the rise it may climb (45°) or drop (55°) over that distance. */
const PROBE = 1.2
const MAX_RISE = PROBE * Math.tan(Math.PI / 4)
const DROP_GRADIENT = Math.tan((55 * Math.PI) / 180)
const MAX_DROP = PROBE * DROP_GRADIENT
/** Natural ground steeper than this (rise/run, ≈52°) cannot hold a stance: the player slides down it. */
const SLIDE_GRADIENT = Math.tan((52 * Math.PI) / 180)
const SLIDE_SPEED = 6
/** Take-off speed for the jump height; in the air the feet can clear a ledge this far above them. */
const JUMP_SPEED = Math.sqrt(2 * LAYOUT.player.gravity * LAYOUT.player.jumpHeight)
const AIR_STEP = 0.45
/** Longest drop that still ends on foot: the sword catches a fall at 20 m/s, about 7 m down. */
const LANDING_DROP = 8
/** Torso (knee to crown) and radius tested against props, steles and rock for walking. */
const BODY = { bottom: 0.45, top: 1.7, radius: 0.35 }
const fall = { x: 0, z: 0 }, probeGradient = { x: 0, z: 0 }
const forward = new Vector3(), right = new Vector3(), desired = new Vector3()
/** Set for a step that starts inside a prop collider (e.g. an uneven pillar top), so the player can walk out of it. */
let ignoreProps = false

const bodyBlocked = (x: number, y: number, z: number) =>
  insideStructure(x, y + 1, z) || (!ignoreProps && bodyInsideAnyCollider(x, y + BODY.bottom, y + BODY.top, z, BODY.radius))

/**
 * Whether a step from (x, z) to (nx, nz) lands on ground and stays within the climb and drop limits, measured
 * from `here` (the ground underfoot, so a fall in progress is judged by the terrain, not the body).
 * `steepHere`: already standing on ground too steep to hold (where a slide cannot continue), so any step
 * within the limits may lead off it.
 */
function canStep(x: number, z: number, nx: number, nz: number, y: number, here: number, steepHere: boolean) {
  const next = groundHeight(nx, nz, y)
  if (next === null || bodyBlocked(nx, Math.max(y, next), nz)) return false
  const dx = nx - x, dz = nz - z, length = Math.hypot(dx, dz)
  if (length < 1e-6) return true
  const ahead = groundHeight(x + (dx / length) * PROBE, z + (dz / length) * PROBE, y)
  const target = ahead ?? next
  if (target - here > MAX_RISE || here - target > MAX_DROP) return false
  // Never walk onto ground too steep to stand on; sliding is only for being set down there.
  if (steepHere) return true
  const slope = terrainGradient(nx, nz, y, probeGradient)
  return slope === null || Math.hypot(slope.x, slope.z) <= SLIDE_GRADIENT
}

/**
 * In the air the body may pass over any drop (even off a cliff), but not into a wall, a structure or a prop, nor over a
 * spot where it would come down inside one (a jump onto a low rock or a pillar ledge, which has no footing of its own).
 */
function canFly(nx: number, nz: number, y: number) {
  const next = groundHeight(nx, nz, y + AIR_STEP)
  if (next !== null && next > y + AIR_STEP) return false
  if (bodyBlocked(nx, y, nz)) return false
  return next === null || y - next > LANDING_DROP || !bodyBlocked(nx, next, nz)
}

/**
 * One ground step: jog (sprint with `sprinting`), jump, slide down ground too steep to stand on, fall.
 * Returns the downward speed at touchdown when the feet land this step, else 0.
 */
export function stepGround(
  position: Vector3, velocity: Vector3, input: Vector3, yaw: number,
  sprinting: boolean, jump: boolean, delta: number,
) {
  const speed = sprinting ? LAYOUT.player.sprintSpeed : LAYOUT.player.jogSpeed
  forward.set(Math.sin(yaw), 0, -Math.cos(yaw))
  right.set(Math.cos(yaw), 0, Math.sin(yaw))
  desired.copy(forward).multiplyScalar(-input.z).addScaledVector(right, input.x)
  if (desired.lengthSq() > 1) desired.normalize()
  desired.multiplyScalar(speed)
  const ground = groundHeight(position.x, position.z, position.y)
  const here = ground ?? -Infinity
  const grounded = position.y <= here + 0.04
  // Footing pushes off quickly and stops sooner than it builds up; in the air the body only steers.
  const slowing = desired.x * desired.x + desired.z * desired.z < velocity.x * velocity.x + velocity.z * velocity.z
  const blend = 1 - Math.exp(-(grounded ? (slowing ? 14 : 9) : 2.5) * delta)
  velocity.x += (desired.x - velocity.x) * blend
  velocity.z += (desired.z - velocity.z) * blend
  if (desired.lengthSq() === 0 && Math.hypot(velocity.x, velocity.z) < 0.015) { velocity.x = 0; velocity.z = 0 }
  // Too steep to stand on (e.g. set down on a cliff face): slide down the fall line.
  const gradient = grounded ? terrainGradient(position.x, position.z, position.y, fall) : null
  const steepness = gradient ? Math.hypot(gradient.x, gradient.z) : 0
  const steep = gradient !== null && steepness > SLIDE_GRADIENT
  // The slide stops where the fall line leaves walkable ground (the terrain walk floor).
  const sliding = steep && groundHeight(position.x + (gradient.x / steepness) * PROBE, position.z + (gradient.z / steepness) * PROBE, position.y) !== null
  if (sliding) {
    velocity.x += (gradient.x / steepness * SLIDE_SPEED - velocity.x) * blend
    velocity.z += (gradient.z / steepness * SLIDE_SPEED - velocity.z) * blend
  }
  const airborne = !grounded || (jump && !sliding)
  if (grounded && jump && !sliding) velocity.y = JUMP_SPEED
  ignoreProps = bodyInsideAnyCollider(position.x, position.y + BODY.bottom, position.y + BODY.top, position.z, BODY.radius)
  const startX = position.x, startZ = position.z
  const nextX = position.x + velocity.x * delta
  const nextZ = position.z + velocity.z * delta
  const allowed = (nx: number, nz: number) => airborne ? canFly(nx, nz, position.y)
    : sliding ? groundHeight(nx, nz, position.y) !== null : canStep(position.x, position.z, nx, nz, position.y, here, steep)
  // Blocked moves slide along the obstacle (cliff edge, steep bank) instead of stopping dead.
  if (allowed(nextX, nextZ)) {
    position.x = nextX
    position.z = nextZ
  } else if (allowed(nextX, position.z)) {
    position.x = nextX
    velocity.z = 0
  } else if (allowed(position.x, nextZ)) {
    position.z = nextZ
    velocity.x = 0
  } else {
    velocity.x = 0
    velocity.z = 0
  }
  const surface = groundHeight(position.x, position.z, position.y + (airborne ? AIR_STEP : 0)) ?? -Infinity
  // Walking downhill keeps the feet planted: a grounded step follows the ground down as far as a walkable drop.
  const stepLength = Math.hypot(position.x - startX, position.z - startZ)
  if (!airborne && velocity.y <= 0 && position.y > surface && position.y - surface <= stepLength * DROP_GRADIENT + 0.05) {
    velocity.y = 0
    position.y = surface
    return 0
  }
  if (velocity.y > 0 || position.y > surface + 0.04) {
    velocity.y -= LAYOUT.player.gravity * delta
    position.y += velocity.y * delta
    if (position.y > surface) return 0
  }
  const landing = Math.max(0, -velocity.y)
  velocity.y = 0
  position.y = surface
  return airborne ? landing : 0
}
