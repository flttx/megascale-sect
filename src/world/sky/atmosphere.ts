import { Color, MathUtils, Vector2, Vector3 } from 'three'

/**
 * Mutable sky state shared by the sky dome, cloud sea, lights and post FX.
 * Consumers read it inside useFrame so time-of-day / weather updates never re-render React.
 */
export const atmosphere = {
  hours: 15,
  /** Unit vector pointing toward the sun / moon. */
  sunDirection: new Vector3(), moonDirection: new Vector3(),
  sunColor: new Color(), sunIntensity: 0,
  moonColor: new Color('#9fb3e6'), moonIntensity: 0,
  zenith: new Color(), horizon: new Color(), ground: new Color(),
  hemiSky: new Color(), hemiGround: new Color(), hemiIntensity: 0, envIntensity: 0,
  fogColor: new Color(), fogDensity: 0, fogFalloff: 0.0058, fogBase: -110,
  cloudLit: new Color(), cloudShade: new Color(), cloudCover: 0.5,
  stars: 0, exposure: 1,
  wind: new Vector2(4, -1.5),
  /** Bumped when the change is large enough that the IBL environment should be re-rendered. */
  envVersion: 0,
}
export type Atmosphere = typeof atmosphere

interface Key {
  /** Sun direction y. */
  at: number
  zenith: string; horizon: string; ground: string; sun: string; sunI: number
  hemiSky: string; hemiGround: string; hemiI: number; env: number
  fog: string; fogD: number; cloudLit: string; cloudShade: string; stars: number; exposure: number
}
// Palette follows the concept art: pale cerulean sky, white-gold light, blue-grey mist.
const KEYS: Key[] = [
  { at: -0.3, zenith: '#03060f', horizon: '#111a2c', ground: '#0b1120', sun: '#000000', sunI: 0, hemiSky: '#3d5080', hemiGround: '#0d121c', hemiI: 0.5, env: 0.45, fog: '#141c2c', fogD: 0.0011, cloudLit: '#3a4865', cloudShade: '#141b2b', stars: 1, exposure: 1.35 },
  { at: -0.08, zenith: '#111c38', horizon: '#57466a', ground: '#1f2233', sun: '#ff6a3a', sunI: 0, hemiSky: '#4d5a86', hemiGround: '#15151e', hemiI: 0.42, env: 0.45, fog: '#3b3d55', fogD: 0.0012, cloudLit: '#8a6f86', cloudShade: '#2b2d44', stars: 0.55, exposure: 1.25 },
  { at: 0.02, zenith: '#34568f', horizon: '#f09a62', ground: '#5a4c52', sun: '#ff8a4a', sunI: 2.4, hemiSky: '#9aa7c8', hemiGround: '#4a3a36', hemiI: 0.3, env: 0.38, fog: '#c09888', fogD: 0.001, cloudLit: '#ffc49a', cloudShade: '#7a7088', stars: 0.05, exposure: 1.1 },
  { at: 0.18, zenith: '#3f74bb', horizon: '#e8cfb4', ground: '#6e6c6c', sun: '#ffd3a1', sunI: 4.0, hemiSky: '#c9d8f0', hemiGround: '#6c6358', hemiI: 0.32, env: 0.42, fog: '#cfcac6', fogD: 0.0009, cloudLit: '#fff1df', cloudShade: '#9ea5b8', stars: 0, exposure: 1.08 },
  { at: 0.45, zenith: '#3b77c9', horizon: '#c9dbee', ground: '#6f7984', sun: '#fff1dc', sunI: 4.4, hemiSky: '#d3e2f6', hemiGround: '#5f646c', hemiI: 0.3, env: 0.42, fog: '#bccfe2', fogD: 0.0008, cloudLit: '#ffffff', cloudShade: '#aab8cb', stars: 0, exposure: 1.05 },
  { at: 1, zenith: '#3571c4', horizon: '#c6d9ed', ground: '#727c87', sun: '#fff6ea', sunI: 4.6, hemiSky: '#d6e4f8', hemiGround: '#62676f', hemiI: 0.3, env: 0.42, fog: '#b8cce1', fogD: 0.00078, cloudLit: '#ffffff', cloudShade: '#adbbce', stars: 0, exposure: 1.02 },
]
const PARSED = KEYS.map((k) => ({ ...k, c: Object.fromEntries((['zenith', 'horizon', 'ground', 'sun', 'hemiSky', 'hemiGround', 'fog', 'cloudLit', 'cloudShade'] as const).map((name) => [name, new Color(k[name])])) }))
const MAX_ELEVATION = MathUtils.degToRad(64)

/** Sun path: rises in the east (+x) at 06:00, peaks south (+z) at noon, sets west (−x) at 18:00. */
export function sunDirectionAt(hours: number, target: Vector3) {
  const t = ((hours - 6) / 12) * Math.PI
  return target.set(Math.cos(t), Math.sin(t) * Math.sin(MAX_ELEVATION), Math.sin(t) * Math.cos(MAX_ELEVATION) * 0.85 + 0.18).normalize()
}

const lastEnvSun = new Vector3(0, -2, 0)
/** Recomputes every derived atmosphere value for a time of day (0–24 h). */
export function updateAtmosphere(hours: number) {
  const a = atmosphere
  a.hours = ((hours % 24) + 24) % 24
  sunDirectionAt(a.hours, a.sunDirection)
  sunDirectionAt(a.hours + 12, a.moonDirection).lerp(new Vector3(0.2, 0.9, -0.3), 0.25).normalize()
  const y = a.sunDirection.y
  let i = 0
  while (i < PARSED.length - 2 && y > PARSED[i + 1].at) i++
  const k0 = PARSED[i], k1 = PARSED[i + 1]
  const t = MathUtils.smoothstep(y, k0.at, k1.at)
  const mix = (name: keyof typeof k0.c, target: Color) => target.copy(k0.c[name]).lerp(k1.c[name], t)
  mix('zenith', a.zenith); mix('horizon', a.horizon); mix('ground', a.ground); mix('sun', a.sunColor)
  mix('hemiSky', a.hemiSky); mix('hemiGround', a.hemiGround); mix('fog', a.fogColor)
  mix('cloudLit', a.cloudLit); mix('cloudShade', a.cloudShade)
  const lerp = (key: 'sunI' | 'hemiI' | 'env' | 'fogD' | 'stars' | 'exposure') => MathUtils.lerp(k0[key], k1[key], t)
  a.sunIntensity = lerp('sunI'); a.hemiIntensity = lerp('hemiI'); a.envIntensity = lerp('env')
  a.fogDensity = lerp('fogD'); a.stars = lerp('stars'); a.exposure = lerp('exposure')
  a.moonIntensity = MathUtils.smoothstep(-y, -0.02, 0.2) * 0.9
  if (lastEnvSun.angleTo(a.sunDirection) > MathUtils.degToRad(1.5)) { lastEnvSun.copy(a.sunDirection); a.envVersion++ }
}
updateAtmosphere(atmosphere.hours)

/** Direction and strength of whichever body currently lights the world. */
export function keyLight(target: Vector3) {
  const a = atmosphere
  const sunUp = a.sunDirection.y > -0.04
  target.copy(sunUp ? a.sunDirection : a.moonDirection)
  // Fade to zero across the horizon so the sun→moon handover never pops.
  const fade = sunUp ? MathUtils.smoothstep(a.sunDirection.y, -0.04, 0.05) : MathUtils.smoothstep(a.moonDirection.y, 0.02, 0.15)
  return { color: sunUp ? a.sunColor : a.moonColor, intensity: (sunUp ? a.sunIntensity : a.moonIntensity) * fade }
}
