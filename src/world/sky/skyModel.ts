import { ClampToEdgeWrapping, Color, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RepeatWrapping, RGBAFormat, ShaderMaterial, Uniform, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three'

/**
 * Single-scattering Earth atmosphere (Rayleigh + Mie + ozone, Hillaire 2020 coefficients).
 * The sky-view LUT is a lat-long radiance map around the camera that the sky dome, the image-based
 * light, the aerial-perspective fog and the cloud lighting all sample, so every distant colour agrees.
 */

/** Altitude (m above sea level) of world y = 0: the sect sits high on a mountain. */
export const WORLD_ALTITUDE = 1800
/** Sun illuminance scale feeding the LUT; tuned so the noon zenith lands near the old painted palette. */
export const SKY_SUN = 22

const RG = 6360e3, RT = 6420e3
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6]
const BETA_ME = 4.4e-6
const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6]

/** Direct-sun transmittance from the sect toward a body at elevation `mu` (= direction.y). */
export function sunTransmittance(mu: number, haze: number, out: Color) {
  const oy = RG + WORLD_ALTITUDE
  // Stay just above the geometric horizon dip; below it keyLight() has already faded the light out.
  const dy = Math.max(mu, -0.02), dx = Math.sqrt(1 - dy * dy)
  const b = oy * dy
  const tMax = -b + Math.sqrt(b * b - (oy * oy - RT * RT))
  let odR = 0, odM = 0, odO = 0, prev = 0
  const steps = 48
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps, t = tMax * f * f, dt = t - prev, tm = prev + dt / 2
    prev = t
    const h = Math.hypot(dx * tm, oy + dy * tm) - RG
    odR += Math.exp(-h / 8000) * dt; odM += Math.exp(-h / 1200) * dt; odO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt
  }
  return out.setRGB(
    Math.exp(-(BETA_R[0] * odR + BETA_ME * haze * odM + BETA_O[0] * odO)),
    Math.exp(-(BETA_R[1] * odR + BETA_ME * haze * odM + BETA_O[1] * odO)),
    Math.exp(-(BETA_R[2] * odR + BETA_ME * haze * odM + BETA_O[2] * odO)),
  )
}

/** Must match `skyLutUv` in glsl.ts: azimuth on u, square-root-compressed elevation on v. */
const lutFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uSunDir; uniform vec3 uSunE; uniform vec3 uMoonDir; uniform vec3 uMoonE;
uniform float uAltitude; uniform float uHaze; uniform float uDesat; uniform float uDarken; uniform float uFlash;
#define PI 3.14159265
const float RG = 6360e3; const float RT = 6420e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BETA_MS = 3.996e-6; const float BETA_ME = 4.4e-6;
const vec3 BETA_O = vec3(0.65e-6, 1.881e-6, 0.085e-6);

float sphereExit(vec3 ro, vec3 rd, float r) { float b = dot(ro, rd); return -b + sqrt(max(b * b - dot(ro, ro) + r * r, 0.0)); }
float groundHit(vec3 ro, vec3 rd) { float b = dot(ro, rd); float d = b * b - dot(ro, ro) + RG * RG; return (d < 0.0 || b > 0.0) ? -1.0 : -b - sqrt(d); }
vec3 density(float h) { return vec3(exp(-h / 8000.0), exp(-h / 1200.0), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0)); }
vec3 extinction(vec3 d) { return BETA_R * d.x + BETA_ME * uHaze * d.y + BETA_O * d.z; }
vec3 lightTransmittance(vec3 p, vec3 l) {
  if (groundHit(p, l) > 0.0) return vec3(0.0);
  float tMax = sphereExit(p, l, RT);
  vec3 od = vec3(0.0); float prev = 0.0;
  for (int i = 0; i < 8; i++) {
    float f = (float(i) + 1.0) / 8.0; float t = tMax * f * f; float dt = t - prev;
    od += extinction(density(length(p + l * (prev + dt * 0.5)) - RG)) * dt; prev = t;
  }
  return exp(-od);
}
float rayleighPhase(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float miePhase(float mu) {
  const float g = 0.8; const float g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

void main() {
  float az = vUv.x * 2.0 * PI;
  float s = vUv.y * 2.0 - 1.0;
  float el = sign(s) * s * s * 0.5 * PI;
  vec3 rd = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 ro = vec3(0.0, RG + uAltitude, 0.0);
  float tMax = sphereExit(ro, rd, RT);
  float tg = groundHit(ro, rd);
  if (tg > 0.0) tMax = tg;
  float muS = dot(rd, uSunDir), muM = dot(rd, uMoonDir);
  float prS = rayleighPhase(muS), pmS = miePhase(muS), prM = rayleighPhase(muM), pmM = miePhase(muM);
  bool moon = uMoonE.x + uMoonE.y + uMoonE.z > 1e-5;
  vec3 L = vec3(0.0), T = vec3(1.0);
  float prev = 0.0;
  for (int i = 0; i < 28; i++) {
    float f = (float(i) + 1.0) / 28.0; float t = tMax * f * f; float dt = t - prev;
    vec3 p = ro + rd * (prev + dt * 0.5); prev = t;
    vec3 d = density(length(p) - RG);
    vec3 sR = BETA_R * d.x; float sM = BETA_MS * uHaze * d.y;
    vec3 ext = extinction(d);
    vec3 sunT = lightTransmittance(p, uSunDir);
    vec3 inS = (sR * prS + sM * pmS) * sunT * uSunE;
    // Cheap multiple-scattering fill: an isotropic share of the light that reached this sample.
    inS += (sR + sM) * sunT * uSunE * 0.045;
    if (moon) {
      vec3 moonT = lightTransmittance(p, uMoonDir);
      inS += ((sR * prM + sM * pmM) + (sR + sM) * 0.045) * moonT * uMoonE;
    }
    vec3 stepT = exp(-ext * dt);
    L += T * inS * (1.0 - stepT) / max(ext, vec3(1e-12));
    T *= stepT;
  }
  float lum = dot(L, vec3(0.2126, 0.7152, 0.0722));
  L = mix(L, vec3(lum), uDesat) * (1.0 - uDarken);
  L += vec3(0.78, 0.83, 1.0) * uFlash * 0.5;
  // Airglow floor so a moonless night never goes pitch black.
  L += vec3(0.0024, 0.0036, 0.0072);
  gl_FragColor = vec4(L, 1.0);
}`

export interface SkyLutInputs {
  sunDirection: Vector3; moonDirection: Vector3
  sunE: number; moonE: Color
  haze: number; desat: number; darken: number; flash: number
}

/** Renders the sky-view LUT on demand (only when an input moved enough to matter). */
export class SkyLut {
  readonly target = new WebGLRenderTarget(256, 128, {
    type: HalfFloatType, format: RGBAFormat, wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping,
    minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false,
  })
  private readonly material = new ShaderMaterial({
    name: 'SkyViewLut',
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: lutFragment,
    uniforms: {
      uSunDir: new Uniform(new Vector3()), uSunE: new Uniform(new Vector3()), uMoonDir: new Uniform(new Vector3()), uMoonE: new Uniform(new Vector3()),
      uAltitude: new Uniform(WORLD_ALTITUDE), uHaze: new Uniform(1), uDesat: new Uniform(0), uDarken: new Uniform(0), uFlash: new Uniform(0),
    },
    depthTest: false, depthWrite: false,
  })
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.material)
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private key = ''

  constructor() { this.quad.frustumCulled = false }

  get texture() { return this.target.texture }

  update(renderer: WebGLRenderer, input: SkyLutInputs) {
    const r = (v: number) => Math.round(v * 2000)
    const key = [
      input.sunDirection.x, input.sunDirection.y, input.sunDirection.z, input.moonDirection.y, input.sunE / 40,
      input.moonE.r, input.moonE.g, input.moonE.b, input.haze / 4, input.desat, input.darken, input.flash,
    ].map(r).join(',')
    if (key === this.key) return false
    this.key = key
    const u = this.material.uniforms
    u.uSunDir.value.copy(input.sunDirection); u.uSunE.value.setScalar(input.sunE)
    u.uMoonDir.value.copy(input.moonDirection); u.uMoonE.value.set(input.moonE.r, input.moonE.g, input.moonE.b)
    u.uHaze.value = input.haze; u.uDesat.value = input.desat; u.uDarken.value = input.darken; u.uFlash.value = input.flash
    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(this.quad, this.camera)
    renderer.setRenderTarget(previous)
    return true
  }

  dispose() {
    this.target.dispose(); this.material.dispose(); this.quad.geometry.dispose()
  }
}

/** The one sky-view LUT every sky-lit shader samples (rendered by SkyDome each frame). */
export const skyLut = new SkyLut()
