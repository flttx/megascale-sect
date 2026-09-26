import { getBounds } from '@gltf-transform/core'
import { io } from './lib.mjs'
for (const c of ['male', 'female']) {
  const doc = await io.read(`public/assets/characters/${c}/rig.optimized.glb`)
  const b = getBounds(doc.getRoot().listScenes()[0])
  console.log(c, 'min', b.min.map((v) => v.toFixed(4)), 'max', b.max.map((v) => v.toFixed(4)), 'heightY', (b.max[1] - b.min[1]).toFixed(4))
}
