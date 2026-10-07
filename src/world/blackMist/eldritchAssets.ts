const assetUrl = (file: string) => `${import.meta.env.BASE_URL}assets/black-mist/${file}`.replace(/\/{2,}/g, '/')

/** Inspected Tripo PBR assets; preloading is owned by the black-mist loading boundary. */
export const ELDRITCH_ASSETS = {
  eye: { model: assetUrl('abyss-eye.glb'), lodModel: assetUrl('abyss-eye.lod1.glb'), targetWidthMeters: 240 },
  tentacle: {
    model: assetUrl('abyss-tentacle.glb'),
    lodModel: assetUrl('abyss-tentacle.lod1.glb'),
    targetHeightMeters: 540,
  },
} as const

export const HORROR_ASSETS = {
  watcher: { model: assetUrl('shroud-watcher.glb'), lodModel: assetUrl('shroud-watcher.lod1.glb') },
  behemoth: { model: assetUrl('abyss-behemoth.glb'), lodModel: assetUrl('abyss-behemoth.lod1.glb') },
} as const

export function eldritchAssetUrls(): string[] {
  return [
    ELDRITCH_ASSETS.eye.model,
    ELDRITCH_ASSETS.eye.lodModel,
    ELDRITCH_ASSETS.tentacle.model,
    ELDRITCH_ASSETS.tentacle.lodModel,
    HORROR_ASSETS.watcher.model,
    HORROR_ASSETS.watcher.lodModel,
    HORROR_ASSETS.behemoth.model,
    HORROR_ASSETS.behemoth.lodModel,
  ]
}

export type EldritchAssetId = keyof typeof ELDRITCH_ASSETS
export type EldritchAssetStatus = 'pending' | 'loading' | 'ready' | 'error'

/** Asset readiness is independent of the cinematic clock and does not allocate a placeholder model. */
const readiness: Record<EldritchAssetId, EldritchAssetStatus> = { eye: 'pending', tentacle: 'pending' }

export function setEldritchAssetStatus(id: EldritchAssetId, status: EldritchAssetStatus) {
  readiness[id] = status
}

export function eldritchAssetsSnapshot() {
  return {
    eye: { ...ELDRITCH_ASSETS.eye, status: readiness.eye },
    tentacle: { ...ELDRITCH_ASSETS.tentacle, status: readiness.tentacle },
    ready: readiness.eye === 'ready' && readiness.tentacle === 'ready',
  }
}
