import { useEffect, useMemo } from 'react'
import { BoxGeometry, Color, Float32BufferAttribute } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LAYOUT } from '../worldLayout'

/** One box of the stairs in world space, tinted per vertex for the graybox material (the road re-skins it in paving). */
function part(size: [number, number, number], position: [number, number, number], tilt: number, color: string) {
  const box = new BoxGeometry(...size).rotateX(tilt).translate(...position)
  const tint = new Color(color), colors = new Float32Array(box.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i)
  box.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return box
}

/** Ramp, steps, side rails and newel posts merged into one mesh, so the stairs cost one draw per pass and cascade. */
export function GrandStairs() {
  const geometry = useMemo(() => {
    const { startZ, endZ, height, width, steps } = LAYOUT.stairs
    const run = (startZ - endZ) / steps, rise = height / steps
    const angle = Math.atan2(height, startZ - endZ), length = Math.hypot(startZ - endZ, height), middle = (startZ + endZ) / 2
    const parts = [part([width + 3, 1.5, length], [0, height / 2 - 0.7, middle], angle, '#78818a')]
    for (let i = 0; i < steps; i++) parts.push(part([width, rise, run + 0.015], [0, (i + 1) * rise - rise / 2 + 0.035, startZ - (i + 0.5) * run], 0, '#c4c4c0'))
    for (const side of [-1, 1]) {
      parts.push(part([1.2, 1.2, length], [side * (width / 2 + 0.7), height / 2 + 0.4, middle], angle, '#d4d3cd'))
      for (const t of [0, 0.25, 0.5, 0.75, 1]) parts.push(part([2.3, 2.5, 2.3], [side * (width / 2 + 0.7), t * height + 1.2, startZ + (endZ - startZ) * t], 0, '#aeb4b7'))
    }
    const merged = mergeGeometries(parts)
    parts.forEach((p) => p.dispose())
    return merged
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh name="MG03_GrandStairs" geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.92} />
    </mesh>
  )
}
