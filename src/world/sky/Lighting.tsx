import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { DirectionalLight, HemisphereLight, Mesh, ShaderChunk, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three'
import { atmosphere, keyLight } from './atmosphere'
import { useWorldStore } from '../store'
import { QUALITY_PRESETS } from '../quality'

/** Shadowed range; beyond it the height fog carries depth. Splits are fractions of it. */
const SHADOW_FAR = 1500
const SPLITS: Record<number, number[]> = { 3: [0.035, 0.18, 1], 4: [0.02, 0.07, 0.25, 1] }
/** How far toward the sun a caster may sit outside a cascade (the main hall is ~420 m tall). */
const LIGHT_MARGIN = 900

type Hook = Material['onBeforeCompile']
const isLit = (material: Material) => ['isMeshStandardMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial'].some((flag) => flag in material)
const keyDirection = new Vector3()

/**
 * three 0.186's CSMShader.lights_fragment_begin predates the DFG lookup the stock chunk does for standard
 * materials. Without it `material.dfg` and `multiScatteringCompensation` stay zero, so every CSM-lit standard
 * material loses both its IBL reflection and its direct specular. Ported from the stock chunk.
 */
const STANDARD_DFG = /* glsl */ `
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;`
function restoreStandardDfg() {
  const chunk = ShaderChunk.lights_fragment_begin
  if (chunk.includes('material.dfg')) return
  if (import.meta.env.DEV && !chunk.includes('IncidentLight directLight;')) console.warn('[lighting] CSM lights chunk changed; standard materials may lose specular')
  ShaderChunk.lights_fragment_begin = chunk.replace('IncidentLight directLight;', STANDARD_DFG)
}

/**
 * Sun/moon key light with cascaded shadows, plus hemisphere fill. Image-based fill comes from SkyDome.
 *
 * Every lit mesh casts and receives shadows unless `userData.castShadow === false`. CSM needs each lit
 * material flagged before its first compile (otherwise the cascades add up as separate lights), so new
 * meshes are picked up every frame; existing `onBeforeCompile` hooks (T02R terrain shaders) are chained.
 */
export function Lighting() {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const quality = useWorldStore((state) => state.quality)
  const { shadowCascades, shadowMapSize } = QUALITY_PRESETS[quality]
  const hemi = useMemo(() => new HemisphereLight(), [])
  const plain = useRef<DirectionalLight>(null)
  const hooked = useRef(new Map<Material, Hook | null>())
  const lens = useRef({ fov: 0, aspect: 0 })

  // CSM adds its lights to the scene on construction, so it must be created in an effect (not during render).
  const csmRef = useRef<CSM | null>(null)
  useEffect(() => {
    if (!shadowCascades) return
    const splits = SPLITS[shadowCascades]
    const instance = new CSM({
      camera, parent: scene, cascades: shadowCascades, maxFar: SHADOW_FAR, shadowMapSize,
      mode: 'custom', customSplitsCallback: (_count: number, _near: number, _far: number, target: number[]) => target.push(...splits),
      lightMargin: LIGHT_MARGIN, lightFar: LIGHT_MARGIN + SHADOW_FAR * 2, shadowBias: -0.00015,
    })
    restoreStandardDfg()
    instance.fade = true
    instance.lights.forEach((light) => { light.shadow.radius = 2 })
    lens.current = { fov: 0, aspect: 0 }
    csmRef.current = instance
    const originals = hooked.current
    const hooks = window as unknown as Record<string, unknown>
    if (import.meta.env.DEV) hooks.__lightingStats = () => ({
      cascades: instance.lights.length,
      shadowMaps: instance.lights.filter((light) => light.shadow.map).length,
      hookedMaterials: originals.size,
      frustums: instance.lights.map((light) => Math.round(light.shadow.camera.right - light.shadow.camera.left)),
    })
    return () => {
      delete hooks.__lightingStats
      csmRef.current = null
      instance.remove()
      instance.lights.forEach((light) => light.dispose())
      instance.dispose()
      // CSM deletes the hook it installed; put back the material's own shader hook.
      originals.forEach((own, material) => { if (own) material.onBeforeCompile = own })
      originals.clear()
    }
  }, [camera, scene, shadowCascades, shadowMapSize])

  useFrame(() => {
    const csm = csmRef.current
    const dir = keyDirection
    const { color, intensity } = keyLight(dir)
    hemi.color.copy(atmosphere.hemiSky); hemi.groundColor.copy(atmosphere.hemiGround); hemi.intensity = atmosphere.hemiIntensity

    if (!csm) {
      const light = plain.current
      if (light) { light.position.copy(camera.position).addScaledVector(dir, 500); light.target.position.copy(camera.position); light.target.updateMatrixWorld(); light.color.copy(color); light.intensity = intensity }
      return
    }
    scene.traverse((object: Object3D) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      let lit = false
      for (const material of materials) {
        if (!isLit(material)) continue
        lit = true
        if (hooked.current.has(material)) continue
        const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null
        csm.setupMaterial(material)
        const csmHook = material.onBeforeCompile
        if (own) material.onBeforeCompile = (shader, renderer) => { own.call(material, shader, renderer); csmHook.call(material, shader, renderer) }
        hooked.current.set(material, own)
        material.needsUpdate = true
      }
      if (lit) { mesh.receiveShadow = true; mesh.castShadow = mesh.userData.castShadow !== false }
    })
    if (lens.current.fov !== camera.fov || lens.current.aspect !== camera.aspect) {
      lens.current = { fov: camera.fov, aspect: camera.aspect }
      csm.updateFrustums()
    }
    csm.lightDirection.copy(dir).negate()
    csm.lights.forEach((light) => {
      light.color.copy(color); light.intensity = intensity
      // Normal offset scaled to each cascade's texel footprint keeps acne away without peter-panning up close.
      light.shadow.normalBias = (light.shadow.camera.right - light.shadow.camera.left) / shadowMapSize * 1.4
    })
    csm.update()
  })

  return (
    <>
      <primitive object={hemi} />
      {!shadowCascades && <directionalLight ref={plain} />}
    </>
  )
}
