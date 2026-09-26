import { Data3DTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three'

/** Integer lattice hash → [0, 1). */
function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
const wrap = (i: number, period: number) => ((i % period) + period) % period
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
/** Normalised sum of `count` octaves: first weight `amp`, each next one scaled by `gain`. */
function octaves(count: number, amp: number, gain: number, sample: (octave: number) => number) {
  let sum = 0, norm = 0
  for (let o = 0; o < count; o++) { sum += sample(o) * amp; norm += amp; amp *= gain }
  return sum / norm
}

/** Periodic value noise (period in lattice cells). */
function value2(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi)
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period), y0 = wrap(yi, period), y1 = wrap(yi + 1, period)
  const a = hash(x0, y0, 0, seed), b = hash(x1, y0, 0, seed), c = hash(x0, y1, 0, seed), d = hash(x1, y1, 0, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function value3(x: number, y: number, z: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi)
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period), y0 = wrap(yi, period), y1 = wrap(yi + 1, period), z0 = wrap(zi, period), z1 = wrap(zi + 1, period)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  return lerp(
    lerp(lerp(hash(x0, y0, z0, seed), hash(x1, y0, z0, seed), u), lerp(hash(x0, y1, z0, seed), hash(x1, y1, z0, seed), u), v),
    lerp(lerp(hash(x0, y0, z1, seed), hash(x1, y0, z1, seed), u), lerp(hash(x0, y1, z1, seed), hash(x1, y1, z1, seed), u), v),
    w,
  )
}
/** Periodic Worley F1 distance (≈ 0 at a feature point, ~1 between them). */
function worley2(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  let best = 9
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, wx = wrap(cx, period), wy = wrap(cy, period)
    const px = cx + hash(wx, wy, 1, seed) - x, py = cy + hash(wx, wy, 2, seed) - y
    best = Math.min(best, px * px + py * py)
  }
  return Math.min(Math.sqrt(best), 1)
}
function worley3(x: number, y: number, z: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  let best = 9
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz, wx = wrap(cx, period), wy = wrap(cy, period), wz = wrap(cz, period)
    const px = cx + hash(wx, wy, wz * 3 + 1, seed) - x, py = cy + hash(wx, wy, wz * 3 + 2, seed) - y, pz = cz + hash(wx, wy, wz * 3 + 3, seed) - z
    const d = px * px + py * py + pz * pz
    if (d < best) best = d
  }
  return Math.min(Math.sqrt(best), 1)
}

/**
 * Tileable 2D cloud-sea noise, RGBA:
 * R broad fbm (swell and rifts), G billow mounds (inverted Worley fbm), B fine fbm, A spare Worley.
 */
export function createCloudNoise2D(size = 256) {
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / size, y = j / size
    const fbm = octaves(5, 0.5, 0.5, (o) => { const p = 4 << o; return value2(x * p, y * p, p, 11 + o) })
    const billow = octaves(3, 0.6, 0.45, (o) => { const p = 6 << o; return 1 - worley2(x * p, y * p, p, 31 + o) })
    const fine = octaves(4, 0.5, 0.5, (o) => { const p = 16 << o; return value2(x * p, y * p, p, 51 + o) })
    const k = (j * size + i) * 4
    data[k] = Math.round(fbm * 255)
    data[k + 1] = Math.round(Math.pow(billow, 1.6) * 255)
    data[k + 2] = Math.round(fine * 255)
    data[k + 3] = Math.round((1 - worley2(x * 12, y * 12, 12, 71)) * 255)
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/** Tileable 3D Perlin-Worley erosion noise (single channel) for the billowy top of the cloud sea. */
export function createCloudNoise3D(size = 48) {
  const data = new Uint8Array(size * size * size)
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / size, y = j / size, z = k / size
    const w = (1 - worley3(x * 4, y * 4, z * 4, 4, 5)) * 0.625 + (1 - worley3(x * 8, y * 8, z * 8, 8, 6)) * 0.375
    const v = value3(x * 8, y * 8, z * 8, 8, 7) * 0.65 + value3(x * 16, y * 16, z * 16, 16, 8) * 0.35
    // Worley cells dominate so the erosion carves round, cauliflower-like lobes; value noise breaks them up.
    const pw = Math.min(1, Math.max(0, (w * 0.62 + v * 0.38 - 0.18) / 0.72))
    data[(k * size + j) * size + i] = Math.round(pw * 255)
  }
  const texture = new Data3DTexture(data, size, size, size)
  texture.format = RedFormat; texture.type = UnsignedByteType
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping
  texture.magFilter = LinearFilter; texture.minFilter = LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}
