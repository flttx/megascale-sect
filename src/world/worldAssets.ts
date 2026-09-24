import { LAYOUT } from './worldLayout'

export type AssetConfig = {
  id: string
  label: string
  url: string
  targetHeight: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scaleMultiplier: number
  enabled: boolean
}

export const MG01_MAIN_BUILDING: AssetConfig = {
  id: 'MG01', label: '主建筑', url: '/assets/models/主建筑.glb', targetHeight: 420,
  position: LAYOUT.main.position, rotation: LAYOUT.main.rotation, scaleMultiplier: 1, enabled: true,
}

export const MG02_GATE: AssetConfig = {
  id: 'MG02', label: '山门', url: '/assets/models/山门.glb', targetHeight: 56,
  position: LAYOUT.gate.position, rotation: LAYOUT.gate.rotation, scaleMultiplier: 1, enabled: true,
}

export const MG04_SIDE_TOWER: AssetConfig = {
  id: 'MG04', label: '侧塔', url: '/assets/models/侧塔.glb', targetHeight: 120,
  position: LAYOUT.towers[0].position, rotation: LAYOUT.towers[0].rotation, scaleMultiplier: 1, enabled: true,
}

export const ASSETS = [MG01_MAIN_BUILDING, MG02_GATE, MG04_SIDE_TOWER] as const
