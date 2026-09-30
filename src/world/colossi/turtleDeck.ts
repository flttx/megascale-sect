import { Matrix4, Ray, Vector3 } from 'three'
import type { Object3D, SkinnedMesh } from 'three'
import type { SurfaceAddress, SurfaceHit } from '../surfaces'
import { TURTLE } from './layout'

/**
 * 巨鳌's deck (R10e). The shell and everything on it are bound wholly to the skeleton's root, which the `swim` clip
 * never moves (R11), so those triangles are gathered once in the turtle's own frame — footprint centre at the origin,
 * head toward +Z, metres — and every query is turned into that frame by the live pose Turtle.tsx writes each frame.
 * Triangles with any weight on another bone (flippers, neck, head, tail) are left out: they move with the stroke and
 * are nothing to stand on.
 */
export const turtleState = { ready: false, heading: 0, center: new Vector3(), frame: 0 }

/** Skin weight on the root at or above which a vertex is part of the rigid body (weights are stored in 8 bits). */
const RIGID = 0.999
const CELL = 4
const key = (i: number, j: number) => (i + 32768) * 65536 + j + 32768
let corners = new Float32Array(0), normals = new Float32Array(0), stamps = new Uint32Array(0)
let owner: Object3D | null = null, reach = 0, query = 0
const grid = new Map<number, number[]>()
/**
 * Local (x, z) of the back's spirit orbs (R10f): before the pavilion and behind its two rear corners, on one level of
 * its terrace that is open, flat and walkable throughout, so the highest surface over each is the one to stand on.
 */
const ORB_SPOTS: [number, number][] = [[0, -14], [-20, -52], [20, -52]]
export const TURTLE_ORB_COUNT = ORB_SPOTS.length
/** Local deck height under each orb spot (the deck is rigid, so it is found once per bind). */
let orbHeights: number[] = []
const ray = new Ray(), a = new Vector3(), b = new Vector3(), c = new Vector3(), hitPoint = new Vector3()
const localFrom = new Vector3(), localDirection = new Vector3(), side = new Vector3(), across = new Vector3(), bodyFrom = new Vector3()

/** Gathers the deck from the loaded full-detail model (the scene may already be placed; its own frame is used). */
export function bindTurtleDeck(scene: Object3D) {
  // A skinned mesh refreshes its bind inverse only in updateMatrixWorld (not updateWorldMatrix).
  scene.updateWorldMatrix(true, false)
  scene.updateMatrixWorld(true)
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh | undefined
  const geometry = mesh?.geometry, index = geometry?.index
  const skinIndex = geometry?.attributes.skinIndex, skinWeight = geometry?.attributes.skinWeight
  const root = mesh?.skeleton.bones.findIndex((bone) => bone.name === 'root') ?? -1
  if (!mesh || !index || !skinIndex || !skinWeight || root < 0) throw new Error('Turtle deck needs an indexed mesh skinned to a root bone')
  const toAsset = new Matrix4().copy(scene.matrixWorld).invert().multiply(mesh.matrixWorld)
  const kept: number[] = [], up: number[] = [], v = new Vector3(), ab = new Vector3(), ac = new Vector3(), n = new Vector3()
  const rigid = (i: number) => {
    for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === root && skinWeight.getComponent(i, k) >= RIGID) return true
    return false
  }
  // Positions through the skin (the stored ones are quantised in bone space); the root sits at its bind pose.
  const vertex = (i: number) => {
    mesh.getVertexPosition(i, v).applyMatrix4(toAsset)
    return [v.x * TURTLE.scale, v.y * TURTLE.scale, (v.z - TURTLE.centerZ) * TURTLE.scale]
  }
  for (let t = 0; t < index.count; t += 3) {
    const i0 = index.getX(t), i1 = index.getX(t + 1), i2 = index.getX(t + 2)
    if (!rigid(i0) || !rigid(i1) || !rigid(i2)) continue
    const p = [vertex(i0), vertex(i1), vertex(i2)]
    a.fromArray(p[0]); b.fromArray(p[1]); c.fromArray(p[2])
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
    if (n.lengthSq() < 1e-12) continue
    n.normalize()
    kept.push(...p[0], ...p[1], ...p[2]); up.push(n.x, n.y, n.z)
  }
  corners = Float32Array.from(kept); normals = Float32Array.from(up); stamps = new Uint32Array(up.length / 3)
  grid.clear(); reach = 0
  for (let i = 0; i < stamps.length; i++) {
    const o = i * 9
    const xs = [corners[o], corners[o + 3], corners[o + 6]], zs = [corners[o + 2], corners[o + 5], corners[o + 8]]
    for (let k = 0; k < 3; k++) reach = Math.max(reach, Math.hypot(xs[k], zs[k]))
    for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++) {
      for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor(Math.max(...zs) / CELL); z++) {
        const bucket = grid.get(key(x, z))
        if (bucket) bucket.push(i); else grid.set(key(x, z), [i])
      }
    }
  }
  orbHeights = ORB_SPOTS.map(([x, z]) => deckTop(x, z))
  if (!orbHeights.every(Number.isFinite)) throw new Error('Turtle orb spot is off the deck')
  owner = scene; turtleState.ready = false
  return () => { if (owner === scene) { owner = null; grid.clear(); corners = normals = new Float32Array(0); stamps = new Uint32Array(0); orbHeights = []; turtleState.ready = false } }
}

export function updateTurtleDeck(center: Vector3, heading: number) {
  turtleState.center.copy(center); turtleState.heading = heading
  turtleState.frame++; turtleState.ready = owner !== null
}

/** World (x, z) into the turtle's frame. */
function toLocal(x: number, z: number, out: Vector3) {
  const dx = x - turtleState.center.x, dz = z - turtleState.center.z
  const cos = Math.cos(turtleState.heading), sin = Math.sin(turtleState.heading)
  return out.set(cos * dx - sin * dz, 0, sin * dx + cos * dz)
}
/** A local point or direction back into the world (`offset` adds the centre). */
function toWorld(p: Vector3, offset: boolean) {
  const cos = Math.cos(turtleState.heading), sin = Math.sin(turtleState.heading)
  const x = cos * p.x + sin * p.z, z = -sin * p.x + cos * p.z
  p.set(x, p.y, z)
  return offset ? p.add(turtleState.center) : p
}

/** Barycentric weights of the last `heightOver` hit. */
let overU = 0, overV = 0
/** Local height of the triangle over local (px, pz), or NaN beside it or edge-on. */
function heightOver(triangle: number, px: number, pz: number) {
  const o = triangle * 9
  const ax = corners[o], az = corners[o + 2], bx = corners[o + 3], bz = corners[o + 5], cx = corners[o + 6], cz = corners[o + 8]
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) < 1e-9) return NaN
  const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
  const v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
  if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) return NaN
  overU = u; overV = v
  return corners[o + 1] * u + corners[o + 4] * v + corners[o + 7] * (1 - u - v)
}
const cellOf = (p: Vector3) => grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))) ?? []

/** Highest upward-facing deck height over local (x, z), or NaN off the deck. */
function deckTop(x: number, z: number) {
  let best = -Infinity
  for (const triangle of cellOf(localFrom.set(x, 0, z))) {
    if (normals[triangle * 3 + 1] <= 0.05) continue
    const y = heightOver(triangle, x, z)
    if (y > best) best = y
  }
  return Number.isFinite(best) ? best : NaN
}

/** The `index`-th spirit orb on the back, 1.5 m over the deck, or null while the deck is not ready. */
export function turtleOrbPosition(index: number, out: Vector3): Vector3 | null {
  const spot = ORB_SPOTS[index], height = orbHeights[index]
  if (!turtleState.ready || !spot || !Number.isFinite(height)) return null
  return toWorld(out.set(spot[0], height + 1.5, spot[1]), true)
}

export function turtleDeckHit(x: number, z: number, fromY = Infinity): SurfaceHit | null {
  if (!turtleState.ready || Math.hypot(x - turtleState.center.x, z - turtleState.center.z) > reach) return null
  const p = toLocal(x, z, localFrom), top = fromY - turtleState.center.y + 1
  let best = -Infinity, bestTriangle = -1, bestU = 0, bestV = 0
  for (const triangle of cellOf(p)) {
    if (normals[triangle * 3 + 1] <= 0.05) continue
    const y = heightOver(triangle, p.x, p.z)
    if (!(y <= top) || y <= best) continue
    best = y; bestTriangle = triangle; bestU = overU; bestV = overV
  }
  if (bestTriangle < 0) return null
  const n = toWorld(a.fromArray(normals, bestTriangle * 3), false)
  return { y: best + turtleState.center.y, normal: [n.x, n.y, n.z], normalY: n.y, surfaceId: 'turtle', anchor: { triangle: bestTriangle, u: bestU, v: bestV } }
}

export function evaluateTurtleAnchor(address: SurfaceAddress, out: Vector3): Vector3 | null {
  const o = address.triangle * 9
  if (!turtleState.ready || o + 8 >= corners.length) return null
  const w = 1 - address.u - address.v
  out.set(corners[o] * address.u + corners[o + 3] * address.v + corners[o + 6] * w, corners[o + 1] * address.u + corners[o + 4] * address.v + corners[o + 7] * w,
    corners[o + 2] * address.u + corners[o + 5] * address.v + corners[o + 8] * w)
  return toWorld(out, true)
}

/** Free length along the unit `direction` before any of the turtle's triangles (shell, rocks, pavilion, pines). */
export function turtleClearance(from: Vector3, direction: Vector3, length: number): number {
  if (!turtleState.ready || Math.hypot(from.x - turtleState.center.x, from.z - turtleState.center.z) > reach + length) return length
  toLocal(from.x, from.z, localFrom).y = from.y - turtleState.center.y
  const cos = Math.cos(turtleState.heading), sin = Math.sin(turtleState.heading)
  localDirection.set(cos * direction.x - sin * direction.z, direction.y, sin * direction.x + cos * direction.z)
  ray.set(localFrom, localDirection)
  const endX = localFrom.x + localDirection.x * length, endZ = localFrom.z + localDirection.z * length
  let free = length
  query = (query + 1) >>> 0 || 1
  for (let x = Math.floor(Math.min(localFrom.x, endX) / CELL); x <= Math.floor(Math.max(localFrom.x, endX) / CELL); x++) {
    for (let z = Math.floor(Math.min(localFrom.z, endZ) / CELL); z <= Math.floor(Math.max(localFrom.z, endZ) / CELL); z++) {
      for (const i of grid.get(key(x, z)) ?? []) {
        if (stamps[i] === query) continue
        stamps[i] = query
        const o = i * 9
        a.fromArray(corners, o); b.fromArray(corners, o + 3); c.fromArray(corners, o + 6)
        if (!ray.intersectTriangle(a, b, c, false, hitPoint)) continue
        const d = hitPoint.distanceTo(localFrom)
        if (d > 1e-4 && d < free) free = d
      }
    }
  }
  return free
}

/** A step from (x, z) to (nx, nz) runs the body into a pavilion wall, a pine trunk or a rock face. */
export function turtleBodyBlocked(x: number, y: number, z: number, nx: number, nz: number) {
  const distance = Math.hypot(nx - x, nz - z)
  if (distance < 1e-7 || !turtleState.ready || Math.hypot(x - turtleState.center.x, z - turtleState.center.z) > reach + 1) return false
  side.set((nx - x) / distance, 0, (nz - z) / distance)
  across.set(-side.z, 0, side.x)
  for (const h of [0.5, 1.2, 1.7]) for (const offset of [-0.35, 0, 0.35]) {
    bodyFrom.set(x, y + h, z).addScaledVector(across, offset)
    if (turtleClearance(bodyFrom, side, distance + 0.35) < distance + 0.35 - 1e-5) return true
  }
  return false
}

/**
 * How deep (m) a point is inside the turtle: the height up to the first of its surfaces straight above, when that
 * surface faces up (the top of the shell, a rock or a canopy seen from within); 0 in the open, under an overhang,
 * a canopy or the pavilion roof, and beneath the turtle.
 */
export function turtleDepth(x: number, y: number, z: number) {
  if (!turtleState.ready || Math.hypot(x - turtleState.center.x, z - turtleState.center.z) > reach) return 0
  const p = toLocal(x, z, localFrom), from = y - turtleState.center.y
  let nearest = Infinity, facing = 0
  for (const triangle of cellOf(p)) {
    const h = heightOver(triangle, p.x, p.z)
    if (!(h > from) || h >= nearest) continue
    nearest = h; facing = normals[triangle * 3 + 1]
  }
  return facing > 0 ? nearest - from : 0
}
