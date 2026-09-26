import { AdditiveBlending, DoubleSide, ShaderMaterial, Uniform } from 'three'
import type { Side } from 'three'
import { atmosphere } from '../sky/atmosphere'
import { fogUniforms } from '../sky/fog'
import { FOG_GLSL } from '../sky/glsl'

/**
 * Additive glow materials (orb halos, light pillars, array glyphs, shockwave). They don't write depth,
 * so the post-process height fog skips them: each fades itself by the same analytic fog instead.
 */
export function syncGlow(material: ShaderMaterial, time: number) {
  const u = material.uniforms
  if (u.uTime) u.uTime.value = time
  // Glows read brighter at night; keep them from blowing out in daylight.
  if (u.uNight) u.uNight.value = atmosphere.night
}

const FOG_FADE = /* glsl */ `
${FOG_GLSL}
float glowFade(vec3 world) {
  vec3 d = world - cameraPosition; float dist = max(length(d), 1e-3);
  return 1.0 - heightFog(cameraPosition, d / dist, dist);
}
`

export function glowMaterial(name: string, vertexShader: string, fragmentShader: string, uniforms: Record<string, Uniform> = {}, side: Side = DoubleSide) {
  return new ShaderMaterial({
    name, vertexShader, fragmentShader: `${FOG_FADE}\n${fragmentShader}`,
    uniforms: { ...fogUniforms, uTime: new Uniform(0), uNight: new Uniform(0), ...uniforms },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
}

/** Camera-facing quad per instance (instance scale = quad size; distant ones grow so they stay findable). */
export const HALO_VERTEX = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld; varying vec3 vTint;
void main() {
  vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  float dist = distance(centre.xyz, cameraPosition);
  float grow = clamp(dist / 60.0, 1.0, 7.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = centre.xyz + (right * position.x + up * position.y) * s * grow;
  vUv = uv; vWorld = world;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`
export const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColor; uniform float uNight;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vTint;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float glow = pow(max(1.0 - r, 0.0), 2.6);
  float core = exp(-r * r * 22.0);
  vec3 col = uColor * vTint * (glow * mix(0.28, 0.5, uNight) + core * 0.9);
  gl_FragColor = vec4(col * glowFade(vWorld), 1.0);
}
`

/** Instanced world-space mesh with per-instance tint and local uv/position varyings. */
export const LOCAL_VERTEX = /* glsl */ `
varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vTint;
void main() {
  vec4 local = vec4(position, 1.0);
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  vec4 world = model * local;
  vUv = uv; vLocal = position; vWorld = world.xyz;
  vNormalW = normalize(mat3(model) * normal);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/** Vertical beam fading upward, brightest where the view grazes its axis. */
export const PILLAR_FRAGMENT = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uHeight; uniform float uNight;
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vTint;
void main() {
  float h = clamp(vLocal.y / uHeight, 0.0, 1.0);
  float fade = pow(1.0 - h, 1.8) * smoothstep(0.0, 0.05, h);
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = pow(abs(dot(normalize(vNormalW), view)), 1.5);
  float shimmer = 0.85 + 0.15 * sin(uTime * 2.0 + vLocal.y * 1.3);
  vec3 col = uColor * vTint * fade * facing * shimmer * mix(0.35, 0.7, uNight);
  gl_FragColor = vec4(col * glowFade(vWorld), 1.0);
}
`

/** Rotating rune circle for teleport arrays (uv spans the disc). */
export const GLYPH_FRAGMENT = /* glsl */ `
uniform float uTime; uniform float uNight;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vTint;
float line(float d, float w) { return smoothstep(w, 0.0, abs(d)); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p), a = atan(p.y, p.x);
  if (r > 1.0) discard;
  float spin = uTime * 0.12;
  float rings = line(r - 0.95, 0.012) + line(r - 0.86, 0.008) * 0.8 + line(r - 0.5, 0.01) * 0.7 + line(r - 0.2, 0.012) * 0.6;
  float band = step(0.86, r) * step(r, 0.95);
  float ticks = band * step(0.55, fract((a + spin) * 36.0 / 6.28318)) * 0.55;
  float petals = line(r - 0.5 * (0.72 + 0.28 * abs(cos(3.0 * (a - spin * 1.6)))), 0.012) * step(r, 0.86);
  float spokes = line(sin(6.0 * (a + spin * 0.7)) * r, 0.01) * step(0.2, r) * step(r, 0.5) * 0.6;
  float centre = exp(-r * r * 9.0) * 0.35;
  float pulse = 0.8 + 0.2 * sin(uTime * 1.7);
  float glow = (rings + ticks + petals + spokes) * pulse + centre;
  vec3 col = vTint * glow * mix(0.9, 1.4, uNight);
  gl_FragColor = vec4(col * glowFade(vWorld), 1.0);
}
`

/** Expanding ground ring (bell shockwave); uProgress 0→1. */
export const WAVE_FRAGMENT = /* glsl */ `
uniform float uProgress;
varying vec2 vUv; varying vec3 vWorld;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  if (r > 1.0) discard;
  float f = uProgress;
  float front = exp(-pow((r - f) / 0.02, 2.0));
  float echo = exp(-pow((r - f * 0.72) / 0.015, 2.0)) * 0.55;
  float wake = smoothstep(f - 0.3, f, r) * step(r, f) * 0.22;
  float alpha = (front + echo + wake) * pow(1.0 - f, 1.6);
  gl_FragColor = vec4(vec3(1.0, 0.83, 0.52) * alpha * 1.6 * glowFade(vWorld), 1.0);
}
`

/** Soft additive sparks (points). */
export const SPARK_VERTEX = /* glsl */ `
attribute float aLife; attribute vec3 aColor;
uniform float uPixel;
varying float vLife; varying vec3 vColor; varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife <= 0.0 ? 0.0 : (0.35 + 0.65 * aLife) * 90.0 * uPixel / max(-mv.z, 0.5);
  vLife = aLife; vColor = aColor; vWorld = world.xyz;
}
`
export const SPARK_FRAGMENT = /* glsl */ `
varying float vLife; varying vec3 vColor; varying vec3 vWorld;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.2) * vLife;
  gl_FragColor = vec4(vColor * a * 2.2 * glowFade(vWorld), 1.0);
}
`
