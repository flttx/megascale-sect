import { loadTarget, retarget } from './retarget.mjs'
for (const c of ['male', 'female']) {
  const T = await loadTarget(`public/assets/characters/${c}/rig.optimized.glb`)
  const r = await retarget(`asset-pipeline/anim/tripo/${c}/walk.glb`, T)
  console.log(c, 'rest joint deviation (units):', r.restDev.toFixed(5), 'frames', r.frames.length)
}
