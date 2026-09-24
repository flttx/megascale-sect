import { LAYOUT } from '../worldLayout'

const cliffPieces = [
  [-225, -72, -170, 125, 128, 145], [225, -72, -180, 122, 132, 145],
  [-290, -75, -20, 90, 112, 92], [285, -72, -35, 88, 110, 90],
  [-165, -66, -270, 150, 145, 250], [165, -72, -320, 145, 155, 255],
  [0, -92, -440, 202, 165, 215], [-390, -60, -460, 200, 220, 175],
  [385, -52, -485, 195, 195, 185],
] as const

export function Cliffs() {
  return (
    <group name="MG03_Cliffs">
      <mesh position={[0, -56, (LAYOUT.platform.frontZ + LAYOUT.platform.backZ) / 2]}>
        <boxGeometry args={[LAYOUT.platform.width - 15, 155, LAYOUT.platform.frontZ - LAYOUT.platform.backZ - 20]} />
        <meshStandardMaterial color="#55636c" roughness={1} flatShading />
      </mesh>
      {cliffPieces.map(([x, y, z, sx, sy, sz], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0.1 * i, i * 0.37, 0.06 * (i % 3)]} scale={[sx, sy, sz]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 ? '#66747b' : '#596772'} roughness={1} flatShading />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 175, -55, -20]} rotation={[0, side * 0.35, side * 0.16]} scale={[74, 105, 85]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#53616b" roughness={1} flatShading />
          </mesh>
          <mesh position={[side * 290, 6, -690]} rotation={[0, 0.4, 0.06]} scale={[190, 170, 180]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#7d8b94" roughness={1} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  )
}
