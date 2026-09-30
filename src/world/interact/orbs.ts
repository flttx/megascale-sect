import { hash, roadAt, terrainHeight } from '../environment/t02r/terrain'
import { PILLAR_SUMMITS } from '../landmarks/rockLayout'
import { BRIDGES, ISLANDS, PILLARS, siteClearance } from '../sites'
import type { Vec3 } from '../surfaces'
import { Vector3 } from 'three'
import { COLOSSUS_META } from '../colossi/colossiMeta'
import { kunOrbPosition } from '../colossi/kunDeck'
import { COLOSSI, colossusMatrix } from '../colossi/layout'
import { TURTLE_ORB_COUNT, turtleOrbPosition } from '../colossi/turtleDeck'
import { worldTerrainHeight } from '../regions/regions'
import { WIND_STREAMS } from '../wind/windStreams'

/** Display groups for the collection page. */
export type OrbGroup = 'road' | 'platform' | 'bridge' | 'island' | 'pillar' | 'roof' | 'sky' | 'kun' | 'sage' | 'dragon' | 'tomb' | 'gate' | 'turtle'
export const ORB_GROUP_LABELS: Record<OrbGroup, string> = {
  road: '石道长阶', platform: '云阙广场', bridge: '桥下', island: '浮屿', pillar: '石林之巅', roof: '主殿檐顶', sky: '天路',
  kun: '鲲背', sage: '玄穹峰', dragon: '龙脊岭', tomb: '万剑冢', gate: '归墟云海', turtle: '鳌背',
}

export interface OrbSite {
  id: string; position: Vec3; group: OrbGroup
  /** Spatial cluster the compass points at (nearest cluster that still has orbs). */
  cluster: string
  kunIndex?: number
  turtleIndex?: number
}

/** `lift` metres over the centre of a colossus's highest collider band: a sword's pommel, the sage's crown. */
function crown(id: string, lift: number): Vec3 {
  const colossus = COLOSSI.find((c) => c.id === id)
  if (!colossus) throw new Error(`Missing colossus ${id}`)
  const [, hi, circles] = COLOSSUS_META[colossus.model].bands.reduce((a, b) => (b[1] > a[1] ? b : a))
  const x = circles.reduce((sum, c) => sum + c[0], 0) / circles.length, z = circles.reduce((sum, c) => sum + c[1], 0) / circles.length
  const p = new Vector3(x, hi, z).applyMatrix4(colossusMatrix(colossus))
  return [p.x, p.y + lift, p.z]
}
const onGround = (x: number, z: number, lift: number): Vec3 => [x, worldTerrainHeight(x, z) + lift, z]

/**
 * Spirit orbs, placed deterministically: a gentle trail on foot (road, stairs, forecourt) that
 * graduates to flight targets (under bridges, island tops, pillar crowns, the hall's roof tiers, open sky).
 */
function placeOrbs(): OrbSite[] {
  const out: OrbSite[] = []
  const counts = new Map<string, number>()
  const push = (position: Vec3, group: OrbGroup, cluster: string) => {
    const base = cluster === group ? group : `${group}_${cluster}`
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    out.push({ id: `orb_${base}_${n}`, position, group, cluster })
  }

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

  // Under each bridge deck, a short way out from both ends (reached by flying beneath). The platform end first
  // crosses a shoulder of ground, so that orb moves on until the ground has fallen well away under it.
  for (const bridge of BRIDGES) {
    for (let t of [0.14, 0.86]) {
      const [ax, ay, az] = bridge.from, [bx, by, bz] = bridge.to
      const at = (u: number): Vec3 => [ax + (bx - ax) * u, ay + (by - ay) * u - bridge.sag * 4 * u * (1 - u) - 5.5, az + (bz - az) * u]
      while (t < 0.8 && terrainHeight(at(t)[0], at(t)[2]) > at(t)[1] - 3.5) t += 0.01
      push(at(t), 'bridge', bridge.id)
    }
  }

  // Two per island top, on the pad but away from its interactables. IDs use the island identity.
  const islandOrbs = (island: (typeof ISLANDS)[number], index: number) => {
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
    if (placed !== 2) throw new Error(`Island ${island.id} could only place ${placed}/2 spirit orbs`)
  }
  ISLANDS.forEach((island, index) => { if (!island.chains) islandOrbs(island, index) })

  // Crowns of the six tallest pillars around the sect.
  PILLARS.map((pillar, i) => ({ pillar, summit: PILLAR_SUMMITS[i] })).filter(({ pillar }) => !pillar.outer).sort((a, b) => b.summit[1] - a.summit[1]).slice(0, 6)
    .forEach(({ pillar, summit: [x, y, z] }) => push([x, y + 2.4, z], 'pillar', pillar.id))
  ISLANDS.forEach((island, index) => { if (island.chains) islandOrbs(island, index) })

  // Main hall roof tiers: each floats 4–9 m over the tiles directly below and is reached by flying down onto it.
  const roof: Vec3[] = [[0, 447, -320], [0, 384, -346], [0, 380, -292], [0, 235, -400], [0, 234, -240], [78, 178, -320], [-78, 178, -320], [48, 234, -272]]
  roof.forEach((position) => push(position, 'roof', 'roof'))

  // Open sky along the flight lines between the sect and its islands.
  const sky: Vec3[] = [[-135, 100, 65], [30, 150, 280], [-380, 105, -330], [420, 120, -200], [-230, 170, -450], [330, 90, 100], [-90, 250, -640]]
  sky.forEach((position, i) => push(position, 'sky', `sky_${i}`))
  for (let i = 0; i < 6; i++) out.push({ id: `orb_kun_${i}`, position: [0, 0, 0], group: 'kun', cluster: 'kun', kunIndex: i })

  // R10 outer regions. The sage: its terrace apron, before its face, over its crown, and the highest northern summit.
  push(onGround(-40, -1960, 1.4), 'sage', 'sage')
  push([0, 470, -2060], 'sage', 'sage')
  push(crown('seated_sage', 6), 'sage', 'sage')
  push(onGround(-16, -2792, 3), 'sage', 'peak')
  // The dragon: along the updraft that coils up its pillar, so riding the wind gathers them.
  const coil = WIND_STREAMS.find((w) => w.id === 'dragon')?.points
  if (!coil) throw new Error('Missing the dragon updraft')
  ;[2, 4, 7, 10].forEach((k) => push(coil[k], 'dragon', 'dragon'))
  // Over the pommel of every sword in the tomb.
  COLOSSI.filter((c) => c.id.startsWith('tomb_sword_')).forEach((c) => push(crown(c.id, 6), 'tomb', 'tomb'))
  // The sky gate: in its opening on the southern wind, 6 m over the middle of its lintel (only the horns at its ends
  // rise higher), and the crowns of the two tallest sea stacks.
  push([0, 0, 2000], 'gate', 'gate')
  push([0, 291, 2004], 'gate', 'gate')
  push(onGround(-2328, 1620, 3), 'gate', 'stack_w')
  push(onGround(2336, 1492, 3), 'gate', 'stack_e')
  for (let i = 0; i < TURTLE_ORB_COUNT; i++) out.push({ id: `orb_turtle_${i}`, position: [0, 0, 0], group: 'turtle', cluster: 'turtle', turtleIndex: i })
  return out
}

export const ORBS: OrbSite[] = placeOrbs()
export const ORB_COUNT = ORBS.length
if (new Set(ORBS.map((o) => o.id)).size !== ORB_COUNT || ORB_COUNT !== 86) throw new Error('Spirit orb layout is incomplete or has duplicate IDs')
export const COLLECT_RADIUS = 2.5
/** One position source for rendering, collection, compass, map and verification. */
export function orbPosition(orb: OrbSite, out: Vector3): Vector3 | null {
  if (orb.kunIndex !== undefined) return kunOrbPosition(orb.kunIndex, out)
  if (orb.turtleIndex !== undefined) return turtleOrbPosition(orb.turtleIndex, out)
  return out.fromArray(orb.position)
}
