import { Vector3 } from 'three'

/**
 * 飞行试炼 (R10c): one ring course per outer region. Flying through the first ring starts the clock; the rest are
 * taken in order and the last stops it. Each ring is [x, y, z, radius]; it faces along the course, from the ring
 * before it toward the one after.
 */
export type TrialId = 'north' | 'east' | 'west' | 'south'
export type Ring = readonly [number, number, number, number]

export interface TrialCourse {
  id: TrialId
  name: string
  rings: Ring[]
}

export const TRIAL_COURSES: TrialCourse[] = [
  {
    // Round the seated sage, climbing, and out over its crown.
    id: 'north', name: '玄穹环峰',
    rings: [
      [0, 200, -1760, 22], [-250, 250, -1880, 16], [-330, 300, -2100, 16], [-300, 350, -2330, 16], [-120, 420, -2440, 16],
      [150, 470, -2420, 16], [320, 500, -2250, 16], [300, 520, -2000, 16], [120, 560, -1880, 16], [0, 600, -2150, 18],
    ],
  },
  {
    // North along the dragon spine, then the coil up the dragon pillar to its crown.
    id: 'east', name: '龙脊穿云',
    rings: [
      [2350, 380, 1000, 22], [2430, 380, 700, 16], [2250, 450, 350, 16], [2150, 430, 60, 16], [2000, 420, -200, 16],
      [1914, 460, -418, 16], [2204, 548, -708, 16], [2494, 636, -418, 16], [2204, 724, -128, 16], [1914, 812, -418, 16],
      [2204, 930, -418, 18],
    ],
  },
  {
    // With the west wind down the longest sword cut, out at its far end, and back low between the tomb swords.
    id: 'west', name: '万剑穿林',
    rings: [
      [-1560, 170, -167, 22], [-1914, 70, -332, 15], [-2200, 50, -466, 15], [-2470, 55, -592, 15], [-2760, 170, -730, 16],
      [-2700, 200, -330, 16], [-2500, 200, -300, 16], [-2325, 200, -225, 16], [-2120, 200, -380, 16], [-1880, 220, -560, 18],
    ],
  },
  {
    // North, low through the pillar forest east of the sky gate, then round and south with the wind through the gate.
    id: 'south', name: '天门归墟',
    rings: [
      [1100, 150, 2250, 22], [1045, 60, 1955, 16], [1040, 60, 1800, 16], [1030, 60, 1590, 16], [900, 50, 1400, 16],
      [450, 20, 1450, 16], [0, -10, 1640, 18], [0, -10, 2000, 45],
    ],
  },
]

/** Unit normal of ring `i`: from the ring before it toward the ring after it (one-sided at the ends). */
export function ringNormal(course: TrialCourse, i: number, out: Vector3) {
  const a = course.rings[Math.max(0, i - 1)], b = course.rings[Math.min(course.rings.length - 1, i + 1)]
  return out.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
}

export const TRIAL_IDS = TRIAL_COURSES.map((c) => c.id)

/** 83.42 → "1:23.4". */
export function formatTrialTime(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600), rest = (tenths % 600) / 10
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}
