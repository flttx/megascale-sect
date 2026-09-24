import { AdditiveBlending, Color, PlaneGeometry, ShaderMaterial, Uniform } from 'three'
import type { MeshStandardMaterial } from 'three'
import { atmosphere } from '../sky/atmosphere'
import { FOG_GLSL } from '../sky/glsl'
import type { GlowSpec } from './propCatalog'

const f = (v: number) => v.toFixed(3)

/**
 * Masks a lantern material's emissive to its lamp chamber (a box in normalised model space) so only the
 * paper / fire box glows; the base texture doubles as the emissive map, keeping the lattice pattern.
 * Set before the mesh enters the scene so the CSM and surface-weather hooks chain onto it.
 */
export function withGlowMask(material: MeshStandardMaterial, glow: GlowSpec, color: Color, key: string) {
  material.emissive.copy(color)
  material.emissiveMap = glow.strength < 0.5 ? null : material.map
  material.emissiveIntensity = 0
  const terms = [
    `smoothstep(${f(glow.yMin - 0.015)}, ${f(glow.yMin + 0.01)}, vPropLocal.y) * (1.0 - smoothstep(${f(glow.yMax - 0.01)}, ${f(glow.yMax + 0.015)}, vPropLocal.y))`,
    glow.radius !== undefined ? `(1.0 - smoothstep(${f(glow.radius - 0.015)}, ${f(glow.radius + 0.01)}, length(vPropLocal.xz)))` : '',
    glow.zMax !== undefined ? `(1.0 - smoothstep(${f(glow.zMax - 0.01)}, ${f(glow.zMax + 0.02)}, vPropLocal.z))` : '',
  ].filter(Boolean)
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPropLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPropLocal = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPropLocal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ${terms.join(' * ')};`)
  }
  material.customProgramCacheKey = () => `prop-glow-${key}`
  return material
}

/**
 * Soft additive halos for lanterns (one instanced draw). Billboarded in the vertex shader from the
 * instance translation / scale, nudged toward the camera so the lamp's own stone doesn't clip it, and
 * self-fogged because additive, non-depth-writing pixels bypass the post-process height fog.
 */
export function makeGlowSpriteMaterial() {
  return new ShaderMaterial({
    name: 'PropLanternGlow',
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    uniforms: {
      uIntensity: new Uniform(0), uTime: new Uniform(0), uColor: new Uniform(new Color('#ffb266')),
      fogTint: new Uniform(atmosphere.fogColor), fogSunColor: new Uniform(atmosphere.sunColor), fogSunDir: new Uniform(atmosphere.sunDirection),
      fogDensity: new Uniform(0), fogFalloff: new Uniform(0), fogBase: new Uniform(0),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      void main() {
        vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = length(instanceMatrix[0].xyz);
        vec4 mv = viewMatrix * center;
        mv.xy += position.xy * size;
        mv.z += size * 0.6;
        vUv = uv; vWorld = center.xyz; vSeed = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity; uniform float uTime; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      ${FOG_GLSL}
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = pow(max(1.0 - d, 0.0), 2.4);
        float flicker = 0.9 + 0.1 * sin(uTime * (7.0 + vSeed * 5.0) + vSeed * 40.0) * sin(uTime * 3.1 + vSeed * 17.0);
        vec3 toFrag = vWorld - cameraPosition; float dist = length(toFrag); vec3 dir = toFrag / max(dist, 1e-3);
        float fade = (1.0 - heightFog(cameraPosition, dir, dist)) * (1.0 - smoothstep(260.0, 380.0, dist));
        gl_FragColor = vec4(uColor * core * uIntensity * flicker * fade, 1.0);
      }`,
  })
}

export const glowQuad = new PlaneGeometry(1, 1)

/** Per-frame fog uniforms, mirroring CloudSea. */
export function syncGlowFog(material: ShaderMaterial, time: number, intensity: number) {
  const u = material.uniforms
  u.uTime.value = time; u.uIntensity.value = intensity
  u.fogDensity.value = atmosphere.fogDensity; u.fogFalloff.value = atmosphere.fogFalloff; u.fogBase.value = atmosphere.fogBase
}
