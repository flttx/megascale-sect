// Validate final colossi GLBs: node asset-pipeline/colossi/validate.mjs file1.glb file2.glb ...
import fs from 'node:fs/promises'
import { NodeIO, Logger, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'

await MeshoptDecoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const r3 = (v) => v.map((x) => Math.round(x * 100) / 100)
const out = []
for (const file of process.argv.slice(2)) {
  const bytes = (await fs.stat(file)).size
  const doc = await io.read(file)
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const b = getBounds(scene)
  let tris = 0
  let prims = 0
  const attrs = new Set()
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    prims++
    tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
    p.listSemantics().forEach((s) => attrs.add(s))
  }
  const textures = []
  for (const t of root.listTextures()) {
    const img = t.getImage()
    const meta = img ? await sharp(Buffer.from(img)).metadata() : {}
    const slots = []
    for (const m of root.listMaterials()) {
      if (m.getBaseColorTexture() === t) slots.push('baseColor')
      if (m.getNormalTexture() === t) slots.push('normal')
      if (m.getMetallicRoughnessTexture() === t) slots.push('metallicRoughness')
      if (m.getOcclusionTexture() === t) slots.push('occlusion')
      if (m.getEmissiveTexture() === t) slots.push('emissive')
    }
    textures.push({ slots: slots.join('+'), mime: t.getMimeType(), size: `${meta.width}x${meta.height}`, kb: Math.round((img?.byteLength ?? 0) / 1024) })
  }
  const mats = root.listMaterials().map((m) => ({ name: m.getName(), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), doubleSided: m.getDoubleSided() }))
  const rec = {
    file, mb: +(bytes / 1e6).toFixed(2), tris, primitives: prims, nodes: root.listNodes().length,
    attributes: [...attrs].join(','), min: r3(b.min), max: r3(b.max), size: r3(b.max.map((v, i) => v - b.min[i])),
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName).join(','), textures, materials: mats,
  }
  out.push(rec)
  console.log(JSON.stringify(rec))
}
