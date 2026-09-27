import { Vector3 } from 'three'
import { groundHeight, LAYOUT, terrainSlope } from '../worldLayout'
import { stepFlight } from './FlightController'
import { stepGround } from './GroundController'

export type PlayerPhase = 'GROUND' | 'SUMMONING' | 'BOARDING' | 'FLIGHT' | 'LANDING' | 'DISMOUNTING'
export const PHASE_LABELS: Record<PlayerPhase, string> = {
  GROUND: '地面行走', SUMMONING: '凝气召剑', BOARDING: '跃起踏剑',
  FLIGHT: '御剑飞行', LANDING: '御剑降落', DISMOUNTING: '收剑落地',
}
export const FLIGHT_SEQUENCE = { summon: 1.2, board: 1.25, dismount: 0.75, step: 1.15, hover: 0.55 } as const
/** A jump pressed this long before touchdown still fires on landing. */
export const JUMP_BUFFER = 0.15
/** Falling faster than this on foot (≈7 m of drop) calls the sword to catch the player. */
const RESCUE_SPEED = 20
export const smooth = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v) }

export type PlayerRuntime = {
  position: Vector3; velocity: Vector3; phase: PlayerPhase; elapsed: number; time: number;
  yaw: number; pitch: number; facing: number; sequenceYaw: number; origin: Vector3; destination: Vector3;
  bank: number; climb: number; ready: boolean;
  stride: number; gait: number; runMix: number; rideMix: number; impact: number; braking: boolean; boostMix: number;
  /** Jump press still waiting for footing (s); off the ground on foot; its smoothed weight; landing crouch 0…1. */
  jumpBuffer: number; inAir: boolean; air: number; landing: number;
}

export function createPlayerRuntime(): PlayerRuntime {
  return {
    position: new Vector3(...LAYOUT.spawn.position), velocity: new Vector3(), phase: 'GROUND',
    elapsed: 0, time: 0, yaw: 0, pitch: 0.1, facing: 0, sequenceYaw: 0,
    origin: new Vector3(), destination: new Vector3(), bank: 0, climb: 0, ready: false,
    stride: 0, gait: 0, runMix: 0, rideMix: 0, impact: 0, braking: false, boostMix: 0,
    jumpBuffer: 0, inAir: false, air: 0, landing: 0,
  }
}

export function changePhase(runtime: PlayerRuntime, phase: PlayerPhase) {
  runtime.phase = phase
  runtime.elapsed = 0
  // A buffered jump or the airborne flag from the last stretch on foot never carries into the next phase.
  runtime.jumpBuffer = 0
  runtime.inAir = false
}

/** The sword flashes in underfoot and carries the player straight into flight (a long fall, or F pressed mid-jump). */
function catchWithSword(runtime: PlayerRuntime) {
  changePhase(runtime, 'FLIGHT')
  runtime.velocity.y *= 0.35
  runtime.impact = 1
  runtime.air = 0
}

export function isAirborne(phase: PlayerPhase) {
  return phase === 'FLIGHT' || phase === 'LANDING' || phase === 'DISMOUNTING'
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
    }).find((candidate) => candidate.height !== null && Math.abs(position.y - candidate.height) <= 0.8)
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
    const surface = groundHeight(runtime.position.x, runtime.position.z, runtime.position.y)
    if (surface === null) return '请飞到地面、平台或浮岛上方，再按 F 落地'
    if (terrainSlope(runtime.position.x, runtime.position.z, runtime.position.y) > 40) return '下方地势陡峭，请飞到平缓处再落地'
    runtime.destination.copy(runtime.position).setY(surface + FLIGHT_SEQUENCE.hover)
    runtime.velocity.set(0, 0, 0)
    changePhase(runtime, 'LANDING')
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
      const x = position.x, z = position.z
      runtime.jumpBuffer = Math.max(0, runtime.jumpBuffer - delta)
      const touchdown = stepGround(position, velocity, input, runtime.yaw, boosting, runtime.jumpBuffer > 0, delta)
      if (!runtime.inAir && velocity.y > 0) runtime.jumpBuffer = 0
      runtime.inAir = velocity.y !== 0
      runtime.air += ((runtime.inAir ? 1 : 0) - runtime.air) * (1 - Math.exp(-12 * delta))
      if (touchdown > 4) runtime.landing = Math.min(1, runtime.landing + touchdown / 18)
      const distance = runtime.inAir ? 0 : Math.hypot(position.x - x, position.z - z)
      const actualSpeed = distance / Math.max(delta, 0.001)
      runtime.gait += ((actualSpeed > 0.12 ? Math.min(1, actualSpeed / 2) : 0) - runtime.gait) * (1 - Math.exp(-14 * delta))
      if (!runtime.inAir) runtime.runMix += (Math.min(1, Math.max(0, (actualSpeed - 2) / 3.5)) - runtime.runMix) * (1 - Math.exp(-6 * delta))
      // Stride lengthens with speed, so cadence stays near a runner's ~3 steps/s from jog to sprint.
      runtime.stride += distance / (1.7 + Math.min(actualSpeed, 11) * 0.28) * Math.PI * 2
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
      const surface = groundHeight(position.x, position.z, position.y + FLIGHT_SEQUENCE.hover)
      if (surface !== null && position.y < surface + FLIGHT_SEQUENCE.hover) {
        position.y = surface + FLIGHT_SEQUENCE.hover
        velocity.y = Math.max(0, velocity.y)
      }
      const turn = Math.atan2(Math.sin(runtime.facing - previousFacing), Math.cos(runtime.facing - previousFacing))
      const targetBank = Math.max(-0.38, Math.min(0.38, turn / Math.max(delta, 0.001) * -0.11 - input.x * 0.12))
      runtime.bank += (targetBank - runtime.bank) * (1 - Math.exp(-5 * delta))
      runtime.climb += (Math.atan2(velocity.y, Math.max(12, Math.hypot(velocity.x, velocity.z))) - runtime.climb) * (1 - Math.exp(-5 * delta))
      break
    }
    case 'LANDING': {
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
