// Max local rotation angle of twist bones and of the parent bones, per clip.
import { io, skeletonOf, sampleAnimation } from './lib.mjs'
import fs from 'node:fs'
const dir = process.argv[2]
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb') && f !== 'rig_tripo.glb')) {
  const doc = await io.read(`${dir}/${f}`)
  const skel = skeletonOf(doc)
  const s = sampleAnimation(doc, doc.getRoot().listAnimations()[0], skel)
  const out = []
  for (const n of skel.order.filter((n) => /Twist/.test(n))) {
    let mx = 0
    for (const p of s.local) mx = Math.max(mx, p.get(n).r.angleTo(skel.nodes.get(n).r))
    if (mx > 0.05) out.push(`${n}:${(mx * 57.3).toFixed(0)}`)
  }
  console.log(f.padEnd(20), out.join(' ') || '(twists static)')
}
