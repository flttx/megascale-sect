import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three'
import { BRIDGES, bridgeDeck } from '../../bridges'
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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Polynomial smooth minimum / maximum: blends two height fields over a band of width k. */
function smin(a: number, b: number, k: number) {
  if (Math.abs(a - b) >= k) return Math.min(a, b)
  const t = clamp(0.5 + 0.5 * (b - a) / k); return b + (a - b) * t - k * t * (1 - t)
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)
/** Ridged value noise in 0..1: sharp crests where the noise crosses zero. */
function ridged(x: number, z: number, seed: number, octaves = 3) {
  let sum = 0, amplitude = 0.5, frequency = 1, weight = 1
  for (let i = 0; i < octaves; i++) {
    const n = (1 - Math.abs(noise(x * frequency, z * frequency, seed + i * 7))) ** 2 * weight
    weight = clamp(n * 1.6)
    sum += n * amplitude; amplitude *= 0.5; frequency *= 2.03
  }
  return sum / 0.875
}

/** Outer ground, far below the cloud sea; only rifts ever show it. */
export const TERRAIN_BASE = -420

/** Horizontal distance (m) from the summit massif: the platform rim, every tower pad and the approach spine. */
function massifDistance(x: number, z: number) {
  const wx = x + noise(x / 150, z / 150, 2) * 30 + noise(x / 43, z / 49, 3) * 10
  const wz = z + noise(x / 160, z / 130, 8) * 30 + noise(x / 47, z / 41, 5) * 10
  let d = rectDistance(wx, wz, 0, -290, 214, 238)
  for (const tower of LAYOUT.towers) d = smin(d, Math.hypot(wx - tower.position[0], wz - tower.position[2]) - towerRadius(tower.scaleMultiplier) - 30, 40)
  d = smin(d, rectDistance(wx, wz, 0, 62, 36, 118), 50)
  // The warp may bend the rim, never cut into the slab, a tower pad or the road.
  d = Math.min(d, rectDistance(x, z, 0, -290, 198, 233), rectDistance(x, z, 0, 62, 24, 116))
  for (const tower of LAYOUT.towers) d = Math.min(d, Math.max(0, Math.hypot(x - tower.position[0], z - tower.position[2]) - towerRadius(tower.scaleMultiplier) - 14))
  return Math.max(0, d)
}

// [from x, z, to x, z, crest at start, crest at end, flank gradient]
const SPURS: [number, number, number, number, number, number, number][] = [
  [-235, -240, -650, -165, 10, -330, 1.25],
  [255, -395, 670, -475, 6, -345, 1.15],
  // Saddles that climb from the summit's back corners into the two karst peaks.
  [-232, -515, -318, -632, 2, 70, 1.45],
  [236, -528, 330, -668, 0, 95, 1.45],
  // The approach spine's nose, sinking into the clouds behind the spawn.
  [0, 176, 26, 440, -3, -360, 1.05],
]
function spur(x: number, z: number, index: number) {
  const [ax, az, bx, bz, ha, hb, gradient] = SPURS[index]
  const vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz)
  const along = ((x - ax) * vx + (z - az) * vz) / length
  const lateral = Math.abs(((x - ax) * vz - (z - az) * vx) / length)
  const beyond = Math.max(0, -along, along - length)
  const t = clamp(along / length)
  const crestRelief = 60 * (1 - 0.5 * t)
  // Cheap reject: this spur cannot reach above the outer ground here.
  if (lerp(ha, hb, t) + crestRelief - (lateral + beyond) * gradient * 0.7 < TERRAIN_BASE - 40) return -Infinity
  const crest = lerp(ha, hb, t ** 1.25) + (ridged(along / 95, index * 3.7, 71 + index) - 0.55) * crestRelief
  // Gullies score the flanks; the crest line wanders.
  const flank = lateral + noise(along / 70, index, 81) * 16 + (1 - Math.abs(noise(along / 38, lateral / 90, 83))) * 9
  return crest - Math.hypot(Math.max(0, flank), beyond) * gradient * (1 + 0.25 * noise(x / 90, z / 90, 85))
}

// [centre x, z, radius, summit]: sheer karst peaks framing the hall from the front, leaving the back view open.
const PEAKS: [number, number, number, number][] = [
  [-335, -662, 128, 250], [-455, -590, 72, 150],
  [348, -704, 142, 320], [470, -618, 80, 185],
]
function peak(x: number, z: number, index: number) {
  const [cx, cz, radius, summit] = PEAKS[index]
  const dx = x - cx, dz = z - cz, distance = Math.hypot(dx, dz)
  if (distance > radius * 1.7) return -Infinity
  // Lobed plan from noise sampled around a circle, so it closes seamlessly.
  const c = distance > 1e-3 ? dx / distance : 1, sn = distance > 1e-3 ? dz / distance : 0
  const lobes = noise(c * 1.7 + index * 9, sn * 1.7, 31) * 0.24 + noise(c * 4.3 + index * 9, sn * 4.3, 37) * 0.09
    + (ridged(c * 9 + index * 9, sn * 9, 43, 2) - 0.45) * 0.13 + noise(dx / 11, dz / 11, 47) * 0.025
  const t = distance / (radius * (1 + lobes))
  const cap = (1 - Math.min(t, 1) ** 2) * radius * 0.1 + ridged(dx / 45, dz / 45, 41 + index) * 14
  // Stepped profile: ledges every ~20% of the drop where pines and moss can hold on.
  const fall = smooth(0.6, 1.12, t), q = fall * 5, stepped = (Math.floor(q) + smooth(0.25, 0.75, q - Math.floor(q))) / 5
  return summit + cap - (summit - TERRAIN_BASE + 20) * lerp(fall, stepped, 0.55)
}

/** Natural ground before the architectural cuts: summit massif, cliffs, spurs and peaks. */
function naturalHeight(x: number, z: number) {
  const forward = smooth(-75, 12, z)
  const rise = smooth(-150, -480, z) * smooth(120, 280, Math.abs(x))
  let top = lerp(24 + rise * 22, -1, forward) + noise(x / 61, z / 67, 4) * 3.5 + noise(x / 17, z / 23, 6) * 1.1
  top -= smooth(150, 205, z) * (z - 150) * 0.3
  let h = top
  const d = massifDistance(x, z)
  if (d > 0) {
    const cliffHeight = 165 + noise(x / 170, z / 170, 9) * 55, cliffWidth = 40 + noise(x / 83, z / 83, 13) * 16
    // Vertical flutes and buttresses: any xz offset of the rim distance becomes a rib running down the face.
    const fluted = d + (ridged(x / 21, z / 21, 23, 2) - 0.45) * 14 * smooth(0, 18, d) + noise(x / 9, z / 9, 25) * 3 * smooth(0, 10, d)
    const fall = smooth(0, cliffWidth, fluted)
    // Rounded karst rim, near-vertical face, then a talus apron that runs on under the clouds.
    h = top - cliffHeight * fall - Math.max(0, fluted - cliffWidth * 0.7) * 1.05
    // Bedding ledges, strongest mid-face.
    const step = 13 + noise(x / 200, z / 200, 21) * 3, k = h / step
    const terrace = (Math.floor(k) + smooth(0.3, 0.7, k - Math.floor(k))) * step
    h = lerp(h, terrace, 1.8 * fall * (1 - fall))
  }
  for (let i = 0; i < SPURS.length; i++) h = smax(h, spur(x, z, i), 30)
  for (let i = 0; i < PEAKS.length; i++) h = smax(h, peak(x, z, i), 45)
  const base = TERRAIN_BASE + noise(x / 260, z / 260, 17) * 28 + ridged(x / 180, z / 180, 19, 2) * 26
  return smax(h, base, 30)
}

export function terrainHeight(x: number, z: number) {
  let h = naturalHeight(x, z)
  // Explicit architectural cuts. Natural slopes extend beyond every slab edge.
  const platform = rectDistance(x, z, 0, -290, 191, 226)
  for (const tower of LAYOUT.towers) {
    const r = towerRadius(tower.scaleMultiplier), d = Math.hypot(x - tower.position[0], z - tower.position[2])
    h += (tower.position[1] - 0.5 - h) * (1 - smooth(r, r + 45, d))
  }
  // The protected playable platform wins over nearby tower slope influences.
  h += (23.78 - h) * (1 - smooth(0, 18 + 8 * noise(x / 58, z / 60, 77), platform))
  // Beyond the slab the bridges cross a low shoulder before the cliff rim; cut a shallow trench just under each
  // deck (as they land in a notch on the isles), so no plank is buried. The planks start at the slab edge (x ±190).
  for (const b of BRIDGES) {
    const deck = bridgeDeck(b, x, z), target = deck.y - 0.3
    if (deck.t > 0 && deck.t < 1 && h > target) h += (target - h) * (1 - smooth(b.halfWidth + 1.4, b.halfWidth + 4.6, deck.side)) * smooth(0, 1.5, rectDistance(x, z, 0, -290, 189.5, 226))
  }
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
    h += (Math.max(h, embankment - smooth(22, 48, distance) * 300) - h) * endBlend
  }
  return h
}
export function slopeAt(x: number, z: number) {
  const dx = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2
  const dz = (terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2
  return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI
}
/** Grid lines from min to max; each [from, to, step] tier refines the spacing inside it (finest listed last). */
function coordinates(min: number, max: number, tiers: [number, number, number][], coarse: number) {
  const values = [min]
  for (let p = min; p < max;) {
    let step = coarse
    for (const [a, b, s] of tiers) if (p >= a && p < b) step = s
    p = Math.min(max, p + step); values.push(p)
  }
  return values
}
export function heightMesh(xs: number[], zs: number[], height: (x: number, z: number) => number) {
  const positions = new Float32Array(xs.length * zs.length * 3), indices: number[] = []
  let o = 0
  for (const z of zs) for (const x of xs) { positions[o++] = x; positions[o++] = height(x, z); positions[o++] = z }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals()
  return g
}
export function makeTerrain() {
  // 3 m on the summit and its cliffs, 6 m over the spurs and peaks, 12 m for ground that stays under the clouds.
  const xs = coordinates(TERRAIN.minX, TERRAIN.maxX, [[-720, 720, 6], [-360, 360, 3]], 12)
  const zs = coordinates(TERRAIN.minZ, TERRAIN.maxZ, [[-900, 460, 6], [-600, 240, 3]], 12)
  // Add exact artificial edges to prevent triangles bridging over the roads/cuts.
  xs.push(-191, -15, -9, 0, 9, 15, 191); zs.push(-516, -65, 20, 45, 55, 65, 138, 150, 162)
  const X = [...new Set(xs)].sort((a, b) => a - b), Z = [...new Set(zs)].sort((a, b) => a - b)
  const g = heightMesh(X, Z, terrainHeight)
  g.setAttribute('surfaceMask', new Float32BufferAttribute(surfaceMask(X, Z, g.getAttribute('position').array), 2))
  // The grid lines, so the grass can sample the rendered triangles rather than the analytic height.
  g.userData.grid = { xs: X, zs: Z } satisfies TerrainGrid
  return g
}
export interface TerrainGrid { xs: number[]; zs: number[] }
/**
 * Per-vertex hints for the terrain shader: R = worn verges beside the road and the platform rim,
 * G = concavity (hollows and cliff feet, where scree and soil collect), from the grid's own curvature.
 */
function surfaceMask(xs: number[], zs: number[], positions: ArrayLike<number>) {
  const out = new Float32Array(xs.length * zs.length * 2), n = xs.length
  const y = (i: number, j: number) => positions[(j * n + i) * 3 + 1]
  const curvature = (h0: number, h1: number, h2: number, d0: number, d1: number) => ((h2 - h1) / d1 - (h1 - h0) / d0) / ((d0 + d1) / 2)
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < n; i++) {
    const x = xs[i], z = zs[j], h = y(i, j)
    let concave = 0
    if (i > 0 && j > 0 && i < n - 1 && j < zs.length - 1) {
      concave = curvature(y(i - 1, j), h, y(i + 1, j), x - xs[i - 1], xs[i + 1] - x) + curvature(y(i, j - 1), h, y(i, j + 1), z - zs[j - 1], zs[j + 1] - z)
    }
    const verge = Math.max(1 - smooth(9, 24, roadDistance(x, z)), (1 - smooth(0, 10, rectDistance(x, z, 0, -290, 191, 226))) * smooth(-1, 1, rectDistance(x, z, 0, -290, 191, 226)) * 0.55)
    out[(j * n + i) * 2] = verge
    out[(j * n + i) * 2 + 1] = smooth(0.015, 0.09, concave)
  }
  return out
}

export const DISTANT_RIDGE_LAYERS = 4
/** Z extent of a distant ridge layer's mesh. */
export const distantRidgeBand = (layer: number) => [-1700 - layer * 380, -1100 - layer * 380] as const
/** Serrated karst ranges behind the sect, rising from the cloud floor to 150–750 m. */
export function distantRidgeHeight(layer: number, x: number, z: number) {
  const center = -1400 - layer * 380 + Math.sin(x / 230 + layer) * 45 + noise(x / 400, layer, 27) * 40
  // Ends sink into the cloud sea so the 3.4 km strips never show a cut edge.
  const crest = (0.35 + 0.65 * ridged(x / (300 - layer * 30), layer * 2.3, 25 + layer)) * (560 + 150 * layer) * (0.75 + 0.25 * noise(x / 900, layer, 29)) * (1 - smooth(1250, 1680, Math.abs(x)))
  // Sharp-crested cross-section: steep faces fall to the cloud floor, gullied by lateral noise.
  const across = Math.abs(z - center) / (120 + layer * 30) + (1 - Math.abs(noise(x / 60, z / 90, 33))) * 0.12
  return TERRAIN_BASE + crest * Math.exp(-across * 2.1) + 22 * noise(x / 53, z / 81, 35) * Math.exp(-across)
}
export function makeDistantRidge(layer: number) {
  const xs = Array.from({ length: 341 }, (_, i) => -1700 + i * 10)
  const [minZ] = distantRidgeBand(layer)
  const zs = Array.from({ length: 31 }, (_, i) => minZ + i * 20)
  return heightMesh(xs, zs, (x, z) => distantRidgeHeight(layer, x, z))
}

export const FAR_RING_RADII = [3000, 3900, 4800] as const
/**
 * A ring of peaks around the whole horizon, 3–5 km out. Heights come from noise sampled on a circle, so the
 * ring closes seamlessly; broad gaps leave open sky over the cloud sea in some directions.
 */
export function farRingHeight(layer: number, angle: number, radial: number) {
  const c = Math.cos(angle), sn = Math.sin(angle), f = 5 + layer * 2
  const open = smooth(-0.25, 0.3, noise(c * 1.3 + layer * 5, sn * 1.3, 91 + layer))
  const crest = (0.3 + 0.7 * ridged(c * f + layer * 11, sn * f, 93 + layer)) * (1000 + layer * 300) * (0.25 + 0.75 * open)
  const across = Math.abs(radial) / (260 + layer * 60) + (1 - Math.abs(noise(c * 40 + layer, radial / 120, 97))) * 0.15
  return TERRAIN_BASE - 30 + crest * Math.exp(-across * 2)
}
export function makeFarRing(layer: number) {
  const radius = FAR_RING_RADII[layer], segments = 900, rows = 22, width = 760
  const positions = new Float32Array((segments + 1) * rows * 3), indices: number[] = []
  let o = 0
  for (let j = 0; j < rows; j++) {
    const radial = (j / (rows - 1) - 0.5) * width
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      positions[o++] = Math.cos(angle) * (radius + radial)
      positions[o++] = farRingHeight(layer, angle, radial)
      positions[o++] = -290 + Math.sin(angle) * (radius + radial)
    }
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1
    indices.push(a, b, c, b, d, c)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals()
  return g
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
