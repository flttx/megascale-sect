import { LAYOUT } from './worldLayout'

// Optimized LOD0/LOD1 are produced by scripts/optimize-buildings.mjs; ?originalBuildings loads the raw Tripo GLBs in dev.
const original = import.meta.env.DEV && new URLSearchParams(window.location.search).has('originalBuildings')
const model = (name: string, lod: 'optimized' | 'lod1') => `/assets/models/${name}${original ? '' : `.${lod}`}.glb`

export type AssetConfig = {
  id: string
  label: string
  url: string
  /** Low-detail variant swapped in beyond lodDistance (metres from the asset origin). */
  lodUrl: string
  lodDistance: number
  targetHeight: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scaleMultiplier: number
  enabled: boolean
}

export const MG01_MAIN_BUILDING: AssetConfig = {
  id: 'MG01', label: '主建筑', url: model('主建筑', 'optimized'), lodUrl: model('主建筑', 'lod1'), lodDistance: 780, targetHeight: 420,
  position: LAYOUT.main.position, rotation: LAYOUT.main.rotation, scaleMultiplier: 1, enabled: true,
}

export const MG02_GATE: AssetConfig = {
  id: 'MG02', label: '山门', url: model('山门', 'optimized'), lodUrl: model('山门', 'lod1'), lodDistance: 260, targetHeight: 56,
  position: LAYOUT.gate.position, rotation: LAYOUT.gate.rotation, scaleMultiplier: 1, enabled: true,
}

export const MG04_SIDE_TOWER: AssetConfig = {
  id: 'MG04', label: '侧塔', url: model('侧塔', 'optimized'), lodUrl: model('侧塔', 'lod1'), lodDistance: 420, targetHeight: 120,
  position: LAYOUT.towers[0].position, rotation: LAYOUT.towers[0].rotation, scaleMultiplier: 1, enabled: true,
}

export const ASSETS = [MG01_MAIN_BUILDING, MG02_GATE, MG04_SIDE_TOWER] as const
export const worldAssetsReady = (loaded: Record<string, string>) => ASSETS.every((asset) => !asset.enabled || !!loaded[asset.id])
