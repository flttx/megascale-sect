import { BufferAttribute, BufferGeometry, Group, LOD, Matrix3, Mesh, Vector3 } from 'three'
import type { Material, Matrix4, Object3D } from 'three'
import { bridgeDeck } from '../bridges'
import { BRIDGES, ISLANDS, PILLARS } from '../sites'
import type { BridgeSite, IslandSite } from '../sites'
import { ISLAND_PLACEMENTS, padFlatten, PILLAR_PLACEMENTS, rockScaleY, toWorld } from './rockLayout'
import type { RockPlacement } from './rockLayout'
import { ISLAND_META, PILLAR_META } from './rockMeta'

/**
 * Bakes the placed Blender rocks into world-space geometry: one mesh per pillar cluster and per island, each
 * with its full and reduced (lod1) level, so a group costs one draw and culls / shadows as a unit. Island
 * tops are flattened around the walkable pad and notched where a bridge lands. The baked vertex colour
 * (AO, vegetation, bedding bands) becomes the `rockMask` attribute the karst material reads.
 */

interface Source { geometry: BufferGeometry; matrix: Matrix4 }
interface Item { source: Source; pl: RockPlacement; island?: IslandSite }

const up = new Vector3(0, 1, 0)
/** Distance from the nearest pillar of a cluster at which it drops to the reduced model. */
const PILLAR_LOD1 = 420
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function sources(root: Object3D) {
  const out = new Map<string, Source>()
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) out.set(mesh.name, { geometry: mesh.geometry, matrix: mesh.matrixWorld })
  })
  return out
}

/** Island top: flat to the pad edge + 2 m, easing back to the sculpted surface by the narrowest rim. */
function shapeIslandTop(isle: IslandSite, bridge: BridgeSite | undefined, p: Vector3, n: Vector3) {
  const [cx, T, cz] = isle.top, P = isle.padRadius, d = Math.hypot(p.x - cx, p.z - cz)
  if (p.y > T - 3) {
    const w = padFlatten(isle, d)
    if (w > 0) { p.y += (T - p.y) * w; n.lerp(up, w).normalize() }
  }
  // The bridge lands in a shallow notch cut to deck height (the pad itself stays flat).
  if (bridge && d > P + 0.1) {
    const deck = bridgeDeck(bridge, p.x, p.z), target = deck.y - 0.14
    if (deck.t > 0 && deck.t < 1.02 && p.y > target) {
      const w = smooth(0, 1, 1 - (deck.side - bridge.halfWidth - 0.4) / 1.6)
      if (w > 0) { p.y += (target - p.y) * w; n.lerp(up, w).normalize() }
    }
  }
}

function bake(items: Item[]) {
  let vertices = 0, indices = 0
  for (const { source } of items) { vertices += source.geometry.attributes.position.count; indices += source.geometry.index?.count ?? 0 }
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), mask = new Uint8Array(vertices * 4), index = new Uint32Array(indices)
  const p = new Vector3(), n = new Vector3(), normalMatrix = new Matrix3(), world: [number, number, number] = [0, 0, 0]
  let v = 0, k = 0
  for (const { source, pl, island } of items) {
    const g = source.geometry, pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color
    const bridge = island && BRIDGES.find((b) => b.island === island.id)
    const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw)
    normalMatrix.getNormalMatrix(source.matrix)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(source.matrix)
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix)
      // Normals take the inverse of the (non-uniform) scale, then the yaw.
      const nx = n.x / pl.sxz, ny = n.y / rockScaleY(pl, p.y), nz = n.z / pl.sxz
      n.set(c * nx + s * nz, ny, -s * nx + c * nz).normalize()
      toWorld(pl, p.x, p.y, p.z, world)
      p.set(world[0], world[1], world[2])
      if (island) shapeIslandTop(island, bridge, p, n)
      position.set([p.x, p.y, p.z], (v + i) * 3)
      normal.set([n.x, n.y, n.z], (v + i) * 3)
      if (col) mask.set([col.getX(i), col.getY(i), col.getZ(i), col.itemSize > 3 ? col.getW(i) : 1].map((c) => Math.round(c * 255)), (v + i) * 4)
      else mask.set([255, 0, 128, 255], (v + i) * 4)
    }
    const src = g.index
    if (src) for (let i = 0; i < src.count; i++) index[k++] = src.getX(i) + v
    v += pos.count
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('rockMask', new BufferAttribute(mask, 4, true))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** `distance`: where the reduced level takes over, given the group's centre (the LOD measures from it). */
function group(levels: Item[][], distance: (centre: Vector3) => number, material: Material) {
  const geometries = levels.map(bake), centre = geometries[0].boundingSphere?.center ?? new Vector3(), switchAt = distance(centre)
  const lod = new LOD()
  lod.position.copy(centre)
  geometries.forEach((geometry, level) => {
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(centre).negate()
    // Each level is a group so LOD.update toggles the group, never the mesh: N8AO hides opaque meshes for its
    // transparency passes, and an LOD re-showing them there would redraw the rock (and its shadows) twice more.
    const holder = new Group()
    holder.add(mesh)
    lod.addLevel(holder, level * switchAt, 0.1)
  })
  return { lod, geometries }
}

/**
 * `scenes`: pillars, pillars lod1, islands, islands lod1. Returns the LOD groups under one root and
 * a disposer for their geometry.
 */
export function buildRockField(scenes: Object3D[], material: Material) {
  const [pillars0, pillars1, islands0, islands1] = scenes.map(sources)
  const root: Object3D[] = [], geometries: BufferGeometry[] = []
  const pick = (map: Map<string, Source>, name: string) => { const source = map.get(name); if (!source) throw new Error(`rock model ${name} missing`); return source }
  const clusters = new Map<number, number[]>()
  PILLARS.forEach((site, i) => clusters.set(site.cluster, [...(clusters.get(site.cluster) ?? []), i]))
  for (const members of clusters.values()) {
    const levels = [pillars0, pillars1].map((map) => members.map((i) => ({ source: pick(map, PILLAR_META[PILLAR_PLACEMENTS[i].variant].name), pl: PILLAR_PLACEMENTS[i] })))
    // Past the members' reach from the centre + PILLAR_LOD1, every member is at least PILLAR_LOD1 away.
    const reach = (c: Vector3) => Math.max(...members.map((i) => Math.hypot(PILLARS[i].x - c.x, PILLARS[i].z - c.z) + PILLARS[i].radius))
    const built = group(levels, (c) => reach(c) + PILLAR_LOD1, material)
    root.push(built.lod); geometries.push(...built.geometries)
  }
  ISLANDS.forEach((isle, i) => {
    const pl = ISLAND_PLACEMENTS[i], name = ISLAND_META[pl.variant].name
    const levels = [islands0, islands1].map((map) => [
      { source: pick(map, name), pl, island: isle },
      ...[...map.entries()].filter(([key]) => key.startsWith(`${name}_debris_`)).map(([, source]) => ({ source, pl })),
    ])
    const built = group(levels, () => 420, material)
    root.push(built.lod); geometries.push(...built.geometries)
  })
  return { root, dispose: () => geometries.forEach((g) => g.dispose()) }
}
