import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, GodRays, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Effect, EffectAttribute, ToneMappingMode } from 'postprocessing'
import { Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Uniform, Vector3, type Camera } from 'three'
import { atmosphere } from './atmosphere'
import { FOG_GLSL } from './glsl'
import { useWorldStore } from '../store'
import { QUALITY_PRESETS } from '../quality'

const fogFragment = /* glsl */ `
uniform mat4 uProjectionInverse; uniform mat4 uCameraWorld; uniform vec3 uCameraPos;
${FOG_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // The sky dome writes no depth and blends its own horizon haze.
  if (depth >= 0.999999) { outputColor = inputColor; return; }
  vec4 view = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  vec3 ray = world - uCameraPos;
  float dist = length(ray);
  vec3 dir = ray / dist;
  outputColor = vec4(mix(inputColor.rgb, fogColorFor(dir), heightFog(uCameraPos, dir, dist)), inputColor.a);
}`

/** Depth-reconstructed exponential height fog with sun in-scatter; replaces three's per-material fog. */
class HeightFogEffect extends Effect {
  camera: Camera
  constructor(camera: Camera) {
    super('HeightFogEffect', fogFragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uProjectionInverse', new Uniform(new Matrix4())], ['uCameraWorld', new Uniform(new Matrix4())], ['uCameraPos', new Uniform(new Vector3())],
        ['fogTint', new Uniform(atmosphere.fogColor)], ['fogSunColor', new Uniform(atmosphere.sunColor)], ['fogSunDir', new Uniform(atmosphere.sunDirection)],
        ['fogDensity', new Uniform(0)], ['fogFalloff', new Uniform(0)], ['fogBase', new Uniform(0)],
      ]),
    })
    this.camera = camera
  }
  update() {
    const u = this.uniforms
    u.get('uProjectionInverse')!.value.copy(this.camera.projectionMatrixInverse)
    u.get('uCameraWorld')!.value.copy(this.camera.matrixWorld)
    u.get('uCameraPos')!.value.setFromMatrixPosition(this.camera.matrixWorld)
    u.get('fogDensity')!.value = atmosphere.fogDensity
    u.get('fogFalloff')!.value = atmosphere.fogFalloff
    u.get('fogBase')!.value = atmosphere.fogBase
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
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const quality = useWorldStore((state) => state.quality)
  const preset = QUALITY_PRESETS[quality]
  const fog = useMemo(() => new HeightFogEffect(camera), [camera])
  const sun = useSunProxy()

  // Composer passes each call gl.render; accumulate draw stats over the whole frame for telemetry.
  useEffect(() => {
    gl.info.autoReset = false
    return () => { gl.info.autoReset = true }
  }, [gl])
  useEffect(() => () => fog.dispose(), [fog])
  useFrame(() => {
    gl.info.reset()
    gl.toneMappingExposure = atmosphere.exposure
  })

  return (
    <>
      <primitive object={sun} />
      <EffectComposer key={quality} multisampling={preset.msaa} enableNormalPass={false} autoClear={false}>
        {preset.ao && <N8AO halfRes quality="performance" aoRadius={3.5} distanceFalloff={1.2} intensity={2.2} color="#27303c" />}
        <primitive object={fog} dispose={null} />
        {preset.godRays && <GodRays sun={sun} samples={48} density={0.94} decay={0.925} weight={0.32} exposure={0.42} clampMax={1} blur />}
        {preset.bloom && <Bloom mipmapBlur intensity={0.5} luminanceThreshold={1} luminanceSmoothing={0.3} radius={0.72} />}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.42} />
        {!preset.msaa && <SMAA />}
      </EffectComposer>
    </>
  )
}
