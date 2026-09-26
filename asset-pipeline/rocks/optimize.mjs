// Raw Blender GLBs (asset-pipeline/rocks/out/*.raw.glb) -> meshopt GLBs in public/assets/environment/rocks/.
//   node asset-pipeline/rocks/optimize.mjs
// Mirrors the optimize step of scripts/tripo/generate.mjs: dedup -> weld -> prune -> meshopt.
// quantizePosition 16 over a per-mesh volume => step = half-extent / 32767 (a 420 m pillar: ~6.4 mm).
// COLOR_0 is quantized to 8-bit normalized (still linear); NORMAL to 10 bits.
import { readdirSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, 'out')
const dst = resolve(here, '..', '..', 'public', 'assets', 'environment', 'rocks')

async function main() {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
  mkdirSync(dst, { recursive: true })
  const files = readdirSync(src).filter((f) => f.endsWith('.raw.glb')).sort()
  if (!files.length) throw new Error(`no *.raw.glb in ${src}; run export.py first`)
  for (const f of files) {
    const doc = await io.read(join(src, f))
    const names = doc.getRoot().listNodes().map((n) => n.getName())
    await doc.transform(
      dedup(),
      weld(),
      prune({ keepAttributes: true }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }),
    )
    // quantize() moves a mesh into a new unnamed child node when its node has children; name any such node
    for (const node of doc.getRoot().listNodes()) {
      if (!node.getName() && node.getMesh()) node.setName(node.getMesh().getName())
    }
    const lost = names.filter((n) => !doc.getRoot().listNodes().some((m) => m.getName() === n))
    if (lost.length) throw new Error(`${f}: nodes lost during optimize: ${lost.join(', ')}`)
    const out = join(dst, f.replace('.raw.glb', '.glb'))
    await io.write(out, doc)
    const a = statSync(join(src, f)).size
    const b = statSync(out).size
    console.log(`${f} ${(a / 1024).toFixed(0)} KiB -> ${out} ${(b / 1024).toFixed(0)} KiB`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
