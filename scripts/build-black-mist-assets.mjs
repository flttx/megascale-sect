// Locally optimize inspected Tripo PBR assets, preserving source anatomy and orientation.
// node scripts/build-black-mist-assets.mjs --eye <source.glb> --tentacle <source.glb>
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Logger, NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public/assets/black-mist')
const META = path.join(ROOT, 'asset-pipeline/black-mist/assets.json')
const argv = process.argv.slice(2)
const inputs = Object.fromEntries(
  ['eye', 'tentacle'].map((id) => {
    const index = argv.indexOf(`--${id}`)
    if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing --${id} source GLB`)
    return [id, path.resolve(ROOT, argv[index + 1])]
  }),
)
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const triangles = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .reduce(
      (sum, mesh) =>
        sum +
        mesh
          .listPrimitives()
          .reduce(
            (count, primitive) =>
              count + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3,
            0,
          ),
      0,
    )
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')
const bounds = (doc) => {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (!scene) throw new Error('Model has no scene')
  const box = getBounds(scene)
  return { min: box.min, max: box.max, size: box.max.map((value, index) => value - box.min[index]) }
}
await fs.mkdir(PUBLIC, { recursive: true })
const result = {}
for (const [id, source] of Object.entries(inputs)) {
  const raw = await fs.readFile(source),
    original = await io.readBinary(raw)
  if (triangles(original) < 1000 || Math.min(...bounds(original).size) <= 0)
    throw new Error(`Source anatomy is empty or flat: ${id}`)
  const asset = {
    source: relative(source),
    sha256: createHash('sha256').update(raw).digest('hex'),
    sourceTriangles: triangles(original),
    bounds: bounds(original),
    lods: [],
  }
  for (const lod of [
    { suffix: '', ratio: 1, texture: 4096 },
    { suffix: '.lod1', ratio: 0.3, texture: 1024 },
  ]) {
    const doc = await io.readBinary(raw)
    const transforms = [dedup(), weld()]
    if (lod.ratio < 1) transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: 0.002 }))
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        slots: /^baseColorTexture$/,
        resize: [lod.texture, lod.texture],
        quality: 94,
        effort: 60,
      }),
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        slots: /^(?!baseColorTexture$).*$/,
        resize: [lod.texture, lod.texture],
        quality: 96,
        effort: 60,
      }),
      prune(),
      meshopt({
        encoder: MeshoptEncoder,
        level: 'medium',
        quantizePosition: 16,
        quantizeNormal: 12,
        quantizeTexcoord: 14,
      }),
    )
    await doc.transform(...transforms)
    const target = path.join(PUBLIC, `abyss-${id}${lod.suffix}.glb`)
    await io.write(target, doc)
    const output = await fs.readFile(target),
      inspected = await io.readBinary(output)
    if (triangles(inspected) < 500) throw new Error(`Optimized model is empty: ${id}`)
    asset.lods.push({
      file: relative(target),
      bytes: output.length,
      triangles: triangles(inspected),
      materials: inspected.getRoot().listMaterials().length,
      textures: inspected
        .getRoot()
        .listTextures()
        .map((texture) => ({ name: texture.getName(), size: texture.getSize(), mimeType: texture.getMimeType() })),
    })
  }
  result[id] = asset
  console.log(
    `${id}: ${asset.sourceTriangles} source triangles; ${asset.lods.map((lod) => `${lod.triangles} tris / ${(lod.bytes / 1048576).toFixed(2)} MiB`).join(', ')}`,
  )
}
await fs.mkdir(path.dirname(META), { recursive: true })
await fs.writeFile(META, `${JSON.stringify(result, null, 2)}\n`)
