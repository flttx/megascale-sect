export type CharacterId = 'male' | 'female'
const variant = import.meta.env.DEV && new URLSearchParams(window.location.search).has('originalCharacters') ? '' : '.optimized'

export const CHARACTER_ASSETS = {
  male: {
    name: '主角一 · 男', key: '1', height: 1.75, color: '#8ce8f5', secondaryColor: '#efcf88',
    model: `/assets/characters/male/rig${variant}.glb`, sword: `/assets/characters/male/sword${variant}.glb`,
    sourceTask: '87a0bb2a-7036-4b35-9aee-0f38ba5c8daa',
    swordTask: '78d6738f-5f8a-4903-bd8d-ccffdd26d806',
    rotationY: Math.PI / 2, swordLength: 2.2, swordDeckOffset: -0.16, swordLateralOffset: -0.10, swordRoll: 0,
  },
  female: {
    name: '主角二 · 女', key: '2', height: 1.7, color: '#c5b8ff', secondaryColor: '#b8f2e4',
    model: `/assets/characters/female/rig${variant}.glb`, sword: `/assets/characters/female/sword${variant}.glb`,
    sourceTask: 'f662dc18-023f-489a-8790-c71ac906ebb8',
    swordTask: '77d24ae9-fc72-4c42-9ba1-823a22eb2e6f',
    rotationY: Math.PI / 2, swordLength: 2.05, swordDeckOffset: -0.042, swordLateralOffset: 0, swordRoll: Math.PI / 2,
  },
} as const
