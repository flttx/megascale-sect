import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerObjectColliders } from '../meshColliders'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { LAYOUT } from '../worldLayout'

/**
 * Two pairs of 华表 (ceremonial columns) flanking the imperial way across the forecourt: a two-tier plinth, an
 * octagonal white-jade shaft banded in gold, a cloud plate and a dew tray crowned by a crouching beast, ~21 m in
 * all. Between the 1.75 m figure, the 13 m banners, the 60 m pailou and the 420 m hall they are the missing
 * middle step of the plaza's scale. One merged mesh; it collides as drawn.
 */
const Y = LAYOUT.platform.height
export const HUABIAO: readonly (readonly [number, number])[] = [
  [-22, -84],
  [22, -84],
  [-22, -132],
  [22, -132],
]

function part(geometry: BufferGeometry, color: Color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const count = g.getAttribute('position').count,
    data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) data.set([color.r, color.g, color.b], i * 3)
  g.setAttribute('color', new BufferAttribute(data, 3))
  if (g !== geometry) geometry.dispose()
  return g
}

function buildHuabiao() {
  const jade = new Color('#e9e5da'),
    stone = new Color('#cfc8b8'),
    gold = new Color('#c8a052')
  const parts: BufferGeometry[] = []
  for (const [x, z] of HUABIAO) {
    const at = (geometry: BufferGeometry, y: number, color: Color) =>
      parts.push(part(geometry.translate(x, Y + y, z), color))
    at(new BoxGeometry(3.6, 0.8, 3.6), 0.4, stone)
    at(new BoxGeometry(2.8, 0.8, 2.8), 1.2, jade)
    at(new CylinderGeometry(1.1, 1.2, 0.8, 8), 2.0, stone)
    at(new CylinderGeometry(0.72, 0.84, 17, 8), 2.4 + 8.5, jade)
    for (const y of [6, 11.5]) at(new CylinderGeometry(0.9, 0.9, 0.3, 8), y, gold)
    // The cloud plate crosses the shaft broadside to the way.
    at(new BoxGeometry(5.2, 1.1, 0.35), 16.4, jade)
    at(new CylinderGeometry(1.0, 0.8, 0.7, 8), 19.75, stone)
    at(new CylinderGeometry(1.5, 1.4, 0.35, 12), 20.25, jade)
    at(new SphereGeometry(0.8, 12, 8).scale(1, 0.9, 1.3), 21.1, stone)
  }
  const geometry = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  const mesh = new Mesh(geometry, withSurfaceWeather(new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })))
  mesh.name = 'Huabiao'
  return mesh
}

export function Huabiao() {
  const mesh = useMemo(buildHuabiao, [])
  useEffect(() => registerObjectColliders(mesh), [mesh])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
    },
    [mesh],
  )
  return <primitive object={mesh} />
}
