import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { CylinderCollider, Vec3 } from '../surfaces'
import { COLOSSUS_META } from './colossiMeta'
import type { ColossusModel } from './colossiMeta'

/**
 * Where the colossi stand (R3): the two guardians rising out of the cloud sea either side of the sect, the
 * sword driven into the eastern peak behind the hall, the armillary sphere over the hall roof and the kun's
 * flight loop. The renderer and the collider registry both read it.
 */
export interface ColossusPlacement {
  id: string
  model: ColossusModel
  /** World position of the model origin (a guardian's base, the sword's tip). */
  position: Vec3
  /** Radians, applied as tilt about local Z, then X, then yaw (Euler order YXZ). */
  rotation: Vec3
  scale: number
  /** Beyond this the reduced model is shown. */
  lodDistance: number
}

/** Yaw that turns a model's +Z (its front) from (x, z) toward (tx, tz). */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z)

export const COLOSSI: ColossusPlacement[] = [
  // The cloud tops (y −84) reach their hands (base −84 − 67.5·scale); heads at y ≈ 280, turned toward the pilgrim
  // road. Placed clear of the ridges above the clouds and ≥ 17 m from every rock column above them.
  { id: 'guardian_east', model: 'guardian_a', position: [460, -381, -420], rotation: [0, facing(460, -420, 0, 100), 0], scale: 4.4, lodDistance: 1100 },
  { id: 'guardian_west', model: 'guardian_b', position: [-440, -381, -440], rotation: [0, facing(-440, -440, 0, 100), 0], scale: 4.4, lodDistance: 1100 },
  // Tip buried 60 m in the eastern summit (347 m); the flat of the blade faces the spawn, leaning a few degrees.
  { id: 'giant_sword', model: 'giant_sword', position: [332, 287, -717], rotation: [0.04, facing(332, -717, 0, 150), -0.06], scale: 1.1, lodDistance: 1400 },
]

export function colossusMatrix(c: ColossusPlacement, out = new Matrix4()) {
  const q = new Quaternion().setFromEuler(new Euler(c.rotation[0], c.rotation[1], c.rotation[2], 'YXZ'))
  return out.compose(new Vector3(...c.position), q, new Vector3(c.scale, c.scale, c.scale))
}

/**
 * Flight colliders: every band circle of the model as a vertical cylinder through its placed band. A tilted
 * model shifts each band's circle with it, so the column leans in steps of one band.
 */
export function colossusColliders(c: ColossusPlacement): CylinderCollider[] {
  const m = colossusMatrix(c), a = new Vector3(), b = new Vector3(), out: CylinderCollider[] = []
  for (const [lo, hi, circles] of COLOSSUS_META[c.model].bands) for (const [x, z, r] of circles) {
    a.set(x, lo, z).applyMatrix4(m); b.set(x, hi, z).applyMatrix4(m)
    out.push({ kind: 'cylinder', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, radius: r * c.scale, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) })
  }
  return out
}

/** The armillary sphere floats this far above the hall roof (y 444), centred on the hall. */
export const ARMILLARY = { position: [0, 560, -330] as Vec3, radius: 60 }

/**
 * The kun's closed loop (centripetal Catmull-Rom): it breaches from the cloud sea in the front valley, climbs
 * over the spawn toward the hall, sweeps past its east side and behind the sword, circles back high over the
 * rear ranges, runs down the west past the pillars and dives into the clouds far in front, turning beneath them.
 * Keeps ≥ 175 m from every pillar, island, statue and the hall, and ≥ 186 m above the ground.
 */
export const KUN_PATH: Vec3[] = [
  [60, -210, 1020], [40, -60, 720], [20, 170, 420], [60, 330, 150], [330, 480, -60], [600, 520, -400], [800, 540, -780],
  [420, 540, -1120], [-300, 500, -1120], [-920, 440, -900], [-1260, 340, -420], [-1160, 250, 150], [-820, 160, 740],
  [-360, -20, 1020], [150, -190, 1180], [420, -230, 1100],
]
/** Model scale and cruising speed (m/s) along the loop. */
export const KUN = { scale: 1.2, speed: 40 }
