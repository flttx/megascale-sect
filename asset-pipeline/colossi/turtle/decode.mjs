// Decode the shipped turtle LOD0 into a GLB Blender can import (no meshopt, plain float accessors), the input of
// build_turtle.py. The original Tripo source is not kept; the cleaned, optimised LOD0 is the rigging source.
//
// node asset-pipeline/colossi/turtle/decode.mjs [src.glb] [out.glb]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dequantize } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] ?? path.join(DIR, 'work/orig_lod0.glb')
const OUT = process.argv[3] ?? path.join(DIR, 'work/decoded.glb')

await MeshoptDecoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(SRC)
await doc.transform(dequantize())
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression' || ext.extensionName === 'KHR_mesh_quantization') ext.dispose()
const root = doc.getRoot()
console.log('materials', root.listMaterials().map((m) => m.getName()), 'textures', root.listTextures().map((t) => `${t.getName()} ${t.getMimeType()} ${t.getSize()?.join('x')}`))
console.log('node', root.listNodes().map((n) => ({ name: n.getName(), t: n.getTranslation(), s: n.getScale() })))
await io.write(OUT, doc)
console.log('wrote', OUT)
