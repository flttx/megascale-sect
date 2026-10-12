import { Box3, BufferGeometry, Vector3 } from 'three'
import type { CylinderCollider } from '../surfaces'
import { isPine } from './propCatalog'
import type { PropId } from './propCatalog'
import type { Placement } from './placement'

/** All solid bark, including branches and roots; alpha-tested needles never become a canopy wall. */
export function pineBarkGeometry(source: BufferGeometry) {
  const geometry = new BufferGeometry(),
    bark = source.getAttribute('aPine'),
    index = source.index!
  const indices: number[] = []
  for (let i = 0; i < index.count; i += 3)
    if (bark.getW(index.getX(i)) >= 0.5) indices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
  geometry.setAttribute('position', source.getAttribute('position'))
  geometry.setIndex(indices)
  return geometry
}

/** Select the longest connected bark tube; roots, branches and needle cards must not become a solid canopy. */
function trunkMask(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'),
    bark = geometry.getAttribute('aPine'),
    index = geometry.index!
  const parent = Uint32Array.from({ length: position.count }, (_, i) => i)
  const root = (vertex: number): number => {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]]
      vertex = parent[vertex]
    }
    return vertex
  }
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2)
    if (bark.getW(a) < 0.5) continue
    parent[root(b)] = root(a)
    parent[root(c)] = root(a)
  }
  const spans = new Map<number, { min: number; max: number }>()
  for (let i = 0; i < position.count; i++) {
    if (bark.getW(i) < 0.5) continue
    const id = root(i),
      y = position.getY(i),
      span = spans.get(id)
    if (span) {
      span.min = Math.min(span.min, y)
      span.max = Math.max(span.max, y)
    } else spans.set(id, { min: y, max: y })
  }
  let trunk = -1,
    height = 0
  for (const [id, span] of spans)
    if (span.max - span.min > height) {
      trunk = id
      height = span.max - span.min
    }
  return Uint8Array.from(parent, (_, i) => Number(bark.getW(i) >= 0.5 && root(i) === trunk))
}

/** Conservative horizontal slices of the rendered source, independent of camera LOD. Pines use bark only. */
export function propCollisionShapes(id: PropId, geometry: BufferGeometry): CylinderCollider[] {
  const pine = isPine(id)
  if (!pine && id !== 'rock_moss' && id !== 'rock_scholar') return []
  const position = geometry.getAttribute('position'),
    index = geometry.index
  if (!index) throw new Error(`Prop collision source must be indexed: ${id}`)
  const mask = pine ? trunkMask(geometry) : null
  const extent = new Box3(),
    point = new Vector3()
  for (let i = 0; i < position.count; i++)
    if (!mask || mask[i]) extent.expandByPoint(point.fromBufferAttribute(position, i))
  if (extent.isEmpty()) throw new Error(`Prop collision source is empty: ${id}`)
  const height = extent.max.y - extent.min.y
  const count = pine ? Math.max(1, Math.ceil(height / 0.75)) : 8
  const step = height / count
  const bands = Array.from({ length: count }, () => new Box3())
  const vertices = [new Vector3(), new Vector3(), new Vector3()]
  for (let i = 0; i < index.count; i += 3) {
    if (mask && !mask[index.getX(i)]) continue
    for (let k = 0; k < 3; k++) vertices[k].fromBufferAttribute(position, index.getX(i + k))
    const lo = Math.max(0, Math.floor((Math.min(...vertices.map((v) => v.y)) - extent.min.y) / step))
    const hi = Math.min(count - 1, Math.floor((Math.max(...vertices.map((v) => v.y)) - extent.min.y) / step))
    // Include triangles crossing a band even when none of their vertices lies inside it.
    for (let band = lo; band <= hi; band++) for (const vertex of vertices) bands[band].expandByPoint(vertex)
  }
  return bands.flatMap((box, band) =>
    box.isEmpty()
      ? []
      : [
          {
            kind: 'cylinder' as const,
            x: (box.min.x + box.max.x) / 2,
            z: (box.min.z + box.max.z) / 2,
            radius: Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
            minY: extent.min.y + band * step,
            maxY: extent.min.y + (band + 1) * step,
          },
        ],
  )
}

/** Match the same yaw/scale/translation used by the instanced render meshes. */
export function placePropColliders(shapes: CylinderCollider[], placement: Placement): CylinderCollider[] {
  const p = placement,
    c = Math.cos(p.yaw),
    s = Math.sin(p.yaw)
  return shapes.map((shape) => ({
    kind: 'cylinder',
    x: p.x + (c * shape.x + s * shape.z) * p.scale,
    z: p.z + (-s * shape.x + c * shape.z) * p.scale,
    radius: shape.radius * p.scale,
    minY: p.y + shape.minY * p.scale,
    maxY: p.y + shape.maxY * p.scale,
  }))
}
