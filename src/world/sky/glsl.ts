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

/** Sky-view LUT lookup (see skyModel.ts): azimuth on u, square-root-compressed elevation on v. */
export const SKY_VIEW_GLSL = /* glsl */ `
uniform sampler2D fogSkyLut;
vec3 skyView(vec3 dir) {
  vec3 d = normalize(dir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float s = sign(el) * sqrt(abs(el) / 1.5707963);
  return texture2D(fogSkyLut, vec2(fract(atan(d.z, d.x) / 6.2831853), 0.5 + 0.5 * s)).rgb;
}
`

/**
 * Two analytic media integrated along the view ray: a dense mist hugging the cloud sea (fogBase/fogFalloff)
 * and a thin aerial haze that fades with altitude and takes its colour from the sky-view LUT, so distant
 * ridges turn sky-blue while the mist stays pearl white. `heightFog` returns the amount in [0, 1] and records
 * the mist share that `fogColorFor` blends by, so call it first.
 */
export const FOG_GLSL = /* glsl */ `
${SKY_VIEW_GLSL}
uniform vec3 fogTint; uniform vec3 fogSunColor; uniform vec3 fogSunDir;
uniform float fogDensity; uniform float fogFalloff; uniform float fogBase; uniform float fogAerial;
float fogMistShare = 0.5;
float fogDepth(vec3 origin, vec3 dir, float dist, float falloff, float base) {
  // Linearise on the optical exponent dist·k, not on k alone, or the path jumps where |k| crosses the cut.
  float k = dir.y * falloff, x = dist * k;
  float path = abs(x) < 1e-3 ? dist * (1.0 - 0.5 * x) : (1.0 - exp(-x)) / k;
  return exp(-(origin.y - base) * falloff) * path;
}
float heightFog(vec3 origin, vec3 dir, float dist) {
  float mist = fogDensity * fogDepth(origin, dir, dist, fogFalloff, fogBase);
  // Aerial haze builds in over the first ~kilometre (path d²/(d + 800)), so mid-range pillars keep their
  // contrast while distant ridges still fade into the sky.
  float aerial = fogAerial * fogDepth(origin, dir, dist * dist / (dist + 800.0), 1.0 / 1500.0, 0.0);
  fogMistShare = mist / max(mist + aerial, 1e-7);
  return 1.0 - exp(-max(mist + aerial, 0.0));
}
vec3 fogColorFor(vec3 dir) {
  // Once the sun has set its (deep red) colour must not glow up from below the horizon.
  float mu = max(dot(dir, fogSunDir), 0.0) * smoothstep(-0.06, 0.02, fogSunDir.y);
  vec3 mist = fogTint + fogSunColor * (pow(mu, 6.0) * 0.2 + pow(mu, 48.0) * 0.45);
  // In-scatter along a downward ray is lit like the horizon it runs toward, not like the ground.
  vec3 aerial = skyView(vec3(dir.x, max(dir.y, 0.02), dir.z));
  return mix(aerial, mist, fogMistShare);
}
`
