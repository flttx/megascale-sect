// Write an animation-only GLB: skeleton nodes cloned from the character (same names + rest TRS),
// no mesh / skin, one glTF animation per clip targeting those nodes by reference.
import { Document } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { resample } from '@gltf-transform/functions'
import { io } from './lib.mjs'
import { PREFIX } from './retarget.mjs'

/** clips: [{ name, times: Float32Array, rot: Map(bone → Float32Array 4N), hips: Float32Array 3N }] */
export async function writeAnimGlb(target, clips, outFile, { compress = true, tolerance = 1e-4 } = {}) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('Scene')
  const nodes = new Map()
  for (const name of target.skel.order) {
    const e = target.skel.nodes.get(name)
    if (e.mesh) continue // character mesh node is not needed for animation data
    const n = doc.createNode(name).setTranslation(e.t.toArray()).setRotation(e.r.toArray()).setScale(e.s.toArray())
    nodes.set(name, n)
    if (e.parent) nodes.get(e.parent).addChild(n); else scene.addChild(n)
  }
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name)
    const input = doc.createAccessor(`${clip.name}_t`).setType('SCALAR').setArray(clip.times).setBuffer(buffer)
    const add = (node, path, arr, type) => {
      const out = doc.createAccessor(`${clip.name}_${node.getName()}_${path}`).setType(type).setArray(arr).setBuffer(buffer)
      const s = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR')
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s))
    }
    for (const [bone, arr] of clip.rot) add(nodes.get(PREFIX + bone), 'rotation', arr, 'VEC4')
    add(nodes.get(PREFIX + 'Hips'), 'translation', clip.hips, 'VEC3')
  }
  await doc.transform(resample({ tolerance }))
  if (compress) doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  await io.write(outFile, doc)
  return doc
}
