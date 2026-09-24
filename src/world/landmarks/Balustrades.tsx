import { useEffect, useMemo } from 'react'
import { BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { towerFootings } from '../environment/t02r/scatter'
import { siteClearance } from '../sites'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { LAYOUT } from '../worldLayout'

/**
 * White-jade balustrade (汉白玉栏杆) along the platform's front and side edges: one instanced bay
 * (floor rail, carved panel, vase balusters, handrail, a post at each end) plus gilded lotus caps.
 * Gaps open at the grand stairs, bridge heads, interact sites and tower footings.
 */

const BAY = 2.6
const Y = LAYOUT.platform.height

function box(w: number, h: number, d: number, x: number, y: number, z = 0) { return new BoxGeometry(w, h, d).translate(x, y, z) }

/** One bay along local +X from 0 to BAY; posts at both ends coincide with the neighbours' (same shading). */
function bayGeometry() {
  const parts: BufferGeometry[] = [
    box(BAY, 0.16, 0.46, BAY / 2, 0.08),
    box(BAY - 0.3, 0.36, 0.1, BAY / 2, 0.36),
    box(BAY - 0.3, 0.05, 0.16, BAY / 2, 0.19),
    box(BAY - 0.3, 0.07, 0.2, BAY / 2, 0.575),
    new CylinderGeometry(0.055, 0.055, BAY - 0.3, 6).rotateZ(Math.PI / 2).translate(BAY / 2, 0.93, 0),
  ]
  // Vase balusters between the panel and the handrail.
  for (const f of [0.33, 0.67]) parts.push(box(0.12, 0.3, 0.11, BAY * f, 0.76), box(0.2, 0.06, 0.14, BAY * f, 0.63), box(0.18, 0.05, 0.13, BAY * f, 0.89))
  for (const x of [0, BAY]) parts.push(box(0.24, 1.2, 0.24, x, 0.72), box(0.3, 0.1, 0.3, x, 1.35), box(0.2, 0.08, 0.2, x, 1.44))
  const merged = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g))
  parts.forEach((g) => g.dispose())
  return merged
}

function capGeometry() {
  const bud = new SphereGeometry(0.1, 10, 7).scale(1, 1.45, 1).translate(0, 1.6, 0)
  const seat = new CylinderGeometry(0.13, 0.09, 0.06, 10).translate(0, 1.5, 0)
  const merged = mergeGeometries([bud.toNonIndexed(), seat.toNonIndexed()])
  bud.dispose(); seat.dispose()
  return merged
}

function insideFooting(x: number, z: number) {
  return towerFootings.some((t) => {
    const dx = x - t.position[0], dz = z - t.position[2], c = Math.cos(t.rotation[1]), s = Math.sin(t.rotation[1])
    const lx = dx * c - dz * s, lz = dx * s + dz * c
    return Math.abs(lx) < t.width / 2 + 1.5 && Math.abs(lz) < t.depth / 2 + 1.5
  })
}

/** Bay start points and yaw along each edge; a bay survives only if its whole length is clear. */
function layoutBays() {
  const { width, frontZ, backZ } = LAYOUT.platform
  const inset = 0.35, hx = width / 2 - inset, fz = frontZ - inset, bz = backZ + inset
  const edges: [number, number, number, number][] = [[-hx, fz, hx, fz], [-hx, fz, -hx, bz], [hx, fz, hx, bz]]
  const bays: { x: number; z: number; yaw: number; length: number }[] = []
  const clear = (x: number, z: number) => siteClearance(x, z) > 0.6 && !insideFooting(x, z) && !(z > frontZ - 3 && Math.abs(x) < 10.5)
  for (const [ax, az, bx, bz2] of edges) {
    const len = Math.hypot(bx - ax, bz2 - az), n = Math.round(len / BAY), step = len / n
    const ux = (bx - ax) / len, uz = (bz2 - az) / len, yaw = Math.atan2(-uz, ux)
    for (let i = 0; i < n; i++) {
      const x0 = ax + ux * step * i, z0 = az + uz * step * i
      if ([0, 0.5, 1].every((f) => clear(x0 + ux * step * f, z0 + uz * step * f))) bays.push({ x: x0, z: z0, yaw, length: step })
    }
  }
  return bays
}

export function Balustrades() {
  const { rail, caps } = useMemo(() => {
    const bays = layoutBays()
    const jade = withSurfaceWeather(new MeshStandardMaterial({ color: '#ebe7dc', roughness: 0.42 }))
    const gold = withSurfaceWeather(new MeshStandardMaterial({ color: '#c8a052', roughness: 0.3, metalness: 0.85 }))
    const rail = new InstancedMesh(bayGeometry(), jade, bays.length)
    const posts = new Map<string, Vector3>()
    const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), s = new Vector3(), p = new Vector3()
    bays.forEach((bay, i) => {
      rail.setMatrixAt(i, m.compose(p.set(bay.x, Y, bay.z), q.setFromAxisAngle(up, bay.yaw), s.set(bay.length / BAY, 1, 1)))
      for (const f of [0, 1]) {
        const x = bay.x + Math.cos(bay.yaw) * bay.length * f, z = bay.z - Math.sin(bay.yaw) * bay.length * f
        posts.set(`${Math.round(x * 10)},${Math.round(z * 10)}`, new Vector3(x, Y, z))
      }
    })
    rail.computeBoundingSphere()
    const caps = new InstancedMesh(capGeometry(), gold, posts.size)
    let k = 0
    for (const at of posts.values()) caps.setMatrixAt(k++, m.makeTranslation(at.x, at.y, at.z))
    caps.computeBoundingSphere()
    caps.userData.castShadow = false
    return { rail, caps }
  }, [])
  useEffect(() => () => {
    for (const mesh of [rail, caps]) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); mesh.dispose() }
  }, [rail, caps])
  return <><primitive object={rail} /><primitive object={caps} /></>
}
