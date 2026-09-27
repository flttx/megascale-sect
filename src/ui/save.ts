import { mixer } from '../world/audio/mixer'
import { useSyncExternalStore } from 'react'
import legacyOrbs from './legacyOrbs.json'
import { groundHit, insideStructure, LAYOUT, terrainSlope } from '../world/worldLayout'
import { bodyInsideAnyCollider } from '../world/surfaces'
import type { VolumeChannel } from '../world/audio/mixer'
import { getPlayerRuntime } from '../world/player/playerHandle'
import type { CharacterId } from '../world/player/characterAssets'
import { QUALITY_LEVELS } from '../world/quality'
import type { QualityLevel } from '../world/quality'
import { INTERACT_SITES } from '../world/sites'
import { URL_OVERRIDES, useWorldStore } from '../world/store'
import { ORBS } from '../world/interact/orbs'
import { useUiStore } from './uiStore'

export const SAVE_KEY = 'yunque.save.v2'
const LEGACY_KEY = 'yunque.save.v1'
const SAVE_VERSION = 2
type StorageStatus = 'ok' | 'unavailable' | 'protected'
let storageStatus: StorageStatus = 'ok'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const useStorageStatus = () => useSyncExternalStore(subscribe, () => storageStatus)
function blockStorage(status: StorageStatus, error: unknown) {
  if (storageStatus !== 'ok') return
  storageStatus = status
  console.warn('[save] automatic saving stopped; original data retained', error)
  listeners.forEach((listener) => listener())
}
const legacyIds = new Map(legacyOrbs.map(({ oldId, id }) => [oldId, id]))
const CHANNELS: VolumeChannel[] = ['master', 'music', 'ambience', 'sfx']
const TIME_SCALES = [0, 0.5, 1, 2, 4]

export interface SavedSettings {
  character: CharacterId
  quality: QualityLevel; autoQuality: boolean; mouseSensitivity: number; fov: number
  volumes: Record<VolumeChannel, number>; timeScale: number; autoWeather: boolean; soundEnabled: boolean
}
export interface SavedPosition { x: number; y: number; z: number; yaw: number }
export interface SaveData {
  version: number
  orbs: string[]; steles: string[]; viewpoints: string[]; arrays: string[]
  settings: SavedSettings | null
  position: SavedPosition | null
  savedAt: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isQuality = (value: unknown): value is QualityLevel => typeof value === 'string' && (QUALITY_LEVELS as string[]).includes(value)
/** Keeps only known ids so a renamed site or orb never breaks progress counts. */
const idList = (value: unknown, known: Set<string>) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)))] : []

const KNOWN = {
  orbs: new Set(ORBS.map((orb) => orb.id)),
  steles: new Set(INTERACT_SITES.filter((s) => s.kind === 'stele').map((s) => s.id)),
  viewpoints: new Set(INTERACT_SITES.filter((s) => s.kind === 'viewpoint').map((s) => s.id)),
  arrays: new Set(INTERACT_SITES.filter((s) => s.kind === 'teleport').map((s) => s.id)),
}

function parseSettings(value: unknown): SavedSettings | null {
  if (!isRecord(value)) return null
  const { quality, autoQuality, mouseSensitivity, fov, volumes, timeScale, autoWeather, soundEnabled } = value
  if (!isQuality(quality) || typeof autoQuality !== 'boolean' || !isNumber(mouseSensitivity) || !isNumber(fov)) return null
  if (!isRecord(volumes) || !CHANNELS.every((c) => isNumber(volumes[c]))) return null
  if (!isNumber(timeScale) || typeof autoWeather !== 'boolean' || typeof soundEnabled !== 'boolean') return null
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  return {
    quality, autoQuality, autoWeather, soundEnabled,
    character: value.character === 'female' ? 'female' : 'male',
    mouseSensitivity: clamp(mouseSensitivity, 0.2, 3), fov: clamp(fov, 55, 90),
    volumes: Object.fromEntries(CHANNELS.map((c) => [c, clamp(volumes[c] as number, 0, 1)])) as Record<VolumeChannel, number>,
    timeScale: TIME_SCALES.includes(timeScale) ? timeScale : 1,
  }
}

function parsePosition(value: unknown): SavedPosition | null {
  if (!isRecord(value)) return null
  const { x, y, z, yaw } = value
  return isNumber(x) && isNumber(y) && isNumber(z) && isNumber(yaw) && Math.abs(x) < 1200 && Math.abs(z) < 1300 && y > -80 && y < 600 ? { x, y, z, yaw } : null
}

/** Pure, repeatable migration followed by validation. Unknown versions must never be overwritten. */
export function migrate(value: unknown): SaveData | null {
  if (!isRecord(value)) return null
  let data = value
  if (data.version === 1) data = { ...data, version: 2, orbs: Array.isArray(data.orbs) ? data.orbs.map((id) => legacyIds.get(id)) : [] }
  if (data.version !== SAVE_VERSION) return null
  return {
    version: SAVE_VERSION,
    orbs: idList(data.orbs, KNOWN.orbs), steles: idList(data.steles, KNOWN.steles),
    viewpoints: idList(data.viewpoints, KNOWN.viewpoints), arrays: idList(data.arrays, KNOWN.arrays),
    settings: parseSettings(data.settings), position: parsePosition(data.position),
    savedAt: isNumber(data.savedAt) ? data.savedAt : 0,
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY) ?? window.localStorage.getItem(LEGACY_KEY)
    if (raw === null) return null
    let data: unknown
    try { data = JSON.parse(raw) } catch {
      const backup = 'yunque.save.corrupt', previous = window.localStorage.getItem(backup)
      if (previous !== raw) {
        if (previous !== null) window.localStorage.setItem(`${backup}.${Date.now()}`, previous)
        window.localStorage.setItem(backup, raw)
      }
      return null
    }
    const result = migrate(data)
    if (!result) blockStorage('protected', 'Unsupported save version')
    return result
  } catch (error) {
    blockStorage('unavailable', error)
    return null
  }
}

let lastPosition: SavedPosition | null = null

function snapshot(): SaveData {
  const world = useWorldStore.getState(), ui = useUiStore.getState()
  return {
    version: SAVE_VERSION,
    orbs: ui.orbs, steles: ui.steles, viewpoints: ui.viewpoints, arrays: ui.arrays,
    settings: {
      character: world.character,
      quality: world.quality, autoQuality: world.autoQuality, mouseSensitivity: world.mouseSensitivity, fov: world.fov,
      volumes: ui.volumes, timeScale: world.timeScale, autoWeather: world.autoWeather, soundEnabled: world.soundEnabled,
    },
    position: lastPosition ? safePosition() : null,
    savedAt: Date.now(),
  }
}

function write() {
  // Loading can restore settings before island/prop surfaces register. Preserve the old checkpoint
  // until the player enters and those surfaces are available for validation.
  if (storageStatus !== 'ok' || !useWorldStore.getState().started) return false
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()))
    return true
  } catch (error) {
    blockStorage('unavailable', error)
    return false
  }
}

/** Remembers where the player stands, but only somewhere safe to resume (on foot, normal camera). */
function samplePosition() {
  const world = useWorldStore.getState(), runtime = getPlayerRuntime()
  if (!world.started || !runtime || runtime.phase !== 'GROUND' || runtime.inAir || runtime.takeoffTime || runtime.aboard || world.cameraMode !== 'player') return
  const p = runtime.position
  if (!staticFooting(p, 0.05)) return
  lastPosition = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(runtime.yaw * 1000) / 1000 }
}

function staticFooting(p: { x: number; y: number; z: number }, tolerance: number) {
  const hit = groundHit(p.x, p.z, p.y)
  return hit && hit.surfaceId !== 'kun' && terrainSlope(p.x, p.z, p.y) <= 52 && Math.abs(p.y - hit.y) <= tolerance &&
    !bodyInsideAnyCollider(p.x, p.y + 0.45, p.y + 1.7, p.z, 0.35, 0, true) && !insideStructure(p.x, p.y + 1, p.z)
}

export function safePosition(): SavedPosition {
  return lastPosition && staticFooting(lastPosition, 0.3) ? { ...lastPosition } : { x: LAYOUT.spawn.position[0], y: LAYOUT.spawn.position[1], z: LAYOUT.spawn.position[2], yaw: 0 }
}
export function flushSave() { samplePosition(); return write() }

/**
 * Applies a save before the player enters. URL verification overrides (?quality, ?weather, ?hours) win
 * over saved settings so scripted checks stay deterministic.
 */
export function applySave(save: SaveData) {
  lastPosition = save.position
  useUiStore.setState({ orbs: save.orbs, steles: save.steles, viewpoints: save.viewpoints, arrays: save.arrays })
  const settings = save.settings
  if (!settings) return
  const world = useWorldStore.getState()
  world.selectCharacter(settings.character)
  const query = new URLSearchParams(window.location.search)
  if (!query.has('quality')) world.setQuality(settings.quality, settings.autoQuality)
  if (URL_OVERRIDES.weather === null) world.setAutoWeather(settings.autoWeather)
  world.setMouseSensitivity(settings.mouseSensitivity)
  world.setFov(settings.fov)
  world.setTimeScale(settings.timeScale)
  if (world.soundEnabled !== settings.soundEnabled) world.toggleSound()
  useUiStore.getState().setVolumes(settings.volumes)
  CHANNELS.forEach((c) => mixer.setVolume(c, settings.volumes[c]))
}

/** Persists progress and settings on change (debounced), the position every 8 s and on leaving the page. */
export function startAutosave() {
  let timer = 0
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(write, 600) }
  const unsubUi = useUiStore.subscribe((s, p) => { if (s.orbs !== p.orbs || s.steles !== p.steles || s.viewpoints !== p.viewpoints || s.arrays !== p.arrays || s.volumes !== p.volumes) schedule() })
  const unsubWorld = useWorldStore.subscribe((s, p) => {
    if (s.quality !== p.quality || s.autoQuality !== p.autoQuality || s.mouseSensitivity !== p.mouseSensitivity || s.fov !== p.fov ||
      s.timeScale !== p.timeScale || s.autoWeather !== p.autoWeather || s.soundEnabled !== p.soundEnabled || s.character !== p.character) schedule()
  })
  const interval = window.setInterval(() => { if (useWorldStore.getState().started) { samplePosition(); write() } }, 8000)
  const leave = () => { samplePosition(); write() }
  window.addEventListener('pagehide', leave)
  window.addEventListener('beforeunload', leave)
  return () => {
    window.clearTimeout(timer); window.clearInterval(interval)
    unsubUi(); unsubWorld()
    window.removeEventListener('pagehide', leave)
    window.removeEventListener('beforeunload', leave)
  }
}
