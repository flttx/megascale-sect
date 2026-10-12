import { worldTerrainHeight } from './regions'

/**
 * The outer regions' lesser buildings beside their colossi: a cloud-viewing pavilion on the sage's terrace, a
 * gate before the sword tomb, a dragon-king shrine on the dragon mesa and a sea-viewing pavilion on the sky-gate
 * isle. Each stands on the flat top clear of the region's sites, colossus and blades; `footprint` (m) keeps the
 * terrace groves off it. `yaw` turns the model's front (+Z) toward what it faces.
 */
export interface RegionStructure {
  id: string
  model: 'cloud_pavilion' | 'tomb_gate' | 'dragon_shrine'
  x: number
  z: number
  yaw: number
  /** Rendered height (m). */
  height: number
  footprint: number
}

const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z)

export const REGION_STRUCTURES: RegionStructure[] = [
  // Steps toward the seated sage; the open side looks out over the northern ranges.
  {
    id: 'pavilion_sage',
    model: 'cloud_pavilion',
    x: 215,
    z: -2005,
    yaw: facing(215, -2005, 0, -2175),
    height: 24,
    footprint: 14,
  },
  // Faces the sect across the gulf, the way a pilgrim arrives at the tomb.
  { id: 'gate_tomb', model: 'tomb_gate', x: -1830, z: -500, yaw: Math.PI / 2, height: 34, footprint: 22 },
  {
    id: 'shrine_dragon',
    model: 'dragon_shrine',
    x: 2290,
    z: -520,
    yaw: facing(2290, -520, 2200, -420),
    height: 22,
    footprint: 14,
  },
  { id: 'pavilion_guixu', model: 'cloud_pavilion', x: 0, z: 2580, yaw: Math.PI, height: 22, footprint: 14 },
]

/** The lowest ground under the footprint, so no corner of the base floats over a dip. */
export function structureBase(s: RegionStructure) {
  let low = worldTerrainHeight(s.x, s.z)
  for (let a = 0; a < 12; a++)
    low = Math.min(
      low,
      worldTerrainHeight(
        s.x + Math.cos((a / 12) * Math.PI * 2) * s.footprint * 0.6,
        s.z + Math.sin((a / 12) * Math.PI * 2) * s.footprint * 0.6,
      ),
    )
  return low
}
