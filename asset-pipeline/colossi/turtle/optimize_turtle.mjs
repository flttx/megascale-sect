// 巨鳌 runtime files from the rigged Blender export (build_turtle.py):
//   LOD0 public/assets/colossi/turtle.glb       skinned, full mesh, same textures as the static LOD0
//   LOD1 public/assets/colossi/turtle.lod1.glb  skinned, same skeleton + clip, triangles and textures of the static LOD1
// Textures and material factors are taken over unchanged from the static LODs (backed up in work/ before the first
// run), so the look does not shift and nothing is compressed twice. Checks each output's skin, clip and size.
//
// node asset-pipeline/colossi/turtle/optimize_turtle.mjs [rigged.glb]
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, prune, resample, simplify, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '../../..')
const SRC = process.argv[2] ?? path.join(DIR, 'work/turtle_rigged.glb')
const OUT = path.join(ROOT, 'public/assets/colossi')
const LODS = [
  { name: 'turtle.glb', look: path.join(DIR, 'work/orig_lod0.glb'), simplify: false },
  { name: 'turtle.lod1.glb', look: path.join(DIR, 'work/orig_lod1.glb'), simplify: true },
]
const SLOTS = ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const countTris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0)

/** The static LOD's textures (images as shipped) and factors onto the rigged material. */
function takeLook(doc, look) {
  const from = look.getRoot().listMaterials()[0], to = doc.getRoot().listMaterials()[0]
  if (!from || !to) throw new Error('turtle material missing')
  for (const slot of SLOTS) {
    const src = from[`get${slot}Texture`]()
    const dst = to[`get${slot}Texture`]()
    if (!src) {
      if (dst) to[`set${slot}Texture`](null)
      continue
    }
    const tex = (dst ?? doc.createTexture()).setImage(src.getImage()).setMimeType(src.getMimeType()).setName(src.getName()).setURI('')
    to[`set${slot}Texture`](tex)
  }
  to.setName(from.getName()).setBaseColorFactor(from.getBaseColorFactor()).setMetallicFactor(from.getMetallicFactor())
    .setRoughnessFactor(from.getRoughnessFactor()).setNormalScale(from.getNormalScale()).setOcclusionStrength(from.getOcclusionStrength())
    .setEmissiveFactor(from.getEmissiveFactor()).setAlphaMode(from.getAlphaMode()).setDoubleSided(from.getDoubleSided())
  // Textures shared by two slots (ORM in metallicRoughness + occlusion) end up as one after dedup().
}

async function build(lod) {
  const [doc, look] = await Promise.all([io.read(SRC), io.read(lod.look)])
  takeLook(doc, look)
  await doc.transform(dedup(), weld(), resample({ tolerance: 1e-5 }), prune())
  const before = countTris(doc)
  if (lod.simplify) {
    const target = countTris(look)
    // Search the ratio that lands just under the static LOD1's triangle count (seams welded first).
    let lo = 0.05, hi = 0.8, best = null
    for (let it = 0; it < 14; it++) {
      const r = (lo + hi) / 2
      const trial = await io.read(SRC)
      await trial.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: r, error: 1, lockBorder: false }))
      const t = countTris(trial)
      if (t <= target) { best = r; lo = r } else hi = r
      if (best && target - t < target * 0.02 && t <= target) break
    }
    if (best === null) throw new Error('no simplify ratio reaches the LOD1 budget')
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: best, error: 1, lockBorder: false }), prune())
    console.log(`${lod.name}: simplify ratio ${best.toFixed(4)} → ${countTris(doc)} tris (from ${before}, static LOD1 ${target})`)
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }))
  const out = path.join(OUT, lod.name)
  await io.write(out, doc)

  const check = await io.read(out)
  const root = check.getRoot()
  const skin = root.listSkins()[0], clip = root.listAnimations().find((a) => a.getName() === 'swim')
  const prim = root.listMeshes()[0]?.listPrimitives()[0]
  if (!skin || skin.listJoints().length !== 15) throw new Error(`${lod.name}: expected a 15-joint skin`)
  if (!clip) throw new Error(`${lod.name}: swim clip missing`)
  if (!prim?.getAttribute('JOINTS_0') || !prim.getAttribute('WEIGHTS_0')) throw new Error(`${lod.name}: skin attributes missing`)
  const duration = Math.max(...clip.listSamplers().map((s) => s.getInput().getMax([])[0]))
  const tex = root.listTextures().map((t) => `${t.getName()} ${t.getSize().join('x')} ${t.getMimeType()} ${(t.getImage().byteLength / 1e3).toFixed(0)} kB`)
  const size = statSync(out).size
  console.log(`${lod.name}: ${countTris(check)} tris, ${skin.listJoints().length} joints, swim ${duration.toFixed(2)} s, ${(size / 1e6).toFixed(2)} MB | ${tex.join(' | ')}`)
  return size
}

let total = 0
for (const lod of LODS) total += await build(lod)
console.log(`total ${(total / 1e6).toFixed(2)} MB`)
