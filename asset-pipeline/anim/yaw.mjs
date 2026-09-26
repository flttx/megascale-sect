// Heading (yaw of hips forward axis in the ground plane) per frame.
import { io, skeletonOf, sampleAnimation, worldPose, restPose } from './lib.mjs'
import { Vector3 } from 'three'
const doc = await io.read(process.argv[2]); const skel = skeletonOf(doc)
const s = sampleAnimation(doc, doc.getRoot().listAnimations()[0], skel)
const rw = worldPose(skel, restPose(skel))
const out = []
s.local.forEach((p, f) => { const w = worldPose(skel, p); const q = w.get('Pelvis').q.clone().multiply(rw.get('Pelvis').q.clone().invert()); const fwd = new Vector3(1, 0, 0).applyQuaternion(q); if (f % 4 === 0) out.push(`${f}:${(Math.atan2(-fwd.z, fwd.x) * 57.3).toFixed(0)}`) })
console.log(out.join(' '))
