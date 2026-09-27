import { PerspectiveCamera, Vector3 } from 'three'
import type { Mode } from '../store'
import { insideAnyCollider } from '../surfaces'
import { groundHeight, insideStructure } from '../worldLayout'
import { smooth } from './playerMotion'
import { kunClearance } from '../colossi/kunDeck'

/** Orbit pivot above the feet, how far the view tilts below the aim pitch, and the arm length range (m). */
const RIG = {
  GROUND: { pivot: 1.55, tilt: 0.26, near: 4.3, far: 4.9, shoulder: 0.45 },
  FLIGHT: { pivot: 1.3, tilt: 0.2, near: 5.8, far: 7.2, shoulder: 0 },
} as const
const MIN_ARM = 0.7, PAD = 0.25
/** A pivot this far from the last one is a teleport: snap instead of easing across the map. */
const SNAP = 30

const rig = { ready: false, pivot: new Vector3(), last: new Vector3(), height: 0, rise: 0, arm: 5, shoulder: 0, time: 0, velocity: new Vector3(), lag: new Vector3() }
const target = new Vector3(), focus = new Vector3(), view = new Vector3(), side = new Vector3(), up = new Vector3()
const sample = new Vector3(), moved = new Vector3(), direction = new Vector3()

/** The next update starts over (snaps) instead of easing in from wherever a cutscene, photo mode or teleport left it. */
export function resetCameraRig() {
  rig.ready = false
}
const carryUp = new Vector3(0, 1, 0)
export function shiftCameraRig(previous: Vector3, current: Vector3, turn: number) {
  if (!rig.ready) return
  rig.pivot.sub(previous).applyAxisAngle(carryUp, turn).add(current)
  rig.last.sub(previous).applyAxisAngle(carryUp, turn).add(current)
  rig.velocity.applyAxisAngle(carryUp, turn)
}

function solid(point: Vector3) {
  const ground = groundHeight(point.x, point.z, point.y)
  return (ground !== null && point.y < ground + 0.3) || insideStructure(point.x, point.y, point.z) || insideAnyCollider(point.x, point.y, point.z, 0.3)
}

/** Free length (≤ `length`) along the unit `direction` from `from` before terrain, a structure or a collider. */
function clearance(from: Vector3, direction: Vector3, length: number) {
  const deckFree = kunClearance(from, direction, length)
  const steps = Math.max(2, Math.ceil(length / 0.6))
  for (let i = 1; i <= steps; i++) {
    if (!solid(sample.copy(from).addScaledVector(direction, (i / steps) * length))) continue
    // Refine the hit between the last free sample and this one.
    let lo = ((i - 1) / steps) * length, hi = (i / steps) * length
    for (let k = 0; k < 4; k++) {
      const mid = (lo + hi) / 2
      if (solid(sample.copy(from).addScaledVector(direction, mid))) hi = mid; else lo = mid
    }
    return Math.min(lo, deckFree)
  }
  return Math.min(length, deckFree)
}

export function CameraRig({ camera }: { camera: PerspectiveCamera }) {
  return <group name="cameraRig"><primitive object={camera} name="camera" /></group>
}

/**
 * Third-person orbit: the mouse turns the view directly; the arm swings out from a pivot over the player's
 * shoulder, pulls in at once when terrain or a wall comes between, and eases back out. Height follows with a
 * little lag (jumps, steps), flight adds lag under acceleration, a wider view and buffeting at speed.
 */
export function updateCameraRig(
  camera: PerspectiveCamera, player: Vector3, yaw: number, pitch: number,
  mode: Mode, delta: number, speed = 0, bank = 0, impact = 0, baseFov = 72, landing = 0,
) {
  const config = RIG[mode]
  const flight = mode === 'FLIGHT'
  const pace = flight ? smooth(speed / 140) : smooth((speed - 5.5) / 4.5)
  const length = config.near + (config.far - config.near) * pace
  const fresh = !rig.ready || rig.last.distanceTo(player) > SNAP
  if (fresh) {
    rig.ready = true
    rig.height = config.pivot
    rig.pivot.copy(player)
    rig.pivot.y += config.pivot
    rig.last.copy(player)
    rig.rise = 0
    rig.arm = length
    rig.velocity.set(0, 0, 0)
  }
  const dt = Math.max(delta, 1e-4)
  moved.copy(player).sub(rig.last).divideScalar(dt)
  rig.last.copy(player)
  // Ground and flight frame the player from different heights: ease between them so neither switch jumps.
  rig.height += (config.pivot - rig.height) * (1 - Math.exp(-4 * delta))
  target.copy(player)
  target.y += rig.height + impact * 0.045 - landing * 0.16
  // Travel is followed exactly (a diving sword would outrun any easing); on foot, height eases over steps and jumps.
  rig.pivot.x = target.x
  rig.pivot.z = target.z
  // In flight only the height offset left over from the ground eases out.
  if (flight) rig.pivot.y = target.y + (rig.rise *= Math.exp(-8 * delta))
  else rig.pivot.y += (target.y - rig.pivot.y) * (1 - Math.exp(-12 * delta))
  rig.rise = rig.pivot.y - target.y
  // Under acceleration the camera falls back a little, then catches up once the speed settles.
  rig.velocity.lerp(moved, 1 - Math.exp(-4 * delta))
  rig.lag.copy(moved).sub(rig.velocity).multiplyScalar(flight ? -0.05 : 0)
  const lag = Math.min(2.5, rig.lag.length())
  if (lag > 1e-3) {
    // Never let the lag carry the focus into a wall, or the arm would start inside it.
    direction.copy(rig.lag).divideScalar(rig.lag.length())
    rig.lag.copy(direction).multiplyScalar(Math.max(0, Math.min(lag, clearance(rig.pivot, direction, lag + PAD) - PAD)))
  }

  const tilt = pitch - config.tilt
  view.set(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt))
  side.set(Math.cos(yaw), 0, Math.sin(yaw))
  // Shoulder offset, kept clear of a wall on that side.
  const shoulder = config.shoulder > 0 ? Math.max(0, Math.min(config.shoulder, clearance(rig.pivot, side, config.shoulder + PAD) - PAD)) : 0
  rig.shoulder = fresh ? shoulder : rig.shoulder + (shoulder - rig.shoulder) * (1 - Math.exp(-(shoulder < rig.shoulder ? 30 : 5) * delta))
  focus.copy(rig.pivot).addScaledVector(side, rig.shoulder).add(rig.lag)
  // Probe out to the current arm as well, so a shorter wanted length (slowing down, landing) eases in rather than snapping.
  view.negate()
  const free = Math.max(MIN_ARM, clearance(focus, view, Math.max(length, rig.arm) + PAD) - PAD)
  view.negate()
  rig.arm = free < rig.arm ? free : rig.arm + (Math.min(free, length) - rig.arm) * (1 - Math.exp(-3.5 * delta))
  camera.position.copy(focus).addScaledVector(view, -rig.arm)

  // Buffeting above ~60 m/s: small, incommensurate wobble in position and roll.
  rig.time += delta
  const buffet = flight ? smooth((speed - 60) / 80) : 0
  let roll = -bank * 0.08
  if (buffet > 0) {
    const t = rig.time
    up.crossVectors(side, view)
    camera.position.addScaledVector(side, (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3) * 0.4) * buffet * 0.04)
    camera.position.addScaledVector(up, (Math.sin(t * 31.7 + 1.3) * 0.6 + Math.sin(t * 19.9) * 0.4) * buffet * 0.04)
    roll += Math.sin(t * 27.3 + 0.7) * buffet * 0.004
  }
  const surface = groundHeight(camera.position.x, camera.position.z, camera.position.y)
  if (surface !== null) camera.position.y = Math.max(surface + 0.3, camera.position.y)
  camera.lookAt(sample.copy(camera.position).add(view))
  camera.rotateZ(roll)
  const fov = baseFov + (flight ? 11 : 3) * pace
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * delta))
  camera.updateProjectionMatrix()
}
