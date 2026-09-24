import { useEffect, useMemo } from 'react'
import { Detailed, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { AssetConfig } from '../worldAssets'
import { useWorldStore } from '../store'

export function useAssetMetrics(config: AssetConfig) {
  const [gltf, lod] = useGLTF([config.url, config.lodUrl])
  return useMemo(() => {
    // LOD1 shares LOD0's normalisation so the two levels line up exactly when swapped.
    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = config.targetHeight / size.y
    return { gltf, lod, box, size, center, scale }
  }, [gltf, lod, config])
}

export function WorldAsset({ config }: { config: AssetConfig }) {
  const { gltf, lod, box, size, center, scale } = useAssetMetrics(config)
  const showHelpers = useWorldStore((state) => state.showHelpers)
  const setAsset = useWorldStore((state) => state.setAsset)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const lodScene = useMemo(() => lod.scene.clone(true), [lod.scene])
  const actualScale = scale * config.scaleMultiplier

  useEffect(() => {
    const report = `${config.label}: original ${size.toArray().map((n) => n.toFixed(3)).join(' × ')} m, ` +
      `normalized ${(size.x * actualScale).toFixed(1)} × ${(size.y * actualScale).toFixed(1)} × ${(size.z * actualScale).toFixed(1)} m, ` +
      `scale ${actualScale.toFixed(3)}, position ${config.position.join(', ')}, rotation ${config.rotation.join(', ')}, LOD1 > ${config.lodDistance} m`
    console.info(`[${config.id}]`, report, 'box', box)
    setAsset(config.id, report)
  }, [config, size, actualScale, box, setAsset])

  if (!config.enabled) return null
  const offset = [-center.x, -box.min.y, -center.z] as const
  return (
    <group name={`${config.id}_AssetRoot`} position={[...config.position]} rotation={[...config.rotation]}>
      <Detailed distances={[0, config.lodDistance]} hysteresis={0.08}>
        <group name={`${config.id}_LOD0`} scale={actualScale}><primitive object={scene} position={offset} /></group>
        <group name={`${config.id}_LOD1`} scale={actualScale}><primitive object={lodScene} position={offset} /></group>
      </Detailed>
      {showHelpers && (
        <mesh position={[0, size.y * actualScale / 2, 0]}>
          <boxGeometry args={[size.x * actualScale, size.y * actualScale, size.z * actualScale]} />
          <meshBasicMaterial color="#e8c475" wireframe transparent opacity={0.5} depthTest={false} />
        </mesh>
      )}
    </group>
  )
}
