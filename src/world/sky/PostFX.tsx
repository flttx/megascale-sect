import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, GodRays, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Effect, ToneMappingMode } from 'postprocessing'
import type { EffectComposer as Composer } from 'postprocessing'
import { Mesh, MeshBasicMaterial, SphereGeometry, Uniform, Vector3, type PerspectiveCamera } from 'three'
import { atmosphere } from './atmosphere'
import { AtmosphereEffect } from './atmosphereEffect'
import { useWorldStore } from '../store'
import { QUALITY_PRESETS } from '../quality'

const gradeFragment = /* glsl */ `
uniform vec3 uShadowTint; uniform vec3 uHighlightTint; uniform float uSaturation; uniform float uContrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Grade in a square-root (roughly perceptual) space so the controls behave evenly across the range.
  vec3 p = sqrt(clamp(inputColor.rgb, 0.0, 1.0));
  float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
  p = mix(vec3(l), p, uSaturation);
  p = clamp((p - 0.46) * uContrast + 0.46, 0.0, 1.0);
  p *= mix(uShadowTint, uHighlightTint, smoothstep(0.12, 0.85, l));
  // Triangular dither hides banding in the smooth sky gradients.
  vec2 q = gl_FragCoord.xy;
  float n = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453) + fract(sin(dot(q, vec2(39.3468, 11.135))) * 24634.6345) - 1.0;
  p += n / 255.0;
  outputColor = vec4(p * p, inputColor.a);
}`

/** Display-referred split-tone grade: cool shadows, warm highlights, gentle contrast and saturation. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFragment, {
      uniforms: new Map<string, Uniform>([
        ['uShadowTint', new Uniform(new Vector3(0.95, 0.99, 1.06))], ['uHighlightTint', new Uniform(new Vector3(1.025, 1.0, 0.97))],
        ['uSaturation', new Uniform(1.08)], ['uContrast', new Uniform(1.06)],
      ]),
    })
  }
}

const SUN_DISTANCE = 1600

/** Emissive proxy the god-ray pass occludes against scene depth; tracks the sun at a fixed range. */
function useSunProxy() {
  const sun = useMemo(() => {
    const mesh = new Mesh(new SphereGeometry(26, 24, 12), new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false }))
    mesh.name = 'SunProxy'; mesh.frustumCulled = false
    return mesh
  }, [])
  useEffect(() => () => { sun.geometry.dispose(); (sun.material as MeshBasicMaterial).dispose() }, [sun])
  useFrame(({ camera }) => {
    const a = atmosphere
    sun.position.copy(camera.position).addScaledVector(a.sunDirection, SUN_DISTANCE)
    sun.visible = a.sunDirection.y > -0.03 && a.sunIntensity > 0.05
    ;(sun.material as MeshBasicMaterial).color.copy(a.sunColor).multiplyScalar(6)
  })
  return sun
}

export function PostFX() {
  const composer = useRef<Composer>(null)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const quality = useWorldStore((state) => state.quality)
  const preset = QUALITY_PRESETS[quality]
  const fog = useMemo(() => new AtmosphereEffect(camera as PerspectiveCamera, preset.volumetricClouds), [camera, preset.volumetricClouds])
  const grade = useMemo(() => new GradeEffect(), [])
  const sun = useSunProxy()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = window as Window & { __postfx?: () => unknown }
    target.__postfx = () => ({ composer: composer.current, renderer: gl })
    return () => { delete target.__postfx }
  }, [gl])

  // Composer passes each call gl.render; accumulate draw stats over the whole frame for telemetry.
  useEffect(() => {
    gl.info.autoReset = false
    return () => { gl.info.autoReset = true }
  }, [gl])
  useEffect(() => () => fog.dispose(), [fog])
  useEffect(() => () => grade.dispose(), [grade])
  useFrame(() => {
    gl.info.reset()
    gl.toneMappingExposure = atmosphere.exposure
  })

  return (
    <>
      <primitive object={sun} />
      <EffectComposer ref={composer} key={quality} multisampling={preset.msaa} enableNormalPass={false} autoClear={false}
        mergeMode={import.meta.env.DEV && new URLSearchParams(window.location.search).has('profileGpu') ? 'none' : 'auto'}>
        {preset.ao && <N8AO halfRes quality="performance" aoRadius={3.5} distanceFalloff={1.2} intensity={2.2} color="#27303c" />}
        <primitive object={fog} dispose={null} />
        {preset.godRays && <GodRays sun={sun} samples={48} density={0.94} decay={0.925} weight={0.32} exposure={0.42} clampMax={1} blur />}
        {preset.bloom && <Bloom mipmapBlur intensity={0.5} luminanceThreshold={1} luminanceSmoothing={0.3} radius={0.72} />}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <primitive object={grade} dispose={null} />
        <Vignette offset={0.32} darkness={0.42} />
        {!preset.msaa && <SMAA />}
      </EffectComposer>
    </>
  )
}
