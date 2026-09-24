import { MathUtils } from 'three'
import { atmosphere, updateAtmosphere } from '../sky/atmosphere'

/** Real seconds per in-game day at time scale 1 (deep night runs faster, see `tickTime`). */
export const DAY_SECONDS = 24 * 60

const forward = { remaining: 0, rate: 0, resolve: null as (() => void) | null }

export const getHours = () => atmosphere.hours

/** Jumps the clock (0–24 h). Weather modifiers are re-applied on the next frame. */
export function setHours(hours: number) {
  updateAtmosphere(hours)
}

/**
 * Advances the clock by `hours` over `seconds` of real time (meditation). A new call replaces a running
 * one, which then resolves immediately. Resolves when the advance completes.
 */
export function fastForward(hours: number, seconds: number): Promise<void> {
  forward.resolve?.()
  return new Promise((resolve) => {
    forward.remaining = Math.max(0, hours)
    forward.rate = forward.remaining / Math.max(0.1, seconds)
    forward.resolve = resolve
  })
}

export const isFastForwarding = () => forward.remaining > 0

/** Advances the clock one frame; called by WeatherSystem before any consumer reads the atmosphere. */
export function tickTime(delta: number, scale: number, paused: boolean) {
  // Deep night passes 2.5× faster so most of the cycle is spent in daylight and twilight.
  const nightRush = 1 + 1.5 * MathUtils.clamp((-atmosphere.sunDirection.y - 0.12) / 0.2, 0, 1)
  let advance = paused ? 0 : delta * scale * nightRush * 24 / DAY_SECONDS
  if (forward.remaining > 0) {
    const step = Math.min(forward.remaining, forward.rate * delta)
    forward.remaining -= step
    advance += step
    if (forward.remaining <= 1e-6) {
      forward.remaining = 0
      forward.resolve?.()
      forward.resolve = null
    }
  }
  updateAtmosphere(atmosphere.hours + advance)
}
