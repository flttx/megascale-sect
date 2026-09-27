import type { BoxCollider, WalkableSpan } from '../surfaces'
import { LAYOUT } from '../worldLayout'

/**
 * Furniture on the main platform: planted tree pits in the forecourt and along the hall's flanks, a raised
 * reflecting pool each side of the forecourt, and the great censer's two-tier dais on the axis. The stone is
 * merged into the terrace meshes (EnvironmentT02R), the pines and censers are prop placements, and the colliders
 * and walkable tiers below keep walking, flight and the camera in step with what is drawn.
 */
const Y = LAYOUT.platform.height

/** Tree pit centres [x, z]: two pairs in the forecourt, four down each flank of the hall. */
export const TREE_PITS: readonly (readonly [number, number])[] = [
  [-36, -112], [36, -112], [-36, -142], [36, -142],
  ...[-215, -290, -350, -445].flatMap((z) => [[-155, z], [155, z]] as const),
]
/** Square curb: half-size, height above the paving, wall thickness; the bed lies `bed` below the coping. */
export const PIT = { half: 3, height: 0.55, wall: 0.45, bed: 0.12 }

/** Raised pools either side of the forecourt, clear of the lantern axis, the bell and the altar. */
export const POOLS: readonly { x: number; z: number; halfX: number; halfZ: number }[] = [
  { x: -98, z: -92, halfX: 18, halfZ: 10 }, { x: 98, z: -92, halfX: 18, halfZ: 10 },
]
/** Curb height and wall thickness; the water stands `water` above the paving, just under the coping. */
export const POOL = { height: 0.6, wall: 0.8, water: 0.42 }

/** The censer's dais: square tiers (half-sizes), each `rise` high. */
export const DAIS = { x: 0, z: -160, tiers: [8, 5.5], rise: 0.3 }
export const DAIS_TOP = Y + DAIS.tiers.length * DAIS.rise

/** Each dais tier is a flat walkable square. */
export const PLAZA_WALKABLES: WalkableSpan[] = DAIS.tiers.map((half, i) => {
  const y = Y + (i + 1) * DAIS.rise
  return { kind: 'span', from: [DAIS.x, y, DAIS.z + half], to: [DAIS.x, y, DAIS.z - half], halfWidth: half, sag: 0 }
})

/** Pits stop the body up to the pine's lower boughs; pools a little over the coping, so nobody wades in. */
export const PLAZA_COLLIDERS: BoxCollider[] = [
  ...TREE_PITS.map(([x, z]): BoxCollider => ({ kind: 'box', min: [x - PIT.half, Y, z - PIT.half], max: [x + PIT.half, Y + 6, z + PIT.half] })),
  ...POOLS.map((p): BoxCollider => ({ kind: 'box', min: [p.x - p.halfX, Y, p.z - p.halfZ], max: [p.x + p.halfX, Y + POOL.height + 0.4, p.z + p.halfZ] })),
]
