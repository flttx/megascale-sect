import { Color, MathUtils } from 'three'
import { atmosphere } from '../sky/atmosphere'
import { blackMistRuntime } from './runtime'

const palette = {
  fog: new Color('#3b454f'),
  lit: new Color('#647077'),
  shade: new Color('#111821'),
  sky: new Color('#81989f'),
  ground: new Color('#243336'),
  sun: new Color('#b2babb'),
}
let envStep = -1
export function applyBlackMistAtmosphere() {
  const r = blackMistRuntime
  if (!r.active) {
    envStep = -1
    return
  }
  const a = atmosphere
  const arrival = MathUtils.smoothstep(r.elapsed, 8, 38)
  const dark = arrival * 0.88
  a.sunColor.lerp(palette.sun, dark)
  a.sunIntensity *= 1 - dark * 0.84
  a.moonIntensity *= 1 - dark * 0.75
  a.hemiSky.lerp(palette.sky, dark)
  a.hemiGround.lerp(palette.ground, dark)
  a.hemiIntensity = MathUtils.lerp(a.hemiIntensity, 0.68, dark)
  a.envIntensity = MathUtils.lerp(a.envIntensity, 0.26, dark)
  a.cloudLit.lerp(palette.lit, dark)
  a.cloudShade.lerp(palette.shade, dark)
  a.fogColor.lerp(palette.fog, dark)
  a.cloudCover = Math.max(a.cloudCover, arrival * 0.96)
  a.overcast = Math.max(a.overcast, arrival * 0.94)
  a.skyDesat = Math.max(a.skyDesat, arrival * 0.85)
  a.skyDarken = Math.max(a.skyDarken, arrival * 0.62)
  a.haze = Math.max(a.haze, 1 + arrival * 2)
  a.fogDensity = MathUtils.lerp(a.fogDensity, 0.00105, dark)
  a.fogBase = MathUtils.lerp(a.fogBase, -15, dark)
  a.fogFalloff = MathUtils.lerp(a.fogFalloff, 0.003, dark)
  a.night = Math.max(a.night, arrival * 0.72)
  a.stars *= 1 - arrival
  a.exposure = MathUtils.lerp(a.exposure, 1.3, dark)
  a.wind.set(4 + arrival * 28, -1.5 - arrival * 9)
  const flash =
    Math.exp(-Math.abs(r.elapsed - 28.2) * 5) * 0.75 +
    Math.exp(-Math.abs(r.elapsed - 35.2) * 5) * 0.5 +
    Math.exp(-Math.abs(r.elapsed - 43.2) * 5) * 0.3
  a.flash = Math.max(a.flash, flash)
  // Refresh image-based lighting only when storm density noticeably changes.
  const step = Math.floor(arrival * 12)
  if (step !== envStep) {
    envStep = step
    a.envVersion++
  }
}
