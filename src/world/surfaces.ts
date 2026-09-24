/**
 * Runtime registries for walkable surfaces and flight colliders added by world features
 * (islands, bridges, pillar tops, large props). Systems register on mount and unregister on unmount.
 */
export type Vec3 = readonly [number, number, number]

/** Flat walkable disc, e.g. an island or pillar top. */
export interface WalkableDisc { kind: 'disc'; x: number; z: number; y: number; radius: number }
/** Walkable strip between two points whose deck sags by `sag` metres at mid-span (plank bridge). */
export interface WalkableSpan { kind: 'span'; from: Vec3; to: Vec3; halfWidth: number; sag: number }
export type WalkableSurface = WalkableDisc | WalkableSpan

/** Solid volume flight cannot enter. Cylinders are vertical. */
export interface CylinderCollider { kind: 'cylinder'; x: number; z: number; radius: number; minY: number; maxY: number }
export interface BoxCollider { kind: 'box'; min: Vec3; max: Vec3 }
export type Collider = CylinderCollider | BoxCollider

const walkables = new Set<WalkableSurface>()
const colliders = new Set<Collider>()

export function registerWalkables(list: WalkableSurface[]) {
  list.forEach((surface) => walkables.add(surface))
  return () => list.forEach((surface) => walkables.delete(surface))
}

export function registerColliders(list: Collider[]) {
  list.forEach((collider) => colliders.add(collider))
  return () => list.forEach((collider) => colliders.delete(collider))
}

function surfaceY(surface: WalkableSurface, x: number, z: number): number | null {
  if (surface.kind === 'disc') return Math.hypot(x - surface.x, z - surface.z) <= surface.radius ? surface.y : null
  const [ax, ay, az] = surface.from, [bx, by, bz] = surface.to
  const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz
  const t = ((x - ax) * dx + (z - az) * dz) / lengthSq
  if (t < 0 || t > 1) return null
  const side = Math.abs((x - ax) * dz - (z - az) * dx) / Math.sqrt(lengthSq)
  if (side > surface.halfWidth) return null
  return ay + (by - ay) * t - surface.sag * 4 * t * (1 - t)
}

/**
 * Highest registered surface under (x, z) that a body at height `fromY` can stand on:
 * surfaces more than 1 m above it (e.g. an island overhead) are ignored.
 */
export function walkableHeight(x: number, z: number, fromY = Infinity): number | null {
  let best: number | null = null
  for (const surface of walkables) {
    const y = surfaceY(surface, x, z)
    if (y !== null && fromY >= y - 1 && (best === null || y > best)) best = y
  }
  return best
}

export function insideAnyCollider(x: number, y: number, z: number, margin = 1): boolean {
  for (const c of colliders) {
    if (c.kind === 'cylinder') {
      if (y >= c.minY - margin && y <= c.maxY + margin && Math.hypot(x - c.x, z - c.z) < c.radius + margin) return true
    } else if (x > c.min[0] - margin && x < c.max[0] + margin && y > c.min[1] - margin && y < c.max[1] + margin && z > c.min[2] - margin && z < c.max[2] + margin) return true
  }
  return false
}

/** Debug / verification view of what is registered. */
export function surfaceStats() {
  return { walkables: [...walkables], colliders: [...colliders] }
}
