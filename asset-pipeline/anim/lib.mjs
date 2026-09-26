// Shared helpers: glTF I/O, rest skeleton extraction and sampled FK using three.js math.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { Quaternion, Vector3, Matrix4 } from 'three'

await MeshoptDecoder.ready
await MeshoptEncoder.ready
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
export { MeshoptEncoder }

/** Flatten a document's node tree into { name → { parent, t, r, s, node } } in DFS order. */
export function skeletonOf(doc) {
  const nodes = new Map()
  const order = []
  const visit = (n, parent) => {
    const e = { name: n.getName(), parent, t: new Vector3(...n.getTranslation()), r: new Quaternion(...n.getRotation()), s: new Vector3(...n.getScale()), node: n, mesh: !!n.getMesh() }
    nodes.set(e.name, e); order.push(e.name)
    for (const c of n.listChildren()) visit(c, e.name)
  }
  for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) visit(n, null)
  return { nodes, order }
}

/** Sample an animation into per-frame local TRS for every node (rest where not animated). */
export function sampleAnimation(doc, anim, skel, fps = 'native') {
  let duration = 0
  const tracks = new Map()
  for (const ch of anim.listChannels()) {
    const name = ch.getTargetNode().getName(), p = ch.getTargetPath(), s = ch.getSampler()
    const times = s.getInput().getArray(), vals = s.getOutput().getArray()
    duration = Math.max(duration, times[times.length - 1])
    if (!tracks.has(name)) tracks.set(name, {})
    tracks.get(name)[p] = { times, vals, interp: s.getInterpolation(), comps: p === 'rotation' ? 4 : 3 }
  }
  const native = anim.listSamplers()[0].getInput().getArray()
  const times = fps === 'native' ? Array.from(native) : Array.from({ length: Math.round(duration * fps) + 1 }, (_, f) => Math.min(duration, f / fps))
  const frames = times.length
  const evalTrack = (tr, time) => {
    const { times, vals, comps } = tr
    let i = 0
    while (i < times.length - 2 && times[i + 1] <= time) i++
    const t0 = times[i], t1 = times[Math.min(i + 1, times.length - 1)]
    const a = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0
    const j = Math.min(i + 1, times.length - 1)
    const out = []
    for (let k = 0; k < comps; k++) out.push(vals[i * comps + k] * (1 - a) + vals[j * comps + k] * a)
    return out
  }
  const local = []
  for (let f = 0; f < frames; f++) {
    const time = times[f]
    const pose = new Map()
    for (const name of skel.order) {
      const e = skel.nodes.get(name), tr = tracks.get(name) ?? {}
      const t = tr.translation ? new Vector3(...evalTrack(tr.translation, time)) : e.t.clone()
      const r = tr.rotation ? new Quaternion(...evalTrack(tr.rotation, time)).normalize() : e.r.clone()
      const s = tr.scale ? new Vector3(...evalTrack(tr.scale, time)) : e.s.clone()
      pose.set(name, { t, r, s })
    }
    local.push(pose)
  }
  return { duration, frames, fps: (frames - 1) / duration, times, local, animated: new Set(tracks.keys()), tracks }
}

/** FK: local pose map → world { m: Matrix4, q: Quaternion, p: Vector3 } per node. */
export function worldPose(skel, pose) {
  const world = new Map()
  for (const name of skel.order) {
    const e = skel.nodes.get(name), l = pose.get(name)
    const m = new Matrix4().compose(l.t, l.r, l.s)
    if (e.parent) m.premultiply(world.get(e.parent).m)
    const p = new Vector3(), q = new Quaternion(), s = new Vector3()
    m.decompose(p, q, s)
    world.set(name, { m, q, p })
  }
  return world
}

export function restPose(skel) {
  const pose = new Map()
  for (const name of skel.order) { const e = skel.nodes.get(name); pose.set(name, { t: e.t.clone(), r: e.r.clone(), s: e.s.clone() }) }
  return pose
}
