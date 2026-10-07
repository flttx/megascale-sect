// Optimize approved, inspected horror GLBs without another generation call.
// node scripts/build-horror-assets.mjs --watcher <model.glb> --behemoth <model.glb>
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Logger, NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public/assets/black-mist')
const META = path.join(ROOT, 'asset-pipeline/black-mist/horror-assets.json')
const argv = process.argv.slice(2)
const names = { watcher: 'shroud-watcher', behemoth: 'abyss-behemoth' }
const inputs = Object.fromEntries(
  Object.keys(names).map((id) => {
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
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')
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
function bounds(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (!scene) throw new Error('Horror model has no scene')
  const box = getBounds(scene)
  return { min: box.min, max: box.max, size: box.max.map((value, index) => value - box.min[index]) }
}
function stats(doc) {
  return {
    triangles: triangles(doc),
    meshes: doc.getRoot().listMeshes().length,
    primitives: doc
      .getRoot()
      .listMeshes()
      .reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0),
    materials: doc
      .getRoot()
      .listMaterials()
      .map((material) => ({
        name: material.getName(),
        pbr: {
          baseColor: !!material.getBaseColorTexture(),
          normal: !!material.getNormalTexture(),
          roughness: !!material.getMetallicRoughnessTexture(),
        },
      })),
    textures: doc
      .getRoot()
      .listTextures()
      .map((texture) => ({ name: texture.getName(), size: texture.getSize(), mimeType: texture.getMimeType() })),
    bounds: bounds(doc),
  }
}
await fs.mkdir(PUBLIC, { recursive: true })
const report = {}
for (const [id, source] of Object.entries(inputs)) {
  const raw = await fs.readFile(source),
    original = await io.readBinary(raw),
    sourceStats = stats(original)
  if (
    sourceStats.triangles < 1000 ||
    Math.min(...sourceStats.bounds.size) <= 0 ||
    !sourceStats.materials.some((material) => material.pbr.baseColor && material.pbr.normal && material.pbr.roughness)
  ) {
    throw new Error(`Horror source is empty or missing its inspected PBR maps: ${id}`)
  }
  const asset = {
    source: relative(source),
    sha256: createHash('sha256').update(raw).digest('hex'),
    sourceStats,
    lods: [],
  }
  for (const lod of [
    { suffix: '', ratio: 1, texture: 4096 },
    { suffix: '.lod1', ratio: 0.3, texture: 1024 },
  ]) {
    const doc = await io.readBinary(raw)
    const transforms = [dedup(), weld(), join()]
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
    const target = path.join(PUBLIC, `${names[id]}${lod.suffix}.glb`)
    await io.write(target, doc)
    const output = await fs.readFile(target),
      optimized = stats(await io.readBinary(output))
    if (optimized.triangles < 500) throw new Error(`Horror optimized model is empty: ${id}`)
    asset.lods.push({
      file: relative(target),
      bytes: output.length,
      sha256: createHash('sha256').update(output).digest('hex'),
      ...optimized,
    })
  }
  report[id] = asset
  console.log(
    `${id}: ${sourceStats.triangles} source triangles; ${asset.lods.map((lod) => `${lod.triangles} tris / ${(lod.bytes / 1048576).toFixed(2)} MiB / ${lod.primitives} draws`).join(', ')}`,
  )
}
await fs.mkdir(path.dirname(META), { recursive: true })
await fs.writeFile(META, `${JSON.stringify(report, null, 2)}\n`)
