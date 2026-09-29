import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { DRAGON_MESA, SAGE_TERRACE, SWORD_MESA } from '../regions/regions'
import type { CylinderCollider, Vec3 } from '../surfaces'
import { COLOSSUS_META } from './colossiMeta'
import type { ColossusMeta, ColossusModel } from './colossiMeta'

/**
 * Where the colossi stand (R3): the two guardians rising out of the cloud sea either side of the sect, the
 * sword driven into the eastern peak behind the hall, the armillary sphere over the hall roof and the kun's
 * flight loop; since R10 also the colossus of each outer region. The renderer and the collider registry both read it.
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

/**
 * 万剑冢: swords driven tip-first into the sword mesa, as [x, z, scale, lean about X, lean about Z, yaw off facing the
 * sect, depth the tip is buried]. The great sword stands upright with its flat to the sect; the lesser ones lean.
 */
const TOMB_SWORDS: [number, number, number, number, number, number, number][] = [
  [-2200, -250, 1.3, 0.03, -0.05, 0, 50],
  [-2050, -500, 0.55, 0.24, 0.1, 0.5, 30],
  [-2450, -200, 0.5, -0.18, 0.28, -0.7, 30],
  [-2180, -760, 0.42, 0.32, -0.2, 1.2, 30],
  [-2550, -400, 0.6, -0.26, -0.14, 2.1, 30],
]

export const COLOSSI: ColossusPlacement[] = [
  // The cloud tops (y −84) reach their hands (base −84 − 67.5·scale); heads at y ≈ 280, turned toward the pilgrim
  // road. Placed clear of the ridges above the clouds and ≥ 17 m from every rock column above them.
  { id: 'guardian_east', model: 'guardian_a', position: [460, -381, -420], rotation: [0, facing(460, -420, 0, 100), 0], scale: 4.4, lodDistance: 1100 },
  { id: 'guardian_west', model: 'guardian_b', position: [-440, -381, -440], rotation: [0, facing(-440, -440, 0, 100), 0], scale: 4.4, lodDistance: 1100 },
  // Tip buried 60 m in the eastern summit (347 m); the flat of the blade faces the spawn, leaning a few degrees.
  { id: 'giant_sword', model: 'giant_sword', position: [332, 287, -717], rotation: [0.04, facing(332, -717, 0, 150), -0.06], scale: 1.1, lodDistance: 1400 },
  // R10. 玄穹峰: the sage sits on the terrace facing the sect across the northern gulf, 375 m from seat to crown.
  { id: 'seated_sage', model: 'seated_sage', position: [SAGE_TERRACE.x, SAGE_TERRACE.top - 2, SAGE_TERRACE.z - 25], rotation: [0, 0, 0], scale: 2.5, lodDistance: 1600 },
  // 龙脊岭: the dragon column rises 660 m from the spine's central mesa, its coils turned toward the hall.
  { id: 'dragon_pillar', model: 'dragon_pillar', position: [DRAGON_MESA.x, DRAGON_MESA.top - 2, DRAGON_MESA.z], rotation: [0, facing(DRAGON_MESA.x, DRAGON_MESA.z, 0, -300), 0], scale: 4.4, lodDistance: 1600 },
  // 天门: its feet lost in the cloud sea before the gate isle, below the lowest flight height (−60); the ~200 m opening
  // spans the cloud tops to y ≈ 70.
  { id: 'sky_gate', model: 'sky_gate', position: [0, -150, 2000], rotation: [0, Math.PI, 0], scale: 3, lodDistance: 1800 },
  ...TOMB_SWORDS.map(([x, z, scale, leanX, leanZ, yaw, buried], i): ColossusPlacement => ({
    id: `tomb_sword_${i}`, model: 'giant_sword', position: [x, SWORD_MESA.top - buried, z], rotation: [leanX, facing(x, z, 0, -300) + yaw, leanZ],
    scale, lodDistance: i === 0 ? 1600 : 1000,
  })),
]

export function colossusMatrix(c: ColossusPlacement, out = new Matrix4()) {
  const q = new Quaternion().setFromEuler(new Euler(c.rotation[0], c.rotation[1], c.rotation[2], 'YXZ'))
  return out.compose(new Vector3(...c.position), q, new Vector3(c.scale, c.scale, c.scale))
}

/**
 * Flight colliders: every band circle of the model as a vertical cylinder through its placed band. A tilted
 * model shifts each band's circle with it, so the column leans in steps of one band.
 */
export function colossusColliders(c: ColossusPlacement, bands = COLOSSUS_META[c.model].bands): CylinderCollider[] {
  const m = colossusMatrix(c), a = new Vector3(), b = new Vector3(), out: CylinderCollider[] = []
  for (const [lo, hi, circles] of bands) for (const [x, z, r] of circles) {
    a.set(x, lo, z).applyMatrix4(m); b.set(x, hi, z).applyMatrix4(m)
    out.push({ kind: 'cylinder', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, radius: r * c.scale, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) })
  }
  return out
}

/**
 * A model's bands merged into `count` equal-height segments of one circle each, bounding the segment's circles: a
 * cheap collider set for many small copies of a model.
 */
export function coarseBands(model: ColossusModel, count: number): ColossusMeta['bands'] {
  const { height, bands } = COLOSSUS_META[model]
  return Array.from({ length: count }, (_, s): ColossusMeta['bands'][number] => {
    const lo = height * s / count, hi = height * (s + 1) / count
    const circles = bands.filter(([from, to]) => to > lo && from < hi).flatMap(([, , c]) => c)
    const cx = (Math.min(...circles.map(([x, , r]) => x - r)) + Math.max(...circles.map(([x, , r]) => x + r))) / 2
    const cz = (Math.min(...circles.map(([, z, r]) => z - r)) + Math.max(...circles.map(([, z, r]) => z + r))) / 2
    return [lo, hi, circles.length ? [[cx, cz, Math.max(...circles.map(([x, z, r]) => Math.hypot(x - cx, z - cz) + r))]] : []]
  })
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
