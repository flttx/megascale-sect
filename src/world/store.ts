import { create } from 'zustand'
import type { CharacterId } from './player/characterAssets'
import type { PlayerPhase } from './player/playerMotion'
import type { QualityLevel } from './quality'

export type Mode = 'GROUND' | 'FLIGHT'
type Telemetry = {
  fps: number; position: [number, number, number]; mode: Mode; speed: number;
  distance: number; altitude: number; drawCalls: number; triangles: number; dpr: number
}
type WorldState = {
  started: boolean; locked: boolean; debug: boolean; showHelpers: boolean;
  telemetry: Telemetry; assets: Record<string, string>;
  character: CharacterId; characterReady: Record<CharacterId, boolean>; phase: PlayerPhase; notice: string | null;
  soundEnabled: boolean; toggleSound: () => void;
  quality: QualityLevel; autoQuality: boolean; setQuality: (quality: QualityLevel, auto?: boolean) => void;
  selectCharacter: (id: CharacterId) => void; setCharacterReady: (id: CharacterId, ready: boolean) => void;
  setPhase: (phase: PlayerPhase) => void; setNotice: (notice: string | null) => void;
  setStarted: (value: boolean) => void; setLocked: (value: boolean) => void;
  toggleDebug: () => void; toggleHelpers: () => void;
  setTelemetry: (value: Telemetry) => void; setAsset: (id: string, value: string) => void
}

export const useWorldStore = create<WorldState>((set) => ({
  started: false, locked: false, debug: false, showHelpers: false,
  character: 'male', characterReady: { male: false, female: false }, phase: 'GROUND', notice: null,
  soundEnabled: true, toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  quality: 'high', autoQuality: true, setQuality: (quality, auto = false) => set({ quality, autoQuality: auto }),
  selectCharacter: (character) => set((state) => {
    if (!['GROUND', 'FLIGHT'].includes(state.phase)) return { notice: '请等当前动作结束后切换角色' }
    return { character, notice: null }
  }),
  setCharacterReady: (id, ready) => set((state) => ({ characterReady: { ...state.characterReady, [id]: ready } })),
  setPhase: (phase) => set({ phase }), setNotice: (notice) => set({ notice }),
  telemetry: { fps: 0, position: [0, 0, 150], mode: 'GROUND', speed: 0, distance: 0, altitude: 0, drawCalls: 0, triangles: 0, dpr: 1 },
  assets: {},
  setStarted: (started) => set({ started }),
  setLocked: (locked) => set({ locked }),
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  toggleHelpers: () => set((state) => ({ showHelpers: !state.showHelpers })),
  setTelemetry: (telemetry) => set({ telemetry }),
  setAsset: (id, value) => set((state) => ({ assets: { ...state.assets, [id]: value } })),
}))
