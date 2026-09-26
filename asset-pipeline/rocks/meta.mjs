// Measure the delivered rock GLBs and write the layout metadata the game needs before they load.
//   node asset-pipeline/rocks/meta.mjs
// Writes src/world/landmarks/rockMeta.ts: per pillar its height, summit, cross-section profile and flat
// ledges (probed straight down around each pine point, plus the summit where it is flat), and the solid
// cross-section of each band as circles for flight collision; per island its rim radius by bearing, flat-top
// radius, underside depth and cross-section profile. Everything is in asset metres (node matrix applied), origin as authored.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
// Sector rays per band (every 30°) and the band heights they are cast at.
const RAYS = 12
const RAY_HEIGHTS = [0.12, 0.5, 0.88]

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const dir = resolve(root, 'public', 'assets', 'environment', 'rocks')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

/** World-space (asset metres) positions of a node's mesh as a raycastable three Mesh. */
function nodeMesh(node) {
  const m = node.getWorldMatrix(), prim = node.getMesh().listPrimitives()[0]
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n = pos.getCount()
  const out = new Float32Array(n * 3), p = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p)
    out[i * 3] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    out[i * 3 + 1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
    out[i * 3 + 2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(out, 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(idx.getArray()), 1))
  geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return { mesh: new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })), positions: out }
}

const ray = new Raycaster(), down = new Vector3(0, -1, 0), origin = new Vector3()
/** Height of the first surface hit straight down from (x, fromY, z), or null. */
function probe(mesh, x, z, fromY) {
  origin.set(x, fromY, z); ray.set(origin, down)
  const hit = ray.intersectObject(mesh, false)[0]
  return hit ? hit.point.y : null
}

/** Largest radius (step 0.5 m, up to `max`) around (x, y, z) whose rings all probe within `tol` of y. */
function flatRadius(mesh, x, y, z, max, tol) {
  let best = 0
  for (let r = 0.5; r <= max; r += 0.5) {
    const n = Math.max(8, Math.ceil(r * 2))
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, h = probe(mesh, x + Math.cos(a) * r, z + Math.sin(a) * r, y + 40)
      if (h === null || Math.abs(h - y) > tol) return best
    }
    best = r
  }
  return best
}

const across = new Vector3()
/**
 * Solid cross-section of the mesh between heights lo and hi as circles, [x, z, r]: horizontal rays from
 * (cx, cz) every 30° at three heights; every solid run along a ray becomes the circle on that run's diameter.
 * Solid is counted by winding, which also holds where closed shells overlap: each hit's face normal says whether
 * the ray enters or leaves a shell, and the depth at the ray start is whatever leaves it at 0 past the last hit. Runs of one ray merge across the heights, so an
 * overhang anywhere in the band is covered for its whole height.
 */
function bandCircles(mesh, cx, cz, lo, hi) {
  const out = []
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * Math.PI * 2, runs = []
    across.set(Math.cos(a), 0, Math.sin(a))
    for (const f of RAY_HEIGHTS) {
      origin.set(cx, lo + (hi - lo) * f, cz); ray.set(origin, across)
      const hits = ray.intersectObject(mesh, false).map((h) => ({ d: h.distance, step: h.face.normal.dot(across) < 0 ? 1 : -1 }))
      let depth = -hits.reduce((sum, h) => sum + h.step, 0), from = 0
      for (const h of hits) {
        const next = depth + h.step
        if (depth > 0 && next <= 0) runs.push([from, h.d])
        if (depth <= 0 && next > 0) from = h.d
        depth = next
      }
    }
    runs.sort((p, q) => p[0] - q[0])
    const merged = []
    for (const run of runs) { const last = merged[merged.length - 1]; if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]); else merged.push([...run]) }
    for (const [s0, s1] of merged) if (s1 - s0 >= 2) out.push([round(cx + across.x * (s0 + s1) / 2, 1), round(cz + across.z * (s0 + s1) / 2, 1), round((s1 - s0) / 2, 1)])
  }
  return out
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0 }

/**
 * Cross-sections between successive heights in `cuts` (descending or ascending): the vertex centroid of each
 * band and the median distance from it, as [cut index fraction, centre x, centre z, radius].
 */
function sections(positions, cuts, fraction) {
  const out = []
  for (let b = 0; b < cuts.length - 1; b++) {
    const lo = Math.min(cuts[b], cuts[b + 1]), hi = Math.max(cuts[b], cuts[b + 1])
    let sx = 0, sz = 0, n = 0
    for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] >= lo && positions[i + 1] < hi) { sx += positions[i]; sz += positions[i + 2]; n++ }
    const cx = n ? sx / n : 0, cz = n ? sz / n : 0, radii = []
    for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] >= lo && positions[i + 1] < hi) radii.push(Math.hypot(positions[i] - cx, positions[i + 2] - cz))
    out.push([fraction[b], round(cx, 1), round(cz, 1), round(quantile(radii, 0.5), 1)])
  }
  return out
}

async function pillars() {
  const doc = await io.read(resolve(dir, 'pillars.glb'))
  const out = []
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    const { mesh, positions } = nodeMesh(node), extras = node.getExtras()
    const box = mesh.geometry.boundingBox, height = box.max.y
    // Cross-sections by height band, fine enough to follow tiers, leans and spires.
    const fractions = [0, 0.3, 0.5, 0.65, 0.75, 0.83, 0.9, 0.95, 1.001]
    const profile = sections(positions, fractions.map((f) => f * height), fractions)
      .map(([f, cx, cz], b) => [f, bandCircles(mesh, cx, cz, f * height, Math.min(1, fractions[b + 1]) * height)])
    let summit = 1
    for (let i = 4; i < positions.length; i += 3) if (positions[i] > positions[summit]) summit = i
    const shaft = []
    for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] > height * 0.1 && positions[i + 1] < height * 0.6) shaft.push(Math.hypot(positions[i], positions[i + 2]))
    const points = extras.pine_points ?? [], areas = extras.pine_areas_m2 ?? []
    const ledges = []
    for (let k = 0; k < points.length / 3; k++) {
      const [x, y0, z] = points.slice(k * 3, k * 3 + 3)
      const y = probe(mesh, x, z, y0 + 2) ?? y0
      const r = flatRadius(mesh, x, y, z, Math.min(10, Math.sqrt((areas[k] ?? 20) / Math.PI) * 1.5), 0.4)
      if (r >= 1.5) ledges.push([round(x, 1), round(y, 1), round(z, 1), r])
    }
    // The summit itself, where it is flat enough to land on and no pine ledge already covers it.
    const [sx, sy, sz] = [positions[summit - 1], positions[summit], positions[summit + 1]]
    const top = flatRadius(mesh, sx, sy, sz, 10, 0.6)
    if (top >= 1.5 && !ledges.some(([x, y, z]) => Math.abs(y - sy) < 3 && Math.hypot(x - sx, z - sz) < 4)) ledges.push([round(sx, 1), round(sy, 1), round(sz, 1), top])
    // A peaked top with nothing to land on near it: the highest spot in the top 12 % that is flat enough,
    // else in the top 25 % allowing a rougher stance.
    for (const [floor, tol] of [[0.88, 0.8], [0.75, 1.2]]) {
      if (ledges.some(([, y]) => y > height * floor)) break
      let best = null
      for (let x = box.min.x; x <= box.max.x; x += 2) for (let z = box.min.z; z <= box.max.z; z += 2) {
        const y = probe(mesh, x, z, height + 5)
        if (y === null || y < height * floor || (best && y <= best[1])) continue
        const r = flatRadius(mesh, x, y, z, 6, tol)
        if (r >= 2) best = [round(x, 1), round(y, 1), round(z, 1), r]
      }
      if (best) ledges.push(best)
    }
    out.push({
      name: node.getName(), height: round(height, 1), radius: round(quantile(shaft, 0.5), 1),
      summit: [round(positions[summit - 1], 1), round(positions[summit], 1), round(positions[summit + 1], 1)], profile, ledges,
    })
  }
  return out
}

async function islands() {
  const doc = await io.read(resolve(dir, 'islands.glb'))
  const out = []
  for (const node of doc.getRoot().listNodes()) {
    const extras = node.getExtras()
    if (!node.getMesh() || extras.rock_kind !== 'island') continue
    const { mesh, positions } = nodeMesh(node)
    const bins = 48, rim = new Array(bins).fill(0)
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] < -3) continue
      const x = positions[i], z = positions[i + 2], b = Math.floor(((Math.atan2(z, x) / (Math.PI * 2)) + 1) % 1 * bins)
      rim[b] = Math.max(rim[b], Math.hypot(x, z))
    }
    const top = probe(mesh, 0, 0, 20) ?? 0, depth = -mesh.geometry.boundingBox.min.y
    // Height of the top 1.5 m inside the rim at each bin's centre bearing (where a waterfall pours over).
    const lip = rim.map((r, b) => { const a = ((b + 0.5) / bins) * Math.PI * 2; return round(probe(mesh, Math.cos(a) * (r - 1.5), Math.sin(a) * (r - 1.5), 20) ?? top, 1) })
    const fractions = [0, 0.12, 0.3, 0.5, 0.7, 0.85, 1.001]
    out.push({
      name: node.getName(), top: round(top), flat: flatRadius(mesh, 0, top, 0, 80, 0.6),
      depth: round(depth, 1), rim: rim.map((r) => round(r, 1)), lip, profile: sections(positions, fractions.map((f) => -f * depth), fractions),
    })
  }
  return out
}

const data = { pillars: await pillars(), islands: await islands() }
const banner = '// Generated by asset-pipeline/rocks/meta.mjs from public/assets/environment/rocks; do not edit.\n'
const body = `${banner}
/** One authored pillar: base centre at the origin, heights and radii in asset metres. */
export interface PillarMeta {
  name: string; height: number
  /** Median shaft radius (10–60 % of the height). */
  radius: number
  /** Highest vertex. */
  summit: [number, number, number]
  /** Bands up the shaft: [height fraction where the band starts, its solid cross-section as circles [x, z, r]]. */
  profile: [number, [number, number, number][]][]
  /** Flat ledges probed around the authored pine points and at a flat summit: [x, y, z, flat radius]. */
  ledges: [number, number, number, number][]
}
/** One authored island: top centre at the origin. */
export interface IslandMeta {
  name: string
  /** Height of the top at the centre (≈ 0). */
  top: number
  /** Radius within which the top stays within ±0.6 m of the centre. */
  flat: number
  depth: number
  /** Outer radius of the top by bearing, 48 bins from +x toward +z. */
  rim: number[]
  /** Height of the top 1.5 m inside the rim, per rim bin. */
  lip: number[]
  /** Bands down the underside: [depth fraction where the band starts, centre x, centre z, median radius about it]. */
  profile: [number, number, number, number][]
}

export const PILLAR_META: PillarMeta[] = ${JSON.stringify(data.pillars)}

export const ISLAND_META: IslandMeta[] = ${JSON.stringify(data.islands)}
`
writeFileSync(resolve(root, 'src', 'world', 'landmarks', 'rockMeta.ts'), body)
for (const p of data.pillars) console.log(p.name, 'h', p.height, 'r', p.radius, 'summit', JSON.stringify(p.summit), 'ledges', p.ledges.length, '\n  profile', JSON.stringify(p.profile), '\n  ledges', JSON.stringify(p.ledges))
for (const i of data.islands) console.log(i.name, 'top', i.top, 'flat', i.flat, 'depth', i.depth, 'rim min/max', Math.min(...i.rim), Math.max(...i.rim), 'lip min/max', Math.min(...i.lip), Math.max(...i.lip), '\n  profile', JSON.stringify(i.profile))
