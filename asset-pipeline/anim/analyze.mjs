// Report per-source-clip duration, root/hip travel, loop seam error and foot heights.
import { io, skeletonOf, sampleAnimation, worldPose } from './lib.mjs'
import fs from 'node:fs'
const dir = process.argv[2]
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb') && f !== 'rig_tripo.glb')) {
  const doc = await io.read(`${dir}/${f}`)
  const skel = skeletonOf(doc)
  for (const anim of doc.getRoot().listAnimations()) {
    const s = sampleAnimation(doc, anim, skel)
    const W = s.local.map((p) => worldPose(skel, p))
    const hip0 = W[0].get('Hip').p, hipN = W[s.frames - 1].get('Hip').p
    const rootRot = s.tracks.get('Root')?.rotation
    let rootVar = 0
    if (rootRot) { const v = rootRot.vals; for (let i = 0; i < v.length; i++) rootVar = Math.max(rootVar, Math.abs(v[i] - v[i % 4])) }
    // Loop seam: max angle difference of local rotations between first and last frame
    let seam = 0
    for (const n of skel.order) { const a = s.local[0].get(n).r, b = s.local[s.frames - 1].get(n).r; seam = Math.max(seam, a.angleTo(b)) }
    let minY = [Infinity, Infinity], maxY = [-Infinity, -Infinity], hipMin = Infinity, hipMax = -Infinity
    for (const w of W) {
      ;['L_Foot', 'R_Foot'].forEach((k, i) => { const y = w.get(k).p.y; minY[i] = Math.min(minY[i], y); maxY[i] = Math.max(maxY[i], y) })
      hipMin = Math.min(hipMin, w.get('Hip').p.y); hipMax = Math.max(hipMax, w.get('Hip').p.y)
    }
    const d = hipN.clone().sub(hip0)
    console.log(f.padEnd(20), anim.getName().padEnd(16), 'dur', s.duration.toFixed(3), 'frames', s.frames, 'hipTravel', [d.x, d.y, d.z].map((v) => v.toFixed(3)).join(','), 'speed', (Math.hypot(d.x, d.z) / s.duration).toFixed(3), 'hipY', hipMin.toFixed(3), hipMax.toFixed(3), 'footY L', minY[0].toFixed(3), maxY[0].toFixed(3), 'R', minY[1].toFixed(3), maxY[1].toFixed(3), 'seam°', (seam * 57.3).toFixed(1), 'rootVar', rootVar.toFixed(4))
  }
}
