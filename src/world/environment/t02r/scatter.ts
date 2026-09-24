import { LAYOUT } from '../../worldLayout'
import { buildingDistance, hash, noise, roadAt, roadDistance, slopeAt, terrainHeight } from './terrain'

export type RockInstance = { position: [number, number, number]; scale: [number, number, number]; rotation: [number, number, number]; variant: number; slope: number; roadDistance: number; buildingDistance: number; hero: boolean }
export function makeScatter() {
  const rocks: RockInstance[] = []
  function add(x: number, z: number, size: number, seed: number, hero: boolean) {
    const distance = roadDistance(x, z), building = buildingDistance(x, z)
    if (distance < (z < 20 ? 13 : roadAt(z).width / 2 + 2.2) + size * 0.65 || building < size * 0.6 + 1) return
    if (Math.abs(x) < 192 && z < -64 && z > -516) return
    if (Math.abs(x) < 19 && z > 135) return
    const y = terrainHeight(x, z), slope = slopeAt(x, z)
    rocks.push({ position: [x, y - size * .16, z], scale: [size * (.7 + hash(seed, 3) * .45), size * (.55 + hash(seed, 4) * .7), size * (.65 + hash(seed, 7) * .55)], rotation: [(hash(seed, 5) - .5) * .4, hash(seed, 6) * Math.PI * 2, (hash(seed, 8) - .5) * .3], variant: Math.floor(hash(seed, 9) * 4), slope, roadDistance: distance, buildingDistance: building, hero })
  }
  // Authored clusters around cliff breaks, stairs and the backs of the towers.
  const clusters = [[-45,60], [40,20],[-35,-30],[36,-55],[-230,-93],[237,-112],[-292,-232],[302,-274],[-331,-412],[330,-482],[-110,-575],[150,-588]]
  let seed = 1
  for (const [cx, cz] of clusters) for (let i = 0; i < 8; i++) {
    const x = cx + (hash(seed, 11) - .5) * 44, z = cz + (hash(seed, 12) - .5) * 60
    add(x, z, 5 + hash(seed, 13) * 10, seed++, true)
  }
  for (let i = 0; i < 3100; i++) {
    const x = (hash(i, 21) - .5) * 1040, z = -770 + hash(i, 22) * 970
    const slope = slopeAt(x, z), y = terrainHeight(x, z), cluster = noise(x / 44, z / 52, 61)
    const density = slope > 26 && slope < 67 ? .55 : y < -65 && y > -165 ? .40 : .08
    if (hash(i, 23) > density || cluster < -.25) continue
    add(x, z, 1.1 + Math.pow(hash(i, 24), 2) * 4.5, i + 100, false)
  }
  // Road shoulders get small gravel rather than large obstructions.
  for (let i = 0; i < 160; i++) {
    const z = -60 + hash(i, 41) * 218, road = roadAt(z), side = i % 2 ? -1 : 1
    add((z > 20 ? road.x : 0) + side * (road.width / 2 + 3.1 + hash(i, 43) * 3), z, .25 + hash(i, 44) * .65, i + 4300, false)
  }
  return rocks
}
export const towerFootings = LAYOUT.towers.map(t => ({ ...t, width: 48.8 * t.scaleMultiplier + 4, depth: 49.4 * t.scaleMultiplier + 4 }))
