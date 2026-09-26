import { TERRAIN, terrainHeight } from './environment/t02r/terrain'
import { walkableHeight } from './surfaces'

export const LAYOUT = {
  spawn: { position: [0, 0, 150] as const, size: [30, 24] as const },
  road: { width: 16, fromZ: 162, toZ: 20 },
  gate: { position: [0, 0, 55] as const, rotation: [0, Math.PI / 2, 0] as const },
  stairs: { startZ: 20, endZ: -65, height: 24, width: 18, steps: 96 },
  platform: { frontZ: -65, backZ: -515, width: 380, height: 24, slabDepth: 12 },
  main: { position: [0, 24, -320] as const, rotation: [0, 0, 0] as const },
  mainCollider: { halfWidth: 136, halfDepth: 147, minY: 24, maxY: 446 },
  towers: [
    { position: [-200, 24, -170] as const, rotation: [0, 0.22, 0] as const, scaleMultiplier: 1 },
    { position: [200, 24, -185] as const, rotation: [0, -0.19, 0] as const, scaleMultiplier: 0.96 },
    { position: [-242, 34, -295] as const, rotation: [0, 0.44, 0] as const, scaleMultiplier: 0.78 },
    { position: [238, 29, -330] as const, rotation: [0, -0.3, 0] as const, scaleMultiplier: 0.85 },
    { position: [-273, 48, -425] as const, rotation: [0, 0.62, 0] as const, scaleMultiplier: 0.68 },
    { position: [268, 42, -465] as const, rotation: [0, -0.55, 0] as const, scaleMultiplier: 0.72 },
  ],
  player: { height: 1.75, walkSpeed: 3.2, runSpeed: 7, flightSpeed: 30, flightBoostSpeed: 70, gravity: 28 },
  worldLimit: 1100,
} as const

/**
 * Walkable surface height under (x, z), or null where there is none. `fromY` is the querying body's
 * height: registered surfaces (islands, bridges) more than 1 m above it are ignored, so flying under an
 * island never snaps onto its top.
 */
export function groundHeight(x: number, z: number, fromY = Infinity): number | null {
  const base = layoutGroundHeight(x, z)
  const extra = walkableHeight(x, z, fromY)
  return extra === null ? base : base === null ? extra : Math.max(base, extra)
}

function layoutGroundHeight(x: number, z: number): number | null {
  const { spawn, road, stairs, platform } = LAYOUT
  if (insideMainFootprint(x, z)) return null
  if (Math.abs(x) <= spawn.size[0] / 2 && z >= 138 && z <= 162) return 0
  if (Math.abs(x) <= road.width / 2 && z >= stairs.startZ && z <= road.fromZ) return 0
  if (Math.abs(x) <= stairs.width / 2 && z <= stairs.startZ && z >= stairs.endZ) {
    return ((stairs.startZ - z) / (stairs.startZ - stairs.endZ)) * stairs.height
  }
  if (Math.abs(x) <= platform.width / 2 && z <= platform.frontZ && z >= platform.backZ) return platform.height
  return naturalGround(x, z)
}

/** Natural ground is walkable down to just above the cloud tops; below that there is nothing to stand on. */
const TERRAIN_WALK_FLOOR = -60

function naturalGround(x: number, z: number): number | null {
  if (x < TERRAIN.minX || x > TERRAIN.maxX || z < TERRAIN.minZ || z > TERRAIN.maxZ || insideTowerFootprint(x, z)) return null
  const h = terrainHeight(x, z)
  return h >= TERRAIN_WALK_FLOOR ? h : null
}

/**
 * Downhill gradient of the natural ground under (x, z), or null where a road, slab or structure is underfoot
 * (those edges are steps, not slopes). `out` receives the horizontal fall-line direction scaled by rise/run.
 */
export function terrainGradient(x: number, z: number, fromY = Infinity, out = { x: 0, z: 0 }) {
  const h = naturalGround(x, z)
  if (h === null || layoutGroundHeight(x, z) !== h || groundHeight(x, z, fromY) !== h) return null
  const e = 0.5
  out.x = (terrainHeight(x - e, z) - terrainHeight(x + e, z)) / (2 * e)
  out.z = (terrainHeight(x, z - e) - terrainHeight(x, z + e)) / (2 * e)
  return out
}

/** Slope in degrees of the natural ground under (x, z); 0 on roads, slabs and structures. */
export function terrainSlope(x: number, z: number, fromY = Infinity) {
  const g = terrainGradient(x, z, fromY)
  return g ? Math.atan(Math.hypot(g.x, g.z)) * 180 / Math.PI : 0
}

/** The six side towers stand on rotated square footings (see towerFootings in scatter.ts). */
function insideTowerFootprint(x: number, z: number): boolean {
  for (const { position: [px, , pz], rotation: [, ry], scaleMultiplier: m } of LAYOUT.towers) {
    const dx = x - px, dz = z - pz, c = Math.cos(ry), s = Math.sin(ry)
    if (Math.abs(dx * c - dz * s) < (48.8 * m + 4) / 2 + 0.6 && Math.abs(dx * s + dz * c) < (49.4 * m + 4) / 2 + 0.6) return true
  }
  return false
}

export function insideMainFootprint(x: number, z: number): boolean {
  return Math.abs(x - LAYOUT.main.position[0]) < LAYOUT.mainCollider.halfWidth &&
    Math.abs(z - LAYOUT.main.position[2]) < LAYOUT.mainCollider.halfDepth
}

export function insideMainCollider(x: number, y: number, z: number): boolean {
  return insideMainFootprint(x, z) && y >= LAYOUT.mainCollider.minY - 1 && y <= LAYOUT.mainCollider.maxY + 1
}
