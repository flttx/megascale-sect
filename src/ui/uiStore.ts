import { create } from 'zustand'
import type { InteractKind } from '../world/sites'
import type { VolumeChannel } from '../world/audio/mixer'
import { releaseLock, requestLock } from './bridge'

export type Language = 'zh' | 'en'

function readLanguage(): Language {
  try {
    return localStorage.getItem('yunque.language') === 'zh' ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

/** The site the player could use right now (drives the 「E 研读 · 入山碑」 prompt). */
export interface NearbySite { id: string; kind: InteractKind; name: string; verb: string }

/** Modal layers that take the mouse (pointer lock is released while one is open). */
export type Overlay =
  | { kind: 'lore'; id: string }
  | { kind: 'weather' }
  | { kind: 'teleport'; from: string }
  | { kind: 'scroll' }

export type ScrollTab = 'map' | 'codex' | 'collection'
export type PhotoFilter = 'none' | 'warm' | 'ink' | 'cool'
export const PHOTO_FILTERS: PhotoFilter[] = ['none', 'warm', 'ink', 'cool']
export const PHOTO_FILTER_LABELS: Record<PhotoFilter, string> = { none: '原色', warm: '暖阳', ink: '水墨', cool: '清寒' }
/** CSS filter per photo look; the PNG export replays the same string through a 2D canvas. */
export const PHOTO_FILTER_CSS: Record<PhotoFilter, string> = {
  none: 'none',
  warm: 'sepia(0.28) saturate(1.18) contrast(1.04) brightness(1.03)',
  ink: 'grayscale(1) contrast(1.22) brightness(1.06)',
  cool: 'saturate(0.8) hue-rotate(12deg) contrast(1.05) brightness(1.02)',
}

export interface Caption { title: string; text: string; kicker: string }

interface UiState {
  language: Language
  setLanguage: (value: Language) => void
  nearby: NearbySite | null
  overlay: Overlay | null
  scrollTab: ScrollTab
  hudHidden: boolean
  photoFilter: PhotoFilter; photoVignette: boolean
  caption: Caption | null
  /** Cinematic dip-to-dark while the camera cuts back to the player. */
  veil: boolean
  /** Bumped to replay the teleport flash / photo shutter animations. */
  flashKey: number; shutterKey: number
  /** Progress (ids), persisted by `save.ts`. */
  orbs: string[]; steles: string[]; viewpoints: string[]; arrays: string[]
  volumes: Record<VolumeChannel, number>
  /** DEV: let E work without pointer lock (headless verification). */
  devInput: boolean
  /** Leaving photo mode by Esc returns to the scene; a click resumes pointer lock. */
  photoUnlocked: boolean
  lockError: string | null
  setNearby: (value: NearbySite | null) => void
  openOverlay: (value: Overlay) => void
  closeOverlay: () => void
  setScrollTab: (value: ScrollTab) => void
  setHudHidden: (value: boolean) => void
  setPhotoFilter: (value: PhotoFilter) => void; setPhotoVignette: (value: boolean) => void
  setCaption: (value: Caption | null) => void
  setVeil: (value: boolean) => void
  flash: () => void; shutter: () => void
  collectOrb: (id: string) => boolean; readStele: (id: string) => boolean
  visitViewpoint: (id: string) => boolean; activateArray: (id: string) => boolean
  setVolumes: (value: Record<VolumeChannel, number>) => void
  setDevInput: (value: boolean) => void
}

/** Adds `id` to a progress list; returns the new list, or null when it was already there. */
const add = (list: string[], id: string) => list.includes(id) ? null : [...list, id]

export const useUiStore = create<UiState>((set, get) => ({
  language: readLanguage(),
  setLanguage: (language) => {
    set({ language })
    try {
      localStorage.setItem('yunque.language', language)
    } catch (error) {
      console.warn('Could not persist language preference.', error)
    }
  },
  nearby: null, overlay: null, scrollTab: 'map', hudHidden: false,
  photoFilter: 'none', photoVignette: false, caption: null, veil: false, flashKey: 0, shutterKey: 0,
  orbs: [], steles: [], viewpoints: [], arrays: [],
  volumes: { master: 0.8, music: 0.55, ambience: 0.8, sfx: 0.9 },
  devInput: false,
  photoUnlocked: false, lockError: null,
  setNearby: (nearby) => { const current = get().nearby; if (current?.id !== nearby?.id) set({ nearby }) },
  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: () => set({ overlay: null }),
  setScrollTab: (scrollTab) => set({ scrollTab }),
  setHudHidden: (hudHidden) => set({ hudHidden }),
  setPhotoFilter: (photoFilter) => set({ photoFilter }), setPhotoVignette: (photoVignette) => set({ photoVignette }),
  setCaption: (caption) => set({ caption }),
  setVeil: (veil) => set({ veil }),
  flash: () => set((s) => ({ flashKey: s.flashKey + 1 })), shutter: () => set((s) => ({ shutterKey: s.shutterKey + 1 })),
  collectOrb: (id) => { const orbs = add(get().orbs, id); if (orbs) set({ orbs }); return orbs !== null },
  readStele: (id) => { const steles = add(get().steles, id); if (steles) set({ steles }); return steles !== null },
  visitViewpoint: (id) => { const viewpoints = add(get().viewpoints, id); if (viewpoints) set({ viewpoints }); return viewpoints !== null },
  activateArray: (id) => { const arrays = add(get().arrays, id); if (arrays) set({ arrays }); return arrays !== null },
  setVolumes: (volumes) => set({ volumes }),
  setDevInput: (devInput) => set({ devInput }),
}))

/** Opens a modal layer and frees the mouse for it. */
export function showOverlay(overlay: Overlay) {
  useUiStore.getState().openOverlay(overlay)
  releaseLock()
}

/** Closes the modal layer and takes the mouse back for the game. */
export function dismissOverlay() {
  if (!useUiStore.getState().overlay) return
  useUiStore.getState().closeOverlay()
  requestLock()
}
