export interface TentaclePlacement {
  root: readonly [number, number, number]
  height: number
  yaw: number
  delay: number
}

/** Full curled bodies face into the rear ranges, clear of the Kun's complete flight envelope. */
export const TENTACLES: readonly TentaclePlacement[] = [
  { root: [-620, -140, -1940], height: 1100, yaw: -Math.PI / 2, delay: 0 },
  { root: [620, -140, -2000], height: 1200, yaw: Math.PI / 2, delay: 0.7 },
  { root: [-1350, -140, -3090], height: 1250, yaw: -1.65, delay: 1.4 },
  { root: [1350, -140, -3170], height: 1200, yaw: 1.65, delay: 0.3 },
  { root: [-2200, -140, -4520], height: 1350, yaw: -1.85, delay: 1.1 },
  { root: [2200, -140, -4620], height: 1420, yaw: 1.85, delay: 1.8 },
]
