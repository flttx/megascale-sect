import { useEffect, useRef } from 'react'
import { InstancedMesh, Matrix4 } from 'three'
import { LAYOUT } from '../worldLayout'

export function GrandStairs() {
  const ref = useRef<InstancedMesh>(null)
  const { startZ, endZ, height, width, steps } = LAYOUT.stairs
  const run = (startZ - endZ) / steps
  const rise = height / steps
  const angle = Math.atan2(height, startZ - endZ)
  useEffect(() => {
    if (!ref.current) return
    for (let i = 0; i < steps; i++) {
      ref.current.setMatrixAt(i, new Matrix4().makeTranslation(0, (i + 1) * rise - rise / 2 + 0.035, startZ - (i + 0.5) * run))
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [steps, rise, run, startZ])
  return (
    <group name="MG03_GrandStairs">
      <mesh position={[0, height / 2 - 0.7, (startZ + endZ) / 2]} rotation={[angle, 0, 0]}>
        <boxGeometry args={[width + 3, 1.5, Math.hypot(startZ - endZ, height)]} />
        <meshStandardMaterial color="#78818a" roughness={1} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, steps]} receiveShadow>
        <boxGeometry args={[width, rise, run + 0.015]} />
        <meshStandardMaterial color="#c4c4c0" roughness={0.92} metalness={0.02} />
      </instancedMesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (width / 2 + 0.7), height / 2 + 0.4, (startZ + endZ) / 2]} rotation={[angle, 0, 0]}>
            <boxGeometry args={[1.2, 1.2, Math.hypot(startZ - endZ, height)]} />
            <meshStandardMaterial color="#d4d3cd" roughness={0.9} />
          </mesh>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <mesh key={t} position={[side * (width / 2 + 0.7), t * height + 1.2, startZ + (endZ - startZ) * t]}>
              <boxGeometry args={[2.3, 2.5, 2.3]} />
              <meshStandardMaterial color="#aeb4b7" roughness={0.88} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
