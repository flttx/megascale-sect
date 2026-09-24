/** Shared GLSL helpers for sky, clouds and fog shaders. */
export const NOISE_GLSL = /* glsl */ `
float skyHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float skyHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
}
float skyFbm(vec2 p, int octaves) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { if (i >= octaves) break; v += a * skyNoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
`

/**
 * Analytic exponential height fog (density falls off above fogBase), integrated along the view ray.
 * Returns the fog amount in [0, 1].
 */
export const FOG_GLSL = /* glsl */ `
uniform vec3 fogTint; uniform vec3 fogSunColor; uniform vec3 fogSunDir;
uniform float fogDensity; uniform float fogFalloff; uniform float fogBase;
float heightFog(vec3 origin, vec3 dir, float dist) {
  float b = fogFalloff;
  float k = dir.y * b;
  float path = abs(k) < 1e-4 ? dist : (1.0 - exp(-dist * k)) / k;
  float optical = fogDensity * exp(-(origin.y - fogBase) * b) * path;
  return 1.0 - exp(-max(optical, 0.0));
}
vec3 fogColorFor(vec3 dir) {
  float mu = max(dot(dir, fogSunDir), 0.0);
  return fogTint + fogSunColor * (pow(mu, 6.0) * 0.35 + pow(mu, 48.0) * 0.5);
}
`
