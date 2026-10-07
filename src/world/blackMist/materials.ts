import { AdditiveBlending, BackSide, DoubleSide, ShaderMaterial, Uniform } from 'three'
import { NOISE_GLSL } from '../sky/glsl'

/** One mutable set feeds the storm, its debris and all existing weather-patched surfaces. */
export const BLACK_MIST_UNIFORMS = {
  uMistTime: new Uniform(0),
  uMistCorruption: new Uniform(0),
  uMistFront: new Uniform(2600),
  uMistFlash: new Uniform(0),
  uMistApproach: new Uniform(0),
  uMistAmount: new Uniform(0),
  uMistShock: new Uniform(-1),
}

export const BLACK_MIST_SURFACE_HEAD = /* glsl */ `
uniform float uMistCorruption; uniform float uMistFront; uniform float uMistTime; uniform float uMistFlash;
`

/** World-space soot and faint mineral fissures, advancing through the same front as the clouds. */
export const BLACK_MIST_SURFACE_COLOR = /* glsl */ `
  float bmBroad = 0.0, bmVein = 0.0;
  if (uMistCorruption > 0.001) {
  float bmArrival = smoothstep(uMistFront - 180.0, uMistFront + 160.0, vWxPosition.x);
  float bmAmount = uMistCorruption * bmArrival;
  bmBroad = wxNoise(vWxPosition.xz * 0.017 + vWxPosition.y * 0.008);
  float bmStain = smoothstep(0.38, 0.76, bmBroad) * bmAmount;
  float bmLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 bmStone = mix(diffuseColor.rgb, vec3(bmLuma) * vec3(0.82, 0.79, 0.91), 0.64);
  diffuseColor.rgb = mix(diffuseColor.rgb, bmStone * (0.71 - bmStain * 0.16), bmAmount);
  vec2 bmP = (vWxPosition.xz + vWxPosition.y * vec2(0.53, 0.31)) * 0.055;
  float bmWarp = wxNoise(bmP * 0.39);
  float bmChannel = wxNoise(bmP + vec2(bmWarp * 2.3, bmWarp * 1.7));
  float bmWidth = max(fwidth(bmChannel) * 1.3, 0.006);
  bmVein = (1.0 - smoothstep(0.006, 0.006 + bmWidth, abs(bmChannel - 0.52)))
    * smoothstep(0.58, 0.75, bmBroad) * bmAmount;
  diffuseColor.rgb *= 1.0 - bmVein * 0.38;
  }
`

export const BLACK_MIST_SURFACE_EMISSIVE = /* glsl */ `
  // A slow, low glow remains under the soot; the architecture and paths stay readable.
  float bmBreath = 0.65 + 0.35 * sin(uMistTime * 0.55 + bmBroad * 9.0);
  totalEmissiveRadiance += vec3(0.63, 0.095, 0.035) * bmVein * (0.32 * bmBreath + uMistFlash * 1.1);
`

const WORLD_VERTEX = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`

const STORM_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
uniform float uMistTime; uniform float uMistAmount; uniform float uMistFlash; uniform float uMistApproach;
uniform float uLayer;
${NOISE_GLSL}
void main() {
  vec2 p = vec2(vUv.x * 9.4, vUv.y * 3.4) + vec2(uMistTime * 0.032, -uMistTime * 0.018) + uLayer * 8.7;
  vec2 warp = vec2(skyFbm(p * 0.55, 3), skyFbm(p * 0.55 + 11.8, 3));
  float body = skyFbm(p + warp * 1.8, 4);
  float fine = skyFbm(p * 2.5 + warp, 3);
  float crest = 0.68 + skyFbm(vec2(vUv.x * 10.0, uMistTime * 0.015 + uLayer * 3.7), 3) * 0.3;
  float shape = 1.0 - smoothstep(crest - 0.21, crest + 0.035, vUv.y + (body - 0.5) * 0.2);
  shape *= smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.0, 0.075, vUv.x) * (1.0 - smoothstep(0.925, 1.0, vUv.x));
  float alpha = shape * smoothstep(0.14, 0.67, body + (1.0 - vUv.y) * 0.25);
  if (alpha < 0.004) discard;
  // Finite-difference illumination makes the noisy crests read as rolling cloud volumes.
  float lightSample = skyFbm(p + warp * 1.8 + vec2(-0.07, 0.11), 3);
  float edge = clamp((body - lightSample) * 4.5 + fine * 0.35, 0.0, 1.0);
  vec3 color = mix(vec3(0.012, 0.011, 0.019), vec3(0.085, 0.076, 0.103), edge);
  float glow = smoothstep(0.49, 0.7, fine) * smoothstep(0.15, 0.85, vUv.y);
  color += vec3(0.14, 0.026, 0.012) * glow * (0.18 + uMistApproach * 0.42);
  color += vec3(0.32, 0.27, 0.38) * uMistFlash * (0.3 + edge);
  // A near eye sees wisps, instead of the hard plane cutting across it as the front passes.
  float nearFade = smoothstep(18.0, 105.0, distance(vWorld, cameraPosition));
  gl_FragColor = vec4(color, alpha * uMistAmount * nearFade * (0.84 - uLayer * 0.09));
}`

export function createStormMaterial(layer: number) {
  return new ShaderMaterial({
    name: `BlackMistWall_${layer}`,
    vertexShader: WORLD_VERTEX,
    fragmentShader: STORM_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS, uLayer: new Uniform(layer) },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform float uMistTime; uniform float uMistAmount; uniform float uMistCorruption; uniform float uMistApproach; uniform float uMistFlash;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  // The invading sky starts in the east. At impact it unfurls into a world-sized vortex overhead.
  vec2 p = d.xz / max(0.23, d.y + 0.3);
  float radius = length(p);
  // Warp the continuous direction field. Unwrapped longitude feeds unrelated noise on the
  // two sides of atan's ±PI branch, producing a visible meridian from horizon to zenith.
  float twist = radius * 3.4 - uMistTime * 0.03;
  float c = cos(twist), s = sin(twist);
  vec2 spiral = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float n = skyFbm(spiral * 1.8 + vec2(0.0, -uMistTime * 0.025), 4);
  float streakTwist = radius * 8.0 - uMistTime * 0.06;
  float sc = cos(streakTwist), ss = sin(streakTwist);
  vec2 streakField = vec2(sc * p.x - ss * p.y, ss * p.x + sc * p.y);
  float streak = skyFbm(streakField * 4.0 + vec2(radius * 1.15, 0.0), 3);
  float incoming = smoothstep(-0.15 + uMistApproach * 0.25, 0.85 - uMistApproach * 0.4, d.x);
  float spread = max(incoming * uMistApproach, uMistCorruption * 0.93);
  float upper = smoothstep(-0.22, 0.18, d.y);
  float density = smoothstep(0.16, 0.77, n + spread * 0.2);
  float eye = 1.0 - smoothstep(0.04, 0.28, radius);
  float emberRing = exp(-pow((radius - 0.3 - (n - 0.5) * 0.07) * 18.0, 2.0));
  vec3 color = mix(vec3(0.011, 0.01, 0.021), vec3(0.067, 0.052, 0.082), n);
  color = mix(color, vec3(0.0015, 0.001, 0.003), eye * uMistCorruption);
  color += vec3(0.33, 0.045, 0.013) * (emberRing * 0.8 + streak * streak * 0.25) * uMistCorruption;
  color += vec3(0.25, 0.18, 0.29) * uMistFlash * density;
  float alpha = upper * spread * mix(density, 0.9, uMistCorruption * 0.72) * uMistAmount;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.97));
}`

export function createMistSkyMaterial() {
  return new ShaderMaterial({
    name: 'BlackMistSkyVeil',
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
}

const PLUME_VERTEX = /* glsl */ `
attribute float aSeed;
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
void main() {
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center + right * position.x * size.x + up * position.y * size.y;
  vUv = uv; vSeed = aSeed; vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const PLUME_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
uniform float uMistTime; uniform float uMistAmount; uniform float uMistFlash;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * vec2(4.0, 2.4) + vSeed * 13.7 + vec2(uMistTime * 0.035, -uMistTime * 0.025);
  float n = skyFbm(p, 4);
  vec2 q = vUv - 0.5;
  q.y += sin(q.x * 5.0 + vSeed * 9.0 + uMistTime * 0.12) * 0.11;
  float shape = 1.0 - smoothstep(0.17, 0.53, length(q * vec2(1.0, 1.55)) + (n - 0.5) * 0.2);
  float opacity = shape * smoothstep(0.23, 0.72, n) * uMistAmount * 0.6;
  opacity *= smoothstep(15.0, 95.0, distance(vWorld, cameraPosition));
  if (opacity < 0.003) discard;
  vec3 color = mix(vec3(0.013, 0.012, 0.025), vec3(0.07, 0.051, 0.072), n);
  color += vec3(0.22, 0.16, 0.23) * uMistFlash;
  gl_FragColor = vec4(color, opacity);
}`

export function createPlumeMaterial() {
  return new ShaderMaterial({
    name: 'BlackMistPlumes',
    vertexShader: PLUME_VERTEX,
    fragmentShader: PLUME_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS },
    transparent: true,
    depthWrite: false,
    fog: false,
  })
}

const SHOCK_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
uniform float uMistShock;
${NOISE_GLSL}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p), noise = skyFbm(p * 18.0, 3);
  float radius = uMistShock * 0.67;
  float ridge = exp(-pow((r - radius + (noise - 0.5) * 0.024) * 100.0, 2.0));
  float envelope = smoothstep(0.0, 0.12, uMistShock) * (1.0 - smoothstep(0.6, 1.0, uMistShock));
  gl_FragColor = vec4(vec3(0.45, 0.11, 0.04) * ridge * envelope * 1.4, ridge * envelope * 0.52);
}`

export function createShockMaterial() {
  return new ShaderMaterial({
    name: 'BlackMistPressureWave',
    vertexShader: WORLD_VERTEX,
    fragmentShader: SHOCK_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS },
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}

const ASH_VERTEX = /* glsl */ `
attribute vec4 aDrift;
uniform float uMistTime;
varying float vAsh;
void main() {
  vec3 p = position;
  p.x = mod(p.x - uMistTime * (1.4 + aDrift.x * 3.5) + 220.0, 440.0) - 220.0;
  p.y = mod(p.y - uMistTime * (0.3 + aDrift.y) + 100.0, 200.0) - 100.0;
  p.z += sin(uMistTime * 0.23 + aDrift.z * 50.0) * 5.0;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp((1.2 + aDrift.w * 2.5) * 85.0 / max(4.0, -view.z), 1.0, 6.0);
  vAsh = aDrift.w;
}`

const ASH_FRAGMENT = /* glsl */ `
uniform float uMistCorruption; uniform float uMistApproach;
varying float vAsh;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float alpha = (1.0 - smoothstep(0.18, 0.5, r)) * max(uMistCorruption * 0.6, uMistApproach * 0.22);
  vec3 color = mix(vec3(0.18, 0.17, 0.23), vec3(0.6, 0.15, 0.055), step(0.92, vAsh));
  gl_FragColor = vec4(color, alpha);
}`

export function createAshMaterial() {
  return new ShaderMaterial({
    name: 'BlackMistAsh',
    vertexShader: ASH_VERTEX,
    fragmentShader: ASH_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS },
    transparent: true,
    depthWrite: false,
    fog: false,
  })
}

const LIGHTNING_VERTEX = /* glsl */ `
attribute vec3 aDir; attribute float aSide; attribute float aSeed;
uniform float uMistFront;
varying float vSide; varying float vSeed;
void main() {
  vec3 center = position + vec3(uMistFront + 110.0, 0.0, 0.0);
  vec3 direction = normalize(cross(aDir, normalize(cameraPosition - center)));
  vec3 world = center + direction * aSide * 4.2;
  vSide = aSide; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const LIGHTNING_FRAGMENT = /* glsl */ `
uniform float uMistFlash;
varying float vSide; varying float vSeed;
void main() {
  float profile = exp(-vSide * vSide * 5.0);
  float enabled = step(vSeed, min(1.0, uMistFlash * 3.0));
  gl_FragColor = vec4(vec3(1.45, 0.77, 0.93) * profile * uMistFlash * enabled * 2.2, 1.0);
}`

export function createMistLightningMaterial() {
  return new ShaderMaterial({
    name: 'BlackMistStormLightning',
    vertexShader: LIGHTNING_VERTEX,
    fragmentShader: LIGHTNING_FRAGMENT,
    uniforms: { ...BLACK_MIST_UNIFORMS },
    transparent: true,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  })
}
