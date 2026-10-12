import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three'
import { PILLARS } from '../sites'
import { worldTerrainHeight } from '../regions/regions'
import { CLOUD_SEA_Y } from './CloudSea'

/** World rectangle the collar map covers (x0, z0, size in m); outside it the sea lies flat. */
export const COLLAR_RECT = { x0: -3600, z0: -3900, size: 7200 }
const N = 256
/** How high cloud piles against anything that pierces the sea (m), and how far out it spreads. */
export const COLLAR_HEIGHT = 28
const COLLAR_FALLOFF = 70

let texture: DataTexture | null = null

/**
 * Cloud heaped against every pillar shaft and every slope that rises out of the sea, so they no longer meet it in
 * a hard horizontal cut. Built once on the CPU from the pillar layout and the ground heights: a distance field to
 * the nearest piercing solid, mapped to exp(−d / falloff). The cloud-sea shader adds it to the tops. Height and
 * falloff keep its slope (28 / 70 = 0.4) under the 0.6 the ray march's skip assumes.
 */
export function cloudCollarTexture() {
  if (texture) return texture
  const cell = COLLAR_RECT.size / N,
    far = 1e9
  const distance = new Float32Array(N * N).fill(far)
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = COLLAR_RECT.x0 + (i + 0.5) * cell,
        z = COLLAR_RECT.z0 + (j + 0.5) * cell
      if (worldTerrainHeight(x, z) > CLOUD_SEA_Y - 10) distance[j * N + i] = 0
    }
  const reach = COLLAR_FALLOFF * 4
  for (const pillar of PILLARS) {
    const i0 = Math.max(0, Math.floor((pillar.x - pillar.radius - reach - COLLAR_RECT.x0) / cell)),
      i1 = Math.min(N - 1, Math.ceil((pillar.x + pillar.radius + reach - COLLAR_RECT.x0) / cell)),
      j0 = Math.max(0, Math.floor((pillar.z - pillar.radius - reach - COLLAR_RECT.z0) / cell)),
      j1 = Math.min(N - 1, Math.ceil((pillar.z + pillar.radius + reach - COLLAR_RECT.z0) / cell))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = COLLAR_RECT.x0 + (i + 0.5) * cell,
          z = COLLAR_RECT.z0 + (j + 0.5) * cell,
          d = Math.max(0, Math.hypot(x - pillar.x, z - pillar.z) - pillar.radius)
        if (d < distance[j * N + i]) distance[j * N + i] = d
      }
  }
  // Two-pass chamfer transform carries the ground's zero distance outward (pillar distances are already exact).
  const diagonal = cell * Math.SQRT2
  const relax = (k: number, from: number, step: number) => {
    if (distance[from] + step < distance[k]) distance[k] = distance[from] + step
  }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i
      if (i > 0) relax(k, k - 1, cell)
      if (j > 0) relax(k, k - N, cell)
      if (i > 0 && j > 0) relax(k, k - N - 1, diagonal)
      if (i < N - 1 && j > 0) relax(k, k - N + 1, diagonal)
    }
  for (let j = N - 1; j >= 0; j--)
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i
      if (i < N - 1) relax(k, k + 1, cell)
      if (j < N - 1) relax(k, k + N, cell)
      if (i < N - 1 && j < N - 1) relax(k, k + N + 1, diagonal)
      if (i > 0 && j < N - 1) relax(k, k + N - 1, diagonal)
    }
  const data = new Uint8Array(N * N)
  for (let k = 0; k < N * N; k++) data[k] = Math.round(255 * Math.exp(-distance[k] / COLLAR_FALLOFF))
  texture = new DataTexture(data, N, N, RedFormat, UnsignedByteType)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
