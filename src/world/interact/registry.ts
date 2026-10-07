import { INTERACT_SITES } from '../sites'
import type { InteractKind, InteractSite } from '../sites'

/** An interaction site plus how close the player must stand and the verb its prompt shows. */
export interface SiteSpec extends InteractSite {
  radius: number
  verb: string
}

const RADIUS: Record<InteractKind, number> = {
  stele: 3.8,
  viewpoint: 3.6,
  bell: 5.5,
  altar: 6,
  meditation: 3.2,
  teleport: 4.8,
}
const VERB: Record<InteractKind, string> = {
  stele: '研读',
  viewpoint: '远眺',
  bell: '撞钟',
  altar: '祈天',
  meditation: '打坐',
  teleport: '传送',
}
export const KIND_LABELS: Record<InteractKind, string> = {
  stele: '石碑',
  viewpoint: '观景',
  bell: '古钟',
  altar: '祭坛',
  meditation: '蒲团',
  teleport: '传送阵',
}

export const SITES: SiteSpec[] = INTERACT_SITES.map((site) => ({
  ...site,
  radius: RADIUS[site.kind],
  verb: VERB[site.kind],
}))
export const SITE_BY_ID = new Map(SITES.map((site) => [site.id, site]))
export const sitesOf = (kind: InteractKind) => SITES.filter((site) => site.kind === kind)

/** Radius of the walkable teleport disc (its glyph ring stands the player on it). */
export const TELEPORT_PAD_RADIUS = 4.1
export const TELEPORT_PAD_TOP = 0.42

/** Closest usable site to the player's feet, weighted by each kind's reach. */
export function nearestSite(x: number, y: number, z: number): SiteSpec | null {
  let best: SiteSpec | null = null,
    bestScore = 1
  for (const site of SITES) {
    const [sx, sy, sz] = site.position
    if (Math.abs(y - sy) > 3.5) continue
    const score = Math.hypot(x - sx, z - sz) / site.radius
    if (score < bestScore) {
      best = site
      bestScore = score
    }
  }
  return best
}

/** Player yaw that faces `target` from `from` (player forward is (sin yaw, 0, −cos yaw)). */
export const facingYaw = (from: readonly number[], target: readonly number[]) =>
  Math.atan2(target[0] - from[0], -(target[2] - from[2]))
