// Mesh probes shared by the asset meta scripts (rocks, colossi): a glTF node as a raycastable three mesh in
// asset metres, and the solid runs a ray passes through.
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster } from 'three'

/** World-space (asset metres) positions of a node's mesh as a raycastable three Mesh. */
export function nodeMesh(node) {
  const m = node.getWorldMatrix(), prim = node.getMesh().listPrimitives()[0]
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n = pos.getCount()
  const out = new Float32Array(n * 3), p = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p)
    out[i * 3] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    out[i * 3 + 1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
    out[i * 3 + 2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(out, 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(idx.getArray()), 1))
  geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return { mesh: new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })), positions: out }
}

const ray = new Raycaster()
/**
 * Solid runs [from, to] (distances) along the ray from `origin` in unit `direction`. Solid is counted by winding,
 * which also holds where closed shells overlap: each hit's face normal says whether the ray enters or leaves a
 * shell, and the depth at the ray start is whatever leaves it at 0 past the last hit.
 */
export function solidRuns(mesh, origin, direction) {
  ray.set(origin, direction)
  const hits = ray.intersectObject(mesh, false).map((h) => ({ d: h.distance, step: h.face.normal.dot(direction) < 0 ? 1 : -1 }))
  const runs = []
  let depth = -hits.reduce((sum, h) => sum + h.step, 0), from = 0
  for (const h of hits) {
    const next = depth + h.step
    if (depth > 0 && next <= 0) runs.push([from, h.d])
    if (depth <= 0 && next > 0) from = h.d
    depth = next
  }
  return runs
}
