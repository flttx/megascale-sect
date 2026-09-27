import { Uniform } from 'three'
import { atmosphere } from './atmosphere'
import { skyLut } from './skyModel'

/** Aerial-haze extinction (1/m) at y = 0; it thins with altitude (scale height 1.5 km). */
const AERIAL = 1.0e-4

/**
 * One set of fog uniforms shared (by reference) by the post-process atmosphere pass and every material
 * that fogs itself because it writes no depth. Spread it into a material's uniforms; SkyDome syncs it once
 * per frame after the sky-view LUT is rendered.
 */
export const fogUniforms = {
  fogTint: new Uniform(atmosphere.fogColor), fogSunColor: new Uniform(atmosphere.sunColor), fogSunDir: new Uniform(atmosphere.sunDirection),
  fogDensity: new Uniform(0), fogFalloff: new Uniform(0), fogBase: new Uniform(0), fogAerial: new Uniform(AERIAL),
  fogSkyLut: new Uniform(skyLut.texture),
}

export function syncFogUniforms() {
  const a = atmosphere, u = fogUniforms
  u.fogDensity.value = a.fogDensity; u.fogFalloff.value = a.fogFalloff; u.fogBase.value = a.fogBase
  u.fogAerial.value = AERIAL * (1 + (a.haze - 1) * 0.55)
}
