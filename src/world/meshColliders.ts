import { Box3, BufferGeometry, DoubleSide, InstancedMesh, Matrix3, Matrix4, Mesh, Ray, Vector3 } from 'three'
import type { Object3D } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { registerColliders, registerMovingCollider, registerWalkables } from './surfaces'
import type { CollisionQuery, MeshCollider, WalkableMoving } from './surfaces'

const trees = new WeakMap<BufferGeometry, MeshBVH>()
function treeFor(geometry: BufferGeometry) {
  let tree = trees.get(geometry)
  if (!tree) {
    // The BVH sorts its index: keep the render/source geometry (and skin metadata indices) untouched.
    const source = new BufferGeometry()
    source.setAttribute('position', geometry.getAttribute('position'))
    if (geometry.index) source.setIndex(geometry.index.clone())
    tree = new MeshBVH(source)
    trees.set(geometry, tree)
  }
  return tree
}

/** Refit only when a nearby query needs the current animated vertex positions. */
export function refitCollisionGeometry(geometry: BufferGeometry) {
  const tree = treeFor(geometry)
  tree.refit()
  tree.getBoundingBox(tree.geometry.boundingBox!)
}

/** Query the actual mesh, preserving open doors and spaces between columns. Matrix may be a live moving pose. */
export function meshQuery(geometry: BufferGeometry, matrix: Matrix4): CollisionQuery {
  const tree = treeFor(geometry),
    inverse = new Matrix4(),
    body = new Box3(),
    local = new Box3(),
    ray = new Ray()
  const bounds = tree.geometry.boundingBox!
  return (x, bottom, top, z, radius, vertical) => {
    inverse.copy(matrix).invert()
    body.min.set(x - radius, bottom - vertical, z - radius)
    body.max.set(x + radius, top + vertical, z + radius)
    local.copy(body).applyMatrix4(inverse)
    if (!bounds.intersectsBox(local)) return false
    if (tree.intersectsBox(body, inverse)) return true
    // A body entirely inside a closed mesh does not intersect its shell. The first upward exit faces away.
    body.getCenter(ray.origin).applyMatrix4(inverse)
    ray.direction.set(0, 1, 0).transformDirection(inverse)
    const hit = tree.raycastFirst(ray, DoubleSide)
    return !!hit?.face && hit.face.normal.dot(ray.direction) > 0
  }
}

export function meshCollider(geometry: BufferGeometry, matrix: Matrix4, name: string): MeshCollider {
  const bounds = treeFor(geometry).geometry.boundingBox!.clone().applyMatrix4(matrix)
  return {
    kind: 'mesh',
    name,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    intersects: meshQuery(geometry, matrix.clone()),
  }
}

/** Static meshes and instanced meshes, registered once from their rendered transforms; LOD visibility is irrelevant. */
export function registerObjectColliders(root: Object3D) {
  root.updateWorldMatrix(true, true)
  const colliders: MeshCollider[] = [],
    matrix = new Matrix4()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (object instanceof InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix).premultiply(object.matrixWorld)
        colliders.push(meshCollider(object.geometry, matrix, `${root.name}/${object.name}/${i}`))
      }
    } else colliders.push(meshCollider(object.geometry, object.matrixWorld, `${root.name}/${object.name}`))
  })
  return registerColliders(colliders)
}

/** Island lips and bridge notches use their real baked top, including the triangles between authored vertices. */
export function registerObjectWalkables(root: Object3D) {
  root.updateWorldMatrix(true, true)
  const surfaces: WalkableMoving[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const tree = treeFor(object.geometry),
      matrix = object.matrixWorld.clone(),
      inverse = matrix.clone().invert()
    const bounds = tree.geometry.boundingBox!.clone().applyMatrix4(matrix),
      ray = new Ray(),
      point = new Vector3(),
      normal = new Vector3()
    const normals = new Matrix3().getNormalMatrix(matrix)
    surfaces.push({
      kind: 'moving',
      hitAt(x, z, fromY) {
        if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) return null
        ray.origin.set(x, Math.min(fromY + 1, bounds.max.y + 1), z).applyMatrix4(inverse)
        ray.direction.set(0, -1, 0).transformDirection(inverse)
        const hit = tree.raycastFirst(ray, DoubleSide)
        if (!hit?.face) return null
        normal.copy(hit.face.normal).applyMatrix3(normals).normalize()
        if (normal.y <= 0.05) return null
        point.copy(hit.point).applyMatrix4(matrix)
        return { y: point.y, normal: normal.toArray(), normalY: normal.y, surfaceId: 'static' }
      },
    })
  })
  return registerWalkables(surfaces)
}

/** Rigid moving meshes use their live matrices; invisible/consumed models stop blocking immediately. */
export function registerMovingObjectColliders(root: Object3D) {
  const entries: { mesh: Mesh; query: CollisionQuery }[] = []
  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    if (object instanceof Mesh) entries.push({ mesh: object, query: meshQuery(object.geometry, object.matrixWorld) })
  })
  return registerMovingCollider((...args) => {
    if (!root.visible) return false
    root.updateWorldMatrix(true, true)
    return entries.some(({ mesh, query }) => mesh.visible && query(...args))
  })
}
