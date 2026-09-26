// Optimise the Blender exports in raw/ into public/assets/vegetation/: WebP textures, meshopt
// geometry, explicit material flags (bark opaque; needles MASK 0.5 double-sided).
//   node asset-pipeline/vegetation/optimize.mjs
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const RAW = path.join(HERE, 'raw')
const OUT = path.join(ROOT, 'public', 'assets', 'vegetation')
const TREES = ['pine_0', 'pine_1', 'pine_2']

// Texture sizes per LOD: [bark base, bark normal, needles base, needles normal].
const SIZES = { lod0: [1024, 512, 1024, 512], lod1: [256, 128, 512, 256] }

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

function fixMaterials(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName()
    mat.setMetallicFactor(0)
    if (name === 'needles') {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.78)
    } else if (name === 'bark') {
      mat.setAlphaMode('OPAQUE').setDoubleSided(false).setRoughnessFactor(0.92)
    } else {
      throw new Error(`unexpected material ${name}`)
    }
  }
}

/** Resize + WebP per material/slot. Textures are matched by the material that references them. */
function compressFor(doc, sizes) {
  const [barkBase, barkNormal, leafBase, leafNormal] = sizes
  const steps = []
  const bark = doc.getRoot().listMaterials().find((m) => m.getName() === 'bark')
  const leaf = doc.getRoot().listMaterials().find((m) => m.getName() === 'needles')
  const tag = (tex, n) => tex && tex.setName(n)
  tag(bark?.getBaseColorTexture(), 'bark_base')
  tag(bark?.getNormalTexture(), 'bark_normal')
  tag(leaf?.getBaseColorTexture(), 'needles_base')
  tag(leaf?.getNormalTexture(), 'needles_normal')
  const job = (pattern, size, quality, extra = {}) => textureCompress({
    encoder: sharp, targetFormat: 'webp', pattern, resize: [size, size], quality, effort: 80, ...extra,
  })
  steps.push(job(/^bark_base$/, barkBase, 82))
  steps.push(job(/^bark_normal$/, barkNormal, 88))
  steps.push(job(/^needles_base$/, leafBase, 90))
  steps.push(job(/^needles_normal$/, leafNormal, 88))
  return steps
}

await fs.mkdir(OUT, { recursive: true })
for (const tree of TREES) {
  for (const lod of ['lod0', 'lod1']) {
    const src = path.join(RAW, lod === 'lod0' ? `${tree}.glb` : `${tree}.lod1.glb`)
    const dst = path.join(OUT, lod === 'lod0' ? `${tree}.glb` : `${tree}.lod1.glb`)
    const doc = await io.read(src)
    fixMaterials(doc)
    doc.getRoot().listNodes().forEach((n) => n.setName(lod === 'lod0' ? tree : `${tree}.lod1`))
    doc.getRoot().listMeshes().forEach((m) => m.setName(tree))
    await doc.transform(
      ...compressFor(doc, SIZES[lod]),
      dedup(),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
    )
    await io.write(dst, doc)
    const { size } = await fs.stat(dst)
    console.log(`${path.relative(ROOT, dst)}  ${(size / 1024).toFixed(0)} KB`)
  }
}
