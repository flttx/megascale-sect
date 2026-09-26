import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import type { TexturePackRequest, TexturePackResponse } from './terrainTextures.worker'

/**
 * Layer order of the packed surface arrays; `SURFACE_GLSL` in materials.ts names the same indices.
 * Scanned CC0 sets from Poly Haven / ambientCG (see public/assets/textures/CREDITS.md).
 */
export const SURFACE_SETS = ['cliff', 'rock_detail', 'moss', 'grass', 'gravel', 'paving', 'marble'] as const
const HAS_HEIGHT = ['cliff', 'rock_detail', 'paving']
/** 1k maps everywhere: the 2 m sets already resolve millimetres, and rock_detail covers close-up cliffs. */
const SIZE = 1024

/** Flat stand-ins (sRGB albedo + roughness) shown until the scans decode, one per layer. */
const PLACEHOLDER = [[128, 133, 139, 220], [138, 138, 134, 220], [76, 90, 61, 235], [108, 120, 82, 235], [141, 136, 124, 230], [96, 98, 102, 200], [214, 212, 206, 150]]

function placeholder(srgb: boolean) {
  // Detail layers: flat normal (0.5, 0.5), no occlusion, mid height.
  return new Uint8Array(PLACEHOLDER.flatMap((tint) => srgb ? tint : [128, 128, 255, 128]))
}

function arrayTexture(size: number, data: Uint8Array | null, srgb: boolean) {
  const layers = SURFACE_SETS.length
  const texture = new DataArrayTexture(data ?? placeholder(srgb), size, size, layers)
  texture.format = RGBAFormat; texture.type = UnsignedByteType
  if (srgb) texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = data ? LinearMipmapLinearFilter : LinearFilter
  texture.generateMipmaps = data !== null
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/**
 * Shared sampler uniforms for every surface material. They start as neutral 1×1 placeholders so shaders
 * compile at once; the decoded arrays replace them in place when the worker finishes.
 */
export const surfaceTextures = {
  uSurfAlbedo: { value: arrayTexture(1, null, true) },
  uSurfDetail: { value: arrayTexture(1, null, false) },
}

let loading: Promise<void> | null = null
/** Starts the one-off decode; later calls return the same promise. */
export function loadSurfaceTextures() {
  loading ??= new Promise<void>((resolve) => {
    const worker = new Worker(new URL('./terrainTextures.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => { worker.terminate(); resolve() }
    worker.onmessage = ({ data }: MessageEvent<TexturePackResponse>) => {
      if ('error' in data) {
        // Keep the tinted fallback; the world stays playable without the scanned maps.
        console.warn('[surfaces] texture pack failed; using flat tints', data.error)
        finish(); return
      }
      const previous = [surfaceTextures.uSurfAlbedo.value, surfaceTextures.uSurfDetail.value]
      surfaceTextures.uSurfAlbedo.value = arrayTexture(SIZE, data.albedo, true)
      surfaceTextures.uSurfDetail.value = arrayTexture(SIZE, data.detail, false)
      previous.forEach((texture) => texture.dispose())
      finish()
    }
    worker.onerror = (event) => { console.warn('[surfaces] texture worker crashed; using flat tints', event.message); finish() }
    const request: TexturePackRequest = {
      base: `${import.meta.env.BASE_URL}assets/textures`.replace(/\/{2,}/g, '/'),
      sets: [...SURFACE_SETS], heights: SURFACE_SETS.map((set) => HAS_HEIGHT.includes(set)), size: SIZE, suffix: '.1k',
    }
    worker.postMessage(request)
  })
  return loading
}
