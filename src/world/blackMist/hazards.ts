import { Vector3 } from 'three'
import { hasGameInput } from '../../ui/gameKeys'
import { uiBridge } from '../../ui/bridge'
import { useUiStore } from '../../ui/uiStore'
import { getPlayerRuntime } from '../player/playerHandle'
import { useWorldStore } from '../store'
import { blackMistRuntime } from './runtime'

export type BlackMistHazardKind = 'tentacle' | 'creature' | 'ground' | 'building'
export type BlackMistThreatPhase = 'idle' | 'windup' | 'strike' | 'recover'
export interface BlackMistThreatRequest {
  id: string
  kind: BlackMistHazardKind
  origin: Vector3
  range: number
  windup?: number
  strike?: number
  recover?: number
  cooldown?: number
}
export interface BlackMistThreat {
  id: string
  kind: BlackMistHazardKind
  root: Vector3
  range: number
  phase: BlackMistThreatPhase
  phaseTime: number
  progress: number
  strength: number
  target: Vector3 | null
  attackSerial: number
  phaseStart: number
  nextAttack: number
}
export interface BlackMistSweep {
  id: string
  kind: BlackMistHazardKind
  a: Vector3
  b: Vector3
  radius: number
  active: boolean
  attackSerial?: number
}
interface Contact extends BlackMistSweep {
  frame: number
  previousA: Vector3
  previousB: Vector3
  previousActive: boolean
}
export interface BlackMistHit {
  id: number
  sourceId: string
  kind: BlackMistHazardKind
  time: number
  position: number[]
  respawnId: string
  respawnPosition: number[]
}
const threats = new Map<string, BlackMistThreat>(),
  contacts = new Map<string, Contact>(),
  hits: BlackMistHit[] = []
let frame = 0,
  serial = -1,
  enabled = false,
  invulnerableUntil = 0
let review = false,
  previousRelocation = -1,
  previousEnabled = false,
  previousTime = 0,
  playerSwept = false
const player = new Vector3(),
  currentFeet = new Vector3(),
  previousFeet = new Vector3()
const segmentA = new Vector3(),
  segmentB = new Vector3(),
  bodyA = new Vector3(),
  bodyB = new Vector3()
const finite = (point: Vector3) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)

/** Simulation is only dangerous while the player controls exploration; menus/photo/review are safe. */
export function blackMistHazardsEnabled() {
  const r = blackMistRuntime,
    world = useWorldStore.getState(),
    p = getPlayerRuntime()
  return (
    world.gameMode === 'black-mist' &&
    r.active &&
    !r.cinematic &&
    !r.awaitingExplore &&
    r.corruption >= 0.99 &&
    !r.motionPaused &&
    !r.testMotionHeld &&
    !document.hidden &&
    !uiBridge.graphicsBlocked &&
    !useUiStore.getState().overlay &&
    world.started &&
    !review &&
    world.cameraMode === 'player' &&
    hasGameInput() &&
    !!p?.ready
  )
}

export function resetBlackMistHazards() {
  threats.clear()
  contacts.clear()
  hits.length = 0
  invulnerableUntil = 0
  serial = blackMistRuntime.serial
  enabled = false
  review = false
  previousRelocation = -1
  previousEnabled = false
  playerSwept = false
  previousTime = blackMistRuntime.motionTime
}

export function beginBlackMistHazardFrame(inReview = false) {
  const r = blackMistRuntime
  if (serial !== r.serial || !r.active) resetBlackMistHazards()
  const delta = Math.max(0, r.motionTime - previousTime)
  review = inReview
  frame++
  enabled = blackMistHazardsEnabled()
  const runtime = getPlayerRuntime()
  if (runtime) {
    previousFeet.copy(currentFeet)
    currentFeet.copy(runtime.position)
    playerSwept = previousEnabled && enabled && previousRelocation === runtime.relocation && delta > 0 && delta <= 0.15
    if (!playerSwept) previousFeet.copy(currentFeet)
    player.copy(currentFeet)
    player.y += 0.95
    previousRelocation = runtime.relocation
  }
  // Photography/review leave ambient life running, but pause attack timing and its telegraph.
  if (!enabled || !previousEnabled)
    threats.forEach((threat) => {
      threat.phaseStart += delta
      threat.nextAttack += delta
    })
  previousEnabled = enabled
  previousTime = r.motionTime
}

/** Per-actor state with a readable windup, a locked aim during the strike, and a bounded cooldown. */
export function queryBlackMistThreat(request: BlackMistThreatRequest): BlackMistThreat {
  const now = blackMistRuntime.motionTime
  let threat = threats.get(request.id)
  if (!threat) {
    threat = {
      id: request.id,
      kind: request.kind,
      root: request.origin.clone(),
      range: request.range,
      phase: 'idle',
      phaseTime: 0,
      progress: 0,
      strength: 0,
      target: null,
      attackSerial: 0,
      phaseStart: now,
      nextAttack: now + 0.8,
    }
    threats.set(request.id, threat)
  }
  if (!finite(request.origin) || !Number.isFinite(request.range) || request.range <= 0) return threat
  threat.root.copy(request.origin)
  threat.range = request.range
  if (!enabled || now < invulnerableUntil) return threat
  const durations = {
    idle: 1,
    windup: request.windup ?? 1.5,
    strike: request.strike ?? 0.65,
    recover: request.recover ?? 1.6,
  }
  const nearby = player.distanceToSquared(request.origin) <= request.range * request.range
  const transition = (phase: BlackMistThreatPhase) => {
    threat.phase = phase
    threat.phaseStart = now
    threat.phaseTime = 0
    threat.progress = 0
  }
  if (threat.phase === 'idle' && nearby && now >= threat.nextAttack) {
    threat.target = player.clone()
    threat.attackSerial++
    transition('windup')
  }
  threat.phaseTime = Math.max(0, now - threat.phaseStart)
  threat.progress = Math.min(1, threat.phaseTime / durations[threat.phase])
  if (threat.phase === 'windup') {
    if (threat.progress < 0.65) threat.target?.copy(player)
    if (player.distanceToSquared(request.origin) > (request.range * 1.6) ** 2) transition('recover')
    else if (threat.progress >= 1) transition('strike')
  } else if (threat.phase === 'strike' && threat.progress >= 1) transition('recover')
  else if (threat.phase === 'recover' && threat.progress >= 1) {
    threat.target = null
    threat.nextAttack = now + (request.cooldown ?? 2.7)
    transition('idle')
  }
  threat.strength =
    threat.phase === 'windup'
      ? 0.35 * threat.progress
      : threat.phase === 'strike'
        ? 1
        : threat.phase === 'recover'
          ? 1 - threat.progress
          : 0
  return threat
}

/** Publishers supply capsules from the same posed world vertices/joints that the player sees. */
export function publishBlackMistHazard(sweep: BlackMistSweep) {
  if (!finite(sweep.a) || !finite(sweep.b) || !Number.isFinite(sweep.radius) || sweep.radius <= 0 || sweep.radius > 150)
    return
  const previous = contacts.get(sweep.id)
  const active = sweep.active && enabled && blackMistRuntime.motionTime >= invulnerableUntil
  if (previous) {
    previous.previousA.copy(previous.a)
    previous.previousB.copy(previous.b)
    previous.previousActive =
      previous.active && previous.frame === frame - 1 && previous.attackSerial === sweep.attackSerial
    previous.a.copy(sweep.a)
    previous.b.copy(sweep.b)
    previous.radius = sweep.radius
    previous.active = active
    previous.attackSerial = sweep.attackSerial
    previous.frame = frame
  } else
    contacts.set(sweep.id, {
      ...sweep,
      a: sweep.a.clone(),
      b: sweep.b.clone(),
      active,
      frame,
      previousA: sweep.a.clone(),
      previousB: sweep.b.clone(),
      previousActive: false,
    })
}

export function unregisterBlackMistHazard(id: string) {
  threats.delete(id)
  for (const key of contacts.keys())
    if (key === id || key.startsWith(`${id}:`) || key.startsWith(`${id}/`)) contacts.delete(key)
}

/** Closest distance between finite segments, including zero-length endpoints. */
function segmentDistance(p: Vector3, q: Vector3, a: Vector3, b: Vector3) {
  const ux = q.x - p.x,
    uy = q.y - p.y,
    uz = q.z - p.z
  const vx = b.x - a.x,
    vy = b.y - a.y,
    vz = b.z - a.z
  const wx = p.x - a.x,
    wy = p.y - a.y,
    wz = p.z - a.z
  const uu = ux * ux + uy * uy + uz * uz,
    vv = vx * vx + vy * vy + vz * vz
  const uv = ux * vx + uy * vy + uz * vz,
    uw = ux * wx + uy * wy + uz * wz,
    vw = vx * wx + vy * wy + vz * wz
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  let s = 0,
    t = 0
  if (uu <= 1e-12) t = vv > 1e-12 ? clamp(vw / vv) : 0
  else if (vv <= 1e-12) s = clamp(-uw / uu)
  else {
    const denominator = uu * vv - uv * uv
    s = denominator > 1e-12 ? clamp((uv * vw - uw * vv) / denominator) : 0
    t = (uv * s + vw) / vv
    if (t < 0) {
      t = 0
      s = clamp(-uw / uu)
    } else if (t > 1) {
      t = 1
      s = clamp((uv - uw) / uu)
    }
  }
  return Math.hypot(wx + s * ux - t * vx, wy + s * uy - t * vy, wz + s * uz - t * vz)
}

export function pendingBlackMistHit(): BlackMistSweep | null {
  if (!enabled || blackMistRuntime.motionTime < invulnerableUntil) return null
  const runtime = getPlayerRuntime()
  if (!runtime) return null
  for (const contact of contacts.values()) {
    if (!contact.active || contact.frame !== frame) continue
    const radius = contact.radius + 0.48
    bodyA.copy(currentFeet)
    bodyA.y += 0.4
    bodyB.copy(currentFeet)
    bodyB.y += 1.5
    if (segmentDistance(bodyA, bodyB, contact.a, contact.b) <= radius) return contact
    if (!contact.previousActive) continue
    // Compare simultaneous positions. Adaptive spacing catches fast flight without hitting an old escape position.
    const travel =
      previousFeet.distanceTo(currentFeet) +
      Math.max(contact.previousA.distanceTo(contact.a), contact.previousB.distanceTo(contact.b))
    const steps = Math.min(96, Math.max(1, Math.ceil(travel / Math.max(0.1, radius * 0.5))))
    for (let step = 0; step <= steps; step++) {
      const alpha = step / steps
      segmentA.lerpVectors(contact.previousA, contact.a, alpha)
      segmentB.lerpVectors(contact.previousB, contact.b, alpha)
      bodyA.lerpVectors(previousFeet, currentFeet, alpha)
      bodyB.copy(bodyA)
      bodyA.y += 0.4
      bodyB.y += 1.5
      if (segmentDistance(bodyA, bodyB, segmentA, segmentB) <= radius) return contact
    }
  }
  return null
}

export function recordBlackMistHit(
  source: BlackMistSweep,
  position: Vector3,
  respawnId: string,
  respawnPosition: Vector3,
) {
  const now = blackMistRuntime.motionTime
  hits.push({
    id: (hits.at(-1)?.id ?? 0) + 1,
    sourceId: source.id,
    kind: source.kind,
    time: now,
    position: position.toArray(),
    respawnId,
    respawnPosition: respawnPosition.toArray(),
  })
  if (hits.length > 24) hits.shift()
  invulnerableUntil = now + 4
  threats.forEach((threat) => {
    threat.phase = 'idle'
    threat.target = null
    threat.progress = 0
    threat.strength = 0
    threat.nextAttack = invulnerableUntil
  })
  contacts.forEach((contact) => {
    contact.active = false
    contact.previousActive = false
  })
}

export function blackMistHazardsSnapshot() {
  if (serial !== blackMistRuntime.serial || !blackMistRuntime.active) resetBlackMistHazards()
  return {
    enabled,
    paused: !enabled,
    time: blackMistRuntime.motionTime,
    invulnerableUntil,
    playerSwept,
    player: currentFeet.toArray(),
    previousPlayer: previousFeet.toArray(),
    review,
    actors: [...threats.values()].map((threat) => ({
      ...threat,
      state: threat.phase,
      root: threat.root.toArray(),
      target: threat.target?.toArray() ?? null,
    })),
    contacts: [...contacts.values()]
      .filter((contact) => contact.frame >= frame - 1)
      .map((contact) => ({
        id: contact.id,
        kind: contact.kind,
        a: contact.a.toArray(),
        b: contact.b.toArray(),
        radius: contact.radius,
        active: contact.active,
        attackSerial: contact.attackSerial,
      })),
    hits: hits.map((hit) => ({ ...hit })),
  }
}
