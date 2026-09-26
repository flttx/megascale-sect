import { Vector3 } from 'three'
import { groundHeight, LAYOUT, terrainGradient } from '../worldLayout'

/** Horizontal probe for slope checks, and the rise it may climb (45°) or drop (55°) over that distance. */
const PROBE = 1.2
const MAX_RISE = PROBE * Math.tan(Math.PI / 4)
const DROP_GRADIENT = Math.tan((55 * Math.PI) / 180)
const MAX_DROP = PROBE * DROP_GRADIENT
/** Natural ground steeper than this (rise/run, ≈52°) cannot hold a stance: the player slides down it. */
const SLIDE_GRADIENT = Math.tan((52 * Math.PI) / 180)
const SLIDE_SPEED = 6
const fall = { x: 0, z: 0 }, probeGradient = { x: 0, z: 0 }

/**
 * Whether a step from (x, z) to (nx, nz) lands on ground and stays within the climb and drop limits, measured
 * from `here` (the ground underfoot, so a fall in progress is judged by the terrain, not the body).
 * `steepHere`: already standing on ground too steep to hold (where a slide cannot continue), so any step
 * within the limits may lead off it.
 */
function canStep(x: number, z: number, nx: number, nz: number, y: number, here: number, steepHere: boolean) {
  const next = groundHeight(nx, nz, y)
  if (next === null) return false
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

export function stepGround(
  position: Vector3, velocity: Vector3, input: Vector3, yaw: number,
  running: boolean, delta: number,
) {
  const speed = running ? LAYOUT.player.runSpeed : LAYOUT.player.walkSpeed
  const forward = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
  const right = new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
  const desired = forward.multiplyScalar(-input.z).add(right.multiplyScalar(input.x))
  if (desired.lengthSq() > 1) desired.normalize()
  desired.multiplyScalar(speed)
  const blend = 1 - Math.exp(-12 * delta)
  velocity.x += (desired.x - velocity.x) * blend
  velocity.z += (desired.z - velocity.z) * blend
  if (desired.lengthSq() === 0 && Math.hypot(velocity.x, velocity.z) < 0.015) { velocity.x = 0; velocity.z = 0 }
  // Too steep to stand on (e.g. set down on a cliff face): slide down the fall line.
  const here = groundHeight(position.x, position.z, position.y) ?? position.y
  const wasGrounded = position.y <= here + 0.04
  const gradient = terrainGradient(position.x, position.z, position.y, fall)
  const steepness = gradient ? Math.hypot(gradient.x, gradient.z) : 0
  const steep = gradient !== null && steepness > SLIDE_GRADIENT
  // The slide stops where the fall line leaves walkable ground (the terrain walk floor).
  const sliding = steep && groundHeight(position.x + (gradient.x / steepness) * PROBE, position.z + (gradient.z / steepness) * PROBE, position.y) !== null
  if (sliding) {
    velocity.x += (gradient.x / steepness * SLIDE_SPEED - velocity.x) * blend
    velocity.z += (gradient.z / steepness * SLIDE_SPEED - velocity.z) * blend
  }
  const startX = position.x, startZ = position.z
  const nextX = position.x + velocity.x * delta
  const nextZ = position.z + velocity.z * delta
  const allowed = (nx: number, nz: number) => sliding ? groundHeight(nx, nz, position.y) !== null : canStep(position.x, position.z, nx, nz, position.y, here, steep)
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
  const surface = groundHeight(position.x, position.z, position.y) ?? 0
  // Walking downhill keeps the feet planted: a grounded step follows the ground down as far as a walkable drop.
  const stepLength = Math.hypot(position.x - startX, position.z - startZ)
  if (wasGrounded && velocity.y <= 0 && position.y > surface && position.y - surface <= stepLength * DROP_GRADIENT + 0.05) {
    velocity.y = 0
    position.y = surface
  } else if (position.y > surface + 0.04) {
    velocity.y -= LAYOUT.player.gravity * delta
    position.y = Math.max(surface, position.y + velocity.y * delta)
  } else {
    velocity.y = 0
    position.y = surface
  }
}
