import { BufferAttribute, BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash, noise } from '../environment/t02r/terrain'
import { BRIDGES, ISLANDS, PILLAR_BASE_Y, PILLARS } from '../sites'
import type { BridgeSite, IslandSite, PillarSite } from '../sites'

/**
 * Procedural karst: every pillar and floating island is a unique displaced ring grid (world space),
 * merged into one geometry so the whole field costs one draw plus one per shadow cascade.
 */

const TAU = Math.PI * 2

/** `rows` rings × `segs` around, wrapped in θ (no seam); row 0 is the top, rows run outward then down. */
function ringGrid(rows: number, segs: number, vertex: (row: number, theta: number, out: number[]) => void) {
  const position = new Float32Array(rows * segs * 3), color = new Float32Array(rows * segs * 3), out = [0, 0, 0, 1, 0]
  for (let i = 0; i < rows; i++) for (let j = 0; j < segs; j++) {
    out[3] = 1; out[4] = 0
    vertex(i, (j / segs) * TAU, out)
    position.set(out.slice(0, 3), (i * segs + j) * 3)
    // out[3]: painted shade (grooves, undersides); out[4]: moss stain creeping down from shelves and crowns.
    const shade = out[3], moss = Math.min(1, Math.max(0, out[4]))
    color.set([shade * (1 - moss * 0.4), shade * (1 - moss * 0.18), shade * (1 - moss * 0.52)], (i * segs + j) * 3)
  }
  const index = new Uint32Array((rows - 1) * segs * 6)
  let k = 0
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, c = a + segs, d = b + segs
    index.set([a, b, c, b, d, c], k); k += 6
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('color', new BufferAttribute(color, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeVertexNormals()
  return geometry
}

/** Seamless around θ: two 2D noises over the unit circle (scaled by `k` ≈ features per quarter turn) and y. */
function ringNoise(theta: number, k: number, v: number, seed: number) {
  return (noise(Math.cos(theta) * k + seed * 7.1, v) + noise(Math.sin(theta) * k - seed * 3.3, v + 19.7)) * 0.5
}

interface Row { y: number; r: number; kind: 'top' | 'rim' | 'side' }

/** Per-pillar silhouette: taper toward the summit and the summit's radius (the walkable disc is 0.7× it). */
function pillarShape(p: PillarSite) {
  const seed = PILLARS.indexOf(p) + 1, taper = 0.04 + hash(seed, 5, 610) * 0.3
  // Some pillars step out below a narrower summit tier: a broad mossy shoulder partway down.
  const tierDepth = hash(seed, 13, 625) < 0.45 ? (p.topY - PILLAR_BASE_Y) * (0.1 + hash(seed, 14, 626) * 0.2) : 0, tierOut = 0.22 + hash(seed, 15, 627) * 0.2
  const narrow = tierDepth ? 1 - tierOut * 0.5 : 1
  return { seed, taper, tierDepth, tierOut, narrow, topR: p.radius * (1.02 - taper) * narrow * (0.9 + hash(seed, 12, 621) * 0.08) }
}
export function pillarTopRadius(p: PillarSite) { return pillarShape(p).topR }

function pillarGeometry(p: PillarSite) {
  const T = p.topY, R = p.radius, B = PILLAR_BASE_Y, H = T - B
  const { seed, taper, tierDepth, tierOut, narrow, topR } = pillarShape(p)
  const spacing = 11 + hash(seed, 1, 611) * 22, ledge = R * (0.035 + hash(seed, 2, 612) * 0.05)
  const bulgeAt = 0.35 + hash(seed, 3, 613) * 0.4, bulge = (hash(seed, 4, 614) - 0.35) * 0.3
  const leanA = hash(seed, 6, 615) * TAU, lean = R * hash(seed, 7, 616) * 0.35
  const tiltA = hash(seed, 8, 617) * TAU, tilt = 0.8 + hash(seed, 9, 618) * 1.6
  const rows: Row[] = [
    { y: T, r: 0, kind: 'top' }, { y: T, r: 0.4, kind: 'top' }, { y: T, r: 0.74, kind: 'top' },
    { y: T - 0.25, r: 0.86, kind: 'rim' }, { y: T - 1.1, r: 0.96, kind: 'rim' }, { y: T - 3, r: 1, kind: 'side' },
  ]
  // Bedding planes (depths below the summit), irregularly spaced; each gets its own shelf strength.
  const planes: number[] = []
  for (let d = spacing * (0.5 + hash(seed, 10, 619) * 0.6); T - d > -110; d += spacing * (0.55 + hash(seed, d, 620) * 0.9)) planes.push(d)
  // Shaft rows: dense above the cloud sea, sparse below it; a tight pair at each plane makes a shelf.
  const shaft: number[] = []
  for (let y = T - 7; y > B; y -= y > -95 ? 5.5 : 22) shaft.push(y)
  planes.forEach((d) => shaft.push(T - d - 0.1, T - d + 0.6))
  if (tierDepth) shaft.push(T - tierDepth + 0.8, T - tierDepth - 0.4, T - tierDepth - 2.5)
  shaft.sort((a, b) => b - a).filter((y, i, list) => i === 0 || list[i - 1] - y > 0.3).forEach((y) => rows.push({ y, r: 1, kind: 'side' }))
  rows.push({ y: B, r: 1, kind: 'side' })
  /** Undercut bands: full lip just below a plane, tapering inward to the next plane down. */
  const band = (depth: number, theta: number) => {
    let above = -1, below = Infinity
    for (let k = 0; k < planes.length; k++) { if (planes[k] <= depth) above = k; else { below = planes[k]; break } }
    if (below === Infinity || above < 0) return 0
    const strength = 0.25 + hash(seed, above, 622) * 0.75, reach = Math.max(0, ringNoise(theta, 1.8, above * 1.7, seed) + 0.45)
    return strength * Math.min(1, reach) * (1 - (depth - planes[above]) / (below - planes[above]))
  }
  return ringGrid(rows.length, 44, (i, theta, out) => {
    const row = rows[i], s = (row.y - B) / H
    let r = topR * row.r, y = row.y
    if (row.kind !== 'top') {
      const profile = 1.04 - taper * s + bulge * Math.exp(-(((s - bulgeAt) / 0.22) ** 2))
      // Solution fluting: long ridged grooves plus broad lobes, stretched vertically like rain-cut karst.
      const flute = 1 - Math.abs(ringNoise(theta, 4.2, row.y / 120, seed)), groove = 1 - Math.abs(ringNoise(theta, 9, row.y / 60, seed + 7))
      const ribs = (flute - 0.62) * 0.32 + (groove - 0.6) * 0.1 + ringNoise(theta, 1.5, row.y / 170, seed + 3) * 0.24 + ringNoise(theta, 12, row.y / 22, seed + 5) * 0.05
      const depth = T - row.y, tier = tierDepth && depth > tierDepth ? Math.min(1, (depth - tierDepth) / 2.5) * tierOut * (1 - 0.3 * Math.min(1, (depth - tierDepth) / 60)) : 0
      const shaftR = R * profile * (1 + ribs + tier) * narrow + ledge * band(depth, theta)
      // Paint the relief: grooves and the deep shaft read darker, ridges catch the light.
      out[3] = (0.84 + flute * 0.12 + groove * 0.08) * (0.8 + 0.2 * Math.min(1, Math.max(0, (row.y + 90) / 120)))
      const drip = ringNoise(theta, 7, row.y / 40, seed + 11) * 0.5 + 0.5
      out[4] = Math.max(1 - depth / (8 + drip * 14), tierDepth && depth > tierDepth ? 1 - (depth - tierDepth - 1) / (4 + drip * 10) : 0) * (0.5 + drip * 0.6)
      r = row.kind === 'rim' ? topR * row.r * (1 + Math.max(-0.1, Math.min(0.06, ribs * 0.4))) : shaftR
      // Eroded, jagged crown: the rim dips and rises in teeth; the inner summit stays flat.
      if (row.kind === 'rim') y += (ringNoise(theta, 2.4, seed, seed) * 1.6 + Math.max(0, ringNoise(theta, 5, seed * 3, seed) - 0.25) * 6) * (row.r > 0.9 ? 0.6 : 1)
      else y += Math.cos(theta - tiltA) * tilt
    }
    // Lean pivots about the summit so the walkable top stays centred on the site; the shaft wanders a little.
    const wander = R * 0.16 * Math.min(1, (T - row.y) / 70)
    out[0] = p.x + Math.cos(theta) * r + Math.cos(leanA) * lean * (s - 1) + noise(row.y / 150, seed * 1.3, 623) * wander
    out[1] = y
    out[2] = p.z + Math.sin(theta) * r + Math.sin(leanA) * lean * (s - 1) + noise(row.y / 150 + 40, seed * 2.1, 624) * wander
  })
}

interface Deck { t: number; side: number; y: number }
function deckAt(b: BridgeSite, x: number, z: number): Deck {
  const dx = b.to[0] - b.from[0], dz = b.to[2] - b.from[2], len = Math.hypot(dx, dz)
  const t = ((x - b.from[0]) * dx + (z - b.from[2]) * dz) / (len * len)
  const side = Math.abs((x - b.from[0]) * dz - (z - b.from[2]) * dx) / len
  return { t, side, y: b.from[1] + (b.to[1] - b.from[1]) * t - b.sag * 4 * t * (1 - t) }
}

function islandGeometry(isle: IslandSite, seed: number) {
  const [cx, T, cz] = isle.top, P = isle.padRadius, R = isle.radius, D = isle.depth
  const bridge = BRIDGES.find((b) => b.island === isle.id)
  const rows: Row[] = [
    { y: T, r: 0, kind: 'top' }, { y: T, r: P * 0.4, kind: 'top' }, { y: T, r: P * 0.75, kind: 'top' }, { y: T, r: P, kind: 'top' },
    { y: T, r: P + 0.3, kind: 'top' }, { y: T, r: P + 2, kind: 'top' },
    { y: T - 0.3, r: P + 2 + (R - P - 2) * 0.55, kind: 'rim' }, { y: T - 0.9, r: R * 0.97, kind: 'rim' },
    { y: T - 2.2, r: R * 1.02, kind: 'side' }, { y: T - 4.5, r: R * 1.0, kind: 'side' },
  ]
  const K = Math.ceil(D / 2.6)
  for (let k = 1; k <= K; k++) {
    const s = k / K
    rows.push({ y: T - 4.5 - s * (D - 4.5), r: R * Math.pow(1 - s, 0.72) * (1 - 0.06 * Math.sin(s * 9)), kind: 'side' })
  }
  const tipA = hash(seed, 1, 630) * TAU, tipOff = R * (0.15 + hash(seed, 2, 631) * 0.2)
  return ringGrid(rows.length, 104, (i, theta, out) => {
    const row = rows[i]
    let r = row.r, y = row.y
    if (row.kind === 'rim') {
      r *= 1 + ringNoise(theta, 3, seed, seed) * 0.05
      y += ringNoise(theta, 4, seed + 2, seed) * 0.35
    } else if (row.kind === 'side') {
      const s = (T - row.y) / D
      // Craggy: fine vertical ribs that lengthen into hanging drips toward the underside.
      const crag = ringNoise(theta, 3, row.y / (10 + s * 20), seed) * (0.08 + s * 0.22) + ringNoise(theta, 9, row.y / 6, seed + 9) * (0.03 + s * 0.08)
      r *= 1 + crag
      out[3] = 1 - s * 0.32 + crag * 0.6
      y -= Math.max(0, ringNoise(theta, 6, seed, seed + 4)) * s * D * 0.12
    }
    const s = Math.max(0, (T - y) / D)
    const x = cx + Math.cos(theta) * r + Math.cos(tipA) * tipOff * s * s
    const z = cz + Math.sin(theta) * r + Math.sin(tipA) * tipOff * s * s
    // The bridge lands in a shallow notch cut to deck height (the pad itself stays flat).
    if (bridge && row.kind !== 'side' && row.r > P + 0.1) {
      const deck = deckAt(bridge, x, z)
      if (deck.t > 0 && deck.t < 1.02) {
        const w = 1 - Math.min(1, Math.max(0, (deck.side - bridge.halfWidth - 0.4) / 1.6))
        y = Math.min(y, y + (deck.y - 0.14 - y) * w * w * (3 - 2 * w))
      }
    }
    out[0] = x; out[1] = y; out[2] = z
  })
}

/** Small flat-topped boulders drifting around an island: miniature islands, same material. */
function driftRock(x: number, y: number, z: number, size: number, seed: number) {
  const rows: Row[] = [{ y: 0, r: 0, kind: 'top' }, { y: 0, r: 0.7, kind: 'top' }, { y: -0.15, r: 1, kind: 'rim' }, { y: -0.5, r: 0.95, kind: 'side' }, { y: -1.1, r: 0.6, kind: 'side' }, { y: -1.8, r: 0.25, kind: 'side' }, { y: -2.4, r: 0, kind: 'side' }]
  return ringGrid(rows.length, 12, (i, theta, out) => {
    const row = rows[i], r = row.r * (1 + ringNoise(theta, 2, i * 0.7, seed) * 0.3)
    out[0] = x + Math.cos(theta) * r * size
    out[1] = y + row.y * size * (1 + (row.kind === 'side' ? ringNoise(theta, 3, seed, seed) * 0.35 : 0))
    out[2] = z + Math.sin(theta) * r * size
  })
}

export function buildRockField() {
  const parts: BufferGeometry[] = []
  PILLARS.forEach((p) => parts.push(pillarGeometry(p)))
  ISLANDS.forEach((isle, i) => {
    parts.push(islandGeometry(isle, i + 41))
    const [cx, T, cz] = isle.top
    for (let k = 0; k < 6; k++) {
      const a = hash(i, k, 640) * TAU, rho = isle.radius + 6 + hash(i, k, 641) * 22
      parts.push(driftRock(cx + Math.cos(a) * rho, T - 4 - hash(i, k, 642) * isle.depth * 0.7, cz + Math.sin(a) * rho, 1.4 + hash(i, k, 643) * 3.2, i * 10 + k))
    }
  })
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  return merged
}
