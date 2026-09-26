import { hash, roadAt } from '../environment/t02r/terrain'
import { PILLAR_SUMMITS } from '../landmarks/rockLayout'
import { BRIDGES, ISLANDS, PILLARS, siteClearance } from '../sites'
import type { Vec3 } from '../surfaces'

/** Display groups for the collection page. */
export type OrbGroup = 'road' | 'platform' | 'bridge' | 'island' | 'pillar' | 'roof' | 'sky'
export const ORB_GROUP_LABELS: Record<OrbGroup, string> = {
  road: '石道长阶', platform: '云阙广场', bridge: '桥下', island: '浮屿', pillar: '石林之巅', roof: '主殿檐顶', sky: '天路',
}

export interface OrbSite {
  id: string; position: Vec3; group: OrbGroup
  /** Spatial cluster the compass points at (nearest cluster that still has orbs). */
  cluster: string
}

/**
 * 60 spirit orbs, placed deterministically: a gentle trail on foot (road, stairs, forecourt) that
 * graduates to flight targets (under bridges, island tops, pillar crowns, the hall's roof tiers, open sky).
 */
function placeOrbs(): OrbSite[] {
  const out: OrbSite[] = []
  const push = (position: Vec3, group: OrbGroup, cluster: string) => out.push({ id: `orb_${String(out.length).padStart(2, '0')}`, position, group, cluster })

  // Road: alternate sides of the curving road centre, then two on the grand stairs.
  ;[128, 112, 96, 80, 66, 44, 30].forEach((z, i) => push([roadAt(z).x + (i % 2 ? 3.6 : -3.6), 1.4, z], 'road', 'road'))
  ;[-20, -50].forEach((z) => push([0, (20 - z) / 85 * 24 + 1.5, z], 'road', 'stairs'))

  // Platform: forecourt, both flanks and the rear terrace, clear of sites and the hall footprint.
  const platform: [number, number, string][] = [
    [-30, -92, 'forecourt'], [30, -92, 'forecourt'], [-122, -132, 'forecourt'], [122, -132, 'forecourt'],
    [-166, -250, 'flank_w'], [166, -250, 'flank_e'], [-160, -405, 'flank_w'], [160, -405, 'flank_e'],
    [-92, -497, 'rear'], [118, -505, 'rear'],
  ]
  platform.forEach(([x, z, cluster]) => push([x, 25.5, z], 'platform', cluster))

  // Under each bridge deck, a short way out from both ends (reached by flying beneath).
  for (const bridge of BRIDGES) {
    for (const t of [0.14, 0.86]) {
      const [ax, ay, az] = bridge.from, [bx, by, bz] = bridge.to
      const deck = ay + (by - ay) * t - bridge.sag * 4 * t * (1 - t)
      push([ax + (bx - ax) * t, deck - 5.5, az + (bz - az) * t], 'bridge', bridge.id)
    }
  }

  // Two per island top, on the pad but away from its interactables.
  ISLANDS.forEach((island, index) => {
    const [cx, cy, cz] = island.top
    let placed = 0
    for (let attempt = 0; placed < 2 && attempt < 24; attempt++) {
      const angle = hash(index, attempt, 811) * Math.PI * 2, r = island.padRadius * (0.45 + hash(index, attempt, 812) * 0.3)
      const x = cx + Math.cos(angle) * r, z = cz + Math.sin(angle) * r
      if (siteClearance(x, z) < 2.5) continue
      if (out.some((o) => Math.hypot(o.position[0] - x, o.position[2] - z) < island.padRadius * 0.6)) continue
      push([x, cy + 1.4, z], 'island', island.id)
      placed++
    }
  })

  // Crowns of the eight tallest pillars.
  PILLARS.map((pillar, i) => ({ pillar, summit: PILLAR_SUMMITS[i] })).sort((a, b) => b.summit[1] - a.summit[1]).slice(0, 8)
    .forEach(({ pillar, summit: [x, y, z] }) => push([x, y + 2.4, z], 'pillar', pillar.id))

  // Main hall roof tiers (heights probed from above; each sits ~3 m over the tiles).
  const roof: Vec3[] = [[0, 447, -320], [0, 384, -346], [0, 380, -292], [0, 235, -400], [0, 234, -240], [78, 178, -320], [-78, 178, -320], [48, 231, -272]]
  roof.forEach((position) => push(position, 'roof', 'roof'))

  // Open sky along the flight lines between the sect and its islands.
  const sky: Vec3[] = [[-135, 100, 65], [30, 150, 280], [-380, 105, -330], [420, 120, -200], [-230, 170, -450], [330, 90, 100], [-90, 250, -640]]
  sky.forEach((position, i) => push(position, 'sky', `sky_${i}`))
  return out
}

export const ORBS: OrbSite[] = placeOrbs()
export const ORB_COUNT = ORBS.length
export const COLLECT_RADIUS = 2.5
