import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { Box3, Euler, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import { LAYOUT } from '../worldLayout'
import { MG04_SIDE_TOWER } from '../worldAssets'
import { useWorldStore } from '../store'

export function SideTower() {
  const gltf = useGLTF(MG04_SIDE_TOWER.url)
  const meshRef = useRef<InstancedMesh>(null)
  const setAsset = useWorldStore((state) => state.setAsset)
  const showHelpers = useWorldStore((state) => state.showHelpers)
  const data = useMemo(() => {
    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    let source: Mesh | undefined
    gltf.scene.traverse((node) => { if (!source && (node as Mesh).isMesh) source = node as Mesh })
    if (!source) throw new Error('MG04 GLB has no mesh')
    return { source, box, size, center, scale: MG04_SIDE_TOWER.targetHeight / size.y }
  }, [gltf.scene])

  useEffect(() => {
    const { source, box, size, center, scale } = data
    if (!meshRef.current) return
    const base = new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z)
    LAYOUT.towers.forEach((tower, index) => {
      const rotation = new Quaternion().setFromEuler(new Euler(...tower.rotation))
      const factor = scale * tower.scaleMultiplier
      const matrix = new Matrix4().compose(
        new Vector3(...tower.position), rotation, new Vector3(factor, factor, factor),
      ).multiply(base)
      meshRef.current!.setMatrixAt(index, matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.computeBoundingSphere()
    const report = `侧塔: original ${size.toArray().map((n) => n.toFixed(3)).join(' × ')} m, ` +
      `base normalized ${(size.x * scale).toFixed(1)} × ${(size.y * scale).toFixed(1)} × ${(size.z * scale).toFixed(1)} m, ` +
      `scale ${scale.toFixed(3)}, instances ${LAYOUT.towers.length}, source loaded once`
    console.info('[MG04]', report, 'box', box, 'source', source)
    setAsset('MG04', report)
  }, [data, setAsset])

  if (!MG04_SIDE_TOWER.enabled) return null
  return (
    <>
      <instancedMesh ref={meshRef} args={[data.source.geometry, data.source.material, LAYOUT.towers.length]} frustumCulled castShadow={false} receiveShadow={false} />
      {showHelpers && LAYOUT.towers.map((tower, index) => (
        <mesh key={index} position={[tower.position[0], tower.position[1] + MG04_SIDE_TOWER.targetHeight * tower.scaleMultiplier / 2, tower.position[2]]}>
          <boxGeometry args={[data.size.x * data.scale * tower.scaleMultiplier, MG04_SIDE_TOWER.targetHeight * tower.scaleMultiplier, data.size.z * data.scale * tower.scaleMultiplier]} />
          <meshBasicMaterial color="#c4d8e0" wireframe transparent opacity={0.35} depthTest={false} />
        </mesh>
      ))}
    </>
  )
}
