// Exploration: every downloaded Tripo clip retargeted in full (with root motion) → tmp/<c>_raw.glb
import fs from 'node:fs'
import { loadTarget, retarget, hipsLocal } from './retarget.mjs'
import { writeAnimGlb } from './writer.mjs'
const c = process.argv[2]
const only = process.argv[3]?.split(',')
const T = await loadTarget(`../../public/assets/characters/${c}/rig.optimized.glb`)
const dir = `tripo/${c}`
const clips = []
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb') && f !== 'rig_tripo.glb')) {
  const name = f.replace('.glb', '')
  if (only && !only.includes(name)) continue
  const r = await retarget(`${dir}/${f}`, T)
  const N = r.frames.length
  const rot = new Map()
  for (const b of r.frames[0].rot.keys()) {
    const arr = new Float32Array(N * 4)
    let prev = null
    r.frames.forEach((fr, i) => { const q = fr.rot.get(b).clone(); if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev = q; arr.set(q.toArray(), i * 4) })
    rot.set(b, arr)
  }
  const hips = new Float32Array(N * 3)
  r.frames.forEach((fr, i) => hips.set(hipsLocal(T, fr.hips).toArray(), i * 3))
  clips.push({ name, times: new Float32Array(r.times), rot, hips })
}
fs.mkdirSync('tmp', { recursive: true })
await writeAnimGlb(T, clips, `tmp/${c}_raw.glb`, { compress: false })
console.log('clips', clips.map((c) => c.name).join(','))
