import type { Vec3 } from './surfaces'

/** Cross-system world events (e.g. the bell scatters the cranes, lightning triggers thunder). */
export interface WorldEventMap {
  /** The ancient bell was struck. */
  bell: { position: Vec3 }
  /** A lightning strike; `distance` is metres from the camera (thunder is delayed by it). */
  lightning: { position: Vec3; distance: number }
  /** The player used an interactable. */
  interact: { id: string; kind: string }
  /** The player was moved by a teleport array. */
  teleport: { from: Vec3; to: Vec3 }
}
type Listener<K extends keyof WorldEventMap> = (payload: WorldEventMap[K]) => void

const listeners = new Map<keyof WorldEventMap, Set<Listener<keyof WorldEventMap>>>()

export const worldEvents = {
  on<K extends keyof WorldEventMap>(type: K, listener: Listener<K>) {
    const set = listeners.get(type) ?? new Set()
    listeners.set(type, set)
    set.add(listener as Listener<keyof WorldEventMap>)
    return () => { set.delete(listener as Listener<keyof WorldEventMap>) }
  },
  emit<K extends keyof WorldEventMap>(type: K, payload: WorldEventMap[K]) {
    listeners.get(type)?.forEach((listener) => {
      try { listener(payload) } catch (error) { console.error(`[worldEvents] ${type} listener failed`, error) }
    })
  },
}
