import type { Vec3 } from '../surfaces'

/** Last bell strike (seconds on the R3F clock) for the ground shockwave. */
export const bellWave = { start: -1, position: [0, 0, 0] as Vec3, pending: false }

export const SPARK_MAX = 192
/** CPU particle pool for sparkle bursts (orb pickups, array attunement, arrivals); drawn as one Points call. */
export const sparks = {
  position: new Float32Array(SPARK_MAX * 3),
  velocity: new Float32Array(SPARK_MAX * 3),
  color: new Float32Array(SPARK_MAX * 3),
  life: new Float32Array(SPARK_MAX),
  decay: new Float32Array(SPARK_MAX),
  cursor: 0,
  /** Frames the pool has had live particles (drives visibility). */
  alive: 0,
}

export function emitSparks(at: Vec3, count: number, color: Vec3, speed = 3, lift = 1.5, lifetime = 1.1) {
  for (let n = 0; n < count; n++) {
    const i = sparks.cursor
    sparks.cursor = (sparks.cursor + 1) % SPARK_MAX
    const theta = Math.random() * Math.PI * 2, phi = Math.acos(Math.random() * 2 - 1), v = speed * (0.35 + Math.random() * 0.65)
    sparks.position.set(at, i * 3)
    sparks.velocity[i * 3] = Math.sin(phi) * Math.cos(theta) * v
    sparks.velocity[i * 3 + 1] = Math.cos(phi) * v * 0.6 + lift
    sparks.velocity[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v
    sparks.color.set(color, i * 3)
    sparks.life[i] = 1
    sparks.decay[i] = 1 / (lifetime * (0.6 + Math.random() * 0.6))
  }
  sparks.alive = 1
}

/** Advances the pool; returns whether anything is still alive. */
export function stepSparks(delta: number) {
  let alive = false
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparks.life[i] <= 0) continue
    sparks.life[i] = Math.max(0, sparks.life[i] - sparks.decay[i] * delta)
    const drag = Math.exp(-2.2 * delta)
    for (let k = 0; k < 3; k++) {
      sparks.velocity[i * 3 + k] *= drag
      sparks.position[i * 3 + k] += sparks.velocity[i * 3 + k] * delta
    }
    sparks.velocity[i * 3 + 1] -= 0.6 * delta
    if (sparks.life[i] > 0) alive = true
  }
  return alive
}
