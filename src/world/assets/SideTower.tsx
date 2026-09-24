import { useEffect, useMemo } from 'react'
import { Detailed, useGLTF } from '@react-three/drei'
import { Box3, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import { LAYOUT } from '../worldLayout'
import { MG04_SIDE_TOWER } from '../worldAssets'
import { useWorldStore } from '../store'
import { withSceneWeather } from '../weather/surfaceWeather'

// Meshopt quantisation stores the dequantisation scale/offset on the mesh node,
// so the node's world transform must travel with the shared geometry.
function firstMesh(root: Object3D) {
  let found: Mesh | undefined
  root.updateMatrixWorld(true)
  root.traverse((node) => { if (!found && (node as Mesh).isMesh) found = node as Mesh })
  if (!found) throw new Error('MG04 GLB has no mesh')
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
  found.matrixWorld.decompose(position, quaternion, scale)
  return { geometry: found.geometry, material: found.material, position, quaternion, scale }
}

// Six towers share one geometry per LOD; each tower swaps LOD independently by camera distance.
export function SideTower() {
  const [gltf, lod] = useGLTF([MG04_SIDE_TOWER.url, MG04_SIDE_TOWER.lodUrl])
  const setAsset = useWorldStore((state) => state.setAsset)
  const showHelpers = useWorldStore((state) => state.showHelpers)
  const data = useMemo(() => {
    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    return { source: firstMesh(withSceneWeather(gltf.scene)), lodSource: firstMesh(withSceneWeather(lod.scene)), box, size, center, scale: MG04_SIDE_TOWER.targetHeight / size.y }
  }, [gltf.scene, lod.scene])

  useEffect(() => {
    const { source, box, size, scale } = data
    const report = `侧塔: original ${size.toArray().map((n) => n.toFixed(3)).join(' × ')} m, ` +
      `base normalized ${(size.x * scale).toFixed(1)} × ${(size.y * scale).toFixed(1)} × ${(size.z * scale).toFixed(1)} m, ` +
      `scale ${scale.toFixed(3)}, towers ${LAYOUT.towers.length}, shared geometry, LOD1 > ${MG04_SIDE_TOWER.lodDistance} m`
    console.info('[MG04]', report, 'box', box, 'source', source)
    setAsset('MG04', report)
  }, [data, setAsset])

  if (!MG04_SIDE_TOWER.enabled) return null
  const offset = [-data.center.x, -data.box.min.y, -data.center.z] as const
  return (
    <>
      {LAYOUT.towers.map((tower, index) => (
        <group key={index} name={`MG04_Tower${index}`} position={[...tower.position]} rotation={[...tower.rotation]} scale={data.scale * tower.scaleMultiplier}>
          <Detailed distances={[0, MG04_SIDE_TOWER.lodDistance * tower.scaleMultiplier]} hysteresis={0.08}>
            {[data.source, data.lodSource].map((level, lod) => (
              <group key={lod} position={offset}>
                <mesh geometry={level.geometry} material={level.material} position={level.position} quaternion={level.quaternion} scale={level.scale} />
              </group>
            ))}
          </Detailed>
        </group>
      ))}
      {showHelpers && LAYOUT.towers.map((tower, index) => (
        <mesh key={index} position={[tower.position[0], tower.position[1] + MG04_SIDE_TOWER.targetHeight * tower.scaleMultiplier / 2, tower.position[2]]}>
          <boxGeometry args={[data.size.x * data.scale * tower.scaleMultiplier, MG04_SIDE_TOWER.targetHeight * tower.scaleMultiplier, data.size.z * data.scale * tower.scaleMultiplier]} />
          <meshBasicMaterial color="#c4d8e0" wireframe transparent opacity={0.35} depthTest={false} />
        </mesh>
      ))}
    </>
  )
}
