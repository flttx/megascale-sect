import { Box3, BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Object3D } from 'three'

export interface TissueClawPart {
  geometry: BufferGeometry
  material: MeshStandardMaterial
  probes: { name: string; index: number; sourceIndex: number }[]
  sourceTriangles: number
}

/** The inspected Behemoth's right wrist and four clawed fingers, with the authored UV/PBR intact. */
export function clawNormalization(scene: Object3D): Matrix4 {
  scene.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(scene),
    center = bounds.getCenter(new Vector3())
  const height = bounds.max.y - bounds.min.y
  return new Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z))
}

export function createTissueClaws(scene: Object3D, normalizedBody: Matrix4): TissueClawPart[] {
  scene.updateMatrixWorld(true)
  const parts: TissueClawPart[] = []
  const point = new Vector3()
  // The forearm cut is behind the ground/membrane. A proper rotation points the fingers upward;
  // there is no negative scale, generated replacement hand, UV remapping or cap across the palm.
  const wrist = new Vector3(0.442, 0.28, -0.093)
  const stand = new Matrix4()
    .makeScale(1 / 0.28, 1 / 0.28, 1 / 0.28)
    .multiply(new Matrix4().makeRotationZ(Math.PI))
    .multiply(new Matrix4().makeTranslation(-wrist.x, -wrist.y, -wrist.z))
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const source = object.geometry,
      position = source.getAttribute('position'),
      index = source.index
    const material = Array.isArray(object.material) ? object.material[0] : object.material
    if (!position || !(material instanceof MeshStandardMaterial)) return
    const bodyTransform = normalizedBody.clone().multiply(object.matrixWorld)
    const selected = new Uint8Array(position.count)
    for (let vertex = 0; vertex < position.count; vertex++) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(bodyTransform)
      selected[vertex] = Number(point.x > 0.32 && point.y < 0.28)
    }
    const triangles: number[] = [],
      used = new Set<number>()
    for (let offset = 0; offset + 2 < (index?.count ?? position.count); offset += 3) {
      const a = index ? index.getX(offset) : offset,
        b = index ? index.getX(offset + 1) : offset + 1
      const c = index ? index.getX(offset + 2) : offset + 2
      if (!selected[a] || !selected[b] || !selected[c]) continue
      triangles.push(a, b, c)
      used.add(a)
      used.add(b)
      used.add(c)
    }
    if (!triangles.length) return
    const originals = [...used],
      remap = new Map(originals.map((vertex, target) => [vertex, target]))
    const geometry = new BufferGeometry()
    for (const name of ['position', 'normal', 'uv', 'tangent']) {
      const attribute = source.getAttribute(name)
      if (!attribute) continue
      const values = new Float32Array(originals.length * attribute.itemSize)
      originals.forEach((vertex, target) => {
        for (let component = 0; component < attribute.itemSize; component++) {
          values[target * attribute.itemSize + component] = attribute.getComponent(vertex, component)
        }
      })
      geometry.setAttribute(name, new BufferAttribute(values, attribute.itemSize))
    }
    geometry.setIndex(triangles.map((vertex) => remap.get(vertex)!))
    geometry.applyMatrix4(stand.clone().multiply(bodyTransform))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const ownedMaterial = material.clone()
    ownedMaterial.name = 'TripoBehemothRootedWrist'
    const vertices = geometry.getAttribute('position')
    const probes: TissueClawPart['probes'] = []
    // Four independent source fingertip samples, rather than an invented contact sphere.
    const ranges = [-0.5, -0.15, 0.15, 0.5]
    for (let finger = 0; finger < ranges.length; finger++) {
      let best = -Infinity,
        chosen = 0
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const score = vertices.getY(vertex) - Math.abs(vertices.getX(vertex) - ranges[finger]) * 0.4
        if (score > best) {
          best = score
          chosen = vertex
        }
      }
      probes.push({ name: `finger-${finger}`, index: chosen, sourceIndex: originals[chosen] })
    }
    let knuckle = 0,
      distance = Infinity
    for (let vertex = 0; vertex < vertices.count; vertex++) {
      point.fromBufferAttribute(vertices, vertex)
      const current = point.distanceToSquared(new Vector3(0, 0.66, 0.42))
      if (current < distance) {
        distance = current
        knuckle = vertex
      }
    }
    probes.push({ name: 'knuckle', index: knuckle, sourceIndex: originals[knuckle] })
    geometry.userData.sourceAnatomy = {
      source: 'abyss-behemoth',
      region: 'right-wrist-and-claws',
      originalVertexIndices: originals,
      originalTriangles: triangles.length / 3,
      normalization: stand.clone().multiply(bodyTransform).toArray(),
      sourceNode: object.name,
      cutBelowMembrane: true,
    }
    parts.push({ geometry, material: ownedMaterial, probes, sourceTriangles: triangles.length / 3 })
  })
  if (!parts.length) throw new Error('Inspected Behemoth wrist geometry is unavailable')
  return parts
}
