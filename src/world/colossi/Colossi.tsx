import { Detailed, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import { InstancedMesh, Matrix4, Mesh } from 'three'
import { SWORD_MESA } from '../regions/regions'
import { registerColliders } from '../surfaces'
import { withSceneWeather } from '../weather/surfaceWeather'
import { Armillary } from './Armillary'
import { Kun } from './Kun'
import { Turtle } from './Turtle'
import { COLOSSI, colossusColliders, colossusMatrix } from './layout'
import type { ColossusPlacement } from './layout'
import { SWORD_FIELD, SWORD_FIELD_RANGE, swordFieldColliders } from './swordField'

const colossusUrl = (file: string) => `${import.meta.env.BASE_URL}assets/colossi/${file}`.replace(/\/{2,}/g, '/')
const urls = (c: ColossusPlacement) => [colossusUrl(`${c.model}.glb`), colossusUrl(`${c.model}.lod1.glb`)]
COLOSSI.forEach((c) => useGLTF.preload(urls(c)))

/** One Tripo statue or the sword, in asset metres as delivered, with its reduced level for range. */
function StaticColossus({ placement: c }: { placement: ColossusPlacement }) {
  const [gltf, lod] = useGLTF(urls(c))
  const scene = useMemo(() => withSceneWeather(gltf.scene).clone(true), [gltf.scene])
  const lodScene = useMemo(() => withSceneWeather(lod.scene).clone(true), [lod.scene])
  return (
    <group name={`Colossus_${c.id}`} position={c.position} rotation={[c.rotation[0], c.rotation[1], c.rotation[2], 'YXZ']} scale={c.scale}>
      <Detailed distances={[0, c.lodDistance]} hysteresis={0.08}>
        <group name={`Colossus_${c.id}_LOD0`}><primitive object={scene} /></group>
        <group name={`Colossus_${c.id}_LOD1`}><primitive object={lodScene} /></group>
      </Detailed>
    </group>
  )
}

/** 万剑冢's lesser blades: the sword's reduced model instanced once per blade, drawn only near the sword mesa. */
function SwordField() {
  const [, gltf] = useGLTF([colossusUrl('giant_sword.glb'), colossusUrl('giant_sword.lod1.glb')])
  const mesh = useMemo(() => {
    const scene = withSceneWeather(gltf.scene)
    scene.updateMatrixWorld(true)
    const source = scene.getObjectByProperty('isMesh', true)
    if (!(source instanceof Mesh)) return null
    const instanced = new InstancedMesh(source.geometry, source.material, SWORD_FIELD.length), m = new Matrix4()
    SWORD_FIELD.forEach((blade, i) => instanced.setMatrixAt(i, colossusMatrix(blade, m).multiply(source.matrixWorld)))
    instanced.instanceMatrix.needsUpdate = true
    instanced.computeBoundingSphere()
    instanced.name = 'Colossus_sword_field'
    instanced.userData.castShadow = false
    return instanced
  }, [gltf.scene])
  useEffect(() => () => mesh?.dispose(), [mesh])
  // Lighting reads userData.castShadow on every frame.
  useFrame(({ camera }) => {
    if (!mesh) return
    const d = Math.hypot(camera.position.x - SWORD_MESA.x, camera.position.z - SWORD_MESA.z)
    mesh.visible = d < SWORD_FIELD_RANGE.visible
    mesh.userData.castShadow = d < SWORD_FIELD_RANGE.shadow
  })
  return mesh ? <primitive object={mesh} /> : null
}

/** Dev-only: `?nocolossi` drops the whole layer to measure its draw-call and frame-time delta. */
const DISABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has('nocolossi')

/**
 * 巨物 (R3): the two guardians rising from the cloud sea either side of the sect, the sword driven into the
 * eastern summit, the armillary sphere turning over the hall and the kun circling the ranges. R10 adds each outer
 * region's colossus: the seated sage, the dragon column, the sky gate and the sword tomb with its field of blades,
 * and 巨鳌 swimming the south-western cloud sea.
 * Their flight colliders are registered up front from the measured cross-sections (colossiMeta), before the models
 * stream in.
 */
export function Colossi() {
  useEffect(() => (DISABLED ? undefined : registerColliders([...COLOSSI.flatMap((c) => colossusColliders(c)), ...swordFieldColliders()])), [])
  if (DISABLED) return null
  return (
    <>
      {COLOSSI.map((c) => <Suspense key={c.id} fallback={null}><StaticColossus placement={c} /></Suspense>)}
      <Suspense fallback={null}><SwordField /></Suspense>
      <Armillary />
      <Suspense fallback={null}><Kun /></Suspense>
      <Suspense fallback={null}><Turtle /></Suspense>
    </>
  )
}
