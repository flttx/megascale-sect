import { Quaternion, Vector3 } from 'three'
import { groundHeight, insideStructure, LAYOUT, TERRAIN_WALK_FLOOR } from '../worldLayout'
import { insideAnyCollider } from '../surfaces'
import { carrierDepth } from '../colossi/carriers'

/**
 * Collider margin for the current step. A flight that starts inside a collider's 1 m margin (the sword caught the
 * player right beside a stele) tests the bare collider, and one that starts inside it (a long drop onto a tall prop)
 * tests none, so it can always fly back out.
 */
let margin = 1
/**
 * A flier may not go into the turtle (a slope lifts it in `moveAcross`, as terrain does), beyond a rounding skim;
 * one the turtle has swum into may go anywhere no deeper, so up and out.
 */
const CARRIER_SKIM = 0.3
/** The turtle's slopes and swell rise under a low flier; up to this depth it is lifted back over them. */
const CARRIER_LIFT = 2
let carrierLimit = CARRIER_SKIM
const blocked = (x: number, y: number, z: number, structures = true) =>
  (structures && insideStructure(x, y, z)) ||
  (margin >= 0 && insideAnyCollider(x, y, z, margin, true)) ||
  carrierDepth(x, y, z) > carrierLimit
/** Longest collision substep (m): every collider grown by its 1 m margin is at least 2 m across, so none is skipped. */
const SUBSTEP = 1
const forward = new Vector3(),
  right = new Vector3(),
  desired = new Vector3(),
  step = new Vector3()
const heading = new Vector3(),
  aim = new Vector3(),
  swing = new Quaternion(),
  turned = new Quaternion()
/**
 * Carving turns (rad/s of heading) at cruise and boost; below CARVE_MIN m/s, or reversing past CARVE_MAX_ANGLE,
 * the old ease (slow, then build the new way) applies.
 */
const CARVE_RATE = { cruise: 3.4, boost: 2.4 }
const CARVE_MIN = 4
const CARVE_MAX_ANGLE = 2.6
const CARVE_STEP = 1 / 120
/** The last step was stopped by terrain or a collider on some axis: carving resumes once the rider is clear. */
let scraping = false
/** Pointing straight down raises the target speed by this fraction: a dive trades height for speed. */
const DIVE_GAIN = 0.4
const HOVER = 0.55,
  MAX_CLIMB = 1.5
/**
 * Share of a wind stream's velocity a flier takes up: all of it flying with the flow, a third of it hovering or
 * steering across or against it, so a rider can always leave the stream.
 */
const CATCH = { least: 0.3, against: -0.2, along: 0.8 }

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
  position: Vector3,
  velocity: Vector3,
  input: Vector3,
  yaw: number,
  pitch: number,
  boosting: boolean,
  delta: number,
  braking = false,
  wind?: Vector3,
) {
  // A body already outside the bounds (a teleport or a carrier) is held where it is rather than snapped back.
  const { world } = LAYOUT
  const minX = Math.min(world.minX, position.x),
    maxX = Math.max(world.maxX, position.x)
  const minZ = Math.min(world.minZ, position.z),
    maxZ = Math.max(world.maxZ, position.z)
  forward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  right.set(Math.cos(yaw), 0, Math.sin(yaw))
  desired.copy(forward).multiplyScalar(-input.z).addScaledVector(right, input.x)
  desired.y += input.y
  if (desired.lengthSq() > 1) desired.normalize()
  const dive = desired.lengthSq() > 0 ? Math.max(0, -desired.y / desired.length()) : 0
  desired.multiplyScalar(
    braking ? 0 : (boosting ? LAYOUT.player.flightBoostSpeed : LAYOUT.player.flightSpeed) * (1 + DIVE_GAIN * dive),
  )
  if (wind && !braking && wind.lengthSq() > 0) {
    const along = desired.lengthSq() > 0 ? desired.dot(wind) / Math.sqrt(desired.lengthSq() * wind.lengthSq()) : 0
    const t = Math.max(0, Math.min(1, (along - CATCH.against) / (CATCH.along - CATCH.against)))
    desired.addScaledVector(wind, CATCH.least + (1 - CATCH.least) * t * t * (3 - 2 * t))
  }
  const slowing = desired.lengthSq() < velocity.lengthSq() || desired.dot(velocity) < 0
  const response = braking ? 12 : input.lengthSq() === 0 ? 5.5 : slowing ? 4.5 : boosting ? 2.3 : 3.2
  const blend = 1 - Math.exp(-response * delta)
  const speed = velocity.length(),
    target = desired.length()
  heading.copy(velocity).divideScalar(Math.max(speed, 1e-6))
  aim.copy(desired).divideScalar(Math.max(target, 1e-6))
  const angle = heading.angleTo(aim)
  if (!braking && !scraping && speed > CARVE_MIN && target > CARVE_MIN && angle < CARVE_MAX_ANGLE) {
    // Carve: swing the heading toward the aim at a bounded rate and ease the speed on its own, so a turn neither
    // cuts the corner (bleeding speed through the lerp's chord) nor skids sideways.
    // Fixed internal steps keep the swept path the same at 20, 60 or 144 fps.
    const parts = Math.max(1, Math.ceil(delta / CARVE_STEP)),
      h = delta / parts,
      rate = boosting ? CARVE_RATE.boost : CARVE_RATE.cruise,
      ease = Math.exp(-response * h)
    let current = speed
    step.set(0, 0, 0)
    for (let i = 0; i < parts; i++) {
      const left = heading.angleTo(aim)
      const k = left > 1e-5 ? Math.min(1, (rate * h) / left) : 1
      step.addScaledVector(heading, (current * h) / 2)
      swing.setFromUnitVectors(heading, aim)
      heading.applyQuaternion(turned.identity().slerp(swing, k)).normalize()
      current = target + (current - target) * ease
      step.addScaledVector(heading, (current * h) / 2)
    }
    velocity.copy(heading).multiplyScalar(current)
  } else {
    // Exact travel over the step while velocity eases toward `desired`, so the path does not depend on the frame rate.
    step
      .copy(desired)
      .multiplyScalar(delta)
      .addScaledVector(velocity, blend / response)
      .addScaledVector(desired, -blend / response)
    velocity.lerp(desired, blend)
  }
  if (desired.lengthSq() === 0 && velocity.lengthSq() < 0.0025) velocity.set(0, 0, 0)
  margin = !insideAnyCollider(position.x, position.y, position.z, 1, true)
    ? 1
    : !insideAnyCollider(position.x, position.y, position.z, 0, true)
      ? 0
      : -1
  const sunk = carrierDepth(position.x, position.y, position.z)
  if (sunk > 0 && sunk < CARRIER_LIFT && !blocked(position.x, position.y + sunk + HOVER, position.z))
    position.y += sunk + HOVER
  carrierLimit = Math.max(CARRIER_SKIM, carrierDepth(position.x, position.y, position.z))
  const substeps = Math.max(1, Math.ceil(step.length() / SUBSTEP))
  scraping = false
  step.divideScalar(substeps)
  for (let i = 0; i < substeps; i++) {
    if (step.x && !moveAcross(position, position.x + step.x, position.z)) {
      velocity.x = 0
      step.x = 0
      scraping = true
    }
    if (step.z && !moveAcross(position, position.x, position.z + step.z)) {
      velocity.z = 0
      step.z = 0
      scraping = true
    }
    // A flight that starts inside a structure (a dev teleport, a save from before the hall's roofs were re-measured) can always climb out.
    const floor = groundHeight(position.x, position.z, position.y + HOVER)
    const nextY =
      floor !== null && position.y >= floor + HOVER - 1e-5
        ? Math.max(floor + HOVER, position.y + step.y)
        : position.y + step.y
    if (!blocked(position.x, nextY, position.z, !(step.y > 0 && insideStructure(position.x, position.y, position.z)))) {
      if (nextY > position.y + step.y) {
        velocity.y = Math.max(0, velocity.y)
        step.y = 0
      }
      position.y = nextY
    } else {
      velocity.y = 0
      step.y = 0
    }
  }
  position.x = Math.max(minX, Math.min(maxX, position.x))
  position.y = Math.max(TERRAIN_WALK_FLOOR, Math.min(world.ceiling, position.y))
  position.z = Math.max(minZ, Math.min(maxZ, position.z))
}
