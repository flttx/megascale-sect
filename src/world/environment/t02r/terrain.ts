import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three'
import { LAYOUT } from '../../worldLayout'

export const TERRAIN = { minX: -1080, maxX: 1080, minZ: -1220, maxZ: 650 }
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
export function hash(x: number, z: number, seed = 0) { const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n) }
export function noise(x: number, z: number, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz)
  return ((hash(ix, iz, seed) * (1 - u) + hash(ix + 1, iz, seed) * u) * (1 - v) + (hash(ix, iz + 1, seed) * (1 - u) + hash(ix + 1, iz + 1, seed) * u) * v) * 2 - 1
}
export const roadCurve = new CatmullRomCurve3([
  new Vector3(0, 0, 162), new Vector3(0.55, 0, 129), new Vector3(-0.65, 0, 92),
  new Vector3(0, 0, 55), new Vector3(0.5, 0, 36), new Vector3(0, 0, 20),
], false, 'centripetal')
export const roadSamples = roadCurve.getPoints(180)
export function roadAt(z: number) {
  const zz = clamp(z, 20, 162)
  let i = 0
  while (i < roadSamples.length - 2 && roadSamples[i + 1].z > zz) i++
  const a = roadSamples[i], b = roadSamples[i + 1], t = clamp((a.z - zz) / (a.z - b.z))
  return { x: a.x + (b.x - a.x) * t, width: 18.2 + 0.8 * Math.sin((zz - 20) / 142 * Math.PI * 2) }
}
export function roadDistance(x: number, z: number) {
  if (z < -65 || z > 169) return 10000
  return Math.abs(x - (z >= 20 ? roadAt(z).x : 0))
}
export function towerRadius(multiplier: number) { return 38 * multiplier + 4 }
function rectDistance(x: number, z: number, cx: number, cz: number, w: number, d: number) {
  return Math.hypot(Math.max(0, Math.abs(x - cx) - w), Math.max(0, Math.abs(z - cz) - d))
}
export function buildingDistance(x: number, z: number) {
  let d = rectDistance(x, z, 0, -320, 145, 156)
  for (const tower of LAYOUT.towers) d = Math.min(d, Math.hypot(x - tower.position[0], z - tower.position[2]) - towerRadius(tower.scaleMultiplier))
  // Leave the gate and its piers clear; the central road already has its own mask.
  d = Math.min(d, rectDistance(x, z, 0, 55, 27, 10))
  return d
}
function ridge(x: number, z: number, cx: number, cz: number, sx: number, sz: number, h: number, skew = 0) {
  const bend = 21 * Math.sin((z - cz) / 78) + 15 * noise(z / 110, cx / 300, 50)
  const u = (x - cx + (z - cz) * skew + bend) / sx, v = (z - cz) / sz
  const crest = 1 + .16 * noise(x / 76, z / 114, 46) + .10 * noise(x / 34, z / 71, 52)
  return h * Math.exp(-(u * u * 1.8 + v * v * .95) * 1.5) * crest
}
export function terrainHeight(x: number, z: number) {
  // Authored mountain mass and branching ridges establish layout before noise.
  const warpedX = x + noise(x / 95, z / 95, 2) * 38
  const warpedZ = z + noise(x / 110, z / 80, 8) * 40
  const mainDistance = rectDistance(warpedX, warpedZ, 0, -292, 195, 217)
  const cliffWidth = 164 + noise(x / 130, z / 130, 9) * 43
  const shoulder = 1 - smooth(0, 56, mainDistance)
  const face = 1 - smooth(12, cliffWidth, mainDistance)
  const scree = 1 - smooth(56, 285, mainDistance)
  let h = -186 + shoulder * 22 + face * 106 + scree * 87
  h = Math.max(h, -182 + ridge(x, z, -35, 66, 100, 210, 172, -0.16))
  h = Math.max(h, -172 + ridge(x, z, -255, -565, 215, 235, 315, 0.34))
  h = Math.max(h, -170 + ridge(x, z, 250, -610, 185, 240, 350, -0.43))
  h = Math.max(h, -162 + ridge(x, z, -405, -245, 130, 270, 214, -0.22))
  h = Math.max(h, -174 + ridge(x, z, 422, -355, 145, 220, 247, 0.28))
  // Directional gullies, bedding shelves and secondary spurs; no uniform bumps.
  const relief = smooth(-165, -65, h)
  const medium = noise(x / 41, z / 57, 4) * 24 + noise((x + z * 0.3) / 19, z / 81, 6) * 11
  const strata = (1 - Math.abs(noise(x / 27 + h / 66, z / 43, 59))) * 4
  // Oblique erosional clefts open into talus rather than tracing terrace rings.
  for (const side of [-1, 1]) {
    for (const [cz, depth, span] of [[-135, 25, 15], [-255, 32, 19], [-395, 24, 16], [-505, 36, 20]]) {
      const channel = (z - cz + (Math.abs(x) - 245) * (.33 * side + .18)) / span
      const active = smooth(190, 240, Math.abs(x)) * (1 - smooth(330, 510, Math.abs(x)))
      h -= Math.exp(-channel * channel) * depth * active
    }
  }
  h += (medium + strata) * relief + noise(x / 9, z / 13, 12) * 0.65 * relief
  // Explicit architectural cuts. Natural slopes extend beyond every slab edge.
  const platform = rectDistance(x, z, 0, -290, 191, 226)
  for (const tower of LAYOUT.towers) {
    const r = towerRadius(tower.scaleMultiplier), d = Math.hypot(x - tower.position[0], z - tower.position[2])
    h += (tower.position[1] - 0.5 - h) * (1 - smooth(r, r + 45, d))
  }
  // The protected playable platform wins over nearby tower slope influences.
  h += (23.78 - h) * (1 - smooth(0, 18 + 8 * noise(x / 58, z / 60, 77), platform))
  const spawnDistance = rectDistance(x, z, 0, 150, 15, 12)
  h += (-0.2 - h) * (1 - smooth(0, 19, spawnDistance))
  const gateDistance = rectDistance(x, z, 0, 55, 27, 10)
  h += (-0.3 - h) * (1 - smooth(0, 18, gateDistance))
  if (z >= -95 && z <= 210) {
    const road = roadAt(z), ramp = 24 * clamp((20 - z) / 85), width = z < 20 ? 18 : road.width
    const distance = Math.abs(x - (z >= 20 ? road.x : 0))
    const endBlend = smooth(-95, -65, z) * (1 - smooth(162, 210, z))
    // 26 m full influence width around the road, with additional natural fill below.
    const shoulderBlend = (1 - smooth(width / 2 + 0.6, 14, distance)) * endBlend
    h += (ramp - 0.20 - h) * shoulderBlend
    const apron = Math.max(0, distance - width / 2)
    const cuts = noise(x / 19, z / 29, 103) * 9 * smooth(12, 35, distance)
    const embankment = ramp - 0.7 - apron * (0.65 + 0.18 * Math.sin(z * 0.035)) + cuts
    h += (Math.max(h, embankment - smooth(28, 120, distance) * 85) - h) * endBlend
  }
  return h
}
export function slopeAt(x: number, z: number) {
  const dx = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2
  const dz = (terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2
  return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI
}
function coordinates(min: number, max: number, denseMin: number, denseMax: number) {
  const values = [min]
  for (let p = min; p < max;) { p = Math.min(max, p + (p >= denseMin && p < denseMax ? 3 : 8)); values.push(p) }
  return values
}
export function heightMesh(xs: number[], zs: number[], height: (x: number, z: number) => number) {
  const positions: number[] = [], indices: number[] = []
  for (const z of zs) for (const x of xs) positions.push(x, height(x, z), z)
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals()
  return g
}
export function makeTerrain() {
  const xs = coordinates(TERRAIN.minX, TERRAIN.maxX, -350, 350)
  const zs = coordinates(TERRAIN.minZ, TERRAIN.maxZ, -560, 185)
  // Add exact artificial edges to prevent triangles bridging over the roads/cuts.
  xs.push(-191, -15, -9, 0, 9, 15, 191); zs.push(-516, -65, 20, 45, 55, 65, 138, 150, 162)
  return heightMesh([...new Set(xs)].sort((a, b) => a - b), [...new Set(zs)].sort((a, b) => a - b), terrainHeight)
}
export function makeDistantRidge(layer: number) {
  const xs = Array.from({ length: 341 }, (_, i) => -1700 + i * 10)
  const zs = Array.from({ length: 27 }, (_, i) => -1050 - layer * 270 + i * 18)
  return heightMesh(xs, zs, (x, z) => {
    const center = -835 - layer * 270 + Math.sin(x / 230 + layer) * 38
    const crest = 130 + layer * 45 + 95 * noise(x / 270, layer, 25) + 42 * noise(x / 110, layer, 31)
    const cross = Math.exp(-Math.pow((z - center) / (90 + layer * 10), 2))
    return -175 + crest * 1.8 * cross + 17 * noise(x / 53, z / 81, 33) * cross
  })
}
export function makeRoad(shoulder = false) {
  const positions: number[] = [], indices: number[] = []
  roadSamples.forEach((point, i) => {
    const half = roadAt(point.z).width / 2
    const widths = shoulder ? [-half - 3, -half, half, half + 3] : [-half, half]
    for (const w of widths) positions.push(point.x + w, shoulder ? -0.055 - Math.max(0, Math.abs(w) - half) * 0.04 : 0.025, point.z)
    if (i === 0) return
    const n = widths.length
    for (let j = 0; j < n - 1; j++) {
      if (shoulder && j === 1) continue
      const a = (i - 1) * n + j, b = a + 1, c = i * n + j, d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  })
  if (!shoulder) {
    // A shallow roadbed intersects the carved terrain; exposed edges have
    // thickness, so neither the paved ribbon nor its shoulders float in air.
    const topCount = positions.length / 3
    for (let i = 0; i < topCount; i++) positions.push(positions[i * 3], -0.28, positions[i * 3 + 2])
    for (let i = 0; i < roadSamples.length - 1; i++) for (const side of [0, 1]) {
      const a = i * 2 + side, b = a + 2, c = a + topCount, d = b + topCount
      if (side === 0) indices.push(a, c, b, b, c, d)
      else indices.push(a, b, c, b, d, c)
    }
    indices.push(0, 1, topCount, 1, topCount + 1, topCount)
    const a = topCount - 2
    indices.push(a, a + topCount, a + 1, a + 1, a + topCount, a + topCount + 1)
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals()
  return g
}
