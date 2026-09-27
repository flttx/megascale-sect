/**
 * Runtime registries for walkable surfaces and flight colliders added by world features
 * (islands, bridges, pillar tops, large props). Systems register on mount and unregister on unmount.
 */
export type Vec3 = readonly [number, number, number]

/** Flat walkable disc, e.g. an island or pillar top. */
export interface WalkableDisc { kind: 'disc'; x: number; z: number; y: number; radius: number }
/** Walkable strip between two points whose deck sags by `sag` metres at mid-span (plank bridge). */
export interface WalkableSpan { kind: 'span'; from: Vec3; to: Vec3; halfWidth: number; sag: number }
export interface SurfaceAddress { triangle: number; u: number; v: number }
export interface SurfaceHit { y: number; normal: Vec3; normalY: number; surfaceId: string; anchor?: SurfaceAddress }
export interface WalkableMoving { kind: 'moving'; hitAt(x: number, z: number, fromY: number): SurfaceHit | null }
export type WalkableSurface = WalkableDisc | WalkableSpan | WalkableMoving

/**
 * Solid volume flight cannot enter. Cylinders are vertical; an `open` one only loosely wraps something thin (a chain),
 * so flight keeps clear of it while walking and the camera pass through.
 */
export interface CylinderCollider { kind: 'cylinder'; x: number; z: number; radius: number; minY: number; maxY: number; open?: boolean }
export interface BoxCollider { kind: 'box'; min: Vec3; max: Vec3 }
export type Collider = CylinderCollider | BoxCollider

const walkables = new Set<WalkableSurface>()
const colliders = new Set<Collider>()

/** Colliders bucketed by xz cell (CELL m, bounds grown by MAX_MARGIN), rebuilt lazily after any (un)registration. */
const CELL = 32, MAX_MARGIN = 2
let grid: Map<number, Collider[]> | null = null
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)

function colliderGrid() {
  if (grid) return grid
  grid = new Map()
  for (const c of colliders) {
    const [x0, z0, x1, z1] = c.kind === 'cylinder' ? [c.x - c.radius, c.z - c.radius, c.x + c.radius, c.z + c.radius] : [c.min[0], c.min[2], c.max[0], c.max[2]]
    for (let i = Math.floor((x0 - MAX_MARGIN) / CELL); i <= Math.floor((x1 + MAX_MARGIN) / CELL); i++) {
      for (let j = Math.floor((z0 - MAX_MARGIN) / CELL); j <= Math.floor((z1 + MAX_MARGIN) / CELL); j++) {
        const key = cellKey(i, j), list = grid.get(key)
        if (list) list.push(c); else grid.set(key, [c])
      }
    }
  }
  return grid
}
const NONE: Collider[] = []
const collidersNear = (x: number, z: number) => colliderGrid().get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NONE

export function registerWalkables(list: WalkableSurface[]) {
  list.forEach((surface) => walkables.add(surface))
  return () => list.forEach((surface) => walkables.delete(surface))
}

export function registerColliders(list: Collider[]) {
  list.forEach((collider) => colliders.add(collider))
  grid = null
  return () => { list.forEach((collider) => colliders.delete(collider)); grid = null }
}

function surfaceY(surface: WalkableDisc | WalkableSpan, x: number, z: number): number | null {
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
  return walkableHit(x, z, fromY)?.y ?? null
}
export function walkableHit(x: number, z: number, fromY = Infinity): SurfaceHit | null {
  let best: SurfaceHit | null = null
  for (const surface of walkables) {
    const hit = surface.kind === 'moving' ? surface.hitAt(x, z, fromY) : null
    const y = surface.kind === 'moving' ? hit?.y ?? null : surfaceY(surface, x, z)
    if (y !== null && fromY >= y - 1 && (best === null || y > best.y)) best = hit ?? { y, normal: [0, 1, 0], normalY: 1, surfaceId: 'static' }
  }
  return best
}

/** Whether a point is inside a collider grown by `margin` (≤ 2 m) on every side; `open` colliders count only with `open`. */
export function insideAnyCollider(x: number, y: number, z: number, margin = 1, open = false): boolean {
  return bodyInsideAnyCollider(x, y, y, z, margin, margin, open)
}

/**
 * Whether a vertical body from `bottom` to `top` at (x, z), `radius` wide, overlaps a collider (each grown by
 * `vertical` above and below). Walking tests the torso with no vertical margin, so a rock or pillar top the
 * player stands on never blocks them.
 */
export function bodyInsideAnyCollider(x: number, bottom: number, top: number, z: number, radius: number, vertical = 0, open = false): boolean {
  for (const c of collidersNear(x, z)) {
    if (c.kind === 'cylinder') {
      if ((open || !c.open) && top >= c.minY - vertical && bottom <= c.maxY + vertical && Math.hypot(x - c.x, z - c.z) < c.radius + radius) return true
    } else if (x > c.min[0] - radius && x < c.max[0] + radius && top > c.min[1] - vertical && bottom < c.max[1] + vertical && z > c.min[2] - radius && z < c.max[2] + radius) return true
  }
  return false
}

/** Debug / verification view of what is registered. */
export function surfaceStats() {
  return { walkables: [...walkables], colliders: [...colliders] }
}
