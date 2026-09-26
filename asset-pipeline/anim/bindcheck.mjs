// Check joint_world_rest * IBM for every joint (should be one common matrix) and derive skinned rest height.
import { io, skeletonOf, restPose, worldPose } from './lib.mjs'
import { Matrix4, Vector3 } from 'three'
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file)
  const skel = skeletonOf(doc)
  const W = worldPose(skel, restPose(skel))
  const skin = doc.getRoot().listSkins()[0]
  const ibm = skin.getInverseBindMatrices().getArray()
  const mats = skin.listJoints().map((j, i) => W.get(j.getName()).m.clone().multiply(new Matrix4().fromArray(ibm.slice(i * 16, i * 16 + 16))))
  let maxDev = 0
  for (const m of mats) for (let k = 0; k < 16; k++) maxDev = Math.max(maxDev, Math.abs(m.elements[k] - mats[0].elements[k]))
  const meshNode = skel.order.map((n) => skel.nodes.get(n)).find((e) => e.mesh)
  const pos = meshNode.node.getMesh().listPrimitives().map((p) => p.getAttribute('POSITION'))
  let minY = Infinity, maxY = -Infinity
  const v = new Vector3()
  for (const a of pos) { const arr = a.getArray(), n = a.getCount(), el = a.getElementSize(); const norm = a.getNormalized(); for (let i = 0; i < n; i++) { a.getElement(i, v.toArray ? [] : []); const e = a.getElement(i, []); v.set(e[0], e[1], e[2]).applyMatrix4(mats[0]); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y) } }
  console.log(file, 'joints', mats.length, 'maxDev', maxDev.toExponential(2), 'M0', mats[0].elements.map((x) => x.toFixed(4)).join(','), 'skinnedY', minY.toFixed(4), maxY.toFixed(4), 'height', (maxY - minY).toFixed(4))
}
