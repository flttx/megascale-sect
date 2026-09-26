import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(process.argv[2])
const pts = []
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); const v = [0,0,0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push([...v]) } }
const H = Math.max(...pts.map(p => p[1]))
for (const f of (process.argv[3]||'0.05,0.15,0.3,0.45,0.6,0.7,0.75,0.8,0.9,0.97').split(',').map(Number)) {
  const y = f * H, band = H * 0.01
  const s = pts.filter(p => Math.abs(p[1] - y) < band)
  if (!s.length) { console.log(f, 'none'); continue }
  const xs = s.map(p => p[0]), zs = s.map(p => p[2])
  console.log(`y=${y.toFixed(0)} (${f}) x:[${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}] z:[${Math.min(...zs).toFixed(1)}, ${Math.max(...zs).toFixed(1)}] n=${s.length}`)
}
