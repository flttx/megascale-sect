import { buildingDistance, hash, noise, roadAt, roadDistance, slopeAt, terrainHeight } from '../environment/t02r/terrain'
import { towerFootings } from '../environment/t02r/scatter'
import { PILLAR_LEDGES } from '../landmarks/rockLayout'
import { BRIDGES, ISLANDS, siteClearance, yawToward } from '../sites'
import type { Vec3 } from '../surfaces'
import { LAYOUT } from '../worldLayout'
import { PROPS } from './propCatalog'
import type { PropId } from './propCatalog'

/**
 * Deterministic, authored-first prop layout. Every placement is a pure function of the shared layout
 * (sites, terrain), so all clients see the same world. `rank` 0 marks structural pieces kept on every
 * quality tier; decoration keeps `rank < density`.
 */
export interface Placement { x: number; y: number; z: number; yaw: number; scale: number; rank: number }

export interface PierBox { center: Vec3; size: Vec3 }

export interface PropLayout {
  props: Record<PropId, Placement[]>
  /** Masonry footings under the pailou's pillars where the valley falls away from the road. */
  piers: PierBox[]
  /** Pailou world transform (for colliders). */
  pailou: { x: number; y: number; z: number; scale: number }
}

const PLATFORM_Y = LAYOUT.platform.height
/** Pailou: scaled so its central opening (0.31 of the model width) clears the 18 m paved road. */
export const PAILOU_Z = 100
export const PAILOU_WIDTH = 60
/** Canopy radius per tree (m at scale 1): trunks may stand off the road but crowns must not overhang it. */
const CANOPY: Partial<Record<PropId, number>> = { pine_tall: 6.5, pine_guest: 9.3, pine_small: 2.9, bamboo: 3.2 }
const MAX_SLOPE: Partial<Record<PropId, number>> = { pine_tall: 32, pine_guest: 30, pine_small: 34, bamboo: 28, rock_moss: 40, rock_scholar: 36, spirit_crystal: 36 }
/** Rendered terrain is a 3–8 m grid of the analytic height; sinking bases hides interpolation gaps on slopes. */
const SINK: Partial<Record<PropId, number>> = { pine_tall: 0.7, pine_guest: 0.6, pine_small: 0.45, bamboo: 0.5, rock_moss: 0.35, rock_scholar: 0.25 }

const insidePlatform = (x: number, z: number, margin = 0) => Math.abs(x) < 190 + margin && z < -65 + margin && z > -515 - margin
const onStairs = (x: number, z: number, r: number) => z < 24 && z > -70 && Math.abs(x) < 9 + r + 3

function towerClear(x: number, z: number, r: number) {
  for (const t of towerFootings) if (Math.hypot(x - t.position[0], z - t.position[2]) < Math.hypot(t.width, t.depth) / 2 + r) return false
  return true
}
function mainClear(x: number, z: number, r: number) {
  const c = LAYOUT.mainCollider, [mx, , mz] = LAYOUT.main.position
  return Math.abs(x - mx) > c.halfWidth + r || Math.abs(z - mz) > c.halfDepth + r
}
function segmentDistance(px: number, pz: number, a: Vec3, b: Vec3) {
  const dx = b[0] - a[0], dz = b[2] - a[2], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[2]) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - a[0] - dx * t, pz - a[2] - dz * t)
}

export function buildPropLayout(): PropLayout {
  const props = Object.fromEntries(Object.keys(PROPS).map((id) => [id, [] as Placement[]])) as Record<PropId, Placement[]>
  const taken: { x: number; z: number; r: number }[] = []
  const free = (x: number, z: number, r: number) => taken.every((o) => Math.hypot(x - o.x, z - o.z) > (r + o.r) * 0.85)
  const add = (id: PropId, x: number, y: number, z: number, yaw: number, scale = 1, rank = 0) => {
    props[id].push({ x, y, z, yaw, scale: PROPS[id].scale * scale, rank })
    taken.push({ x, z, r: PROPS[id].radius * scale })
  }
  /** Road-edge ground: the 3 m shoulder ribbon (makeRoad(true)) sits slightly below the paving. */
  const roadsideY = (x: number, z: number) => {
    const road = roadAt(z), over = Math.abs(x - road.x) - road.width / 2
    return over <= 3 ? -0.055 - Math.max(0, over) * 0.04 : terrainHeight(x, z)
  }

  // ── Pilgrimage road: stone-lantern pairs every ~16 m, framing the pailou; a few tall lantern posts. ──
  for (const z of [148, 132, 114, 86, 70, 30]) {
    const road = roadAt(z), d = Math.max(11.5, road.width / 2 + 2.4)
    for (const side of [-1, 1]) {
      const x = road.x + side * d
      if (siteClearance(x, z) > 1.5) add('stone_lantern', x, roadsideY(x, z) - 0.04, z, yawToward([x, 0, z], [road.x, 0, z]), 1.15)
    }
  }
  // Arm (local −z) reaches over the road: right-hand posts yaw +π/2, left-hand −π/2.
  for (const [z, side] of [[124, -1], [78, 1], [42, -1]] as const) {
    const road = roadAt(z), x = road.x + side * (road.width / 2 + 1.9)
    if (siteClearance(x, z) > 2) add('lantern_post', x, roadsideY(x, z) - 0.04, z, side * Math.PI / 2, 1.1)
  }

  // ── Pailou spanning the road; width (model z) runs along world x, front (+x) toward the approach (+z). ──
  const pailouX = roadAt(PAILOU_Z).x, pScale = PAILOU_WIDTH / PROPS.pailou.scale
  add('pailou', pailouX, 0, PAILOU_Z, -Math.PI / 2, pScale)
  taken.pop() // its footprint is a thin 60 × 13 m slab, tested as a box below
  const nearPailou = (x: number, z: number, r: number) => Math.abs(z - PAILOU_Z) < 7 + r && Math.abs(x - pailouX) < PAILOU_WIDTH / 2 + 1 + r
  const piers: PierBox[] = []
  for (const [z0, z1] of [[0.146, 0.225], [0.364, 0.442]]) for (const side of [-1, 1]) {
    // yaw −π/2 maps model z → world −x and model x → world z.
    const cx = pailouX - side * (z0 + z1) / 2 * PAILOU_WIDTH, hw = (z1 - z0) / 2 * PAILOU_WIDTH, hd = 0.085 * PAILOU_WIDTH
    let low = Infinity
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) low = Math.min(low, terrainHeight(cx - hw + hw * i / 2, PAILOU_Z - hd + hd * j / 2))
    if (low > -0.3) continue
    const bottom = low - 2.5, top = 0.02
    piers.push({ center: [cx, (bottom + top) / 2, PAILOU_Z], size: [hw * 2, top - bottom, hd * 2] })
  }

  // ── Mountain gate: guardian lions face the approaching pilgrim, turned slightly toward the road. ──
  for (const side of [-1, 1]) {
    const x = side * 11, z = 62
    add('stone_lion', x, terrainHeight(x, z) - 0.05, z, yawToward([x, 0, z], [side * 4, 0, 120]), 1.3)
  }

  // ── Forecourt: great censer before the hall, lantern posts along the axis, welcoming pines. ──
  add('incense_burner', 0, PLATFORM_Y, -160, Math.PI / 2, 3.2)
  for (const z of [-84, -100, -116, -136, -152]) for (const side of [-1, 1]) {
    const x = side * 10.5
    if (siteClearance(x, z) > 1.5) add('lantern_post', x, PLATFORM_Y, z, side * Math.PI / 2, 1.2)
  }
  for (const side of [-1, 1]) {
    add('pine_guest', side * 44, PLATFORM_Y - 0.3, -80, side > 0 ? Math.PI : 0, 1.05)
    add('rock_scholar', side * 36, PLATFORM_Y - 0.1, -74, hash(side, 3) * 6.28, 1.3)
    add('rock_moss', side * 50, PLATFORM_Y - 0.2, -73, hash(side, 4) * 6.28, 0.8)
  }
  // Scholar-rock gardens off the lanes near the side towers.
  for (const [cx, cz, seed] of [[-150, -148, 1], [148, -164, 2]] as const) {
    add('pine_guest', cx, PLATFORM_Y - 0.3, cz, hash(seed, 9) * 6.28, 0.95)
    add('rock_scholar', cx + 8, PLATFORM_Y - 0.1, cz + 5, hash(seed, 10) * 6.28, 1.5)
    add('rock_scholar', cx - 6, PLATFORM_Y - 0.1, cz - 8, hash(seed, 11) * 6.28, 1.1)
    add('rock_moss', cx + 4, PLATFORM_Y - 0.2, cz - 9, hash(seed, 12) * 6.28, 0.9)
    add('pine_small', cx - 9, PLATFORM_Y - 0.2, cz + 6, hash(seed, 13) * 6.28, 1.2)
  }
  // Platform edges beside the hall: tall pines with rocks along the cliff lip.
  for (const [x, z, seed] of [[-176, -250, 5], [-174, -262, 6], [-177, -392, 7], [176, -270, 8], [174, -404, 9], [177, -416, 10]] as const) {
    if (!towerClear(x, z, 4) || siteClearance(x, z) < 3) continue
    add(seed % 3 ? 'pine_tall' : 'pine_small', x, PLATFORM_Y - 0.4, z, hash(seed, 14) * 6.28, seed % 3 ? 0.9 + hash(seed, 15) * 0.25 : 1.6, hash(seed, 16) * 0.3)
    add('rock_moss', x + 4 * Math.sign(x), PLATFORM_Y - 0.2, z + 6, hash(seed, 17) * 6.28, 0.8, hash(seed, 18) * 0.5)
  }

  // ── Pavilion on the back terrace, overlooking the eastern cloud sea. ──
  add('pavilion', 142, PLATFORM_Y, -497, yawToward([142, 0, -497], [900, 0, -600]), 1.1)
  add('pine_guest', 124, PLATFORM_Y - 0.3, -506, 2.1, 0.9)
  add('rock_scholar', 154, PLATFORM_Y - 0.1, -488, 0.6, 1.4)
  add('pine_tall', -158, PLATFORM_Y - 0.4, -510, 1.3, 1)
  add('rock_moss', -150, PLATFORM_Y - 0.2, -503, 2.2, 0.9)

  // ── Islands: pines at the rim, rocks, a lantern pair at the approach, crystals on the high isles. ──
  ISLANDS.forEach((isle, k) => {
    const [cx, cy, cz] = isle.top, bridge = BRIDGES.find((b) => b.island === isle.id)
    // The approach faces the bridge or, for unbridged isles, the main hall.
    const toward = bridge ? bridge.from : [0, cy, -320] as const
    const approach = Math.atan2(toward[2] - cz, toward[0] - cx)
    const ok = (x: number, z: number, r: number) => siteClearance(x, z) > r + 0.5 && free(x, z, r)
      && (!bridge || segmentDistance(x, z, bridge.to, isle.top) > bridge.halfWidth + 2.5 + r)
    const at = (angle: number, rho: number) => [cx + Math.cos(angle) * rho, cz + Math.sin(angle) * rho] as const
    const tryAdd = (id: PropId, angle: number, rho: number, scale: number, rank: number, sink = 0.1) => {
      for (let n = 0; n < 5; n++) {
        const a = angle + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.22
        const [x, z] = at(a, rho)
        if (ok(x, z, PROPS[id].radius * scale)) { add(id, x, cy - sink, z, yawToward([x, 0, z], [cx, 0, cz]) + hash(k, n + 20) * 0.8 - 0.4, scale, rank); return }
      }
    }
    const P = isle.padRadius
    for (const side of [-1, 1]) tryAdd('stone_lantern', approach + side * 0.42, 10.5, 1.15, 0)
    tryAdd('pine_guest', approach + Math.PI + 0.5 + hash(k, 1) * 0.4, P - 2.5, 0.8 + hash(k, 2) * 0.15, 0, 0.4)
    tryAdd(hash(k, 3) > 0.5 ? 'pine_tall' : 'pine_guest', approach + Math.PI - 0.9 - hash(k, 4) * 0.4, P - 1.5, 0.62, 0.35, 0.4)
    tryAdd('rock_scholar', approach + Math.PI + 1.25, P - 3, 1.2, 0)
    tryAdd('rock_moss', approach + Math.PI + 1.55, P - 1.5, 0.8, 0.5, 0.2)
    tryAdd('rock_moss', approach - 1.6 - hash(k, 5), P - 1, 0.65, 0.7, 0.2)
    if (isle.top[1] > 100) for (let c = 0; c < 3; c++)
      tryAdd('spirit_crystal', approach + 1.9 + c * 0.32 + hash(k, c + 6) * 0.2, P - 2 - c * 1.2, 1.1 + hash(k, c + 9) * 0.8, c * 0.3)
  })

  // ── Karst pillar ledges: a twisted pine on about half the authored shelves, never two crowding one spot. ──
  const planted: { x: number; z: number; y: number }[] = []
  PILLAR_LEDGES.forEach((l, i) => {
    const h = hash(i, 71)
    if (h > 0.55 || planted.some((p) => Math.abs(p.y - l.y) < 12 && Math.hypot(p.x - l.x, p.z - l.z) < 5)) return
    const a = hash(i, 72) * 6.28, rho = l.radius * 0.3 * hash(i, 73)
    const x = l.x + Math.cos(a) * rho, z = l.z + Math.sin(a) * rho
    planted.push({ x: l.x, z: l.z, y: l.y })
    add('pine_small', x, l.y - 0.3, z, hash(i, 74) * 6.28, 1.3 + Math.min(l.radius, 4) * 0.25 + hash(i, 75) * 0.3, h * 0.4)
  })

  // ── Terrain: grouped pines, bamboo and rocks on the gentler slopes of the valley and the cliffs. ──
  // A low-frequency mask decides where groves exist, so decoration reads as a few groups, not a carpet.
  const groveTypes: [PropId, number][] = [['pine_tall', 0.34], ['pine_small', 0.2], ['bamboo', 0.16], ['rock_moss', 0.18], ['rock_scholar', 0.12]]
  const pick = (u: number) => { let acc = 0; for (const [id, w] of groveTypes) { acc += w; if (u < acc) return id } return groveTypes[0][0] }
  const tryTerrain = (x: number, z: number, id: PropId, scale: number, rank: number) => {
    const r = PROPS[id].radius * scale, canopy = (CANOPY[id] ?? 0) * scale
    if (insidePlatform(x, z, 6) || onStairs(x, z, Math.max(r, canopy)) || nearPailou(x, z, r)) return false
    const y = terrainHeight(x, z)
    if (y < -62 || slopeAt(x, z) > (MAX_SLOPE[id] ?? 30)) return false
    const road = z > 12 && z < 172 ? roadAt(z) : null
    if (road && roadDistance(x, z) < road.width / 2 + 3.5 + Math.max(r, canopy * 0.7)) return false
    if (buildingDistance(x, z) < r + 3 || siteClearance(x, z) < r + 1.5 || !towerClear(x, z, r + 2) || !mainClear(x, z, r + 6) || !free(x, z, r)) return false
    add(id, x, y - (SINK[id] ?? 0.3) * scale, z, hash(x, z, 5) * 6.28, scale, rank)
    return true
  }
  const grove = (x: number, z: number, u: number, id: PropId) => {
    const scale = id === 'pine_tall' ? 0.8 + u * 0.35 : id === 'bamboo' ? 0.9 + u * 0.4 : 0.8 + u * 0.5
    return tryTerrain(x, z, id, scale, u)
  }
  // Valley slopes flanking the road: fine grid, groves alternate along the road.
  for (let gz = 14; gz <= 176; gz += 6) for (let gx = -46; gx <= 46; gx += 6) {
    const x = gx + (hash(gx, gz, 1) - 0.5) * 5, z = gz + (hash(gx, gz, 2) - 0.5) * 5
    if (noise(x / 26, z / 26, 37) < -0.35) continue
    grove(x, z, hash(gx, gz, 3), pick(hash(gx, gz, 4)))
  }
  // Cliffs and shoulders around the platform: coarser grid, sparser groves.
  for (let gz = -560; gz <= 10; gz += 12) for (let gx = -330; gx <= 330; gx += 12) {
    const x = gx + (hash(gx, gz, 1) - 0.5) * 10, z = gz + (hash(gx, gz, 2) - 0.5) * 10
    if (noise(x / 48, z / 48, 33) < -0.1) continue
    grove(x, z, hash(gx, gz, 3), pick(hash(gx, gz, 4)))
  }
  return { props, piers, pailou: { x: pailouX, y: 0, z: PAILOU_Z, scale: PROPS.pailou.scale * pScale } }
}
