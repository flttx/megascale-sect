// Validate the final rock GLBs in public/assets/environment/rocks/.
//   node asset-pipeline/rocks/validate.mjs
// Checks names, triangle counts, bounds, attributes, extensions and position precision; exits 1 on failure.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(here, '..', '..', 'public', 'assets', 'environment', 'rocks')
const failures = []
const fail = (msg) => failures.push(msg)
const range = (label, v, lo, hi) => {
  if (!(v >= lo && v <= hi)) fail(`${label} = ${Number(v).toFixed(2)} outside [${lo}, ${hi}]`)
}

const SPECS = {
  'pillars.glb': { names: [0, 1, 2, 3, 4, 5].map((i) => `pillar_${i}`), tris: [12000, 25000], kind: 'pillar' },
  'pillars.lod1.glb': { names: [0, 1, 2, 3, 4, 5].map((i) => `pillar_${i}`), tris: [2200, 2800], kind: 'pillar' },
  'islands.glb': { names: [0, 1, 2, 3].map((i) => `isle_${i}`), tris: [10000, 20000], debrisTris: [300, 1500], kind: 'island' },
  'islands.lod1.glb': { names: [0, 1, 2, 3].map((i) => `isle_${i}`), tris: [1700, 2300], debrisTris: [80, 400], kind: 'island' },
  'boulders.glb': { names: [0, 1, 2, 3, 4, 5].map((i) => `boulder_${i}`), tris: [900, 2100], kind: 'boulder' },
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

function meshStats(node) {
  const m = node.getWorldMatrix()
  const mesh = node.getMesh()
  let tris = 0
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const pts = []
  const col = { sum: [0, 0, 0], min: [1, 1, 1], max: [0, 0, 0], n: 0 }
  const attrs = new Set()
  let step = 0
  for (const prim of mesh.listPrimitives()) {
    prim.listSemantics().forEach((s) => attrs.add(s))
    const pos = prim.getAttribute('POSITION')
    const idx = prim.getIndices()
    tris += (idx ? idx.getCount() : pos.getCount()) / 3
    const p = [0, 0, 0]
    for (let i = 0; i < pos.getCount(); i++) {
      const w = transformPoint(m, pos.getElement(i, p))
      pts.push(w)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], w[k])
        hi[k] = Math.max(hi[k], w[k])
      }
    }
    // quantization step in metres: node scale / (2^(bits-1) - 1) for normalized signed ints
    const sx = Math.hypot(m[0], m[1], m[2])
    const bits = pos.getComponentSize() * 8
    if (pos.getNormalized()) step = Math.max(step, sx / (2 ** (bits - 1) - 1))
    else if (bits <= 16) step = Math.max(step, sx)
    const c = prim.getAttribute('COLOR_0')
    if (c) {
      const e = []
      for (let i = 0; i < c.getCount(); i++) {
        c.getElement(i, e)
        for (let k = 0; k < 3; k++) {
          col.sum[k] += e[k]
          col.min[k] = Math.min(col.min[k], e[k])
          col.max[k] = Math.max(col.max[k], e[k])
        }
        col.n++
      }
      col.type = `${c.getType()}/${c.getComponentType()}${c.getNormalized() ? 'n' : ''}`
    }
  }
  return { tris, lo, hi, pts, col, attrs, step }
}

const f1 = (v) => v.toFixed(1)
const fmtB = (lo, hi) => `[${lo.map(f1).join(', ')}] .. [${hi.map(f1).join(', ')}]`

async function main() {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  for (const [file, spec] of Object.entries(SPECS)) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      fail(`${file}: missing`)
      continue
    }
    const doc = await io.read(path)
    const root = doc.getRoot()
    const used = root.listExtensionsUsed().map((e) => e.extensionName)
    const required = root.listExtensionsRequired().map((e) => e.extensionName)
    console.log(`\n${file}  ${(statSync(path).size / 1024).toFixed(0)} KiB  extensions: ${used.join(', ')}`)
    for (const ext of ['EXT_meshopt_compression', 'KHR_mesh_quantization'])
      if (!required.includes(ext)) fail(`${file}: ${ext} not required`)
    if (root.listTextures().length) fail(`${file}: contains ${root.listTextures().length} textures`)
    const nodes = root.listNodes().filter((n) => n.getMesh())
    const byName = new Map(nodes.map((n) => [n.getName(), n]))
    for (const name of spec.names) if (!byName.has(name)) fail(`${file}: node ${name} missing`)
    for (const n of nodes) {
      const name = n.getName()
      if (n.getMesh().getName() !== name) fail(`${file}: node ${name} carries mesh ${n.getMesh().getName()}`)
      const debris = /^isle_\d+_debris_\d+$/.test(name)
      if (!spec.names.includes(name) && !debris) fail(`${file}: unexpected node ${name}`)
      const s = meshStats(n)
      const extras = n.getExtras()
      for (const a of ['POSITION', 'NORMAL', 'COLOR_0']) if (!s.attrs.has(a)) fail(`${file}/${name}: no ${a}`)
      for (const a of s.attrs) if (a.startsWith('TEXCOORD')) fail(`${file}/${name}: unexpected ${a}`)
      if (s.step > 0.03) fail(`${file}/${name}: position step ${s.step} m > 3 cm`)
      for (let k = 0; k < 3; k++) {
        if (s.col.min[k] < -1e-3 || s.col.max[k] > 1 + 1e-3) fail(`${file}/${name}: COLOR_0[${k}] outside 0..1`)
      }
      const cm = s.col.sum.map((v) => v / s.col.n)
      let extra = ''
      if (!debris) range(`${file}/${name} tris`, s.tris, ...spec.tris)
      if (spec.kind === 'pillar') {
        range(`${file}/${name} min y`, s.lo[1], -0.05, 0.05)
        range(`${file}/${name} height`, s.hi[1], 180, 420)
        const base = s.pts.filter((p) => p[1] < 3)
        const rBase = Math.max(...base.map((p) => Math.hypot(p[0], p[2])))
        const cx = (Math.min(...base.map((p) => p[0])) + Math.max(...base.map((p) => p[0]))) / 2
        const cz = (Math.min(...base.map((p) => p[2])) + Math.max(...base.map((p) => p[2]))) / 2
        range(`${file}/${name} base radius`, rBase, 25, 70)
        range(`${file}/${name} base centre offset`, Math.hypot(cx, cz), 0, 3)
        extra = `base r ${f1(rBase)} m, base centre (${f1(cx)}, ${f1(cz)}), pine points ${(extras.pine_points || []).length / 3}`
      } else if (spec.kind === 'island' && !debris) {
        const depth = -s.lo[1]
        range(`${file}/${name} depth`, depth, 60, 160)
        range(`${file}/${name} top diameter`, 2 * extras.rim_radius_mean, 40, 130)
        range(`${file}/${name} top y max (no boulders)`, extras.top_y_max, -1.5, 1.5)
        range(`${file}/${name} top y min`, extras.top_y_min, -1.5, 1.5)
        // mesh check of the walkable top: vertices inside 0.9 x the smallest rim radius and above -4 m
        // (rim boulders excluded by the 1.6 m cut) must sit within +-1.5 m of y=0
        const inner = s.pts.filter((p) => Math.hypot(p[0], p[2]) < 0.9 * extras.rim_radius_min && p[1] > -4)
        const top = inner.filter((p) => p[1] < 1.6)
        const ty = top.map((p) => p[1])
        const tMin = Math.min(...ty)
        const tMax = Math.max(...ty)
        range(`${file}/${name} mesh top y min`, tMin, -1.5, 1.5)
        extra = `depth ${f1(depth)} m, rim r ${extras.rim_radius_min}/${extras.rim_radius_mean}/${extras.rim_radius_max}, top y ${extras.top_y_min}..${extras.top_y_max}, mesh top verts ${top.length} y ${tMin.toFixed(2)}..${tMax.toFixed(2)} (+${inner.length - top.length} boulder verts), debris ${(extras.debris || []).length}`
      } else if (debris) {
        const parent = extras.parent_island
        if (!parent || !byName.has(parent)) fail(`${file}/${name}: parent_island ${parent} missing`)
        const off = extras.offset || [0, 0, 0]
        const inside = s.lo.every((v, k) => v - 0.5 <= off[k]) && s.hi.every((v, k) => v + 0.5 >= off[k] - 30)
        if (!inside) fail(`${file}/${name}: bounds do not surround its offset ${off}`)
        range(`${file}/${name} tris`, s.tris, ...spec.debrisTris)
        extra = `offset (${off.map(f1).join(', ')}) of ${parent}`
      } else if (spec.kind === 'boulder') {
        const size = Math.max(s.hi[0] - s.lo[0], s.hi[1] - s.lo[1], s.hi[2] - s.lo[2])
        range(`${file}/${name} size`, size, 2, 12.5)
        extra = `size ${f1(size)} m`
      }
      console.log(
        `  ${name.padEnd(17)} tris ${String(s.tris).padStart(6)}  bounds ${fmtB(s.lo, s.hi)}  step ${(s.step * 1000).toFixed(1)} mm` +
          `  COLOR_0 ${s.col.type} mean RGB ${cm.map((v) => v.toFixed(2)).join('/')}  ${extra}`,
      )
    }
  }
  if (failures.length) {
    console.log(`\nFAIL (${failures.length})`)
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
