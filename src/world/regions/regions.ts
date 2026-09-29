import { Float32BufferAttribute } from 'three'
import {
  TERRAIN, TERRAIN_BASE, clamp, coordinates, heightMesh, karstPeak, noise, rectDistance, ridged, smax, smin, smooth, surfaceMask,
  terrainHeight,
} from '../environment/t02r/terrain'

/**
 * The four outer regions around the sect's summit (R10). Each is an analytic height field over its own box, so the
 * boxes never overlap each other or the core terrain; between them the ground stays under the cloud sea. The boxes
 * reach past the flight bounds (LAYOUT.world) so the back ranges are whole; each falls to the outer ground at its
 * edges, where neighbouring boxes meet seamlessly.
 */
export type RegionId = 'north' | 'east' | 'west' | 'south'
export interface RegionBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface RegionSpec {
  id: RegionId
  /** Map / notice name (Chinese source string; translated through i18n). */
  name: string
  bounds: RegionBounds
  /** Centre of the region's landmark, used by the map and the region notices. */
  center: [number, number]
  /** Grid refinement tiers [from, to, step] for x and z; `coarse` elsewhere. */
  xs: [number, number, number][]; zs: [number, number, number][]; coarse: number
}

export const REGIONS: RegionSpec[] = [
  {
    id: 'north', name: '玄穹峰', bounds: { minX: -1300, maxX: 1300, minZ: -3800, maxZ: -1300 }, center: [0, -2150],
    xs: [[-1200, 1200, 10], [-420, 420, 6]], zs: [[-3400, -1500, 10], [-2560, -1740, 6]], coarse: 20,
  },
  {
    id: 'east', name: '龙脊岭', bounds: { minX: 1300, maxX: 3500, minZ: -3800, maxZ: 900 }, center: [2200, -420],
    xs: [[1400, 3000, 10], [1930, 2470, 6]], zs: [[-3000, 850, 10], [-690, -150, 6]], coarse: 20,
  },
  {
    id: 'west', name: '万剑冢', bounds: { minX: -3500, maxX: -1300, minZ: -3800, maxZ: 900 }, center: [-2200, -450],
    xs: [[-3000, -1400, 10], [-2720, -1680, 6]], zs: [[-3000, 850, 10], [-980, 80, 6]], coarse: 20,
  },
  {
    id: 'south', name: '归墟云海', bounds: { minX: -3500, maxX: 3500, minZ: 900, maxZ: 3200 }, center: [0, 2450],
    xs: [[-2800, 2800, 12], [-260, 260, 6]], zs: [[950, 2800, 12], [2250, 2680, 6]], coarse: 24,
  },
]

const inside = (b: RegionBounds, x: number, z: number) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ

/** Outer ground under the cloud sea, with the same character as the core's. */
function outerGround(x: number, z: number) {
  return TERRAIN_BASE + noise(x / 260, z / 260, 17) * 28 + ridged(x / 180, z / 180, 19, 2) * 26
}

/**
 * A flat-topped mesa with a lobed rim, fluted cliffs and bedding ledges, falling to the outer ground.
 * `top` is the walkable height at its centre; the top stays within ~1 m of it out to 0.8 × radius.
 */
export function mesa(x: number, z: number, cx: number, cz: number, radius: number, top: number, seed: number) {
  const dx = x - cx, dz = z - cz, distance = Math.hypot(dx, dz)
  if (distance > radius * 1.9) return -Infinity
  const c = distance > 1e-3 ? dx / distance : 1, sn = distance > 1e-3 ? dz / distance : 0
  const lobes = noise(c * 1.5 + seed * 7, sn * 1.5, 131) * 0.24 + noise(c * 3.9 + seed * 7, sn * 3.9, 137) * 0.1
  const rim = radius * (1 + lobes)
  const flute = (ridged(x / 23, z / 23, 139 + seed, 2) - 0.45) * 12 * smooth(rim * 0.95, rim * 1.05, distance)
  const t = (distance + flute) / rim
  const fall = smooth(0.92, 1.3, t)
  const surface = top + noise(x / 70, z / 70, 141 + seed) * 1.2 * (1 - smooth(0.5, 0.8, t)) + noise(x / 90, z / 90, 143 + seed) * 6 * smooth(0.7, 0.92, t)
  const drop = (top - TERRAIN_BASE + 30) * fall
  let h = surface - drop
  // Bedding ledges, strongest mid-face.
  const step = 16 + noise(x / 200, z / 200, 147) * 4, k = h / step
  const terrace = (Math.floor(k) + smooth(0.3, 0.7, k - Math.floor(k))) * step
  h += (terrace - h) * 1.6 * fall * (1 - fall)
  return h
}

/** A serrated ridge along a segment: crest from `ha` to `hb`, flanks falling at `gradient`. */
function ridge(x: number, z: number, ax: number, az: number, bx: number, bz: number, ha: number, hb: number, gradient: number, seed: number) {
  const vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz)
  const along = ((x - ax) * vx + (z - az) * vz) / length
  const lateral = Math.abs(((x - ax) * vz - (z - az) * vx) / length)
  const beyond = Math.max(0, -along, along - length)
  const t = clamp(along / length)
  const relief = 140
  const base = ha + (hb - ha) * t
  if (base + relief - (lateral + beyond) * gradient * 0.7 < TERRAIN_BASE - 40) return -Infinity
  const crest = base + (ridged(along / 120, seed * 3.7, 151 + seed) - 0.5) * relief * (1 - 0.6 * smooth(0.85, 1, Math.abs(t * 2 - 1)))
  const flank = lateral + noise(along / 80, seed, 153) * 22 + (1 - Math.abs(noise(along / 41, lateral / 95, 155))) * 12
  return crest - Math.hypot(Math.max(0, flank), beyond) * gradient * (1 + 0.25 * noise(x / 110, z / 110, 157))
}

/** A sword cut: a straight trench `depth` m deep and `width` m across, scored across a mesa. */
function cut(h: number, x: number, z: number, ax: number, az: number, bx: number, bz: number, width: number, depth: number) {
  const vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz)
  const along = ((x - ax) * vx + (z - az) * vz) / length
  if (along < -width || along > length + width) return h
  const lateral = Math.abs(((x - ax) * vz - (z - az) * vx) / length) + noise(along / 30, 0, 161) * 3
  const ends = smooth(-width, width * 2, along) * (1 - smooth(length - width * 2, length + width, along))
  const floor = h - depth * ends
  // V-walled trench, its floor littered.
  const wall = smooth(width * 0.3, width * 0.5, lateral)
  return Math.min(h, floor + (h - floor) * wall + noise(x / 7, z / 7, 163) * 2 * (1 - wall))
}

// ---------- North · 玄穹峰: the seated sage's terrace, walled by the highest peaks in the world ----------
/** Terrace the colossal sage sits on (walkable flat top). */
export const SAGE_TERRACE = { x: 0, z: -2150, radius: 300, top: 150 }
// [x, z, radius, summit]
const NORTH_PEAKS: [number, number, number, number][] = [
  [0, -2760, 300, 960], [-430, -2560, 190, 700], [440, -2600, 210, 780], [-860, -2780, 250, 640], [880, -2840, 260, 720],
  [-250, -3060, 230, 830], [310, -3100, 240, 880], [-1140, -2420, 170, 430], [1150, -2480, 180, 470], [-620, -3150, 200, 590],
  [660, -3160, 200, 640], [-760, -2000, 90, 260], [790, -1960, 100, 300], [-420, -1760, 70, 140], [460, -1700, 64, 120],
]
function northHeight(x: number, z: number) {
  let h = outerGround(x, z)
  h = smax(h, mesa(x, z, SAGE_TERRACE.x, SAGE_TERRACE.z, SAGE_TERRACE.radius, SAGE_TERRACE.top, 1), 30)
  // Saddles from the terrace's back corners up into the flanking peaks.
  h = smax(h, ridge(x, z, -150, -2330, -400, -2540, SAGE_TERRACE.top - 10, 480, 1.35, 1), 40)
  h = smax(h, ridge(x, z, 160, -2340, 420, -2580, SAGE_TERRACE.top - 10, 520, 1.35, 2), 40)
  h = smax(h, ridge(x, z, 0, -2380, 0, -2700, SAGE_TERRACE.top + 20, 700, 1.4, 3), 40)
  h = smax(h, ridge(x, z, -500, -2600, -1100, -2400, 520, 260, 1.3, 4), 40)
  h = smax(h, ridge(x, z, 520, -2640, 1120, -2460, 560, 280, 1.3, 5), 40)
  NORTH_PEAKS.forEach(([cx, cz, r, s], i) => { h = smax(h, karstPeak(x, z, cx, cz, r, s, 20 + i), 45) })
  return h
}

// ---------- East · 龙脊岭: a serrated spine with the dragon column on its central mesa ----------
export const DRAGON_MESA = { x: 2200, z: -420, radius: 200, top: 210 }
const EAST_SPINE: [number, number][] = [[1880, -2500], [2050, -1650], [2230, -900], [2260, -420], [2380, 200], [2520, 760]]
const EAST_SPINE_HEIGHT = [380, 560, 470, DRAGON_MESA.top, 520, 300]
const EAST_PEAKS: [number, number, number, number][] = [
  [1860, -1250, 120, 500], [2520, -960, 140, 580], [2680, 180, 130, 520], [1980, 380, 110, 380], [1640, -330, 90, 270],
  [2800, -340, 120, 440], [2150, -2250, 170, 640], [2640, -2700, 200, 700], [1700, -2900, 160, 520], [2860, -1700, 150, 460],
]
function eastHeight(x: number, z: number) {
  let h = outerGround(x, z)
  for (let i = 0; i < EAST_SPINE.length - 1; i++) {
    const [ax, az] = EAST_SPINE[i], [bx, bz] = EAST_SPINE[i + 1]
    h = smax(h, ridge(x, z, ax, az, bx, bz, EAST_SPINE_HEIGHT[i], EAST_SPINE_HEIGHT[i + 1], 1.55, 10 + i), 50)
  }
  h = smax(h, mesa(x, z, DRAGON_MESA.x, DRAGON_MESA.z, DRAGON_MESA.radius, DRAGON_MESA.top, 2), 25)
  EAST_PEAKS.forEach(([cx, cz, r, s], i) => { h = smax(h, karstPeak(x, z, cx, cz, r, s, 40 + i), 45) })
  // The mesa's flat top wins over the spine and the peak flanks.
  const d = Math.hypot(x - DRAGON_MESA.x, z - DRAGON_MESA.z)
  h += (DRAGON_MESA.top + noise(x / 70, z / 70, 171) * 1.2 - h) * (1 - smooth(DRAGON_MESA.radius * 0.72, DRAGON_MESA.radius * 0.9, d))
  return h
}

// ---------- West · 万剑冢: a broken plateau scored by sword cuts, bristling with fallen blades ----------
export const SWORD_MESA = { x: -2200, z: -450, radius: 470, top: 140 }
const WEST_MESAS: [number, number, number, number][] = [
  [-1760, 380, 200, 40], [-2720, -1250, 230, 160], [-1640, -1320, 170, 110], [-2760, 520, 180, 70], [-2300, -2300, 260, 240],
  [-1700, -2600, 180, 180],
]
// [from x, z, to x, z, width, depth]
const SWORD_CUTS: [number, number, number, number, number, number][] = [
  [-2700, -700, -1760, -260, 84, 180], [-2480, 60, -1940, -1000, 64, 150], [-2620, -150, -2050, 120, 40, 100],
]
const WEST_PEAKS: [number, number, number, number][] = [[-2750, -2800, 220, 620], [-1900, -3050, 190, 520], [-2900, -1900, 150, 420]]
function westHeight(x: number, z: number) {
  let h = outerGround(x, z)
  h = smax(h, mesa(x, z, SWORD_MESA.x, SWORD_MESA.z, SWORD_MESA.radius, SWORD_MESA.top, 3), 30)
  WEST_MESAS.forEach(([cx, cz, r, t], i) => { h = smax(h, mesa(x, z, cx, cz, r, t, 4 + i), 30) })
  WEST_PEAKS.forEach(([cx, cz, r, s], i) => { h = smax(h, karstPeak(x, z, cx, cz, r, s, 60 + i), 45) })
  for (const [ax, az, bx, bz, w, d] of SWORD_CUTS) h = cut(h, x, z, ax, az, bx, bz, w, d)
  return h
}

// ---------- South · 归墟云海: open cloud sea, a few sea stacks and the southern heavenly gate ----------
export const GATE_ISLE = { x: 0, z: 2460, radius: 170, top: 60 }
const SOUTH_STACKS: [number, number, number, number][] = [
  [-1180, 1080, 90, 150], [-560, 1100, 70, 80], [880, 1050, 85, 170], [1500, 1500, 110, 260], [-1560, 1900, 120, 290],
  [-480, 2600, 80, 110], [520, 2560, 90, 140], [1350, 2380, 100, 210], [-1250, 2450, 110, 190], [2300, 1500, 150, 380],
  [-2300, 1600, 160, 420], [2500, 2350, 170, 330], [-2600, 2300, 160, 350], [-900, 1750, 60, 40], [950, 1900, 70, 70],
  [0, 3050, 150, 260], [-1900, 2950, 170, 300], [1900, 3000, 180, 340], [2900, 1200, 150, 300], [-2900, 1100, 150, 280],
]
function southHeight(x: number, z: number) {
  let h = outerGround(x, z)
  h = smax(h, mesa(x, z, GATE_ISLE.x, GATE_ISLE.z, GATE_ISLE.radius, GATE_ISLE.top, 5), 25)
  SOUTH_STACKS.forEach(([cx, cz, r, s], i) => { h = smax(h, karstPeak(x, z, cx, cz, r, s, 80 + i), 40) })
  return h
}

const HEIGHT: Record<RegionId, (x: number, z: number) => number> = { north: northHeight, east: eastHeight, west: westHeight, south: southHeight }

/** The region whose box contains (x, z), if any. */
export function regionAt(x: number, z: number): RegionSpec | null {
  for (const r of REGIONS) if (inside(r.bounds, x, z)) return r
  return null
}

/** A region's ground, pulled down to the outer ground at its box edges so no cut face shows. */
function boxedHeight(r: RegionSpec, x: number, z: number) {
  const { minX, maxX, minZ, maxZ } = r.bounds
  const edge = Math.min(x - minX, maxX - x, z - minZ, maxZ - z)
  return smin(HEIGHT[r.id](x, z), outerGround(x, z) + edge * 2.6, 40)
}

/** Region ground under (x, z), or null outside every region box. */
export function regionHeight(x: number, z: number): number | null {
  const r = regionAt(x, z)
  return r ? boxedHeight(r, x, z) : null
}

/** Natural ground anywhere: the core terrain, a region, or the outer ground far under the clouds between them. */
export function worldTerrainHeight(x: number, z: number) {
  if (x >= TERRAIN.minX && x <= TERRAIN.maxX && z >= TERRAIN.minZ && z <= TERRAIN.maxZ) return terrainHeight(x, z)
  return regionHeight(x, z) ?? outerGround(x, z)
}

/** One height-field mesh per region, sharing the core terrain's material and surface mask. */
export function makeRegionTerrain(id: RegionId) {
  const spec = REGIONS.find((r) => r.id === id)!
  const { bounds: b } = spec
  const X = coordinates(b.minX, b.maxX, spec.xs, spec.coarse), Z = coordinates(b.minZ, b.maxZ, spec.zs, spec.coarse)
  const g = heightMesh(X, Z, (x, z) => boxedHeight(spec, x, z))
  g.setAttribute('surfaceMask', new Float32BufferAttribute(surfaceMask(X, Z, g.getAttribute('position').array, false), 2))
  g.computeBoundingSphere()
  return g
}

/** Distance (m) from (x, z) to the nearest region box, 0 inside one. For LOD and audio. */
export function regionDistance(id: RegionId, x: number, z: number) {
  const b = REGIONS.find((r) => r.id === id)!.bounds
  return rectDistance(x, z, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)
}
