import { useMemo } from 'react'
import { SphereGeometry } from 'three'

const cloudPositions = [
  [-112, 228, -157, 72, 10, 35], [0, 248, -164, 91, 13, 38],
  [105, 239, -158, 78, 11, 34],
  [-180, 236, -345, 64, 12, 36], [-90, 249, -380, 85, 16, 42],
  [30, 261, -360, 90, 15, 42], [135, 237, -385, 78, 13, 40],
  [-230, 281, -495, 85, 13, 48], [-50, 286, -555, 90, 12, 46],
  [160, 272, -540, 96, 13, 45], [290, 245, -400, 70, 12, 38],
] as const

export function WorldEnvironment() {
  const sphere = useMemo(() => new SphereGeometry(1, 16, 10), [])
  return (
    <>
      <color attach="background" args={['#c9d7e5']} />
      <fog attach="fog" args={['#c9d7e5', 450, 1600]} />
      <group name="HighCloudLayer">
        {cloudPositions.map(([x, y, z, sx, sy, sz], i) => (
          <mesh key={i} geometry={sphere} position={[x, y, z]} scale={[sx, sy, sz]}>
            <meshBasicMaterial color="#f7fafb" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}
