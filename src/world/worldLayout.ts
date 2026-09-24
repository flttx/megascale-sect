export const LAYOUT = {
  spawn: { position: [0, 0, 150] as const, size: [30, 24] as const },
  road: { width: 16, fromZ: 162, toZ: 20 },
  gate: { position: [0, 0, 55] as const, rotation: [0, Math.PI / 2, 0] as const },
  stairs: { startZ: 20, endZ: -65, height: 24, width: 18, steps: 96 },
  platform: { frontZ: -65, backZ: -515, width: 380, height: 24, slabDepth: 12 },
  main: { position: [0, 24, -320] as const, rotation: [0, 0, 0] as const },
  mainCollider: { halfWidth: 136, halfDepth: 147, minY: 24, maxY: 446 },
  towers: [
    { position: [-200, 24, -170] as const, rotation: [0, 0.22, 0] as const, scaleMultiplier: 1 },
    { position: [200, 24, -185] as const, rotation: [0, -0.19, 0] as const, scaleMultiplier: 0.96 },
    { position: [-242, 34, -295] as const, rotation: [0, 0.44, 0] as const, scaleMultiplier: 0.78 },
    { position: [238, 29, -330] as const, rotation: [0, -0.3, 0] as const, scaleMultiplier: 0.85 },
    { position: [-273, 48, -425] as const, rotation: [0, 0.62, 0] as const, scaleMultiplier: 0.68 },
    { position: [268, 42, -465] as const, rotation: [0, -0.55, 0] as const, scaleMultiplier: 0.72 },
  ],
  player: { height: 1.75, walkSpeed: 3.2, runSpeed: 7, flightSpeed: 30, flightBoostSpeed: 70, gravity: 28 },
  worldLimit: 1100,
} as const

export function groundHeight(x: number, z: number): number | null {
  const { spawn, road, stairs, platform } = LAYOUT
  if (insideMainFootprint(x, z)) return null
  if (Math.abs(x) <= spawn.size[0] / 2 && z >= 138 && z <= 162) return 0
  if (Math.abs(x) <= road.width / 2 && z >= stairs.startZ && z <= road.fromZ) return 0
  if (Math.abs(x) <= stairs.width / 2 && z <= stairs.startZ && z >= stairs.endZ) {
    return ((stairs.startZ - z) / (stairs.startZ - stairs.endZ)) * stairs.height
  }
  if (Math.abs(x) <= platform.width / 2 && z <= platform.frontZ && z >= platform.backZ) return platform.height
  return null
}

export function insideMainFootprint(x: number, z: number): boolean {
  return Math.abs(x - LAYOUT.main.position[0]) < LAYOUT.mainCollider.halfWidth &&
    Math.abs(z - LAYOUT.main.position[2]) < LAYOUT.mainCollider.halfDepth
}

export function insideMainCollider(x: number, y: number, z: number): boolean {
  return insideMainFootprint(x, z) && y >= LAYOUT.mainCollider.minY - 1 && y <= LAYOUT.mainCollider.maxY + 1
}
