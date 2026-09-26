// NodeIO check of the final animation GLBs against the character GLBs.
//   node asset-pipeline/anim/verify.mjs            → exit code 1 on any failure
// Checks: no mesh/skin in anim.glb; every channel target name exists (exactly) in rig.glb and rig.optimized.glb;
// every anim.glb node has the same parent and rest TRS as the character node of that name; three.js-sanitised track
// names are unique and match the character's sanitised node names; sampler data is finite, times increase,
// quaternions are unit length; translation only on the hips.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PropertyBinding } from 'three'
import { io } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const TOL = 1e-5
const failures = []
const fail = (msg) => failures.push(msg)

function nodeTable(doc) {
  const table = new Map()
  const visit = (n, parent) => {
    table.set(n.getName(), { parent, t: n.getTranslation(), r: n.getRotation(), s: n.getScale(), mesh: !!n.getMesh(), skin: !!n.getSkin() })
    for (const c of n.listChildren()) visit(c, n.getName())
  }
  for (const scene of doc.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n, null)
  return table
}
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= TOL)
const sameRot = (a, b) => near(a, b) || near(a, b.map((v) => -v))

for (const c of ['male', 'female']) {
  const dir = path.join(ROOT, 'public/assets/characters', c)
  const animFile = path.join(dir, 'anim.glb')
  const anim = await io.read(animFile)
  const A = nodeTable(anim)
  const root = anim.getRoot()
  if (root.listMeshes().length || root.listSkins().length) fail(`${c}: anim.glb contains meshes/skins`)
  const chars = {}
  for (const f of ['rig.glb', 'rig.optimized.glb']) chars[f] = nodeTable(await io.read(path.join(dir, f)))

  // node names, hierarchy and rest TRS
  for (const [f, C] of Object.entries(chars)) {
    const charSanitised = new Set([...C.keys()].map((n) => PropertyBinding.sanitizeNodeName(n)))
    for (const [name, a] of A) {
      const b = C.get(name)
      if (!b) { fail(`${c}: node "${name}" missing in ${f}`); continue }
      if (a.parent !== b.parent) fail(`${c}: "${name}" parent ${a.parent} ≠ ${b.parent} in ${f}`)
      if (!near(a.t, b.t) || !sameRot(a.r, b.r) || !near(a.s, b.s)) fail(`${c}: "${name}" rest TRS differs from ${f}`)
      if (!charSanitised.has(PropertyBinding.sanitizeNodeName(name))) fail(`${c}: sanitised "${name}" not in ${f}`)
    }
  }

  // channels
  const rows = []
  const targets = new Set()
  for (const a of root.listAnimations()) {
    let dur = 0, keys = 0
    const seen = new Set()
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode(), p = ch.getTargetPath(), s = ch.getSampler()
      const name = node.getName()
      targets.add(name)
      const track = `${PropertyBinding.sanitizeNodeName(name)}.${p === 'rotation' ? 'quaternion' : p === 'translation' ? 'position' : p}`
      if (seen.has(track)) fail(`${c}/${a.getName()}: duplicate track ${track}`)
      seen.add(track)
      for (const [f, C] of Object.entries(chars)) if (!C.has(name)) fail(`${c}/${a.getName()}: target "${name}" not in ${f}`)
      if (p === 'translation' && name !== 'mixamorig:Hips') fail(`${c}/${a.getName()}: translation on ${name}`)
      if (p !== 'rotation' && p !== 'translation') fail(`${c}/${a.getName()}: unexpected path ${p}`)
      const t = s.getInput().getArray(), v = s.getOutput().getArray()
      for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) { fail(`${c}/${a.getName()}: non-increasing times on ${track}`); break }
      if (![...v].every(Number.isFinite)) fail(`${c}/${a.getName()}: non-finite values on ${track}`)
      if (p === 'rotation') for (let i = 0; i < v.length; i += 4) {
        const len = Math.hypot(v[i], v[i + 1], v[i + 2], v[i + 3])
        if (Math.abs(len - 1) > 1e-2) { fail(`${c}/${a.getName()}: non-unit quaternion on ${track} (${len.toFixed(4)})`); break }
      }
      dur = Math.max(dur, t[t.length - 1]); keys += t.length
    }
    rows.push({ clip: a.getName(), channels: a.listChannels().length, duration: +dur.toFixed(4), keys })
  }
  const json = JSON.parse(fs.readFileSync(animFile).subarray(20, 20 + fs.readFileSync(animFile).readUInt32LE(12)))
  process.stdout.write(`${c}: ${path.relative(ROOT, animFile).replace(/\\/g, '/')} ${fs.statSync(animFile).size} bytes, ` +
    `${A.size} nodes, extensionsRequired=${JSON.stringify(json.extensionsRequired ?? [])}\n`)
  for (const r of rows) process.stdout.write(`  ${r.clip.padEnd(15)} ${String(r.channels).padStart(3)} channels  ${r.duration.toFixed(3)} s  ${r.keys} keys\n`)
  process.stdout.write(`  channel targets (${targets.size}): ${[...targets].join(', ')}\n`)
}

if (failures.length) {
  process.stdout.write(`FAIL (${failures.length})\n${failures.map((f) => '  ' + f).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('OK: all channel targets and rest transforms match rig.glb and rig.optimized.glb\n')
