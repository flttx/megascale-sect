import { Vector3 } from 'three'
import { groundHeight, insideStructure, LAYOUT, TERRAIN_WALK_FLOOR } from '../worldLayout'
import { insideAnyCollider } from '../surfaces'

/**
 * Collider margin for the current step. A flight that starts inside a collider's 1 m margin (the sword caught the
 * player right beside a stele) tests the bare collider, and one that starts inside it (a long drop onto a tall prop)
 * tests none, so it can always fly back out.
 */
let margin = 1
const blocked = (x: number, y: number, z: number, structures = true) => (structures && insideStructure(x, y, z)) || (margin >= 0 && insideAnyCollider(x, y, z, margin, true))
/** Longest collision substep (m): every collider grown by its 1 m margin is at least 2 m across, so none is skipped. */
const SUBSTEP = 1
const forward = new Vector3(), right = new Vector3(), desired = new Vector3(), step = new Vector3()
/** Pointing straight down raises the target speed by this fraction: a dive trades height for speed. */
const DIVE_GAIN = 0.4
const HOVER = 0.55, MAX_CLIMB = 1.5

/** Resolve terrain in each collision substep. A cliff blocks sideways travel instead of lifting to its top. */
function moveAcross(position: Vector3, nx: number, nz: number) {
  const floor = groundHeight(nx, nz, position.y + HOVER)
  const rise = floor === null ? 0 : Math.max(0, floor + HOVER - position.y)
  if (rise > MAX_CLIMB * Math.hypot(nx - position.x, nz - position.z) + 1e-6) return false
  const y = position.y + rise
  if (blocked(nx, y, nz)) return false
  position.set(nx, y, nz)
  return true
}

export function stepFlight(
  position: Vector3, velocity: Vector3, input: Vector3,
  yaw: number, pitch: number, boosting: boolean, delta: number, braking = false,
) {
  const limitX = Math.max(LAYOUT.worldLimit, Math.abs(position.x)), limitZ = Math.max(LAYOUT.worldLimit, Math.abs(position.z))
  forward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  right.set(Math.cos(yaw), 0, Math.sin(yaw))
  desired.copy(forward).multiplyScalar(-input.z).addScaledVector(right, input.x)
  desired.y += input.y
  if (desired.lengthSq() > 1) desired.normalize()
  const dive = desired.lengthSq() > 0 ? Math.max(0, -desired.y / desired.length()) : 0
  desired.multiplyScalar(braking ? 0 : (boosting ? LAYOUT.player.flightBoostSpeed : LAYOUT.player.flightSpeed) * (1 + DIVE_GAIN * dive))
  const slowing = desired.lengthSq() < velocity.lengthSq() || desired.dot(velocity) < 0
  const response = braking ? 12 : input.lengthSq() === 0 ? 5.5 : slowing ? 4.5 : boosting ? 1.8 : 3.2
  const blend = 1 - Math.exp(-response * delta)
  // Exact travel over the step while velocity eases toward `desired`, so the path does not depend on the frame rate.
  step.copy(desired).multiplyScalar(delta).addScaledVector(velocity, blend / response).addScaledVector(desired, -blend / response)
  velocity.lerp(desired, blend)
  if (desired.lengthSq() === 0 && velocity.lengthSq() < 0.0025) velocity.set(0, 0, 0)
  margin = !insideAnyCollider(position.x, position.y, position.z, 1, true) ? 1 : !insideAnyCollider(position.x, position.y, position.z, 0, true) ? 0 : -1
  const substeps = Math.max(1, Math.ceil(step.length() / SUBSTEP))
  step.divideScalar(substeps)
  for (let i = 0; i < substeps; i++) {
    if (step.x && !moveAcross(position, position.x + step.x, position.z)) { velocity.x = 0; step.x = 0 }
    if (step.z && !moveAcross(position, position.x, position.z + step.z)) { velocity.z = 0; step.z = 0 }
    // A flight that starts inside a structure (a dev teleport, a save from before the hall's roofs were re-measured) can always climb out.
    const floor = groundHeight(position.x, position.z, position.y + HOVER)
    const nextY = floor !== null && position.y >= floor + HOVER - 1e-5 ? Math.max(floor + HOVER, position.y + step.y) : position.y + step.y
    if (!blocked(position.x, nextY, position.z, !(step.y > 0 && insideStructure(position.x, position.y, position.z)))) {
      if (nextY > position.y + step.y) { velocity.y = Math.max(0, velocity.y); step.y = 0 }
      position.y = nextY
    }
    else { velocity.y = 0; step.y = 0 }
  }
  position.x = Math.max(-limitX, Math.min(limitX, position.x))
  position.y = Math.max(TERRAIN_WALK_FLOOR, Math.min(1100, position.y))
  position.z = Math.max(-limitZ, Math.min(limitZ, position.z))
}
