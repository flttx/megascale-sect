export type HorrorSourceType = 'watcher' | 'behemoth'
export type HorrorCreatureId = HorrorSourceType | `${HorrorSourceType}-${string}`

export interface HorrorPlacement {
  id: HorrorCreatureId
  /** Asset anatomy is independent of the unique actor/voice/attack identity. */
  sourceType: HorrorSourceType
  variantId?: 'elder' | 'veil' | 'scree' | 'bell' | 'tide'
  position: readonly [number, number, number]
  height: number
  /** Rotate the inspected source's +X-facing anatomy to local +Z before facing the sect. */
  sourceYaw: number
  revealStart: number
  revealEnd: number
  phase: number
  /** One continuous patrol cycle, including deceleration, roar and recovery. */
  patrol: { radiusX: number; radiusZ: number; period: number; yawLimit: number; startAngle?: number }
  roar: { hold: number; period: number; offset?: number }
}

/** Vast cloud-sea silhouettes beyond the bridges, terraces and existing exploration routes. */
export const HORROR_LAYOUT: readonly HorrorPlacement[] = [
  {
    id: 'watcher',
    sourceType: 'watcher',
    variantId: 'elder',
    position: [-1770, 170, -1050],
    height: 530,
    sourceYaw: -Math.PI / 2,
    revealStart: 28,
    revealEnd: 37,
    phase: 0.7,
    patrol: { radiusX: 95, radiusZ: 60, period: 72, yawLimit: 0.35 },
    roar: { hold: 5.2, period: 72 },
  },
  {
    id: 'behemoth',
    sourceType: 'behemoth',
    variantId: 'elder',
    position: [1450, -180, 850],
    height: 430,
    sourceYaw: -Math.PI / 2,
    revealStart: 31,
    revealEnd: 39,
    phase: 3.3,
    patrol: { radiusX: 80, radiusZ: 55, period: 86, yawLimit: 0.32 },
    roar: { hold: 5.2, period: 86 },
  },
  {
    id: 'watcher-veil',
    sourceType: 'watcher',
    variantId: 'veil',
    position: [1350, -75, -1350],
    height: 175,
    sourceYaw: -Math.PI / 2,
    revealStart: 42,
    revealEnd: 52,
    phase: 1.9,
    patrol: { radiusX: 35, radiusZ: 25, period: 79, yawLimit: 0.4 },
    roar: { hold: 4.8, period: 79, offset: 17 },
  },
  {
    id: 'behemoth-scree',
    sourceType: 'behemoth',
    variantId: 'scree',
    position: [-1450, -100, 780],
    height: 210,
    sourceYaw: -Math.PI / 2,
    revealStart: 44,
    revealEnd: 54,
    phase: 4.1,
    patrol: { radiusX: 50, radiusZ: 35, period: 88, yawLimit: 0.36 },
    roar: { hold: 5.4, period: 88, offset: 29 },
  },
  {
    id: 'watcher-bell',
    sourceType: 'watcher',
    variantId: 'bell',
    position: [650, -85, 1450],
    height: 130,
    sourceYaw: -Math.PI / 2,
    revealStart: 47,
    revealEnd: 57,
    phase: 5.6,
    patrol: { radiusX: 45, radiusZ: 30, period: 91, yawLimit: 0.38 },
    roar: { hold: 4.6, period: 91, offset: 41 },
  },
  {
    id: 'behemoth-tide',
    sourceType: 'behemoth',
    variantId: 'tide',
    position: [2250, -100, 1050],
    height: 170,
    sourceYaw: -Math.PI / 2,
    revealStart: 49,
    revealEnd: 59,
    phase: 2.8,
    patrol: { radiusX: 45, radiusZ: 30, period: 94, yawLimit: 0.34 },
    roar: { hold: 5.1, period: 94, offset: 53 },
  },
]

/** Both look into the central sect, while their own anatomy stays in its normalized body space. */
export function horrorFacing(placement: HorrorPlacement): number {
  return Math.atan2(-placement.position[0], -320 - placement.position[2])
}
