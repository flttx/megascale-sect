// Validate a Kun GLB: triangles, skin joints, animations, textures, and bounds from CPU skinning
// (bind pose + sampled clip frames). CPU skinning is the real test for a skinned + quantized file: glTF ignores the
// mesh node transform, so the dequantisation lives in the inverse bind matrices.
// node asset-pipeline/kun/validate_kun.mjs <file.glb> [reference.glb]
//   with a reference (the unquantised Blender export) it also reports the max vertex deviation per sampled frame.
import { statSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// ---- tiny mat4 (column-major, like glTF)
const mul = (a, b) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
const compose = (t, q, s) => {
  const [x, y, z, w] = q
  const [sx, sy, sz] = s
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const bb = d < 0 ? b.map((v) => -v) : b
  d = Math.abs(d)
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (bb[i] - v) * t)
    const n = Math.hypot(...o)
    return o.map((v) => v / n)
  }
  const th = Math.acos(d)
  const s0 = Math.sin((1 - t) * th) / Math.sin(th)
  const s1 = Math.sin(t * th) / Math.sin(th)
  return a.map((v, i) => v * s0 + bb[i] * s1)
}

async function analyse(file) {
  const doc = await io.read(file)
  const root = doc.getRoot()
  let tris = 0
  const prims = []
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices()
    tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3
    prims.push(p)
  }
  const skins = root.listSkins()
  const skinnedNode = root.listNodes().find((n) => n.getSkin() && n.getMesh())
  // sample channel values at time t (linear / step / cubic-as-linear)
  const sampleAt = (anim, t) => {
    const out = new Map()
    for (const ch of anim.listChannels()) {
      const smp = ch.getSampler()
      const inp = smp.getInput().getArray()
      const outp = smp.getOutput()
      const n = outp.getElementSize()
      const cubic = smp.getInterpolation() === 'CUBICSPLINE'
      const stride = cubic ? 3 : 1
      const get = (i) => {
        const e = new Array(n)
        outp.getElement(i * stride + (cubic ? 1 : 0), e)
        return e
      }
      let i = 0
      while (i < inp.length - 2 && inp[i + 1] < t) i++
      const t0 = inp[i]
      const t1 = inp[Math.min(i + 1, inp.length - 1)]
      const u = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 0
      const a = get(i)
      const b = get(Math.min(i + 1, inp.length - 1))
      const v = smp.getInterpolation() === 'STEP' ? a : ch.getTargetPath() === 'rotation' ? slerp(a, b, u) : a.map((x, k) => x + (b[k] - x) * u)
      const key = ch.getTargetNode()
      if (!out.has(key)) out.set(key, {})
      out.get(key)[ch.getTargetPath()] = v
    }
    return out
  }
  const worldOf = (node, override) => {
    const chain = []
    for (let n = node; n && n.propertyType === 'Node'; n = n.getParentNode()) chain.unshift(n)
    let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for (const n of chain) {
      const o = override?.get(n) ?? {}
      m = mul(m, compose(o.translation ?? n.getTranslation(), o.rotation ?? n.getRotation(), o.scale ?? n.getScale()))
    }
    return m
  }
  const skinPositions = (override) => {
    if (!skinnedNode) return null
    const skin = skinnedNode.getSkin()
    const joints = skin.listJoints()
    const ibm = skin.getInverseBindMatrices()
    const jm = joints.map((j, i) => {
      const inv = new Array(16)
      ibm.getElement(i, inv)
      return mul(worldOf(j, override), inv)
    })
    const res = []
    for (const p of skinnedNode.getMesh().listPrimitives()) {
      const pos = p.getAttribute('POSITION')
      const J = p.getAttribute('JOINTS_0')
      const W = p.getAttribute('WEIGHTS_0')
      const v = [0, 0, 0]
      const jj = [0, 0, 0, 0]
      const ww = [0, 0, 0, 0]
      const out = new Float64Array(pos.getCount() * 3)
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v)
        J.getElement(i, jj)
        W.getElement(i, ww)
        let x = 0, y = 0, z = 0, ws = 0
        for (let k = 0; k < 4; k++) {
          const w = ww[k]
          if (!w) continue
          const m = jm[jj[k]]
          x += w * (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12])
          y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13])
          z += w * (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14])
          ws += w
        }
        out.set([x / ws, y / ws, z / ws], i * 3)
      }
      res.push(out)
    }
    return res
  }
  const bounds = (arrs) => {
    const mn = [Infinity, Infinity, Infinity]
    const mx = [-Infinity, -Infinity, -Infinity]
    for (const a of arrs) for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], a[i + k])
      mx[k] = Math.max(mx[k], a[i + k])
    }
    return { min: mn.map((v) => +v.toFixed(2)), max: mx.map((v) => +v.toFixed(2)), size: mx.map((v, k) => +(v - mn[k]).toFixed(2)) }
  }
  return { doc, root, tris, prims, skins, skinnedNode, sampleAt, skinPositions, bounds }
}

const [file, ref] = process.argv.slice(2)
const A = await analyse(file)
const { root } = A
console.log(`file ${file}  ${(statSync(file).size / 1e6).toFixed(2)} MB`)
console.log(`extensions used: ${root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '-'}`)
console.log(`meshes ${root.listMeshes().length}, primitives ${A.prims.length}, triangles ${A.tris}, vertices ${A.prims.reduce((s, p) => s + p.getAttribute('POSITION').getCount(), 0)}`)
for (const p of A.prims) console.log(`  attributes: ${p.listSemantics().map((s) => `${s}:${p.getAttribute(s).getComponentType()}${p.getAttribute(s).getNormalized() ? 'n' : ''}`).join(' ')}`)
for (const s of A.skins) console.log(`skin "${s.getName()}": ${s.listJoints().length} joints [${s.listJoints().map((j) => j.getName()).join(', ')}]`)
for (const a of root.listAnimations()) {
  const inp = a.listSamplers().map((s) => s.getInput().getArray())
  const dur = Math.max(...inp.map((x) => x[x.length - 1])) - Math.min(...inp.map((x) => x[0]))
  // which channels actually move (constant channels = held rest values); root must stay still (no root motion)
  const moving = {}
  for (const c of a.listChannels()) {
    const o = c.getSampler().getOutput().getArray()
    const n = c.getSampler().getOutput().getElementSize()
    let v = 0
    for (let i = n; i < o.length; i++) v = Math.max(v, Math.abs(o[i] - o[i % n]))
    if (v > 1e-4) (moving[c.getTargetPath()] ??= []).push(c.getTargetNode().getName())
  }
  const rootMoves = Object.values(moving).some((l) => l.includes('root'))
  console.log(`animation "${a.getName()}": ${dur.toFixed(3)} s, ${a.listChannels().length} channels, max keys ${Math.max(...inp.map((x) => x.length))}; animated: ${Object.entries(moving).map(([k, l]) => `${k}×${l.length}`).join(', ') || 'none'}; root motion: ${rootMoves ? 'YES' : 'none'}`)
}
for (const t of root.listTextures()) {
  const sz = t.getSize()
  console.log(`texture "${t.getName()}" ${t.getMimeType()} ${sz ? sz.join('x') : '?'} ${(t.getImage().byteLength / 1e6).toFixed(2)} MB`)
}
for (const m of root.listMaterials()) {
  console.log(`material "${m.getName()}": baseColor ${m.getBaseColorFactor().map((v) => +v.toFixed(3))} metallic ${m.getMetallicFactor()} roughness ${m.getRoughnessFactor()} doubleSided ${m.getDoubleSided()} alpha ${m.getAlphaMode()}`)
}
const rest = A.skinPositions(null)
if (rest) {
  console.log('bind-pose bounds (m, glTF Y-up, CPU-skinned):', JSON.stringify(A.bounds(rest)))
  const B = ref ? await analyse(ref) : null
  const refRest = B?.skinPositions(null)
  let map = null
  const dev = (P, R) => {
    let d = 0
    for (let i = 0; i < map.length; i++) for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(P[0][i * 3 + k] - R[0][map[i] * 3 + k]))
    return d
  }
  if (refRest) {
    const C = 0.5
    const grid = new Map()
    const key = (x, y, z) => `${x},${y},${z}`
    const R = refRest[0]
    for (let i = 0; i < R.length / 3; i++) {
      const k = key(Math.floor(R[i * 3] / C), Math.floor(R[i * 3 + 1] / C), Math.floor(R[i * 3 + 2] / C))
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push(i)
    }
    const P = rest[0]
    map = new Int32Array(P.length / 3)
    for (let i = 0; i < map.length; i++) {
      const cx = Math.floor(P[i * 3] / C), cy = Math.floor(P[i * 3 + 1] / C), cz = Math.floor(P[i * 3 + 2] / C)
      let best = -1, bd = Infinity
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
          const d = (P[i * 3] - R[j * 3]) ** 2 + (P[i * 3 + 1] - R[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - R[j * 3 + 2]) ** 2
          if (d < bd) { bd = d; best = j }
        }
      }
      map[i] = best
    }
    console.log(`bind pose max deviation vs reference (nearest-vertex matched, ${map.length} verts): ${dev(rest, refRest).toFixed(4)} m`)
  }
  for (const a of root.listAnimations()) {
    const inp = a.listSamplers()[0].getInput().getArray()
    const T = inp[inp.length - 1]
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const pose = A.skinPositions(A.sampleAt(a, f * T))
      const b = A.bounds(pose)
      let line = `  ${a.getName()} t=${(f * T).toFixed(2)}s bounds min ${b.min} max ${b.max}`
      if (B) {
        const ra = B.root.listAnimations().find((x) => x.getName() === a.getName())
        const rp = B.skinPositions(B.sampleAt(ra, f * T))
        line += `  max dev vs ref ${dev(pose, rp).toFixed(4)} m`
      }
      console.log(line)
    }
    // loop seam: first vs last frame
    const p0 = A.skinPositions(A.sampleAt(a, 0))
    const p1 = A.skinPositions(A.sampleAt(a, T))
    let d = 0
    p0.forEach((p, pi) => { for (let i = 0; i < p.length; i++) d = Math.max(d, Math.abs(p[i] - p1[pi][i])) })
    console.log(`  ${a.getName()} loop seam (t=0 vs t=${T.toFixed(2)}) max vertex gap ${d.toFixed(4)} m`)
  }
}
const nodes = root.listNodes()
const meshNode = A.skinnedNode ?? nodes.find((n) => n.getMesh())
console.log(`scene roots: ${root.listScenes()[0].listChildren().map((n) => `${n.getName()} T${n.getTranslation().map((v) => +v.toFixed(3))} R${n.getRotation().map((v) => +v.toFixed(3))} S${n.getScale().map((v) => +v.toFixed(3))}`).join(' | ')}`)
console.log(`mesh node "${meshNode?.getName()}" parent "${meshNode?.getParentNode()?.getName?.() ?? '-'}"`)
