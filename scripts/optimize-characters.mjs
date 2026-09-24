import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, simplify, textureCompress, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function stats(doc) {
  return {
    triangles: doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0),
    joints: doc.getRoot().listSkins().map((skin) => skin.listJoints().map((joint) => joint.getName())),
    textures: doc.getRoot().listTextures().map((texture) => ({ size: texture.getSize(), mime: texture.getMimeType() })),
  }
}
const report = []
for (const character of ['male', 'female']) for (const asset of ['rig', 'sword']) {
  const source = `public/assets/characters/${character}/${asset}.glb`
  const target = `public/assets/characters/${character}/${asset}.optimized.glb`
  const original = await fs.readFile(source)
  const doc = await io.readBinary(original)
  const before = stats(doc)
  const options = { ratio: asset === 'rig' ? 0.12 : 0.10, error: asset === 'rig' ? 0.0007 : 0.0005, textureSize: asset === 'rig' ? 2048 : 1024 }
  console.log(`Optimizing ${character}/${asset}: ${before.triangles} triangles`)
  await doc.transform(
    dedup(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: options.ratio, error: options.error }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [options.textureSize, options.textureSize], quality: 88, effort: 60 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14, quantizeWeight: 16 }),
  )
  await io.write(target, doc)
  const output = await fs.readFile(target)
  const verified = await io.readBinary(output)
  const after = stats(verified)
  if (JSON.stringify(before.joints) !== JSON.stringify(after.joints)) throw new Error(`Skeleton changed: ${target}`)
  if (hash(await fs.readFile(source)) !== hash(original)) throw new Error(`Source changed: ${source}`)
  if (after.triangles <= 0 || output.byteLength >= original.byteLength) throw new Error(`Invalid optimization: ${target}`)
  report.push({ source, target, sourceSha256: hash(original), outputSha256: hash(output), options, originalBytes: original.byteLength, optimizedBytes: output.byteLength, before, after })
  console.log(`${character}/${asset}: ${(original.byteLength / 1e6).toFixed(2)} → ${(output.byteLength / 1e6).toFixed(2)} MB; ${before.triangles} → ${after.triangles} triangles`)
}
await fs.mkdir('character-pipeline', { recursive: true })
await fs.writeFile('character-pipeline/optimization-report.json', JSON.stringify(report, null, 2))
