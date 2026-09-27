import { Ray, Vector3 } from 'three'
import type { Object3D, SkinnedMesh } from 'three'
import type { SurfaceAddress, SurfaceHit } from '../surfaces'
import { KUN_DECK } from './kunDeckMeta'

export type DeckAnchor = SurfaceAddress & { point: Vector3; yaw: number }
export const kunState = { ready: false, time: 0, heading: 0, headY: -Infinity, frame: 0, center: new Vector3() }
export const kunDockable = () => kunState.ready && kunState.time >= 30 && kunState.time < 150
type Vertex = { mesh: SkinnedMesh; index: number; point: Vector3; frame: number }
type Triangle = { a: Vertex; b: Vertex; c: Vertex; normal: Vector3 }
let triangles: Triangle[] = [], owner: Object3D | null = null, indexedFrame = -1
const grid = new Map<number, number[]>(), CELL = 4
const key = (i: number, j: number) => (i + 32768) * 65536 + j + 32768
const ab = new Vector3(), ac = new Vector3(), ray = new Ray(), hitPoint = new Vector3()
const normal = new Vector3(), rayDirection = new Vector3()
const packed = new Uint32Array(Uint8Array.from(atob(KUN_DECK.triangles), (c) => c.charCodeAt(0)).buffer)

/** Registration owns no GLTF resources; StrictMode cleanup only releases references. */
export function bindKunDeck(scene: Object3D) {
  const meshes: SkinnedMesh[] = []
  scene.traverse((object) => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh) })
  if (meshes.length !== KUN_DECK.meshes) throw new Error('Kun deck metadata does not match the loaded mesh')
  const vertices = new Map<string, Vertex>()
  const vertex = (mesh: number, index: number) => {
    const id = `${mesh}/${index}`
    let value = vertices.get(id)
    if (!value) { value = { mesh: meshes[mesh], index, point: new Vector3(), frame: -1 }; vertices.set(id, value) }
    return value
  }
  triangles = []
  for (let i = 0; i < packed.length; i += 2) {
    const m = packed[i], offset = packed[i + 1] * 3, index = meshes[m].geometry.index
    if (!index || offset + 2 >= index.count) throw new Error('Kun deck triangle is outside the loaded mesh')
    triangles.push({ a: vertex(m, index.getX(offset)), b: vertex(m, index.getX(offset + 1)), c: vertex(m, index.getX(offset + 2)), normal: new Vector3() })
  }
  owner = scene; kunState.ready = false; indexedFrame = -1
  return () => { if (owner === scene) { owner = null; triangles = []; grid.clear(); kunState.ready = false } }
}

export function updateKunDeck(center: Vector3, time: number, heading: number, headY: number) {
  kunState.center.copy(center); kunState.time = time; kunState.heading = heading; kunState.headY = headY
  kunState.frame++; kunState.ready = owner !== null
}
function skin(v: Vertex) {
  if (v.frame !== kunState.frame) {
    v.mesh.getVertexPosition(v.index, v.point).applyMatrix4(v.mesh.matrixWorld)
    v.frame = kunState.frame
  }
  return v.point
}
function indexFrame() {
  if (indexedFrame === kunState.frame) return
  grid.clear(); indexedFrame = kunState.frame
  triangles.forEach((t, i) => {
    const a = skin(t.a), b = skin(t.b), c = skin(t.c)
    t.normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
    const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL)
    const z0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL), z1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = key(x, z), bucket = grid.get(k)
      if (bucket) bucket.push(i); else grid.set(k, [i])
    }
  })
}
export function kunDeckHit(x: number, z: number, fromY = Infinity): SurfaceHit | null {
  if (!kunState.ready || Math.hypot(x - kunState.center.x, z - kunState.center.z) > 220) return null
  indexFrame()
  let best: SurfaceHit | null = null
  for (const triangle of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
    const t = triangles[triangle], a = t.a.point, b = t.b.point, c = t.c.point
    if (t.normal.y <= 0.05) continue
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
    if (Math.abs(d) < 1e-9) continue
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d
    if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue
    const y = a.y * u + b.y * v + c.y * (1 - u - v)
    if (y > fromY + 1 || (best && y <= best.y)) continue
    best = { y, normalY: t.normal.y, surfaceId: 'kun', anchor: { triangle, u, v } }
  }
  return best
}
export function evaluateDeckAnchor(address: SurfaceAddress, out: Vector3): Vector3 | null {
  const t = triangles[address.triangle]
  if (!kunState.ready || !t) return null
  return out.copy(skin(t.a)).multiplyScalar(address.u).addScaledVector(skin(t.b), address.v).addScaledVector(skin(t.c), 1 - address.u - address.v)
}
export function deckAnchor(hit: SurfaceHit): DeckAnchor | null {
  if (!hit.anchor) return null
  const point = evaluateDeckAnchor(hit.anchor, new Vector3())
  return point ? { ...hit.anchor, point, yaw: kunState.heading } : null
}
export function kunOrbPosition(index: number, out: Vector3) {
  const address = KUN_DECK.orbs[index]
  const point = address ? evaluateDeckAnchor(address, out) : null
  if (point) point.y += 1.5
  return point
}

/** Exact segment clearance through the skinned deck, including pavilion walls and tree trunks. */
export function kunClearance(from: Vector3, direction: Vector3, length: number): number {
  if (!kunState.ready || Math.hypot(from.x - kunState.center.x, from.z - kunState.center.z) > 220 + length) return length
  indexFrame()
  ray.set(from, direction)
  const endX = from.x + direction.x * length, endZ = from.z + direction.z * length
  let free = length
  const seen = new Set<number>()
  for (let x = Math.floor(Math.min(from.x, endX) / CELL); x <= Math.floor(Math.max(from.x, endX) / CELL); x++) {
    for (let z = Math.floor(Math.min(from.z, endZ) / CELL); z <= Math.floor(Math.max(from.z, endZ) / CELL); z++) {
      for (const i of grid.get(key(x, z)) ?? []) {
        if (seen.has(i)) continue
        seen.add(i)
        const t = triangles[i]
        if (!ray.intersectTriangle(t.a.point, t.b.point, t.c.point, false, hitPoint)) continue
        const d = hitPoint.distanceTo(from)
        if (d > 1e-4 && d < free) free = d
      }
    }
  }
  return free
}
const bodyFrom = new Vector3()
export function kunBodyBlocked(x: number, y: number, z: number, nx: number, nz: number) {
  const distance = Math.hypot(nx - x, nz - z)
  if (distance < 1e-7) return false
  rayDirection.set((nx - x) / distance, 0, (nz - z) / distance)
  normal.set(-rayDirection.z, 0, rayDirection.x)
  for (const h of [0.5, 1.2, 1.7]) for (const side of [-0.35, 0, 0.35]) {
    bodyFrom.set(x, y + h, z).addScaledVector(normal, side)
    if (kunClearance(bodyFrom, rayDirection, distance + 0.35) < distance + 0.35 - 1e-5) return true
  }
  return false
}
