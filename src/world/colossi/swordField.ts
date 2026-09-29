import { hash } from '../environment/t02r/terrain'
import { SWORD_MESA, worldTerrainHeight } from '../regions/regions'
import type { CylinderCollider } from '../surfaces'
import { COLOSSUS_META } from './colossiMeta'
import { COLOSSI, coarseBands, colossusColliders } from './layout'
import type { ColossusPlacement } from './layout'

/**
 * 万剑冢's lesser blades (R10): 6–19 m swords scattered over the flat of the sword mesa, leaning at random and buried
 * a fifth of their length, clear of the tomb swords and of the cuts through the mesa. One instanced mesh draws them.
 */
const FIELD = { count: 180, spacing: 14, clearOfTombs: 60, flatness: 4 }
const TOMBS = COLOSSI.filter((c) => c.id.startsWith('tomb_sword_'))

function scatter(): ColossusPlacement[] {
  const out: ColossusPlacement[] = []
  const flat = (x: number, z: number) => [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]
    .every(([dx, dz]) => Math.abs(worldTerrainHeight(x + dx, z + dz) - SWORD_MESA.top) < FIELD.flatness)
  for (let seed = 0; out.length < FIELD.count && seed < FIELD.count * 8; seed++) {
    const a = hash(seed, 1, 1301) * Math.PI * 2, r = SWORD_MESA.radius * 0.95 * Math.sqrt(hash(seed, 2, 1302))
    const x = SWORD_MESA.x + Math.cos(a) * r, z = SWORD_MESA.z + Math.sin(a) * r
    if (!flat(x, z)) continue
    if (TOMBS.some((t) => Math.hypot(t.position[0] - x, t.position[2] - z) < FIELD.clearOfTombs)) continue
    if (out.some((b) => Math.hypot(b.position[0] - x, b.position[2] - z) < FIELD.spacing)) continue
    const scale = 0.014 + hash(seed, 3, 1303) * 0.031, buried = COLOSSUS_META.giant_sword.height * scale * (0.12 + hash(seed, 4, 1304) * 0.13)
    out.push({
      id: `tomb_blade_${out.length}`, model: 'giant_sword', position: [x, worldTerrainHeight(x, z) - buried, z],
      rotation: [0.08 + hash(seed, 5, 1305) * 0.42, hash(seed, 6, 1306) * Math.PI * 2, (hash(seed, 7, 1307) - 0.5) * 0.3], scale, lodDistance: 0,
    })
  }
  return out
}

export const SWORD_FIELD: ColossusPlacement[] = scatter()

/**
 * Ten stacked cylinders per blade: short enough that a blade leaning half a radian stays inside them, and the wide
 * guard fills only its own segment.
 */
export const swordFieldColliders = (): CylinderCollider[] => {
  const bands = coarseBands('giant_sword', 10)
  return SWORD_FIELD.flatMap((b) => colossusColliders(b, bands))
}

/** From the mesa's centre (m): beyond the first the field is hidden in the haze, within the second it casts shadows. */
export const SWORD_FIELD_RANGE = { visible: SWORD_MESA.radius + 1500, shadow: SWORD_MESA.radius + 300 }
