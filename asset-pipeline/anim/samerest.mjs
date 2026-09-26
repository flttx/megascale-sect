import { io, skeletonOf } from './lib.mjs'
for (const c of ['male', 'female']) {
  const a = skeletonOf(await io.read(`public/assets/characters/${c}/rig.glb`)), b = skeletonOf(await io.read(`public/assets/characters/${c}/rig.optimized.glb`))
  let dev = 0, missing = []
  for (const n of a.order) { const x = a.nodes.get(n), y = b.nodes.get(n); if (!y) { missing.push(n); continue } dev = Math.max(dev, x.t.distanceTo(y.t), x.r.angleTo(y.r), x.s.distanceTo(y.s)) }
  console.log(c, 'nodes', a.order.length, b.order.length, 'missing', missing, 'maxdev', dev.toExponential(2), 'mesh node', a.order.find((n) => a.nodes.get(n).mesh), b.order.find((n) => b.nodes.get(n).mesh))
}
