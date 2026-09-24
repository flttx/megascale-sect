import { Vector3 } from 'three'
import { groundHeight, LAYOUT } from '../worldLayout'
import { stepFlight } from './FlightController'
import { stepGround } from './GroundController'

export type PlayerPhase = 'GROUND' | 'SUMMONING' | 'BOARDING' | 'FLIGHT' | 'LANDING' | 'DISMOUNTING'
export const PHASE_LABELS: Record<PlayerPhase, string> = {
  GROUND: '地面行走', SUMMONING: '凝气召剑', BOARDING: '跃起踏剑',
  FLIGHT: '御剑飞行', LANDING: '御剑降落', DISMOUNTING: '收剑落地',
}
export const FLIGHT_SEQUENCE = { summon: 1.2, board: 1.25, dismount: 0.75, step: 1.15, hover: 0.55 } as const
export const smooth = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v) }

export type PlayerRuntime = {
  position: Vector3; velocity: Vector3; phase: PlayerPhase; elapsed: number; time: number;
  yaw: number; pitch: number; facing: number; sequenceYaw: number; origin: Vector3; destination: Vector3;
  bank: number; climb: number; ready: boolean;
  stride: number; gait: number; runMix: number; rideMix: number; impact: number; braking: boolean; boostMix: number;
}

export function createPlayerRuntime(): PlayerRuntime {
  return {
    position: new Vector3(...LAYOUT.spawn.position), velocity: new Vector3(), phase: 'GROUND',
    elapsed: 0, time: 0, yaw: 0, pitch: 0.1, facing: 0, sequenceYaw: 0,
    origin: new Vector3(), destination: new Vector3(), bank: 0, climb: 0, ready: false,
    stride: 0, gait: 0, runMix: 0, rideMix: 0, impact: 0, braking: false, boostMix: 0,
  }
}

export function changePhase(runtime: PlayerRuntime, phase: PlayerPhase) {
  runtime.phase = phase
  runtime.elapsed = 0
}

export function isAirborne(phase: PlayerPhase) {
  return phase === 'FLIGHT' || phase === 'LANDING' || phase === 'DISMOUNTING'
}

export function requestFlightToggle(runtime: PlayerRuntime): string | null {
  if (!runtime.ready) return '角色与动作正在载入，请稍候'
  if (runtime.phase === 'GROUND') {
    const { position, yaw } = runtime
    // At a wall or path edge, turn toward a clear patch before summoning.
    const landing = [0, Math.PI / 2, -Math.PI / 2, Math.PI].map((offset) => {
      const direction = yaw + offset
      const x = position.x + Math.sin(direction) * FLIGHT_SEQUENCE.step
      const z = position.z - Math.cos(direction) * FLIGHT_SEQUENCE.step
      return { x, z, direction, height: groundHeight(x, z) }
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
    const surface = groundHeight(runtime.position.x, runtime.position.z)
    if (surface === null) return '请飞到道路或主平台上方，再按 F 落地'
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
  runtime.rideMix += ((isAirborne(runtime.phase) || (runtime.phase === 'BOARDING' && runtime.elapsed / FLIGHT_SEQUENCE.board > 0.75) ? 1 : 0) - runtime.rideMix) * (1 - Math.exp(-9 * delta))
  runtime.boostMix += ((boosting && runtime.phase === 'FLIGHT' && !runtime.braking && input.lengthSq() > 0 ? 1 : 0) - runtime.boostMix) * (1 - Math.exp(-3 * delta))
  const { position, velocity } = runtime
  switch (runtime.phase) {
    case 'GROUND': {
      const x = position.x, z = position.z
      stepGround(position, velocity, input, runtime.yaw, boosting, delta)
      const distance = Math.hypot(position.x - x, position.z - z)
      const actualSpeed = distance / Math.max(delta, 0.001)
      runtime.gait += ((actualSpeed > 0.12 ? Math.min(1, actualSpeed / 2) : 0) - runtime.gait) * (1 - Math.exp(-14 * delta))
      runtime.runMix += ((boosting && actualSpeed > 3.5 ? 1 : 0) - runtime.runMix) * (1 - Math.exp(-6 * delta))
      runtime.stride += distance / (2.0 + runtime.runMix * 1.15) * Math.PI * 2
      if (Math.hypot(velocity.x, velocity.z) > 0.2) {
        const desired = Math.atan2(velocity.x, -velocity.z)
        const difference = Math.atan2(Math.sin(desired - runtime.facing), Math.cos(desired - runtime.facing))
        runtime.facing += difference * (1 - Math.exp(-12 * delta))
      }
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
      const surface = groundHeight(position.x, position.z)
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
