import { groundHeight } from '../worldLayout'
import { resetCameraRig } from './CameraRig'
import { changePhase, updatePlayerSupport, type PlayerRuntime } from './playerMotion'

/** Imperative access to the live player for systems outside the Player component (interactables, UI, save). */
let bound: PlayerRuntime | null = null

export function bindPlayerRuntime(runtime: PlayerRuntime) {
  bound = runtime
  return () => { if (bound === runtime) bound = null }
}

export function getPlayerRuntime(): Readonly<PlayerRuntime> | null {
  return bound
}

/**
 * Moves the player instantly. Lands on the ground when a walkable surface is within 1.5 m below the
 * target, otherwise leaves them hovering in flight. Refused mid-sequence (summoning, boarding, landing).
 */
export function teleportPlayer(position: readonly [number, number, number], yaw?: number): boolean {
  const runtime = bound
  if (!runtime || !['GROUND', 'FLIGHT'].includes(runtime.phase)) return false
  const [x, y, z] = position
  runtime.relocation++
  runtime.aboard = null; runtime.aboardJump = false; runtime.carrierDelta.set(0, 0, 0); runtime.carrierVelocity.set(0, 0, 0)
  const surface = groundHeight(x, z, y + 1.5)
  const onGround = surface !== null && y - surface < 1.5
  runtime.position.set(x, onGround ? surface : y, z)
  runtime.velocity.set(0, 0, 0)
  runtime.bank = 0; runtime.climb = 0
  runtime.jumpBuffer = 0; runtime.inAir = false; runtime.air = 0; runtime.landing = 0; runtime.takeoff = runtime.takeoffTime = 0
  resetCameraRig()
  if (yaw !== undefined) { runtime.yaw = yaw; runtime.facing = yaw }
  const phase = onGround ? 'GROUND' : 'FLIGHT'
  if (runtime.phase !== phase) {
    changePhase(runtime, phase)
    runtime.rideMix = onGround ? 0 : 1
  }
  updatePlayerSupport(runtime)
  return true
}
