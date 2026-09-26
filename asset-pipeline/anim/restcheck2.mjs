import { io, skeletonOf, worldPose, restPose } from './lib.mjs'
import { MAP, PREFIX, loadTarget } from './retarget.mjs'
const c = process.argv[2] ?? 'male'
const T = await loadTarget(`public/assets/characters/${c}/rig.optimized.glb`)
const doc = await io.read(`asset-pipeline/anim/tripo/${c}/walk.glb`)
const skel = skeletonOf(doc)
const W = worldPose(skel, restPose(skel))
const f = (v) => [v.x, v.y, v.z].map((x) => x.toFixed(3)).join(',')
for (const [b, s] of Object.entries(MAP)) console.log(b.padEnd(14), f(T.restW.get(PREFIX + b).p), '|', s.padEnd(12), f(W.get(s).p), 'dev', W.get(s).p.distanceTo(T.restW.get(PREFIX + b).p).toFixed(4))
for (const n of ['NeckTwist01', 'L_UpperarmTwist01', 'L_ForearmTwist02']) console.log(n, f(W.get(n).p))
