import { Detailed, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import { registerColliders } from '../surfaces'
import { withSceneWeather } from '../weather/surfaceWeather'
import { Armillary } from './Armillary'
import { Kun } from './Kun'
import { COLOSSI, colossusColliders } from './layout'
import type { ColossusPlacement } from './layout'

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

/** Dev-only: `?nocolossi` drops the whole layer to measure its draw-call and frame-time delta. */
const DISABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has('nocolossi')

/**
 * 巨物 (R3): the two guardians rising from the cloud sea either side of the sect, the sword driven into the
 * eastern summit, the armillary sphere turning over the hall and the kun circling the ranges. Their flight colliders are registered up front from the
 * measured cross-sections (colossiMeta), before the models stream in.
 */
export function Colossi() {
  useEffect(() => (DISABLED ? undefined : registerColliders(COLOSSI.flatMap(colossusColliders))), [])
  if (DISABLED) return null
  return (
    <>
      {COLOSSI.map((c) => <Suspense key={c.id} fallback={null}><StaticColossus placement={c} /></Suspense>)}
      <Armillary />
      <Suspense fallback={null}><Kun /></Suspense>
    </>
  )
}
