// dump textures of a glb (downscaled) + channel stats: node tex.mjs file.glb outprefix
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(process.argv[2])
const m = doc.getRoot().listMaterials()[0]
for (const [slot, t] of [['base', m.getBaseColorTexture()], ['orm', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]) {
  if (!t) continue
  const img = sharp(Buffer.from(t.getImage()))
  const st = await img.stats()
  console.log(slot, t.getMimeType(), st.channels.map((c, i) => `${'RGBA'[i]} mean ${c.mean.toFixed(0)} min ${c.min} max ${c.max}`).join(' | '))
  await sharp(Buffer.from(t.getImage())).resize(1024, 1024).png().toFile(`${process.argv[3]}_${slot}.png`)
}
