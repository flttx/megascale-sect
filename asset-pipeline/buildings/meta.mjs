// Measure the main hall (MG01) into the roof height field its flight and camera collider use.
//   node asset-pipeline/buildings/meta.mjs [out.ts]   (also run by `npm run assets:buildings`)
// Writes src/world/assets/hallMeta.ts: over the hall's footprint (LAYOUT.mainCollider), per 2 m cell, the highest point
// of the delivered LOD0 placed as WorldAsset places it (height normalised to 420 m, bottom on the platform, bounding
// box centred on LAYOUT.main) within the cell grown by MARGIN on every side. Each triangle is clipped exactly to each
// cell square it overlaps, and height is linear over a triangle, so the maximum sits on a clipped vertex: the field is
// never below the model anywhere in a cell, and it keeps MARGIN clear of every wall. Eaves read as solid down to the
// platform.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const out = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'src', 'world', 'assets', 'hallMeta.ts')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// Mirrors LAYOUT.main / LAYOUT.mainCollider (src/world/worldLayout.ts) and MG01's targetHeight and unit scale
// multiplier (src/world/worldAssets.ts). The hall is not rotated.
const MAIN = [0, 24, -320], HALF_WIDTH = 136, HALF_DEPTH = 147, TARGET_HEIGHT = 420
const mirrored = [
  ['src/world/worldLayout.ts', `main: { position: [${MAIN.join(', ')}] as const, rotation: [0, 0, 0] as const }`],
  ['src/world/worldLayout.ts', `mainCollider: { halfWidth: ${HALF_WIDTH}, halfDepth: ${HALF_DEPTH}, minY: ${MAIN[1]}`],
  ['src/world/worldAssets.ts', `lodDistance: 780, targetHeight: ${TARGET_HEIGHT}`],
  ['src/world/worldAssets.ts', 'position: LAYOUT.main.position, rotation: LAYOUT.main.rotation, scaleMultiplier: 1,'],
]
for (const [file, text] of mirrored) {
  if (!readFileSync(resolve(root, file), 'utf8').includes(text)) throw new Error(`${file} no longer contains "${text}"; update meta.mjs`)
}
/** Cell size, and how far past its edges a cell still takes the model's height (the collider's horizontal clearance). */
const CELL = 2, MARGIN = 1
const X0 = MAIN[0] - HALF_WIDTH, Z0 = MAIN[2] - HALF_DEPTH
const NX = Math.round(2 * HALF_WIDTH / CELL), NZ = Math.round(2 * HALF_DEPTH / CELL)

const doc = await io.read(resolve(root, 'public', 'assets', 'models', '主建筑.optimized.glb'))
const parts = []
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh()) continue
  const m = node.getWorldMatrix()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), n = pos.getCount(), p = [0, 0, 0], xyz = new Float64Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos.getElement(i, p)
      for (let k = 0; k < 3; k++) {
        const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]
        xyz[i * 3 + k] = v
        min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v)
      }
    }
    // Points and lines still count toward the bounding box WorldAsset measures, but hold no surface.
    const mode = prim.getMode()
    if (mode < 4) continue
    if (mode !== 4) throw new Error(`primitive mode ${mode} (strip / fan) is not supported; export plain triangles`)
    parts.push({ xyz, index: prim.getIndices()?.getArray() ?? Uint32Array.from({ length: n }, (_, i) => i) })
  }
}
const scale = TARGET_HEIGHT / (max[1] - min[1])
const offset = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
for (const { xyz } of parts) for (let i = 0; i < xyz.length; i += 3) for (let k = 0; k < 3; k++) xyz[i + k] = MAIN[k] + (xyz[i + k] - offset[k]) * scale

/** Sutherland–Hodgman against one axis-aligned half-plane: keeps points with sign · (p[k] − bound) ≥ 0. */
function clip(poly, k, bound, sign) {
  const kept = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = sign * (p[k] - bound), dq = sign * (q[k] - bound)
    if (dp >= 0) kept.push(p)
    if ((dp >= 0) !== (dq >= 0)) { const f = dp / (dp - dq); kept.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]) }
  }
  return kept
}

const top = new Float64Array(NX * NZ).fill(-Infinity)
let triangles = 0
for (const { xyz, index } of parts) {
  for (let t = 0; t < index.length; t += 3, triangles++) {
    const tri = [0, 1, 2].map((v) => { const a = index[t + v] * 3; return [xyz[a], xyz[a + 1], xyz[a + 2]] })
    const i1 = Math.max(0, Math.floor((Math.min(tri[0][0], tri[1][0], tri[2][0]) - MARGIN - X0) / CELL))
    const i2 = Math.min(NX - 1, Math.floor((Math.max(tri[0][0], tri[1][0], tri[2][0]) + MARGIN - X0) / CELL))
    const j1 = Math.max(0, Math.floor((Math.min(tri[0][2], tri[1][2], tri[2][2]) - MARGIN - Z0) / CELL))
    const j2 = Math.min(NZ - 1, Math.floor((Math.max(tri[0][2], tri[1][2], tri[2][2]) + MARGIN - Z0) / CELL))
    for (let i = i1; i <= i2; i++) {
      const x1 = X0 + i * CELL - MARGIN, x2 = X0 + (i + 1) * CELL + MARGIN
      const column = clip(clip(tri, 0, x1, 1), 0, x2, -1)
      if (!column.length) continue
      for (let j = j1; j <= j2; j++) {
        const z1 = Z0 + j * CELL - MARGIN, z2 = Z0 + (j + 1) * CELL + MARGIN
        const cell = clip(clip(column, 2, z1, 1), 2, z2, -1)
        for (const [, y] of cell) if (y > top[j * NX + i]) top[j * NX + i] = y
      }
    }
  }
}

// Decimetres above the platform, rounded up; empty cells stay at the platform (0) so flight keeps off the slab.
const heights = new Uint16Array(NX * NZ)
let empty = 0, highest = 0
top.forEach((y, k) => {
  if (y === -Infinity) { empty++; return }
  heights[k] = Math.max(0, Math.min(65535, Math.ceil((y - MAIN[1]) * 10)))
  highest = Math.max(highest, y)
})
console.log(`triangles ${triangles}, scale ${scale.toFixed(3)}, grid ${NX}×${NZ}, empty ${empty}, highest ${highest.toFixed(1)} m`)

writeFileSync(out, `// Generated by asset-pipeline/buildings/meta.mjs from public/assets/models/主建筑.optimized.glb; do not edit.

/**
 * Main hall roof height field (world metres): cell (i, j) spans x0 + i·cell and z0 + j·cell by one cell; \`data\` is
 * base64 little-endian Uint16, row-major in z, the highest model point within ${MARGIN} m of the cell in decimetres above y0.
 */
export const HALL_TOP = { x0: ${X0}, z0: ${Z0}, cell: ${CELL}, nx: ${NX}, nz: ${NZ}, y0: ${MAIN[1]}, data: '${Buffer.from(heights.buffer).toString('base64')}' }
`)
console.log('wrote', out)
