import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, simplify, textureCompress, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const triangles = (doc) => doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives()
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)

// LOD0 is what the player sees up close; LOD1 is swapped in by <Detailed> at distance.
// Towers are drawn 6×, so they get the tightest budget.
const BUILDINGS = [
  { name: '主建筑', lods: [{ suffix: 'optimized', ratio: 0.35, error: 0.002, base: 4096, detail: 2048 }, { suffix: 'lod1', ratio: 0.07, error: 0.02, base: 1024, detail: 512 }] },
  { name: '山门', lods: [{ suffix: 'optimized', ratio: 0.3, error: 0.002, base: 4096, detail: 2048 }, { suffix: 'lod1', ratio: 0.05, error: 0.02, base: 1024, detail: 512 }] },
  { name: '侧塔', lods: [{ suffix: 'optimized', ratio: 0.18, error: 0.004, base: 2048, detail: 1024 }, { suffix: 'lod1', ratio: 0.035, error: 0.03, base: 512, detail: 256 }] },
]
const only = process.argv.slice(2)
const report = []
for (const building of BUILDINGS.filter((b) => !only.length || only.includes(b.name))) {
  const source = `public/assets/models/${building.name}.glb`
  const original = await fs.readFile(source)
  for (const lod of building.lods) {
    const target = `public/assets/models/${building.name}.${lod.suffix}.glb`
    const doc = await io.readBinary(original)
    const before = triangles(doc)
    const started = Date.now()
    await doc.transform(
      dedup(), weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: lod.error }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [lod.base, lod.base], quality: 86, effort: 60 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!baseColorTexture$).*$/, resize: [lod.detail, lod.detail], quality: 88, effort: 60 }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }),
    )
    await io.write(target, doc)
    const output = await fs.readFile(target)
    const after = triangles(await io.readBinary(output))
    if (after <= 0 || output.byteLength >= original.byteLength) throw new Error(`Invalid optimization: ${target}`)
    report.push({ source, target, lod: lod.suffix, options: lod, sourceSha256: hash(original), outputSha256: hash(output), originalBytes: original.byteLength, optimizedBytes: output.byteLength, trianglesBefore: before, trianglesAfter: after, seconds: (Date.now() - started) / 1000 })
    console.log(`${building.name}.${lod.suffix}: ${(original.byteLength / 1e6).toFixed(2)} → ${(output.byteLength / 1e6).toFixed(2)} MB; ${before} → ${after} triangles (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  }
}
await fs.mkdir('asset-pipeline', { recursive: true })
await fs.writeFile('asset-pipeline/building-optimization-report.json', JSON.stringify(report, null, 2))
