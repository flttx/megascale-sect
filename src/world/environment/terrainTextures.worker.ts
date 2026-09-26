/**
 * Decodes the CC0 surface sets (public/assets/textures) off the main thread and packs them into two
 * texture-array layers per set:
 *   albedo: rgb = diffuse (sRGB), a = roughness
 *   detail: rg = OpenGL normal xy, b = ambient occlusion, a = height (AO where the set has no height map)
 */
export interface TexturePackRequest { base: string; sets: string[]; heights: boolean[]; size: number; suffix: string }
export type TexturePackResponse = { albedo: Uint8Array; detail: Uint8Array } | { error: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<TexturePackRequest>) => void) | null
  postMessage(message: TexturePackResponse, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

async function pixels(url: string, size: number, context: OffscreenCanvasRenderingContext2D) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  // Normal, ARM and height maps are data, so no colour-space conversion or premultiplication.
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  context.clearRect(0, 0, size, size)
  context.drawImage(bitmap, 0, 0, size, size)
  bitmap.close()
  return context.getImageData(0, 0, size, size).data
}

scope.onmessage = async ({ data: { base, sets, heights, size, suffix } }) => {
  try {
    const layer = size * size * 4
    const albedo = new Uint8Array(layer * sets.length), detail = new Uint8Array(layer * sets.length)
    await Promise.all(sets.map(async (set, index) => {
      const canvas = new OffscreenCanvas(size, size)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('2D canvas unavailable in worker')
      const file = (map: string) => `${base}/${set}/${map}${suffix}.webp`
      const diff = await pixels(file('diff'), size, context)
      const nor = await pixels(file('nor'), size, context)
      const arm = await pixels(file('arm'), size, context)
      const height = heights[index] ? await pixels(file('height'), size, context) : null
      const offset = layer * index
      for (let i = 0; i < layer; i += 4) {
        const o = offset + i
        albedo[o] = diff[i]; albedo[o + 1] = diff[i + 1]; albedo[o + 2] = diff[i + 2]; albedo[o + 3] = arm[i + 1]
        detail[o] = nor[i]; detail[o + 1] = nor[i + 1]; detail[o + 2] = arm[i]; detail[o + 3] = height ? height[i] : arm[i]
      }
    }))
    scope.postMessage({ albedo, detail }, [albedo.buffer, detail.buffer])
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
