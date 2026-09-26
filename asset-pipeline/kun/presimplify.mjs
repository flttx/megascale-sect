// Seam-aware simplification of the raw Tripo mesh before rigging (textures untouched).
// node asset-pipeline/kun/presimplify.mjs <in.glb> <out.glb> <targetTris>
import { NodeIO, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'

const [src, dst, target] = process.argv.slice(2)
await MeshoptSimplifier.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS)
const tris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0)
const doc = await io.read(src)
const before = tris(doc)
const ratio = Number(target) / before
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004 }), prune())
console.log(`tris ${before} -> ${tris(doc)} (ratio ${ratio.toFixed(3)})`)
await io.write(dst, doc)
