import { hash } from '../environment/t02r/terrain'
import { BRIDGES, ISLANDS, PILLAR_BASE_Y, PILLARS } from '../sites'
import type { IslandSite, PillarSite } from '../sites'
import type { CylinderCollider, Vec3, WalkableDisc } from '../surfaces'
import { ISLAND_META, PILLAR_META } from './rockMeta'
import type { PillarMeta } from './rockMeta'

/**
 * Where each authored Blender rock (rockMeta.ts) stands in the world. The renderer (RockField), the
 * walkable / collider registry and everything set on the rock (props, orbs, waterfalls, bridge heads)
 * all read it, so they agree before the GLBs have loaded.
 *
 * A placement maps asset space to world space: horizontal scale `sxz`, yaw about +Y, vertical scale `sy`,
 * and below the asset height `stretchBelow` a pillar's shaft is stretched down to the bedrock so no base
 * floats in a cloud rift.
 */
export interface RockPlacement {
  /** Index into PILLAR_META or ISLAND_META. */
  variant: number
  x: number; y: number; z: number
  yaw: number; sxz: number; sy: number
  stretchBelow: number
}

const TAU = Math.PI * 2
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** Pillar bases sink at least this deep into the cloud sea before a model is stretched to fit its site. */
const HIDDEN_Y = -230
/** Below this height a pillar's shaft is stretched down to PILLAR_BASE_Y. */
const CUT_Y = -150
/** Most a pillar may be stretched vertically relative to its width. */
const MAX_STRETCH = 1.5
/** Ledges below this sit in the damp cloud tops: not worth landing on, and no walk floor there. */
const LEDGE_MIN_Y = -60

export function rockY(pl: RockPlacement, ly: number) {
  if (ly >= pl.stretchBelow) return pl.y + ly * pl.sy
  const cut = pl.y + pl.stretchBelow * pl.sy
  return PILLAR_BASE_Y + (cut - PILLAR_BASE_Y) * (ly / pl.stretchBelow)
}

/** Vertical scale at asset height `ly` (the stretched base is taller than `sy`). */
export function rockScaleY(pl: RockPlacement, ly: number) {
  return ly >= pl.stretchBelow ? pl.sy : (pl.y + pl.stretchBelow * pl.sy - PILLAR_BASE_Y) / pl.stretchBelow
}

export function toWorld(pl: RockPlacement, lx: number, ly: number, lz: number, out: [number, number, number] = [0, 0, 0]) {
  const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw), x = lx * pl.sxz, z = lz * pl.sxz
  out[0] = pl.x + c * x + s * z
  out[1] = rockY(pl, ly)
  out[2] = pl.z - s * x + c * z
  return out
}

// ── Pillars ──────────────────────────────────────────────────────────────────────────────────────────

function fitPillar(site: PillarSite, m: PillarMeta) {
  const sxz = site.radius / m.radius, sy = Math.max(sxz, (site.topY - HIDDEN_Y) / m.height)
  return { sxz, sy, stretch: sy / sxz }
}

/** Each site takes a model that fits without stretching past MAX_STRETCH, never the same as its predecessor. */
function placePillars(): RockPlacement[] {
  const out: RockPlacement[] = []
  PILLARS.forEach((site, i) => {
    const fits = PILLAR_META.map((m) => fitPillar(site, m))
    const ok = fits.map((_, v) => v).filter((v) => fits[v].stretch <= MAX_STRETCH && v !== out[i - 1]?.variant)
    const variant = ok.length ? ok[Math.floor(hash(i, 1, 910) * ok.length)] : fits.reduce((best, f, v) => (f.stretch < fits[best].stretch ? v : best), 0)
    const { sxz, sy } = fits[variant], y = site.topY - PILLAR_META[variant].height * sy
    out.push({ variant, x: site.x, y, z: site.z, yaw: hash(i, 2, 911) * TAU, sxz, sy, stretchBelow: y < PILLAR_BASE_Y ? -Infinity : (CUT_Y - y) / sy })
  })
  return out
}

export const PILLAR_PLACEMENTS: RockPlacement[] = placePillars()

export interface Ledge { pillar: number; x: number; y: number; z: number; radius: number }

/** Flat shelves and tops worth standing on (world metres), per pillar. */
export const PILLAR_LEDGES: Ledge[] = PILLAR_PLACEMENTS.flatMap((pl, pillar) => PILLAR_META[pl.variant].ledges.flatMap(([lx, ly, lz, r]) => {
  const [x, y, z] = toWorld(pl, lx, ly, lz), radius = r * pl.sxz * 0.8
  return y > LEDGE_MIN_Y && radius >= 1.5 ? [{ pillar, x, y, z, radius }] : []
}))

/** Highest point of each pillar. */
export const PILLAR_SUMMITS: Vec3[] = PILLAR_PLACEMENTS.map((pl) => toWorld(pl, ...PILLAR_META[pl.variant].summit))

/**
 * Flight colliders up each shaft: per cross-section band, the circles that cover its solid rock (rockMeta).
 * Around each ledge a circle shrinks so that a body on the ledge (and hovering just above it) is clear, or the
 * sword could neither land nor lift off.
 */
export function pillarColliders(pl: RockPlacement, index: number): CylinderCollider[] {
  const m = PILLAR_META[pl.variant], site = PILLARS[index], out: CylinderCollider[] = []
  const ledges = PILLAR_LEDGES.filter((l) => l.pillar === index)
  m.profile.forEach(([f, circles], b) => {
    const lo = b === 0 ? PILLAR_BASE_Y : rockY(pl, f * m.height)
    const hi = b === m.profile.length - 1 ? site.topY : rockY(pl, m.profile[b + 1][0] * m.height)
    const cuts = [lo, hi, ...ledges.flatMap((l) => [l.y - 2, l.y + 5])].filter((y) => y >= lo && y <= hi).sort((a, c) => a - c)
    for (const [cx, cz, r] of circles) {
      const [x, , z] = toWorld(pl, cx, 0, cz)
      for (let k = 0; k < cuts.length - 1; k++) {
        const minY = cuts[k], maxY = cuts[k + 1]
        if (maxY - minY < 1e-3) continue
        let radius = r * pl.sxz * 0.95
        for (const l of ledges) if (l.y + 5 > minY && l.y - 2 < maxY) radius = Math.min(radius, Math.hypot(l.x - x, l.z - z) - l.radius - 1.5)
        if (radius < 1) continue
        const last = out[out.length - 1]
        if (last && last.x === x && last.z === z && last.radius === radius && Math.abs(last.maxY - minY) < 1e-3) last.maxY = maxY
        else out.push({ kind: 'cylinder', x, z, radius, minY, maxY })
      }
    }
  })
  return out
}

// ── Islands ──────────────────────────────────────────────────────────────────────────────────────────

/** Model per island; the biggest, deepest one carries 天池's great waterfall. */
const ISLAND_VARIANT: Record<string, number> = {
  isle_west: 0, isle_east: 1, isle_northwest: 3, isle_star: 2, isle_front_left: 1, isle_front_right: 0, isle_sky: 3, isle_chained: 3,
}
const RIM_BINS = 48

/** Rim bin whose neighbourhood reaches out least: the bridge lands there, over the least rough top. */
function narrowestBin(rim: number[]) {
  let best = 0, bestR = Infinity
  for (let b = 0; b < rim.length; b++) {
    const r = Math.max(rim[(b + rim.length - 1) % rim.length], rim[b], rim[(b + 1) % rim.length])
    if (r < bestR) { bestR = r; best = b }
  }
  return best
}

/**
 * Scaled so the narrowest rim sits 5 m outside the walkable pad (the top is flattened out to it), turned so
 * a bridged island meets its bridge with that narrowest side.
 */
function placeIsland(isle: IslandSite, i: number): RockPlacement {
  const variant = ISLAND_VARIANT[isle.id] ?? i % ISLAND_META.length, m = ISLAND_META[variant]
  const s = (isle.padRadius + 5) / Math.min(...m.rim), [x, T, z] = isle.top
  const bridge = BRIDGES.find((b) => b.island === isle.id)
  let yaw = hash(i, 3, 912) * TAU
  if (bridge) yaw = ((narrowestBin(m.rim) + 0.5) / RIM_BINS) * TAU - Math.atan2(bridge.from[2] - z, bridge.from[0] - x)
  return { variant, x, y: T - m.top * s, z, yaw, sxz: s, sy: s, stretchBelow: -Infinity }
}

export const ISLAND_PLACEMENTS: RockPlacement[] = ISLANDS.map(placeIsland)

/** Rim bins covered by an edge `halfWidth` metres either side of a world bearing. */
function rimBins(isle: IslandSite, worldBearing: number, halfWidth: number) {
  const pl = ISLAND_PLACEMENTS[ISLANDS.indexOf(isle)], m = ISLAND_META[pl.variant]
  // A local bearing turns to world bearing − yaw, so the local bearing of a world one is bearing + yaw.
  const u = (((worldBearing + pl.yaw) / TAU) % 1 + 1) % 1, bin = Math.min(RIM_BINS - 1, Math.floor(u * RIM_BINS))
  const spread = Math.ceil(halfWidth / (m.rim[bin] * pl.sxz) / (TAU / RIM_BINS)), bins: number[] = []
  for (let k = -spread; k <= spread; k++) bins.push((bin + k + RIM_BINS) % RIM_BINS)
  return { pl, m, bins, rim: Math.min(...bins.map((b) => m.rim[b])) }
}

/**
 * World radius of an island's top edge along a world bearing (0 = +x, π/2 = +z): the nearest edge across
 * `halfWidth` metres either side, so nothing that wide set there overhangs it.
 */
export function islandRim(isle: IslandSite, worldBearing: number, halfWidth = 0) {
  const { pl, rim } = rimBins(isle, worldBearing, halfWidth)
  return rim * pl.sxz
}

/**
 * How far an island top at distance `d` from the centre is pulled to the pad height: fully to the pad
 * edge + 2 m, easing back to the sculpted surface by + 5 m (where the narrowest rim sits).
 */
export function padFlatten(isle: IslandSite, d: number) {
  return 1 - smooth(isle.padRadius + 2, isle.padRadius + 5, d)
}

/**
 * Where the (flattened) top stands just inside the edge along a world bearing: world radius (nearest across
 * `halfWidth`) and height (highest across it, so a sheet set there clears the rock).
 */
export function islandLip(isle: IslandSite, worldBearing: number, halfWidth = 0) {
  const { pl, m, bins, rim } = rimBins(isle, worldBearing, halfWidth), T = isle.top[1]
  const radius = (rim - 1.5) * pl.sxz
  let y = rockY(pl, Math.max(...bins.map((b) => m.lip[b])))
  if (y > T - 3) y += (T - y) * padFlatten(isle, radius)
  return { radius, y }
}

function islandColliders(isle: IslandSite, pl: RockPlacement): CylinderCollider[] {
  const m = ISLAND_META[pl.variant]
  return m.profile.map(([f, cx, cz, r], b) => {
    const [x, , z] = toWorld(pl, cx, 0, cz), next = m.profile[b + 1]?.[0] ?? 1
    return { kind: 'cylinder' as const, x, z, radius: r * pl.sxz * 0.88, minY: rockY(pl, -next * m.depth), maxY: b === 0 ? isle.top[1] - 0.5 : rockY(pl, -f * m.depth) }
  })
}

/** Walkable ledges and pads plus the flight colliders of every pillar and island. */
export function rockSurfaces() {
  const walkables: WalkableDisc[] = [], colliders: CylinderCollider[] = []
  for (const l of PILLAR_LEDGES) walkables.push({ kind: 'disc', x: l.x, z: l.z, y: l.y, radius: l.radius })
  PILLAR_PLACEMENTS.forEach((pl, i) => colliders.push(...pillarColliders(pl, i)))
  ISLANDS.forEach((isle, i) => {
    walkables.push({ kind: 'disc', x: isle.top[0], z: isle.top[2], y: isle.top[1], radius: isle.padRadius })
    colliders.push(...islandColliders(isle, ISLAND_PLACEMENTS[i]))
  })
  return { walkables, colliders }
}
