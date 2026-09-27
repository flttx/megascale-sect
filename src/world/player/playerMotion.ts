import { Vector3 } from 'three'
import { groundHeight, groundHit, insideStructure, LAYOUT, terrainSlope } from '../worldLayout'
import { bodyInsideAnyCollider } from '../surfaces'
import { stepFlight } from './FlightController'
import { groundState, JUMP_SPEED, stepGround } from './GroundController'
import { deckAnchor, evaluateDeckAnchor, kunBodyBlocked, kunClearance, kunDeckHit, kunDockable, kunState } from '../colossi/kunDeck'
import type { DeckAnchor } from '../colossi/kunDeck'
import { shiftCameraRig } from './CameraRig'
import { useWorldStore } from '../store'

export type PlayerPhase = 'GROUND' | 'SUMMONING' | 'BOARDING' | 'FLIGHT' | 'LANDING' | 'DISMOUNTING'
export const PHASE_LABELS: Record<PlayerPhase, string> = {
  GROUND: '地面行走', SUMMONING: '凝气召剑', BOARDING: '跃起踏剑',
  FLIGHT: '御剑飞行', LANDING: '御剑降落', DISMOUNTING: '收剑落地',
}
export const FLIGHT_SEQUENCE = { summon: 1.2, board: 1.25, dismount: 0.75, step: 1.15, hover: 0.55 } as const
/** A jump pressed this long before touchdown still fires on landing. */
export const JUMP_BUFFER = 0.15
/** The crouch before a jump leaves the ground (s): standing, and out of a run, whose stride has already loaded the legs. */
const TAKEOFF = { standing: 0.1, running: 0.05 } as const
/** Falling faster than this on foot (≈7 m of drop) calls the sword to catch the player. */
const RESCUE_SPEED = 20
export const smooth = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v) }

export type PlayerRuntime = {
  position: Vector3; velocity: Vector3; phase: PlayerPhase; elapsed: number; time: number;
  yaw: number; pitch: number; facing: number; sequenceYaw: number; origin: Vector3; destination: Vector3;
  bank: number; climb: number; ready: boolean;
  rideMix: number; impact: number; braking: boolean; boostMix: number;
  /** Jump press still waiting for footing (s); off the ground on foot; its smoothed weight; landing crouch 0…1. */
  jumpBuffer: number; inAir: boolean; air: number; landing: number;
  /** Time into the crouch before a jump, and its length (0 when no jump is winding up). */
  takeoff: number; takeoffTime: number;
  aboard: DeckAnchor | null; carrierDelta: Vector3; carrierVelocity: Vector3; aboardJump: boolean; kunWarned: boolean; relocation: number;
}

export function createPlayerRuntime(): PlayerRuntime {
  return {
    position: new Vector3(...LAYOUT.spawn.position), velocity: new Vector3(), phase: 'GROUND',
    elapsed: 0, time: 0, yaw: 0, pitch: 0.1, facing: 0, sequenceYaw: 0,
    origin: new Vector3(), destination: new Vector3(), bank: 0, climb: 0, ready: false,
    rideMix: 0, impact: 0, braking: false, boostMix: 0,
    jumpBuffer: 0, inAir: false, air: 0, landing: 0, takeoff: 0, takeoffTime: 0,
    aboard: null, carrierDelta: new Vector3(), carrierVelocity: new Vector3(), aboardJump: false, kunWarned: false, relocation: 0,
  }
}

export function changePhase(runtime: PlayerRuntime, phase: PlayerPhase) {
  if (phase === 'FLIGHT' && runtime.aboard) {
    runtime.velocity.add(runtime.carrierVelocity)
    runtime.aboard = null; runtime.aboardJump = false
  }
  runtime.phase = phase
  runtime.elapsed = 0
  // A buffered jump or the airborne flag from the last stretch on foot never carries into the next phase.
  runtime.jumpBuffer = 0
  runtime.inAir = false
  runtime.takeoff = runtime.takeoffTime = 0
}

/** The sword flashes in underfoot and carries the player straight into flight (a long fall, or F pressed mid-jump). */
function catchWithSword(runtime: PlayerRuntime) {
  runtime.velocity.y *= 0.35
  changePhase(runtime, 'FLIGHT')
  runtime.impact = 1
  runtime.air = 0
}

export function isAirborne(phase: PlayerPhase) {
  return phase === 'FLIGHT' || phase === 'LANDING' || phase === 'DISMOUNTING'
}

const carrierPoint = new Vector3(), previousPoint = new Vector3(), playerBefore = new Vector3(), UP = new Vector3(0, 1, 0)
/** Runs even while the player is in a menu. Returns the carrier's turn for the free-look camera. */
export function carryPlayer(runtime: PlayerRuntime, delta: number) {
  runtime.carrierDelta.set(0, 0, 0)
  const anchor = runtime.aboard
  if (!anchor) { runtime.carrierVelocity.set(0, 0, 0); return 0 }
  const now = evaluateDeckAnchor(anchor, carrierPoint)
  if (!now) { catchWithSword(runtime); return 0 }
  previousPoint.copy(anchor.point); playerBefore.copy(runtime.position)
  const turn = Math.atan2(Math.sin(kunState.heading - anchor.yaw), Math.cos(kunState.heading - anchor.yaw))
  for (const p of [runtime.position, runtime.origin, runtime.destination]) p.sub(previousPoint).applyAxisAngle(UP, turn).add(now)
  runtime.carrierDelta.subVectors(runtime.position, playerBefore)
  if (delta > 0) runtime.carrierVelocity.copy(runtime.carrierDelta).divideScalar(delta)
  runtime.velocity.applyAxisAngle(UP, turn)
  runtime.yaw -= turn; runtime.facing -= turn; runtime.sequenceYaw -= turn
  shiftCameraRig(previousPoint, now, turn)
  anchor.point.copy(now); anchor.yaw = kunState.heading
  if (kunState.time >= 150 && !runtime.kunWarned) { runtime.kunWarned = true; useWorldStore.getState().setNotice('鲲将没入云海') }
  if (runtime.phase === 'LANDING') {
    runtime.destination.y = now.y + FLIGHT_SEQUENCE.hover
    if (!kunDockable()) { changePhase(runtime, 'FLIGHT'); useWorldStore.getState().setNotice('鲲正没入云海，无法停靠') }
  }
  if (runtime.aboard && (runtime.position.y + Math.min(0, runtime.carrierVelocity.y) * delta <= -24 || kunState.headY < -44)) {
    catchWithSword(runtime); useWorldStore.getState().setNotice('飞剑载你离开鲲背')
  }
  return turn
}

export function updatePlayerSupport(runtime: PlayerRuntime) {
  if (runtime.phase !== 'GROUND') return
  const p = runtime.position, hit = kunDeckHit(p.x, p.z, p.y)
  if (runtime.inAir) {
    if (runtime.aboard && runtime.velocity.y > 0) runtime.aboardJump = true
    if (runtime.aboard && (!runtime.aboardJump || !hit)) {
      runtime.velocity.add(runtime.carrierVelocity); runtime.aboard = null; runtime.aboardJump = false
    }
    return
  }
  if (hit && Math.abs(hit.y - p.y) < 0.08 && groundHit(p.x, p.z, p.y)?.surfaceId === 'kun') {
    if (!runtime.aboard && !kunDockable()) { catchWithSword(runtime); return }
    if (!runtime.aboard) runtime.kunWarned = false
    runtime.aboard = deckAnchor(hit); runtime.aboardJump = false
  } else runtime.aboard = null
}

export function bodyClear(x: number, y: number, z: number) {
  return !bodyInsideAnyCollider(x, y + 0.45, y + 1.7, z, 0.35, 0, true) &&
    !insideStructure(x, y + 0.45, z) && !insideStructure(x, y + 1.7, z)
}
/** Sweep the body all the way to its footing, not just the destination under a solid prop. */
const descentRay = new Vector3(), DOWN = new Vector3(0, -1, 0)
export function descentClear(x: number, fromY: number, toY: number, z: number) {
  const length = Math.max(0, fromY - toY) + 1.25
  for (const [dx, dz] of [[0, 0], [-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]]) {
    descentRay.set(x + dx, Math.max(fromY, toY) + 1.7, z + dz)
    if (kunClearance(descentRay, DOWN, length) < length - 1e-5) return false
  }
  const steps = Math.max(1, Math.ceil(Math.abs(fromY - toY) / 0.5))
  for (let i = 0; i <= steps; i++) if (!bodyClear(x, fromY + (toY - fromY) * i / steps, z)) return false
  return true
}

export function requestFlightToggle(runtime: PlayerRuntime): string | null {
  if (!runtime.ready) return '角色与动作正在载入，请稍候'
  if (runtime.phase === 'GROUND' && runtime.inAir) {
    catchWithSword(runtime)
    return null
  }
  if (runtime.phase === 'GROUND') {
    const { position, yaw } = runtime
    // At a wall or path edge, turn toward a clear patch before summoning.
    const landing = [0, Math.PI / 2, -Math.PI / 2, Math.PI].map((offset) => {
      const direction = yaw + offset
      const x = position.x + Math.sin(direction) * FLIGHT_SEQUENCE.step
      const z = position.z - Math.cos(direction) * FLIGHT_SEQUENCE.step
      return { x, z, direction, height: groundHeight(x, z, position.y + 0.8) }
    }).find((candidate) => candidate.height !== null && Math.abs(position.y - candidate.height) <= 0.8 && bodyClear(candidate.x, candidate.height, candidate.z) &&
      !kunBodyBlocked(position.x, position.y, position.z, candidate.x, candidate.z))
    if (!landing || landing.height === null) return '请在平稳、开阔的位置召剑'
    runtime.origin.copy(position)
    runtime.destination.set(landing.x, landing.height + FLIGHT_SEQUENCE.hover, landing.z)
    runtime.sequenceYaw = landing.direction
    runtime.facing = landing.direction
    runtime.velocity.set(0, 0, 0)
    changePhase(runtime, 'SUMMONING')
    return null
  }
  if (runtime.phase === 'FLIGHT') {
    const hit = groundHit(runtime.position.x, runtime.position.z, runtime.position.y)
    const surface = hit?.y ?? null
    if (surface === null) return '请飞到地面、平台或浮岛上方，再按 F 落地'
    if (terrainSlope(runtime.position.x, runtime.position.z, runtime.position.y) > 40) return '下方地势陡峭，请飞到平缓处再落地'
    if (hit?.surfaceId === 'kun' && !kunDockable()) return '鲲正在爬升或入云，请待平飞时停靠'
    if (hit && hit.normalY < Math.cos(40 * Math.PI / 180)) return '鲲背此处陡峭，请移到平缓处'
    if (!descentClear(runtime.position.x, runtime.position.y, surface, runtime.position.z)) return '下方有遮挡，请移到开阔处落地'
    runtime.destination.copy(runtime.position).setY(surface + FLIGHT_SEQUENCE.hover)
    runtime.velocity.set(0, 0, 0)
    changePhase(runtime, 'LANDING')
    if (hit?.surfaceId === 'kun') { runtime.aboard = deckAnchor(hit); runtime.kunWarned = false }
    return null
  }
  if (runtime.phase === 'LANDING') {
    changePhase(runtime, 'FLIGHT')
    return null
  }
  return null
}

export function stepPlayer(runtime: PlayerRuntime, input: Vector3, boosting: boolean, delta: number) {
  runtime.time += delta
  runtime.elapsed += delta
  runtime.impact *= Math.exp(-8 * delta)
  runtime.landing *= Math.exp(-6 * delta)
  runtime.rideMix += ((isAirborne(runtime.phase) || (runtime.phase === 'BOARDING' && runtime.elapsed / FLIGHT_SEQUENCE.board > 0.75) ? 1 : 0) - runtime.rideMix) * (1 - Math.exp(-9 * delta))
  runtime.boostMix += ((boosting && runtime.phase === 'FLIGHT' && !runtime.braking && input.lengthSq() > 0 ? 1 : 0) - runtime.boostMix) * (1 - Math.exp(-3 * delta))
  const { position, velocity } = runtime
  switch (runtime.phase) {
    case 'GROUND': {
      runtime.jumpBuffer = Math.max(0, runtime.jumpBuffer - delta)
      // A press on the ground (or buffered into the landing) crouches first; the leap fires when the crouch bottoms out.
      const footing = groundState(position)
      if (!runtime.takeoffTime && runtime.jumpBuffer > 0 && !runtime.inAir && footing.grounded && !footing.sliding) {
        runtime.jumpBuffer = 0
        runtime.takeoff = 0
        runtime.takeoffTime = TAKEOFF.standing + (TAKEOFF.running - TAKEOFF.standing) * smooth(Math.hypot(velocity.x, velocity.z) / LAYOUT.player.jogSpeed)
      }
      let leap = false
      const windingUp = runtime.takeoffTime > 0
      if (runtime.takeoffTime) {
        runtime.takeoff += delta
        leap = runtime.takeoff >= runtime.takeoffTime
        if (leap) { runtime.takeoff = runtime.takeoffTime = 0; runtime.jumpBuffer = 0 }
      }
      const result = stepGround(position, velocity, input, runtime.yaw, boosting, leap, delta)
      // A committed crouch may leave the ledge before its timer ends: keep that press, once.
      if (windingUp && !result.grounded && velocity.y <= 0 && !result.sliding) {
        velocity.y = JUMP_SPEED
        runtime.takeoff = runtime.takeoffTime = runtime.jumpBuffer = 0
      }
      if (result.sliding) runtime.takeoff = runtime.takeoffTime = runtime.jumpBuffer = 0
      runtime.inAir = !result.grounded || velocity.y > 0
      runtime.air += ((runtime.inAir ? 1 : 0) - runtime.air) * (1 - Math.exp(-12 * delta))
      if (result.touchdown > 4) runtime.landing = Math.min(1, runtime.landing + result.touchdown / 18)
      if (Math.hypot(velocity.x, velocity.z) > 0.2) {
        const desired = Math.atan2(velocity.x, -velocity.z)
        const difference = Math.atan2(Math.sin(desired - runtime.facing), Math.cos(desired - runtime.facing))
        runtime.facing += difference * (1 - Math.exp(-12 * delta))
      }
      // A long fall on foot (off a cliff, into the clouds): the sword flashes in underfoot and catches the player.
      if (runtime.inAir && velocity.y < -RESCUE_SPEED) catchWithSword(runtime)
      break
    }
    case 'SUMMONING':
      if (runtime.elapsed >= FLIGHT_SEQUENCE.summon) changePhase(runtime, 'BOARDING')
      break
    case 'BOARDING': {
      const t = Math.min(1, runtime.elapsed / FLIGHT_SEQUENCE.board)
      const flight = Math.max(0, Math.min(1, (t - 0.16) / 0.66))
      position.lerpVectors(runtime.origin, runtime.destination, smooth(flight))
      position.y += Math.sin(Math.PI * flight) * 0.85
      if (t >= 0.82 && t - delta / FLIGHT_SEQUENCE.board < 0.82) runtime.impact = 1
      if (t === 1) changePhase(runtime, 'FLIGHT')
      break
    }
    case 'FLIGHT': {
      const previousFacing = runtime.facing
      const angle = Math.atan2(Math.sin(runtime.yaw - runtime.facing), Math.cos(runtime.yaw - runtime.facing))
      runtime.facing += angle * (1 - Math.exp(-7 * delta))
      stepFlight(position, velocity, input, runtime.facing, runtime.pitch, boosting, delta, runtime.braking)
      const turn = Math.atan2(Math.sin(runtime.facing - previousFacing), Math.cos(runtime.facing - previousFacing))
      const targetBank = Math.max(-0.38, Math.min(0.38, turn / Math.max(delta, 0.001) * -0.11 - input.x * 0.12))
      runtime.bank += (targetBank - runtime.bank) * (1 - Math.exp(-5 * delta))
      runtime.climb += (Math.atan2(velocity.y, Math.max(12, Math.hypot(velocity.x, velocity.z))) - runtime.climb) * (1 - Math.exp(-5 * delta))
      break
    }
    case 'LANDING': {
      if (!descentClear(position.x, position.y, runtime.destination.y - FLIGHT_SEQUENCE.hover, position.z)) {
        changePhase(runtime, 'FLIGHT')
        useWorldStore.getState().setNotice('降落路径出现遮挡，已停止降落')
        break
      }
      position.y = Math.max(runtime.destination.y, position.y - Math.min(28, (position.y - runtime.destination.y) * 2 + 1) * delta)
      runtime.bank *= Math.exp(-6 * delta)
      runtime.climb *= Math.exp(-6 * delta)
      if (position.y <= runtime.destination.y + 0.002) {
        runtime.origin.copy(position)
        runtime.destination.y -= FLIGHT_SEQUENCE.hover
        changePhase(runtime, 'DISMOUNTING')
      }
      break
    }
    case 'DISMOUNTING': {
      const t = Math.min(1, runtime.elapsed / FLIGHT_SEQUENCE.dismount)
      position.lerpVectors(runtime.origin, runtime.destination, smooth(t))
      position.y += Math.sin(Math.PI * t) * 0.22
      if (t === 1) { runtime.bank = 0; runtime.climb = 0; runtime.impact = 0.7; changePhase(runtime, 'GROUND') }
      break
    }
  }
}
