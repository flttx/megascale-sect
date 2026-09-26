import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const f = process.argv[2]
const doc = await io.read(f)
const root = doc.getRoot()
const fmt = (a) => a.map((v) => v.toFixed(3)).join(',')
function walk(n, d) {
  console.log('  '.repeat(d) + n.getName(), 'T[' + fmt(n.getTranslation()) + '] R[' + fmt(n.getRotation()) + '] S[' + fmt(n.getScale()) + ']', n.getMesh() ? 'MESH' : '', n.getSkin() ? 'SKIN' : '')
  for (const c of n.listChildren()) walk(c, d + 1)
}
for (const s of root.listScenes()) for (const n of s.listChildren()) walk(n, 0)
for (const a of root.listAnimations()) {
  const chs = a.listChannels()
  let dur = 0
  for (const s of a.listSamplers()) { const t = s.getInput().getArray(); dur = Math.max(dur, t[t.length - 1]); }
  const s0 = a.listSamplers()[0]
  console.log('ANIM', a.getName(), 'channels', chs.length, 'dur', dur.toFixed(3), 'keys', s0.getInput().getCount(), 'interp', s0.getInterpolation())
  if (process.argv[3]) for (const c of chs) console.log('   ', c.getTargetNode()?.getName(), c.getTargetPath(), c.getSampler().getInput().getCount())
}
console.log('skins', root.listSkins().map((s) => s.getName() + ':' + s.listJoints().length))
