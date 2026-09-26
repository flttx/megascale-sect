// Optimize a cleaned colossus GLB into LOD0 + LOD1 (meshopt + WebP).
// node asset-pipeline/colossi/optimize.mjs <clean.glb> <outBase> --max-tris 60000 [--lod1 0.2] [--normal 2048] [--orm 1024] [--metal 0]
//   <outBase> e.g. public/assets/colossi/guardian_a  ->  guardian_a.glb, guardian_a.lod1.glb
//   --metal <f>   override metallicFactor (stone/bronze: Tripo sometimes paints metallic noise); omit to keep
import fs from 'node:fs/promises'
import path from 'node:path'
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, simplify, textureCompress, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const [src, outBase] = argv
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def }
const MAX_TRIS = Number(opt('max-tris', 60000))
const LOD1 = Number(opt('lod1', 0.2))
const NORMAL = Number(opt('normal', 2048))
const ORM = Number(opt('orm', 1024))
const METAL = opt('metal', null)

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const tris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives()
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)

const srcBytes = await fs.readFile(src)
const results = {}
for (const lod of [
  { key: 'lod0', file: `${outBase}.glb`, target: MAX_TRIS, base: 2048, normal: NORMAL, orm: ORM, error: 0.004 },
  { key: 'lod1', file: `${outBase}.lod1.glb`, target: null, ratio: LOD1, base: 1024, normal: Math.min(1024, NORMAL), orm: 512, error: 0.03 },
]) {
  const doc = await io.readBinary(srcBytes)
  if (METAL !== null) for (const m of doc.getRoot().listMaterials()) m.setMetallicFactor(Number(METAL))
  for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(false)
  const t0 = tris(doc)
  const ratio = lod.target ? Math.min(1, lod.target / t0) : lod.ratio
  const steps = [dedup()]
  if (ratio < 0.999) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: ratio * 0.985, error: lod.error }))
  steps.push(
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [lod.base, lod.base], quality: 88, effort: 70 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [lod.normal, lod.normal], quality: 90, effort: 70 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(metallicRoughnessTexture|occlusionTexture)$/, resize: [lod.orm, lod.orm], quality: 88, effort: 70 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }),
  )
  await doc.transform(...steps)
  await fs.mkdir(path.dirname(lod.file), { recursive: true })
  await io.write(lod.file, doc)
  const bytes = (await fs.stat(lod.file)).size
  const check = await io.read(lod.file)
  results[lod.key] = { file: lod.file, bytes, tris_in: t0, tris: tris(check) }
  console.log(`${lod.key}: ${lod.file} ${(bytes / 1e6).toFixed(2)} MB, tris ${t0} -> ${tris(check)}`)
}
