// Per-frame dump of hip + feet world positions for one clip.
import { io, skeletonOf, sampleAnimation, worldPose } from './lib.mjs'
const [file, ...bones] = process.argv.slice(2)
const doc = await io.read(file)
const skel = skeletonOf(doc)
const s = sampleAnimation(doc, doc.getRoot().listAnimations()[0], skel)
const list = bones.length ? bones : ['Hip', 'L_Foot', 'R_Foot', 'L_ToeBase', 'R_ToeBase']
s.local.forEach((p, f) => {
  const w = worldPose(skel, p)
  console.log(String(f).padStart(3), list.map((b) => b + ' ' + [w.get(b).p.x, w.get(b).p.y, w.get(b).p.z].map((v) => v.toFixed(3)).join(',')).join('  '))
})
