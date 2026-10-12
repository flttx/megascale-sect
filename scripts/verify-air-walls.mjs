import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

/**
 * No invisible walls: sample standable ground across the core area and every island top, and fail when a walking body
 * is blocked although no rendered triangle lies within SLACK of it and no rendered mesh encloses it. Each such sample
 * is reported with the colliders that blocked it.
 */
const out = 'artifacts/air-walls'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear')
const report = { errors, failure: null }
try {
  report.result = await page.evaluate(async () => {
    const { Box3, Matrix4, Quaternion, Ray, Vector3, DoubleSide } = await window.__liveImport(
      '/node_modules/.vite/deps/three.js',
    )
    const { MeshBVH } = await window.__liveImport('/node_modules/.vite/deps/three-mesh-bvh.js')
    const { bodyInsideAnyCollider, surfaceStats } = await window.__liveImport('/src/world/surfaces.ts')
    const { groundHeight, insideMainFootprint, insideStructure } =
      await window.__liveImport('/src/world/worldLayout.ts')
    const { ISLANDS } = await window.__liveImport('/src/world/sites.ts')
    const { buildPropLayout } = await window.__liveImport('/src/world/props/placement.ts')
    const { boulderShape, boulderShapeGeometries } = await window.__liveImport('/src/world/props/stoneSource.ts')
    const SLACK = 0.15,
      BODY = { bottom: 0.45, top: 1.7, radius: 0.35 }
    const scene = window.__postfx().composer.passes.find((p) => p.scene?.getObjectByName('PropField')).scene
    scene.updateMatrixWorld(true)
    const layout = buildPropLayout(),
      trees = new Map(),
      parts = [],
      m = new Matrix4(),
      up = new Vector3(0, 1, 0)
    const treeFor = (g) => {
      if (!trees.has(g)) trees.set(g, new MeshBVH(g.clone()))
      return trees.get(g)
    }
    // Every rendered triangle mesh, visible or LOD-hidden, minus huge backdrops (sky, sea, terrain).
    scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position || /^Prop_.+_lod1$/.test(o.name)) return
      const g = o.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      // Prop buckets only hold the instances near the camera: use every placement with the LOD0 geometry.
      const placed = layout.props[/^Prop_(.+)_lod0$/.exec(o.name)?.[1]]
      // Boulders draw one shape per instance (stoneSource PICK); the rest of the merged geometry is collapsed.
      const shapes = g.getAttribute('aBoulder') ? boulderShapeGeometries(g) : null
      shapes?.forEach((shape) => shape.computeBoundingBox())
      const n = placed ? placed.length : o.isInstancedMesh ? o.count : 1
      for (let i = 0; i < n; i++) {
        const p = placed?.[i]
        const matrix = p
          ? new Matrix4().compose(
              new Vector3(p.x, p.y, p.z),
              new Quaternion().setFromAxisAngle(up, p.yaw),
              new Vector3().setScalar(p.scale),
            )
          : o.isInstancedMesh
            ? o.getMatrixAt(i, m).premultiply(o.matrixWorld).clone()
            : o.matrixWorld.clone()
        const shape = shapes && p ? shapes[boulderShape(p.x, p.z, shapes.length)] : g
        const box = shape.boundingBox.clone().applyMatrix4(matrix),
          size = box.getSize(new Vector3())
        // Terrain, sea and merged far-flung sets (all chains) would hide air walls on slopes: enclosure only.
        // The sky would enclose everything: skipped.
        const span = Math.max(size.x, size.z)
        if (span > 3000) continue
        parts.push({ g: shape, matrix, inverse: matrix.clone().invert(), box, wide: span > 600, span, name: o.name })
      }
    })
    const regions = [{ x0: -260, x1: 260, z0: -260, z1: 240, step: 2 }]
    for (const isle of ISLANDS) {
      const r = isle.radius + 4
      regions.push({ x0: isle.top[0] - r, x1: isle.top[0] + r, z0: isle.top[2] - r, z1: isle.top[2] + r, step: 1.5 })
    }
    const stats = surfaceStats(),
      body = new Box3(),
      ray = new Ray(),
      centre = new Vector3(),
      sides = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].map((d) => new Vector3(...d)),
      vertical = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)]
    const blockers = (x, y, z) => {
      const bottom = y + BODY.bottom,
        top = y + BODY.top,
        r = BODY.radius,
        list = []
      for (const c of stats.colliders) {
        if (c.kind === 'mesh') {
          if (x <= c.min[0] - r || x >= c.max[0] + r || z <= c.min[2] - r || z >= c.max[2] + r) continue
          if (top <= c.min[1] || bottom >= c.max[1]) continue
          if (c.intersects(x, bottom, top, z, r, 0)) list.push(`mesh ${c.name}`)
        } else if (c.kind === 'cylinder') {
          if (
            !c.open &&
            top >= c.minY &&
            bottom <= c.maxY &&
            Math.hypot(x - c.x, z - c.z) < c.radius + r &&
            !c.cutout?.(x, bottom, top, z, r, 0)
          )
            list.push(
              `cylinder (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) r${c.radius.toFixed(2)} y${c.minY.toFixed(2)}..${c.maxY.toFixed(2)}`,
            )
        } else if (
          x > c.min[0] - r &&
          x < c.max[0] + r &&
          top > c.min[1] &&
          bottom < c.max[1] &&
          z > c.min[2] - r &&
          z < c.max[2] + r
        )
          list.push(`box ${c.min.map((v) => v.toFixed(1))}..${c.max.map((v) => v.toFixed(1))}`)
      }
      return list.length ? list : ['moving collider']
    }
    let samples = 0,
      blocked = 0
    const walls = []
    for (const { x0, x1, z0, z1, step } of regions)
      for (let x = x0; x <= x1; x += step)
        for (let z = z0; z <= z1; z += step) {
          const y = groundHeight(x, z)
          if (y === null || insideMainFootprint(x, z) || insideStructure(x, y + 1, z)) continue
          samples++
          if (!bodyInsideAnyCollider(x, y + BODY.bottom, y + BODY.top, z, BODY.radius)) continue
          blocked++
          body.min.set(x - BODY.radius - SLACK, y + BODY.bottom - SLACK, z - BODY.radius - SLACK)
          body.max.set(x + BODY.radius + SLACK, y + BODY.top + SLACK, z + BODY.radius + SLACK)
          const near = parts.filter((p) => !p.wide && p.box.intersectsBox(body))
          if (near.some((p) => treeFor(p.g).intersectsBox(body, p.inverse))) continue
          // Enclosed (a solid gate bay, a buried rock): the first hit to every side, and up or down, leaves the same
          // mesh. One vertical ray may meet a coplanar cap of stacked primitives (a chain bollard's collar) first.
          centre.set(x, y + 1, z)
          const enclosed = parts
            .filter((p) => p.box.containsPoint(centre))
            .some((p) => {
              const exits = (d) => {
                ray.origin.copy(centre).applyMatrix4(p.inverse)
                ray.direction.copy(d).transformDirection(p.inverse)
                const hit = treeFor(p.g).raycastFirst(ray, DoubleSide)
                return hit?.face && hit.face.normal.dot(ray.direction) > 0
              }
              return sides.every(exits) && vertical.some(exits)
            })
          if (!enclosed) walls.push({ at: [x, +y.toFixed(2), z], by: blockers(x, y, z) })
        }
    const widest = parts
      .filter((p) => p.wide)
      .sort((a, b) => b.span - a.span)
      .slice(0, 8)
      .map((p) => `${p.name} ${Math.round(p.span)} m`)
    return { samples, blocked, parts: parts.length, widest, walls }
  })
  const { samples, blocked, walls, widest } = report.result
  console.log(`enclosure-only meshes: ${widest.join(', ')}`)
  for (const wall of walls.slice(0, 40)) console.log(`air wall at ${wall.at.join(', ')}: ${wall.by.join('; ')}`)
  assert.ok(samples > 30000, `expected the standable sample grid, got ${samples}`)
  assert.equal(walls.length, 0, `${walls.length} invisible walls among ${blocked} blocked samples`)
  assert.deepEqual(errors, [])
  console.log(`PASS air walls: ${samples} standable samples, ${blocked} blocked, all by rendered geometry`)
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
