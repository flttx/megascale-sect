import { LAYOUT } from '../worldLayout'

export function MainRoad() {
  const roadLength = LAYOUT.road.fromZ - LAYOUT.road.toZ
  const roadCenter = (LAYOUT.road.fromZ + LAYOUT.road.toZ) / 2
  return (
    <group name="MG03_MainRoad">
      <mesh position={[0, -1.025, LAYOUT.spawn.position[2]]} receiveShadow>
        <boxGeometry args={[LAYOUT.spawn.size[0], 2, LAYOUT.spawn.size[1]]} />
        <meshStandardMaterial color="#777b80" roughness={0.94} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.22, roadCenter]} receiveShadow>
        <boxGeometry args={[LAYOUT.road.width, 0.44, roadLength]} />
        <meshStandardMaterial color="#a4a7a8" roughness={0.92} metalness={0.03} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (LAYOUT.road.width / 2 + 0.65), 0.38, roadCenter]}>
            <boxGeometry args={[0.8, 0.75, roadLength]} />
            <meshStandardMaterial color="#d2d0c8" roughness={0.86} />
          </mesh>
          <mesh position={[side * 14.2, -11, roadCenter]}>
            <boxGeometry args={[12, 21, roadLength]} />
            <meshStandardMaterial color="#4d5963" roughness={1} flatShading />
          </mesh>
        </group>
      ))}
      {Array.from({ length: 12 }, (_, index) => (
        <mesh key={index} position={[0, 0.015, 143 - index * 10.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LAYOUT.road.width - 1, 0.13]} />
          <meshStandardMaterial color="#c1c0bb" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}
