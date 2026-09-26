// Kun runtime files from the rigged Blender export:
//   LOD0 public/assets/colossi/kun.glb       skinned, full mesh (~38.5k tris), base 2048 / normal 2048 / ORM 1024 WebP
//   LOD1 public/assets/colossi/kun.lod1.glb  skinned, same skeleton + clips, ≤ 8k tris, base 1024 / normal 512 / ORM 512
// The base colour is graded toward deep slate blue-grey (only the cyan/blue hide hues; jade, ivory and gold are kept)
// (the gold inlay is too thin/desaturated in the Tripo texture to mask reliably, so ORM is passed through).
// Also writes meshopt-free twins in asset-pipeline/kun/ (preview_lod*.glb) so Blender can render the final textures.
//
// node asset-pipeline/kun/optimize_kun.mjs [src.glb]
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, prune, resample, simplify, textureCompress, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '../..')
const SRC = process.argv[2] ?? path.join(DIR, 'kun_rigged.glb')
const OUT = path.join(ROOT, 'public/assets/colossi')
const LODS = [
  { name: 'kun.glb', preview: 'preview_lod0.glb', base: 2048, normal: 2048, orm: 1024, tris: null },
  { name: 'kun.lod1.glb', preview: 'preview_lod1.glb', base: 1024, normal: 512, orm: 512, tris: 8000 },
]

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const countTris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0)
const sstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}
function hsv(r, g, b) {
  const mx = Math.max(r, g, b)
  const d = mx - Math.min(r, g, b)
  let h = 0
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, mx > 0 ? d / mx : 0, mx]
}
function rgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const k = Math.floor(h / 60) % 6
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k]
  return [r + m, g + m, b + m]
}
const hueWin = (h, a0, a1, b0, b1) => sstep(a0, a1, h) * (1 - sstep(b0, b1, h))
// hide hues (cyan/blue): shift toward slate (≈212°), desaturate, deepen slightly
const grade = (r, g, b) => {
  const [h, s, v] = hsv(r, g, b)
  const w = hueWin(h, 165, 180, 228, 245) * sstep(0.12, 0.25, s)
  if (w <= 0) return [r, g, b]
  return rgb(h + (212 - h) * 0.45 * w, s * (1 - 0.32 * w), v * (1 - 0.07 * w))
}

async function rawOf(buf, size) {
  return sharp(buf).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}
const toPng = (data, size) => sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()

async function prepareTextures(doc, lod, srcImages) {
  const mat = doc.getRoot().listMaterials()[0]
  const base = mat.getBaseColorTexture()
  const normal = mat.getNormalTexture()
  const orm = mat.getMetallicRoughnessTexture()
  // base colour grade
  const B = await rawOf(srcImages.base, lod.base)
  const d = B.data
  for (let i = 0; i < d.length; i += 3) {
    const [r, g, b] = grade(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
    d[i] = Math.round(Math.min(Math.max(r, 0), 1) * 255)
    d[i + 1] = Math.round(Math.min(Math.max(g, 0), 1) * 255)
    d[i + 2] = Math.round(Math.min(Math.max(b, 0), 1) * 255)
  }
  base.setImage(await toPng(d, lod.base)).setMimeType('image/png').setName('kun_basecolor').setURI('kun_basecolor.png')
  // ORM: lift roughness (G) so weathered hide and stone barnacles don't read wet/plastic; metallic stays texture-only
  const O = await rawOf(srcImages.orm, lod.orm)
  for (let i = 1; i < O.data.length; i += 3) O.data[i] = Math.round(255 * (0.3 + 0.7 * (O.data[i] / 255)))
  orm.setImage(await toPng(O.data, lod.orm)).setMimeType('image/png').setName('kun_orm').setURI('kun_orm.png')
  const N = await rawOf(srcImages.normal, lod.normal)
  normal.setImage(await toPng(N.data, lod.normal)).setMimeType('image/png').setName('kun_normal').setURI('kun_normal.png')
  mat.setName('kun_hide').setMetallicFactor(0) // ORM metallic is ~0.02 everywhere: pure dielectric
}

async function build(lod) {
  const doc = await io.read(SRC)
  const mat = doc.getRoot().listMaterials()[0]
  const srcImages = {
    base: Buffer.from(mat.getBaseColorTexture().getImage()),
    normal: Buffer.from(mat.getNormalTexture().getImage()),
    orm: Buffer.from(mat.getMetallicRoughnessTexture().getImage()),
  }
  await prepareTextures(doc, lod, srcImages)
  await doc.transform(dedup(), weld(), resample({ tolerance: 1e-5 }), prune())
  const before = countTris(doc)
  if (lod.tris) {
    // search the ratio that lands just under the triangle budget (error unconstrained, seams welded first)
    let lo = 0.05, hi = 0.5, best = null
    for (let it = 0; it < 12; it++) {
      const r = (lo + hi) / 2
      const trial = await io.read(SRC)
      await trial.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: r, error: 1, lockBorder: false }))
      const t = countTris(trial)
      if (t <= lod.tris) { best = r; lo = r } else hi = r
      if (best && lod.tris - t < lod.tris * 0.03 && t <= lod.tris) break
    }
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: best, error: 1, lockBorder: false }), prune())
    console.log(`${lod.name}: simplify ratio ${best.toFixed(4)} → ${countTris(doc)} tris (from ${before})`)
  }
  // Blender-importable twin (plain accessors, WebP textures) for preview renders
  const webp = [
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, quality: 92, effort: 70 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, quality: 95, effort: 70 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughnessTexture$/, quality: 90, effort: 70 }),
  ]
  await doc.transform(...webp)
  await io.write(path.join(DIR, lod.preview), doc)
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }))
  const out = path.join(OUT, lod.name)
  await io.write(out, doc)
  const tex = doc.getRoot().listTextures().map((t) => `${t.getName()} ${t.getSize().join('x')} ${(t.getImage().byteLength / 1e3).toFixed(0)} kB`)
  console.log(`${lod.name}: ${countTris(doc)} tris, ${(statSync(out).size / 1e6).toFixed(2)} MB | ${tex.join(' | ')}`)
  return statSync(out).size
}

let total = 0
for (const lod of LODS) total += await build(lod)
console.log(`total ${(total / 1e6).toFixed(2)} MB`)
