// Validates public/assets/vegetation/*.glb against the vegetation contract and writes
// artifacts/assets/vegetation/report.json.   node asset-pipeline/vegetation/validate.mjs
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DIR = path.join(ROOT, 'public', 'assets', 'vegetation')
const REPORT = path.join(ROOT, 'artifacts', 'assets', 'vegetation', 'report.json')
const HEIGHT = { pine_0: 7, pine_1: 13, pine_2: 22 }

await MeshoptDecoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }
const r3 = (v) => Math.round(v * 1000) / 1000

function channelStats(acc) {
  const n = acc.getCount()
  const el = []
  const mn = [Infinity, Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity, -Infinity]
  const sum = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el)
    for (let c = 0; c < el.length; c++) {
      mn[c] = Math.min(mn[c], el[c]); mx[c] = Math.max(mx[c], el[c]); sum[c] += el[c]
    }
  }
  return { min: mn.slice(0, el.length).map(r3), max: mx.slice(0, el.length).map(r3), mean: sum.slice(0, el.length).map((s) => r3(s / n)) }
}

const report = {}
const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.glb')).sort()
for (const file of files) {
  const tree = file.split('.')[0]
  const lod1 = file.includes('.lod1.')
  const buf = await fs.readFile(path.join(DIR, file))
  const doc = await io.readBinary(buf)
  const root = doc.getRoot()
  const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0])
  const entry = { bytes: buf.byteLength, triangles: 0, bounds: { min: b.min.map(r3), max: b.max.map(r3) }, extensions: root.listExtensionsUsed().map((e) => e.extensionName), primitives: [], textures: [] }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      const tris = prim.getIndices().getCount() / 3
      entry.triangles += tris
      const col = prim.getAttribute('COLOR_0')
      const p = {
        material: mat?.getName(), alphaMode: mat?.getAlphaMode(), alphaCutoff: mat?.getAlphaCutoff(), doubleSided: mat?.getDoubleSided(),
        triangles: tris, vertices: prim.getAttribute('POSITION').getCount(),
        attributes: prim.listSemantics(),
        color0: col ? { type: col.getComponentType(), normalized: col.getNormalized(), ...channelStats(col) } : null,
        baseColorTexture: !!mat?.getBaseColorTexture(), normalTexture: !!mat?.getNormalTexture(),
      }
      entry.primitives.push(p)
      check(['bark', 'needles'].includes(p.material), `${file}: unexpected material ${p.material}`)
      check(p.attributes.includes('COLOR_0') && p.attributes.includes('NORMAL') && p.attributes.includes('TEXCOORD_0'), `${file}/${p.material}: missing attribute`)
      check(p.baseColorTexture && p.normalTexture, `${file}/${p.material}: missing texture`)
      if (p.material === 'needles') {
        check(p.alphaMode === 'MASK' && Math.abs(p.alphaCutoff - 0.5) < 1e-6 && p.doubleSided, `${file}: needles flags`)
        check(p.color0 && p.color0.max[2] > 0.8 && p.color0.min[2] < 0.2, `${file}: needles COLOR_0.B phase not spread`)
      } else if (p.material === 'bark') {
        check(p.alphaMode === 'OPAQUE' && !p.doubleSided, `${file}: bark flags`)
        check(p.color0 && p.color0.max[2] < 0.01, `${file}: bark COLOR_0.B should be 0`)
      }
      check(p.color0 && p.color0.min[1] >= -0.001 && p.color0.max[1] <= 1.001, `${file}/${p.material}: COLOR_0.G out of range`)
    }
  }
  for (const tex of root.listTextures()) {
    const meta = await sharp(Buffer.from(tex.getImage())).metadata()
    entry.textures.push({ name: tex.getName(), mime: tex.getMimeType(), size: [meta.width, meta.height], channels: meta.channels, bytes: tex.getImage().byteLength })
    check(tex.getMimeType() === 'image/webp', `${file}: texture ${tex.getName()} not WebP`)
    check(meta.width <= 1024 && meta.height <= 1024, `${file}: texture ${tex.getName()} > 1024`)
  }
  check(root.listMaterials().length === 2, `${file}: expected 2 materials`)
  check(entry.triangles <= (lod1 ? 2500 : 12000), `${file}: ${entry.triangles} triangles over budget`)
  if (!lod1) check(buf.byteLength <= 1.5 * 1024 * 1024, `${file}: ${buf.byteLength} bytes > 1.5 MB`)
  check(Math.abs(b.max[1] - HEIGHT[tree]) < 0.05, `${file}: top y ${r3(b.max[1])} != ${HEIGHT[tree]}`)
  check(b.min[1] < 0.01, `${file}: nothing reaches the ground`)
  report[file] = entry
  console.log(`${file.padEnd(18)} ${(buf.byteLength / 1024).toFixed(0).padStart(5)} KB  ${String(entry.triangles).padStart(6)} tris  `
    + `min [${entry.bounds.min.join(', ')}]  max [${entry.bounds.max.join(', ')}]`)
  for (const p of entry.primitives) {
    console.log(`   ${p.material.padEnd(8)} ${String(p.triangles).padStart(6)} tris  ${p.alphaMode}${p.alphaMode === 'MASK' ? ' ' + p.alphaCutoff : ''} ds=${p.doubleSided}  `
      + `${p.attributes.join(',')}  COLOR_0 min ${JSON.stringify(p.color0.min)} max ${JSON.stringify(p.color0.max)} mean ${JSON.stringify(p.color0.mean)}`)
  }
  console.log('   textures', entry.textures.map((t) => `${t.name} ${t.size.join('x')}x${t.channels} ${(t.bytes / 1024).toFixed(0)}KB`).join(' | '))
}
await fs.mkdir(path.dirname(REPORT), { recursive: true })
await fs.writeFile(REPORT, `${JSON.stringify({ errors, files: report }, null, 2)}\n`)
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ${errors.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall vegetation checks passed')
