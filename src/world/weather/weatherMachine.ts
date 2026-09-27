import { Color, MathUtils, Vector2 } from 'three'
import { atmosphere } from '../sky/atmosphere'
import type { WeatherKind } from '../store'

export type { WeatherKind }
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'mist', 'rain', 'snow', 'storm']
export const WEATHER_LABELS: Record<WeatherKind, string> = { clear: '晴空', mist: '山岚', rain: '细雨', snow: '落雪', storm: '雷暴' }

interface Profile {
  /** Sky / cloud-sea coverage 0–1. */
  cover: number
  /** Solid overcast veil over the sky dome. */
  overcast: number
  fogMul: number
  /** Metres the height-fog base rises (fog climbs the mountain). */
  fogLift: number
  /** Fraction of direct sun / moon light blocked. */
  sunDim: number
  /** Sky, fog and cloud colours pulled toward grey. */
  desat: number
  /** Overall darkening of sky and cloud colours. */
  darken: number
  wind: number
  rain: number; snow: number; storm: number
}

const PROFILES: Record<WeatherKind, Profile> = {
  clear: { cover: 0.45, overcast: 0, fogMul: 1, fogLift: 0, sunDim: 0, desat: 0, darken: 0, wind: 1, rain: 0, snow: 0, storm: 0 },
  mist: { cover: 0.6, overcast: 0.3, fogMul: 3.4, fogLift: 75, sunDim: 0.4, desat: 0.35, darken: 0.02, wind: 0.55, rain: 0, snow: 0, storm: 0 },
  rain: { cover: 0.92, overcast: 0.75, fogMul: 2, fogLift: 35, sunDim: 0.78, desat: 0.62, darken: 0.22, wind: 1.6, rain: 1, snow: 0, storm: 0 },
  snow: { cover: 0.88, overcast: 0.7, fogMul: 2.2, fogLift: 35, sunDim: 0.62, desat: 0.75, darken: 0.04, wind: 0.8, rain: 0, snow: 1, storm: 0 },
  storm: { cover: 1, overcast: 0.95, fogMul: 1.7, fogLift: 25, sunDim: 0.92, desat: 0.72, darken: 0.5, wind: 2.8, rain: 1.35, snow: 0, storm: 1 },
}
const PROFILE_KEYS = Object.keys(PROFILES.clear) as (keyof Profile)[]
type Blend = Profile

/**
 * Live, smoothly blended weather state. Consumers (particles, materials, audio, UI) read it every
 * frame; only WeatherSystem writes it.
 */
export const weather = {
  target: 'clear' as WeatherKind,
  blend: { ...PROFILES.clear } as Blend,
  /** Surface water 0–1: rises during rain, dries slowly afterwards. */
  wetness: 0,
  /** Settled snow 0–1: accumulates while snowing, melts slowly. */
  snowCover: 0,
  /** Lightning flash brightness 0–1 (decays within ~0.4 s). */
  flash: 0,
}

/** Seconds for the sky/fog blend to cover ~63% of a change. Particles follow the same curve. */
const BLEND_TAU = 7
const BASE_WIND = new Vector2(4, -1.5)
const grey = new Color()

/** Jumps straight to the target (verification captures, first frame after load). */
export function snapWeather(kind: WeatherKind) {
  weather.target = kind
  weather.blend = { ...PROFILES[kind] }
  weather.wetness = PROFILES[kind].rain > 0 ? 1 : 0
  weather.snowCover = PROFILES[kind].snow > 0 ? 1 : 0
}

export function tickWeather(delta: number, target: WeatherKind) {
  weather.target = target
  const goal = PROFILES[target], b = weather.blend
  const k = 1 - Math.exp(-delta / BLEND_TAU)
  for (const key of PROFILE_KEYS) b[key] += (goal[key] - b[key]) * k
  const raining = Math.min(1, b.rain), snowing = b.snow
  weather.wetness = MathUtils.clamp(weather.wetness + (raining > 0.3 ? delta / 40 * raining : -delta / 150), 0, 1)
  weather.snowCover = MathUtils.clamp(weather.snowCover + (snowing > 0.3 ? delta / 70 * snowing : -delta / 180) - raining * delta / 60, 0, 1)
  weather.flash = Math.max(0, weather.flash - delta * 2.6)
}

let lastEnvKey = -1
/** Layers the blended weather onto the time-of-day atmosphere (called right after updateAtmosphere). */
export function applyWeather() {
  const a = atmosphere, b = weather.blend, flash = weather.flash
  a.cloudCover = b.cover
  a.overcast = b.overcast
  a.fogDensity *= b.fogMul
  a.fogBase += b.fogLift
  // Thick weather keeps a deeper mist layer (decay 0.009 → 0.0058 /m at mountain-mist strength), so it still
  // swallows the pillar tops instead of only thickening near the cloud sea.
  a.fogFalloff *= MathUtils.lerp(1, 0.0058 / 0.009, MathUtils.clamp((b.fogMul - 1) / 2.4, 0, 1))
  a.sunColor.multiplyScalar(1 - b.sunDim)
  a.moonIntensity *= 1 - b.sunDim
  a.stars *= 1 - MathUtils.smoothstep(b.cover, 0.6, 0.95)
  // Overcast light is soft and even: less direct sun, a little more sky fill.
  a.hemiIntensity *= 1 + b.sunDim * 0.45
  a.envIntensity *= 1 + b.sunDim * 0.25
  const wash = (color: Color, amount: number, darken: number) => {
    const l = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    color.lerp(grey.setScalar(l), amount).multiplyScalar(1 - darken)
  }
  wash(a.zenith, b.desat, b.darken); wash(a.horizon, b.desat, b.darken * 0.8); wash(a.ground, b.desat, b.darken)
  wash(a.fogColor, b.desat * 0.9, b.darken * 0.7); wash(a.cloudLit, b.desat * 0.8, b.darken * 0.9); wash(a.cloudShade, b.desat * 0.6, b.darken * 1.1)
  wash(a.hemiSky, b.desat * 0.7, b.darken * 0.6)
  a.wind.copy(BASE_WIND).multiplyScalar(b.wind)
  a.haze = 1 + (b.fogMul - 1) * 0.8 + b.overcast * 0.6
  a.skyDesat = b.desat; a.skyDarken = b.darken; a.flash = flash
  if (flash > 0) {
    a.hemiIntensity += flash * 2.4
    a.exposure += flash * 0.35
    a.zenith.lerp(grey.set('#c9d4ff'), flash * 0.5); a.horizon.lerp(grey.set('#b8c4f0'), flash * 0.35)
    a.cloudLit.lerp(grey.set('#e6ecff'), flash * 0.6); a.cloudShade.lerp(grey.set('#8d98c8'), flash * 0.6)
  }
  // Re-capture image-based lighting when the sky has visibly changed (not for lightning flicker).
  const envKey = Math.round((b.overcast + b.desat + b.darken) * 25)
  if (envKey !== lastEnvKey) { lastEnvKey = envKey; a.envVersion++ }
}

// Auto weather: long clear spells with occasional fronts. Weights sum to 1.
const AUTO_WEIGHTS: [WeatherKind, number][] = [['clear', 0.42], ['mist', 0.2], ['rain', 0.17], ['snow', 0.1], ['storm', 0.11]]
export function pickNextWeather(current: WeatherKind, random = Math.random): WeatherKind {
  const pool = AUTO_WEIGHTS.filter(([kind]) => kind !== current)
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = random() * total
  for (const [kind, weight] of pool) { roll -= weight; if (roll <= 0) return kind }
  return pool[0][0]
}
/** Seconds a weather state lasts under auto mode before the next front. */
export const autoWeatherDuration = (kind: WeatherKind, random = Math.random) => (kind === 'clear' ? 240 : 150) + random() * 150
