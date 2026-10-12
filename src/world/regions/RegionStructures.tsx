import { Detailed, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Box3 } from 'three'
import type { Group } from 'three'
import { registerObjectColliders, registerObjectWalkables } from '../meshColliders'
import { withSceneWeather } from '../weather/surfaceWeather'
import { REGION_STRUCTURES, structureBase } from './structures'
import type { RegionStructure } from './structures'

const assetUrl = (file: string) => `${import.meta.env.BASE_URL}assets/colossi/${file}`.replace(/\/{2,}/g, '/')
const urls = (model: string) => [assetUrl(`${model}.glb`), assetUrl(`${model}.lod1.glb`)]
new Set(REGION_STRUCTURES.map((s) => s.model)).forEach((model) => useGLTF.preload(urls(model)))
/** Beyond this the reduced level stands in; the regions are seen mostly from afar. */
const LOD_DISTANCE = 650

/** One Tripo building scaled to its height, its base on the lowest ground under it; walkable and solid as drawn. */
function Structure({ structure: s }: { structure: RegionStructure }) {
  const [gltf, lod] = useGLTF(urls(s.model))
  const scene = useMemo(() => withSceneWeather(gltf.scene).clone(true), [gltf.scene])
  const lodScene = useMemo(() => withSceneWeather(lod.scene).clone(true), [lod.scene])
  const { scale, lift } = useMemo(() => {
    const box = new Box3().setFromObject(gltf.scene)
    const scale = s.height / (box.max.y - box.min.y)
    // Sunk 0.3 m so the plinth meets uneven ground without a seam.
    return { scale, lift: structureBase(s) - box.min.y * scale - 0.3 }
  }, [gltf.scene, s])
  const near = useRef<Group>(null)
  useEffect(() => {
    const root = near.current
    if (!root) return
    const off = [registerObjectColliders(root), registerObjectWalkables(root)]
    return () => off.forEach((unregister) => unregister())
  }, [scene, scale, lift])
  return (
    <group name={`Structure_${s.id}`} position={[s.x, lift, s.z]} rotation={[0, s.yaw, 0]} scale={scale}>
      <Detailed distances={[0, LOD_DISTANCE]} hysteresis={0.08}>
        <group ref={near} name={`Structure_${s.id}_LOD0`}>
          <primitive object={scene} />
        </group>
        <group name={`Structure_${s.id}_LOD1`}>
          <primitive object={lodScene} />
        </group>
      </Detailed>
    </group>
  )
}

/** The outer regions' pavilions, tomb gate and dragon shrine (structures.ts). */
export function RegionStructures() {
  return (
    <>
      {REGION_STRUCTURES.map((s) => (
        <Suspense key={s.id} fallback={null}>
          <Structure structure={s} />
        </Suspense>
      ))}
    </>
  )
}
