import { LAYOUT } from '../worldLayout'

export function MainPlatform() {
  const { frontZ, backZ, width, height, slabDepth } = LAYOUT.platform
  const centerZ = (frontZ + backZ) / 2
  const length = frontZ - backZ
  return (
    <group name="MG03_MainPlatform">
      <mesh position={[0, height - slabDepth / 2, centerZ]} receiveShadow>
        <boxGeometry args={[width, slabDepth, length]} />
        <meshStandardMaterial color="#a6a9a8" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh position={[0, height + 0.05, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width - 2, length - 2]} />
        <meshStandardMaterial color="#c7c6c0" roughness={0.94} metalness={0.02} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 - 1.2), height + 1, centerZ]}>
          <boxGeometry args={[2.4, 2, length]} />
          <meshStandardMaterial color="#d7d8d2" roughness={0.88} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} position={[0, height + 0.075, frontZ - 42 - index * 33]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.max(42, 125 - index * 11), 0.35]} />
          <meshStandardMaterial color="#e2e0d8" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}
