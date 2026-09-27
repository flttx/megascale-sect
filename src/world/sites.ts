import { DISTANT_RIDGE_LAYERS, distantRidgeBand, distantRidgeHeight, hash, terrainHeight } from './environment/t02r/terrain'
import type { Vec3 } from './surfaces'

/**
 * Authored layout of the expanded world: the single source of truth that landmarks (geometry,
 * walkable surfaces, colliders), props (decoration, clearance) and interactables (placement) share.
 * Coordinates are world metres; the main platform top is y = 24, the cloud sea top y = -84.
 */

export interface IslandSite {
  id: string; name: string
  /** Centre of the flat walkable top. */
  top: Vec3
  /** Walkable disc radius; the visual top must stay flat out to at least padRadius + 2 m. */
  padRadius: number
  /** Overall visual radius of the island's top. */
  radius: number
  /** Height of the rock mass hanging below the top. */
  depth: number
  bridged: boolean
  /** Pillars it is chained to. A chained isle is hung among the pillars afterwards, so it does not push them aside. */
  chains?: string[]
}

export const ISLANDS: IslandSite[] = [
  { id: 'isle_west', name: '听松屿', top: [-302, 30, -102], padRadius: 20, radius: 27, depth: 46, bridged: true },
  { id: 'isle_east', name: '望月台', top: [332, 40, -85], padRadius: 20, radius: 27, depth: 50, bridged: true },
  { id: 'isle_northwest', name: '栖霞屿', top: [-560, 150, -420], padRadius: 22, radius: 32, depth: 60, bridged: false },
  { id: 'isle_star', name: '摘星台', top: [640, 175, -260], padRadius: 24, radius: 34, depth: 64, bridged: false },
  { id: 'isle_front_left', name: '流云屿', top: [-270, 115, 230], padRadius: 15, radius: 22, depth: 40, bridged: false },
  { id: 'isle_front_right', name: '鹤鸣屿', top: [330, 140, 300], padRadius: 18, radius: 26, depth: 48, bridged: false },
  { id: 'isle_sky', name: '天池', top: [-160, 300, -780], padRadius: 20, radius: 30, depth: 60, bridged: false },
  { id: 'isle_chained', name: '锁云屿', top: [-790, 265, -260], padRadius: 45, radius: 67, depth: 135, bridged: false, chains: ['pillar_5', 'pillar_3', 'pillar_2', 'pillar_0', 'pillar_4'] },
]

export interface BridgeSite {
  id: string; island: string
  /** Deck endpoints (walking height). `from` overlaps the platform by 4 m, `to` overlaps the island pad by 2 m. */
  from: Vec3; to: Vec3
  halfWidth: number
  /** Mid-span sag of the deck in metres. */
  sag: number
}

export const BRIDGES: BridgeSite[] = [
  { id: 'bridge_west', island: 'isle_west', from: [-186, 24, -102], to: [-284, 30, -102], halfWidth: 2.2, sag: 3 },
  { id: 'bridge_east', island: 'isle_east', from: [186, 24, -85], to: [314, 40, -85], halfWidth: 2.2, sag: 3.5 },
]

export interface PillarSite {
  id: string
  /** Index of the cluster it was scattered in (rendered and LOD-switched together). */
  cluster: number
  x: number; z: number
  /** Top surface height; the base is buried at PILLAR_BASE_Y under the cloud sea. */
  topY: number
  /** Mean radius of the shaft. */
  radius: number
}
/** Deep enough to root in the outer ground (TERRAIN_BASE), so no pillar floats inside a cloud rift. */
export const PILLAR_BASE_Y = -440

/** Highest ground (main terrain or distant ridges) inside a circle. */
function groundMax(cx: number, cz: number, r: number) {
  let best = -Infinity
  for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1]) {
    const x = cx + Math.cos(a / 16 * Math.PI * 2) * r * f, z = cz + Math.sin(a / 16 * Math.PI * 2) * r * f
    best = Math.max(best, terrainHeight(x, z))
    for (let layer = 0; layer < DISTANT_RIDGE_LAYERS; layer++) {
      const [minZ, maxZ] = distantRidgeBand(layer)
      if (z >= minZ && z <= maxZ && Math.abs(x) <= 1700) best = Math.max(best, distantRidgeHeight(layer, x, z))
    }
  }
  return best
}

// [centre x, centre z, spread, candidates, min top, max top]
const PILLAR_CLUSTERS: [number, number, number, number, number, number][] = [
  [-760, -300, 300, 8, 20, 180],
  [880, -250, 280, 8, 30, 200],
  [-620, 330, 300, 6, 0, 140],
  [680, 380, 300, 6, 0, 150],
  [-720, -760, 220, 4, 40, 200],
  [800, -720, 220, 4, 40, 200],
]

function generatePillars(): PillarSite[] {
  const out: PillarSite[] = []
  let seed = 0
  PILLAR_CLUSTERS.forEach(([cx, cz, spread, count, minTop, maxTop], cluster) => {
    for (let placed = 0, attempt = 0; placed < count && attempt < count * 8; attempt++) {
      seed++
      const x = cx + (hash(seed, 1, 501) - 0.5) * spread * 2, z = cz + (hash(seed, 2, 502) - 0.5) * spread * 2
      const topY = minTop + hash(seed, 3, 503) * (maxTop - minTop)
      const radius = Math.min(48, Math.max(12, (topY + 84) * (0.1 + hash(seed, 4, 504) * 0.08) + 8))
      if (groundMax(x, z, radius + 30) > -110) continue
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + radius + 30)) continue
      if (ISLANDS.some((i) => !i.chains && Math.hypot(i.top[0] - x, i.top[2] - z) < i.radius + radius + 25)) continue
      out.push({ id: `pillar_${out.length}`, cluster, x, z, topY, radius })
      placed++
    }
  })
  return out
}

export const PILLARS: PillarSite[] = generatePillars()

export type InteractKind = 'stele' | 'viewpoint' | 'bell' | 'altar' | 'meditation' | 'teleport'

export interface InteractSite {
  id: string; kind: InteractKind; name: string
  /** Ground contact point (y is the walkable height there). */
  position: Vec3
  /** Point the object's front (or a viewpoint's camera) should face. */
  faceToward: Vec3
  /** Footprint that decoration must keep clear. */
  clearance: number
}

export const INTERACT_SITES: InteractSite[] = [
  // Steles: sect lore along the pilgrimage route and at the far corners.
  { id: 'stele_spawn', kind: 'stele', name: '入山碑', position: [-12.5, 0, 150], faceToward: [0, 0, 150], clearance: 3 },
  { id: 'stele_road_a', kind: 'stele', name: '问道碑', position: [11.5, 0, 118], faceToward: [0, 0, 118], clearance: 3 },
  { id: 'stele_road_b', kind: 'stele', name: '云海碑', position: [-11.5, 0, 84], faceToward: [0, 0, 84], clearance: 3 },
  { id: 'stele_gate', kind: 'stele', name: '山门碑', position: [12, 0, 36], faceToward: [0, 0, 36], clearance: 3 },
  { id: 'stele_stairs', kind: 'stele', name: '登阶碑', position: [-20, 24, -76], faceToward: [0, 24, -76], clearance: 3 },
  { id: 'stele_forecourt', kind: 'stele', name: '宗规碑', position: [95, 24, -150], faceToward: [60, 24, -120], clearance: 3 },
  { id: 'stele_bridge', kind: 'stele', name: '听松桥记', position: [-178, 24, -112], faceToward: [-178, 24, -102], clearance: 3 },
  { id: 'stele_back', kind: 'stele', name: '后山碑', position: [-120, 24, -500], faceToward: [-120, 24, -480], clearance: 3 },
  { id: 'stele_isle_west', kind: 'stele', name: '松涛碑', position: [-294, 30, -111], faceToward: [-302, 30, -102], clearance: 3 },
  { id: 'stele_star', kind: 'stele', name: '摘星碑', position: [630, 175, -252], faceToward: [640, 175, -260], clearance: 3 },
  // Viewpoints: cinematic overlooks; the first visit reveals map regions.
  { id: 'view_spawn', kind: 'viewpoint', name: '仰止台', position: [-6, 0, 160], faceToward: [0, 120, -320], clearance: 3 },
  { id: 'view_stairs', kind: 'viewpoint', name: '回望阶', position: [12, 24, -70], faceToward: [0, 0, 100], clearance: 3 },
  { id: 'view_back_west', kind: 'viewpoint', name: '西崖', position: [-176, 24, -505], faceToward: [-900, 0, -500], clearance: 3 },
  { id: 'view_back_east', kind: 'viewpoint', name: '东崖', position: [176, 24, -505], faceToward: [900, 0, -600], clearance: 3 },
  { id: 'view_isle_west', kind: 'viewpoint', name: '松风台', position: [-318, 30, -112], faceToward: [-760, 80, -300], clearance: 3 },
  { id: 'view_star', kind: 'viewpoint', name: '摘星顶', position: [650, 175, -240], faceToward: [0, 200, -320], clearance: 3 },
  // Forecourt mechanisms.
  { id: 'bell_forecourt', kind: 'bell', name: '云阙古钟', position: [-62, 24, -118], faceToward: [0, 24, -118], clearance: 6 },
  { id: 'altar_forecourt', kind: 'altar', name: '司天祭坛', position: [62, 24, -118], faceToward: [0, 24, -118], clearance: 6 },
  // Meditation cushions fast-forward time.
  { id: 'meditation_back', kind: 'meditation', name: '观云蒲团', position: [-50, 24, -505], faceToward: [-50, 24, -700], clearance: 3 },
  { id: 'meditation_isle_east', kind: 'meditation', name: '望月蒲团', position: [338, 40, -91], faceToward: [900, 60, -91], clearance: 3 },
  // Teleport arrays link once activated by visiting.
  { id: 'teleport_spawn', kind: 'teleport', name: '山门阵', position: [0, 0, 141], faceToward: [0, 0, 100], clearance: 5 },
  { id: 'teleport_forecourt', kind: 'teleport', name: '云阙阵', position: [0, 24, -128], faceToward: [0, 24, -320], clearance: 5 },
  { id: 'teleport_back', kind: 'teleport', name: '后山阵', position: [70, 24, -492], faceToward: [70, 24, -600], clearance: 5 },
  { id: 'teleport_isle_west', kind: 'teleport', name: '听松阵', position: [-302, 30, -102], faceToward: [-186, 24, -102], clearance: 5 },
  { id: 'teleport_star', kind: 'teleport', name: '摘星阵', position: [640, 175, -260], faceToward: [0, 175, -320], clearance: 5 },
]

/**
 * Distance from (x, z) to the nearest reserved footprint: interact sites and bridge heads.
 * Negative inside a footprint. Decoration should require e.g. `siteClearance(x, z) > size`.
 */
export function siteClearance(x: number, z: number) {
  let best = Infinity
  for (const site of INTERACT_SITES) best = Math.min(best, Math.hypot(x - site.position[0], z - site.position[2]) - site.clearance)
  for (const bridge of BRIDGES) for (const end of [bridge.from, bridge.to]) best = Math.min(best, Math.hypot(x - end[0], z - end[2]) - (bridge.halfWidth + 4))
  return best
}

/** Horizontal yaw (radians about +Y) that turns a model whose front faces +X toward `target`. */
export function yawToward(from: Vec3, target: Vec3) {
  return Math.atan2(-(target[2] - from[2]), target[0] - from[0])
}
