import { create } from 'zustand'
import type { CharacterId } from './player/characterAssets'
import type { PlayerPhase } from './player/playerMotion'
import type { QualityLevel } from './quality'

export type Mode = 'GROUND' | 'FLIGHT'
export type GameMode = 'exploration' | 'black-mist'
/** Who drives the camera: the player rig, a scripted shot (viewpoints, meditation) or the photo-mode free camera. */
export type CameraMode = 'player' | 'cinematic' | 'photo'
export type WeatherKind = 'clear' | 'mist' | 'rain' | 'snow' | 'storm'
type Telemetry = {
  fps: number
  position: [number, number, number]
  mode: Mode
  speed: number
  distance: number
  altitude: number
  drawCalls: number
  triangles: number
  dpr: number
}
type WorldState = {
  started: boolean
  locked: boolean
  debug: boolean
  showHelpers: boolean
  gameMode: GameMode
  setGameMode: (value: GameMode) => void
  telemetry: Telemetry
  assets: Record<string, string>
  character: CharacterId
  characterReady: Record<CharacterId, boolean>
  phase: PlayerPhase
  notice: string | null
  soundEnabled: boolean
  toggleSound: () => void
  quality: QualityLevel
  autoQuality: boolean
  setQuality: (quality: QualityLevel, auto?: boolean) => void
  selectCharacter: (id: CharacterId) => void
  setCharacterReady: (id: CharacterId, ready: boolean) => void
  setPhase: (phase: PlayerPhase) => void
  setNotice: (notice: string | null) => void
  setStarted: (value: boolean) => void
  setLocked: (value: boolean) => void
  toggleDebug: () => void
  toggleHelpers: () => void
  setTelemetry: (value: Telemetry) => void
  setAsset: (id: string, value: string) => void
  /** Day-cycle speed multiplier (1 = one 24-minute day) and pause. The live hour lives in `atmosphere.hours`. */
  timeScale: number
  timePaused: boolean
  setTimeScale: (value: number) => void
  setTimePaused: (value: boolean) => void
  /** Target weather; the weather machine blends toward it. Auto mode picks a new target every few minutes. */
  weather: WeatherKind
  autoWeather: boolean
  setWeather: (value: WeatherKind) => void
  setAutoWeather: (value: boolean) => void
  cameraMode: CameraMode
  setCameraMode: (value: CameraMode) => void
  /** Mouse-look multiplier and base field of view (degrees). */
  mouseSensitivity: number
  fov: number
  setMouseSensitivity: (value: number) => void
  setFov: (value: number) => void
}

// Verification overrides: `?quality=low|mid|high` pins a tier and disables auto-downgrade,
// `?hours=H` starts at that hour with the clock paused, `?weather=kind` starts in that weather with auto weather off.
const query = new URLSearchParams(window.location.search)
const pinnedQuality = query.get('quality')
const isQualityLevel = (value: string | null): value is QualityLevel =>
  value === 'low' || value === 'mid' || value === 'high'
const isWeatherKind = (value: string | null): value is WeatherKind =>
  ['clear', 'mist', 'rain', 'snow', 'storm'].includes(value ?? '')
const pinnedHours =
  query.has('hours') && Number.isFinite(Number(query.get('hours'))) ? Number(query.get('hours')) : null
const pinnedWeather = query.get('weather')
export const URL_OVERRIDES = { hours: pinnedHours, weather: isWeatherKind(pinnedWeather) ? pinnedWeather : null }

export const useWorldStore = create<WorldState>((set) => ({
  started: false,
  locked: false,
  debug: false,
  showHelpers: false,
  gameMode: 'exploration',
  setGameMode: (gameMode) => set({ gameMode }),
  character: 'male',
  characterReady: { male: false, female: false },
  phase: 'GROUND',
  notice: null,
  soundEnabled: true,
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  quality: isQualityLevel(pinnedQuality) ? pinnedQuality : 'high',
  autoQuality: !isQualityLevel(pinnedQuality),
  setQuality: (quality, auto = false) => set({ quality, autoQuality: auto }),
  selectCharacter: (character) =>
    set((state) => {
      if (!['GROUND', 'FLIGHT'].includes(state.phase)) return { notice: '请等当前动作结束后切换角色' }
      return { character, notice: null }
    }),
  setCharacterReady: (id, ready) => set((state) => ({ characterReady: { ...state.characterReady, [id]: ready } })),
  setPhase: (phase) => set({ phase }),
  setNotice: (notice) => set({ notice }),
  telemetry: {
    fps: 0,
    position: [0, 0, 150],
    mode: 'GROUND',
    speed: 0,
    distance: 0,
    altitude: 0,
    drawCalls: 0,
    triangles: 0,
    dpr: 1,
  },
  assets: {},
  setStarted: (started) => set({ started }),
  setLocked: (locked) => set({ locked }),
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  toggleHelpers: () => set((state) => ({ showHelpers: !state.showHelpers })),
  setTelemetry: (telemetry) => set({ telemetry }),
  setAsset: (id, value) => set((state) => ({ assets: { ...state.assets, [id]: value } })),
  timeScale: 1,
  timePaused: URL_OVERRIDES.hours !== null,
  setTimeScale: (timeScale) => set({ timeScale: Math.max(0, timeScale) }),
  setTimePaused: (timePaused) => set({ timePaused }),
  weather: URL_OVERRIDES.weather ?? 'clear',
  autoWeather: URL_OVERRIDES.weather === null,
  setWeather: (weather) => set({ weather }),
  setAutoWeather: (autoWeather) => set({ autoWeather }),
  cameraMode: 'player',
  setCameraMode: (cameraMode) => set({ cameraMode }),
  mouseSensitivity: 1,
  fov: 72,
  setMouseSensitivity: (value) => set({ mouseSensitivity: Math.min(3, Math.max(0.2, value)) }),
  setFov: (value) => set({ fov: Math.min(90, Math.max(55, value)) }),
}))
