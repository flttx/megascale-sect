import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BackSide, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Uniform, type WebGLRenderTarget } from 'three'
import { atmosphere, updateAtmosphere } from './atmosphere'
import { FOG_GLSL, NOISE_GLSL } from './glsl'

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const fragmentShader = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunIntensity;
uniform vec3 uMoonDir; uniform float uMoonIntensity; uniform float uStars;
uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uCloudCover; uniform vec2 uWind;
uniform float uTime; uniform float uEnvPass;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  // Below the horizon the camera looks onto the far cloud sea; the IBL capture keeps a darker ground so
  // downward faces are not over-filled.
  vec3 below = uEnvPass > 0.5 ? uGround : mix(mix(uCloudShade, uCloudLit, 0.6), uHorizon, 0.35);
  col = mix(col, below, smoothstep(0.0, -0.14, h));

  float sunUp = smoothstep(-0.1, 0.04, uSunDir.y);
  float mu = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * sunUp * (pow(mu, 6.0) * 0.18 + pow(mu, 48.0) * 0.45 + pow(mu, 700.0) * 1.6);

  // Stars: one candidate per 3D cell on the view sphere, faded toward the horizon.
  if (uStars > 0.001) {
    vec3 p = dir * 260.0;
    vec3 cell = floor(p);
    float s = skyHash3(cell);
    float d = length(fract(p) - 0.5);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + s * 4.0) + s * 60.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9965, s) * smoothstep(0.32, 0.0, d) * twinkle * uStars * smoothstep(0.0, 0.25, h) * 2.5;
  }

  // Painted cloud deck: world-locked plane projection with a fake self-shadow toward the sun.
  if (h > -0.02) {
    vec2 uv = dir.xz / (h + 0.09) * 0.9 + uWind * uTime * 0.0012;
    float n = skyFbm(uv, uEnvPass > 0.5 ? 3 : 5);
    float lit = skyFbm(uv + uSunDir.xz * 0.12, 3);
    float cover = mix(0.72, 0.38, uCloudCover);
    float alpha = smoothstep(cover, cover + 0.26, n) * smoothstep(-0.02, 0.12, h) * (1.0 - smoothstep(0.55, 0.95, h) * 0.5);
    float shade = clamp((n - lit) * 3.2 + 0.62, 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, shade);
    cloud += uSunColor * sunUp * pow(mu, 10.0) * (1.0 - alpha) * 1.4;
    float cirrus = smoothstep(0.55, 0.9, skyFbm(vec2(uv.x * 0.35, uv.y * 1.6) + 3.1, 4)) * 0.35 * smoothstep(0.0, 0.3, h);
    col = mix(col, uCloudLit * 1.05, cirrus * (1.0 - alpha));
    col = mix(col, cloud, alpha * 0.92);
  }

  // Moon disk with a faint mottled face and halo.
  float moon = dot(dir, uMoonDir);
  float moonDisk = smoothstep(0.99955, 0.99968, moon);
  float mottled = 0.78 + 0.22 * skyNoise(dir.xy * 900.0);
  col += vec3(0.85, 0.9, 1.0) * uMoonIntensity * (moonDisk * mottled * 6.0 + pow(max(moon, 0.0), 180.0) * 0.4);

  // Sun disk last so clouds only partly veil it; dimmed for the IBL capture to avoid fireflies.
  float disk = smoothstep(0.99975, 0.99988, mu) * step(-0.01, h);
  col += uSunColor * sunUp * disk * mix(38.0, 3.0, uEnvPass);

  // Blend into the post-process fog colour at the horizon so terrain and sky meet seamlessly.
  col = mix(col, fogColorFor(dir), (1.0 - smoothstep(0.0, 0.16, abs(h + 0.01))) * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`

export function createSkyMaterial() {
  const material = new ShaderMaterial({
    name: 'SkyDome',
    vertexShader, fragmentShader, side: BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uZenith: new Uniform(atmosphere.zenith), uHorizon: new Uniform(atmosphere.horizon), uGround: new Uniform(atmosphere.ground),
      uSunDir: new Uniform(atmosphere.sunDirection), uSunColor: new Uniform(atmosphere.sunColor), uSunIntensity: new Uniform(0),
      uMoonDir: new Uniform(atmosphere.moonDirection), uMoonIntensity: new Uniform(0), uStars: new Uniform(0),
      uCloudLit: new Uniform(atmosphere.cloudLit), uCloudShade: new Uniform(atmosphere.cloudShade), uCloudCover: new Uniform(0.5),
      uWind: new Uniform(atmosphere.wind), uTime: new Uniform(0), uEnvPass: new Uniform(0),
      fogTint: new Uniform(atmosphere.fogColor), fogSunColor: new Uniform(atmosphere.sunColor), fogSunDir: new Uniform(atmosphere.sunDirection),
      fogDensity: new Uniform(0), fogFalloff: new Uniform(0), fogBase: new Uniform(0),
    },
  })
  return material
}

/** Camera-centred sky sphere; also renders itself into a PMREM cube for image-based lighting. */
export function SkyDome() {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const { material, dome, envScene } = useMemo(() => {
    const material = createSkyMaterial()
    const dome = new Mesh(new SphereGeometry(2000, 48, 24), material)
    dome.name = 'SkyDome'; dome.frustumCulled = false; dome.renderOrder = -1000
    dome.onBeforeRender = (_renderer, _scene, camera) => { dome.position.copy(camera.position); dome.updateMatrixWorld() }
    const envScene = new Scene()
    envScene.add(new Mesh(new SphereGeometry(50, 32, 16), material))
    return { material, dome, envScene }
  }, [])

  const env = useRef<{ pmrem: PMREMGenerator; target: WebGLRenderTarget | null; version: number } | null>(null)
  useEffect(() => {
    const previousBackground = scene.background
    scene.background = null
    env.current = { pmrem: new PMREMGenerator(gl), target: null, version: -1 }
    const hooks = window as unknown as Record<string, unknown>
    if (import.meta.env.DEV) hooks.__setTimeOfDay = updateAtmosphere
    return () => {
      delete hooks.__setTimeOfDay
      scene.environment = null; scene.background = previousBackground
      env.current?.target?.dispose(); env.current?.pmrem.dispose(); env.current = null
      material.dispose(); dome.geometry.dispose()
    }
  }, [gl, scene, material, dome])

  useFrame((_, delta) => {
    const u = material.uniforms, a = atmosphere
    u.uTime.value += delta
    u.uMoonIntensity.value = a.moonIntensity
    u.uStars.value = a.stars
    u.uCloudCover.value = a.cloudCover
    scene.environmentIntensity = a.envIntensity
    const state = env.current
    if (!state || state.version === a.envVersion) return
    state.version = a.envVersion
    u.uEnvPass.value = 1
    const next = state.pmrem.fromScene(envScene, 0.015, 0.1, 100)
    u.uEnvPass.value = 0
    state.target?.dispose()
    state.target = next
    scene.environment = next.texture
  })

  return <primitive object={dome} />
}
