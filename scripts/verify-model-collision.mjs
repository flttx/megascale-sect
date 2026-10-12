import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

const out = 'artifacts/model-collision'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear&kunAt=65')
const report = { errors, failure: null }
try {
  report.coverage = await page.evaluate(async () => {
    const { Vector3, Matrix4 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const { insideAnyCollider, bodyInsideAnyCollider, surfaceStats } =
      await window.__liveImport('/src/world/surfaces.ts')
    const { stepGround } = await window.__liveImport('/src/world/player/GroundController.tsx')
    const { stepFlight } = await window.__liveImport('/src/world/player/FlightController.tsx')
    const { groundHeight, insideStructure } = await window.__liveImport('/src/world/worldLayout.ts')
    const { kunHullClearance, kunDepth, kunState } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
    const { BRIDGES, ISLANDS } = await window.__liveImport('/src/world/sites.ts')
    const { deckY } = await window.__liveImport('/src/world/landmarks/Bridges.tsx')
    const scene = window.__postfx().composer.passes.find((p) => p.scene?.getObjectByName('PropField')).scene
    scene.updateMatrixWorld(true)
    const checks = [],
      coverage = [],
      matrices = new Matrix4(),
      point = new Vector3()
    const groups = [
      'MG02_LOD0',
      'Scatter',
      'Terraces',
      'Balustrade_Rails',
      'Balustrade_Caps',
      'Bridge_Planks',
      'Bridge_Ropes',
      'Interact_stele',
      'Interact_bell',
      'Interact_altar',
      'Interact_meditation',
      'Interact_teleport',
      'Interact_plinths',
      'Colossus_armillary',
      'Banner_Poles_Arms',
      'Banner_Finials',
      ...ISLANDS.map((isle) => `Rock_${isle.id}_LOD0`),
    ]
    // Probe rendered triangle centroids, independent of collision construction. Do not include water or terrain decoration.
    for (const name of groups) {
      const root = scene.getObjectByName(name)
      if (!root) throw Error(`missing rendered fixture ${name}`)
      let samples = 0,
        hits = 0
      root.traverse((mesh) => {
        if (!mesh.isMesh || ['Terrace_Paving', 'Plaza_TreeBeds', 'Plaza_Pools'].includes(mesh.name)) return
        const geometry = mesh.geometry,
          pos = geometry.attributes.position,
          index = geometry.index
        const count = Math.floor((index?.count ?? pos.count) / 3)
        const instances = mesh.isInstancedMesh ? mesh.count : 1
        for (let instance = 0; instance < instances; instance++) {
          if (mesh.isInstancedMesh) mesh.getMatrixAt(instance, matrices).premultiply(mesh.matrixWorld)
          else matrices.copy(mesh.matrixWorld)
          for (let k = 0; k < 3; k++) {
            const triangle = Math.min(count - 1, Math.floor((count * (k + 0.37)) / 3))
            point.set(0, 0, 0)
            for (let v = 0; v < 3; v++) {
              const i = index ? index.getX(triangle * 3 + v) : triangle * 3 + v
              point.x += pos.getX(i) / 3
              point.y += pos.getY(i) / 3
              point.z += pos.getZ(i) / 3
            }
            point.applyMatrix4(matrices)
            samples++
            if (insideAnyCollider(point.x, point.y, point.z, 0.08, true) || insideStructure(point.x, point.y, point.z))
              hits++
          }
        }
      })
      coverage.push({ name, samples, hits })
      checks.push([`${name}: all sampled visible surfaces collide`, samples > 0 && hits === samples])
    }
    // Main road remains passable through the mountain gate.
    const gate = new Vector3(0, groundHeight(0, 70), 70),
      gateVelocity = new Vector3()
    let gateBlocked = false
    for (let i = 0; i < 180; i++) {
      stepGround(gate, gateVelocity, new Vector3(0, 0, -1), 0, true, false, 1 / 60)
      gateBlocked ||= bodyInsideAnyCollider(gate.x, gate.y + 0.45, gate.y + 1.7, gate.z, 0.35)
    }
    checks.push(['gate opening remains walkable', !gateBlocked && gate.z < 46])
    // Every hanging bridge keeps its full centre route, with the side ropes/posts solid.
    const bridgeBlocks = [],
      bridgeWalks = []
    for (const bridge of BRIDGES) {
      let blocked = 0
      for (let i = 0; i <= 30; i++) {
        const t = i / 30,
          x = bridge.from[0] + (bridge.to[0] - bridge.from[0]) * t,
          z = bridge.from[2] + (bridge.to[2] - bridge.from[2]) * t
        const y = groundHeight(x, z, deckY(bridge, t)) ?? deckY(bridge, t)
        if (bodyInsideAnyCollider(x, y + 0.45, y + 1.7, z, 0.35)) {
          blocked++
          const sources = surfaceStats()
            .colliders.filter((c) =>
              c.kind === 'mesh'
                ? c.intersects(x, y + 0.45, y + 1.7, z, 0.35, 0)
                : c.kind === 'cylinder'
                  ? !c.open &&
                    y + 1.7 >= c.minY &&
                    y + 0.45 <= c.maxY &&
                    Math.hypot(x - c.x, z - c.z) < c.radius + 0.35 &&
                    !c.cutout?.(x, y + 0.45, y + 1.7, z, 0.35, 0)
                  : x > c.min[0] - 0.35 &&
                    x < c.max[0] + 0.35 &&
                    y + 1.7 > c.min[1] &&
                    y + 0.45 < c.max[1] &&
                    z > c.min[2] - 0.35 &&
                    z < c.max[2] + 0.35,
            )
            .map((c) => (c.kind === 'mesh' ? c.name : c))
          bridgeBlocks.push({ island: bridge.island, t, x, y, z, sources })
        }
      }
      checks.push([`${bridge.island}: bridge centre stays open`, blocked === 0])
      const walker = new Vector3(...bridge.from),
        velocity = new Vector3(),
        input = new Vector3(...bridge.to).sub(walker).setY(0).normalize()
      const destination = new Vector3(...bridge.to).addScaledVector(input, 4)
      for (let i = 0; i < 1800 && walker.distanceTo(destination) > 1.5; i++)
        stepGround(walker, velocity, input, 0, true, false, 1 / 60)
      bridgeWalks.push({
        island: bridge.island,
        end: walker.toArray(),
        velocity: velocity.toArray(),
        ahead: [0, 0.2, 0.5, 1.2, 2].map((d) => {
          const x = walker.x + input.x * d,
            z = walker.z + input.z * d,
            y = groundHeight(x, z, walker.y)
          return {
            d,
            x,
            y,
            z,
            blocked: bodyInsideAnyCollider(x, y + 0.45, y + 1.7, z, 0.35),
            meshes: surfaceStats()
              .colliders.filter((c) => c.kind === 'mesh' && c.intersects(x, y + 0.45, y + 1.7, z, 0.35, 0))
              .map((c) => c.name),
          }
        }),
      })
      checks.push([`${bridge.island}: actual walking crosses bridge`, walker.distanceTo(destination) < 1.5])
    }
    const rail = new Vector3(-70, 24, -69),
      railVelocity = new Vector3()
    for (let i = 0; i < 60; i++) stepGround(rail, railVelocity, new Vector3(0, 0, 1), 0, true, false, 1 / 20)
    checks.push(['balustrade blocks sprint at 20 fps', rail.z > -68.5 && rail.z < -65.5])

    // Flight into the animated kun's underside must stop; its hollow exterior below the belly remains empty.
    const from = kunState.center.clone().add(new Vector3(0, -180, 0)),
      up = new Vector3(0, 1, 0)
    const clearance = kunHullClearance(from, up, 400),
      belly = from.clone().addScaledVector(up, clearance)
    checks.push(['kun underside found', clearance < 400 && clearance > 0])
    checks.push([
      'kun has solid interior and empty exterior',
      kunDepth(belly.x, belly.y + 0.5, belly.z) > 0 && kunDepth(belly.x, belly.y - 2, belly.z) === 0,
    ])
    const flier = belly.clone().addScaledVector(up, -8),
      flightVelocity = up.clone().multiplyScalar(140)
    for (let i = 0; i < 20; i++) stepFlight(flier, flightVelocity, up, 0, 0, true, 1 / 20)
    checks.push(['boosted flight cannot cross kun belly', flier.y <= belly.y + 0.31 && flier.y > belly.y - 3])

    // Chain bollards (Chains.tsx: post 2.66 m at the foot flaring to 1.9 m over 7 m, cap, knob) are solid to their
    // rendered surface, with no ring of empty collision 0.3 m outside the post.
    const { chainRuns } = await window.__liveImport('/src/world/landmarks/Chains.tsx')
    let bollardMisses = 0,
      bollardRings = 0
    const runs = chainRuns()
    for (const { bollard, from } of runs) {
      for (let h = 0.5; h < 7; h += 0.5)
        for (let k = 0; k < 8; k++) {
          const r = 2.66 - (0.76 * h) / 7,
            a = (k * Math.PI) / 4,
            y = bollard.y + h
          if (!insideAnyCollider(bollard.x + Math.cos(a) * (r - 0.02), y, bollard.z + Math.sin(a) * (r - 0.02), 0.08))
            bollardMisses++
          if (
            h >= 1.5 &&
            Math.abs(y - from.y) > 1 &&
            // Above the isle's rock: where its lip rises round the foot, the post is buried in solid stone.
            y >
              (groundHeight(bollard.x + Math.cos(a) * (r + 0.3), bollard.z + Math.sin(a) * (r + 0.3), y + 5) ??
                -Infinity) &&
            insideAnyCollider(bollard.x + Math.cos(a) * (r + 0.3), y, bollard.z + Math.sin(a) * (r + 0.3), 0)
          )
            bollardRings++
        }
      if (!insideAnyCollider(bollard.x, bollard.y + 7 + 1.1 + 1.33 - 0.05, bollard.z, 0.08)) bollardMisses++
      if (!insideAnyCollider(bollard.x + 2.4, bollard.y + 7.35, bollard.z, 0.08)) bollardMisses++
    }
    checks.push(['chain bollards: rendered surface solid', runs.length > 0 && bollardMisses === 0])
    checks.push(['chain bollards: no invisible ring', bollardRings === 0])

    // Crane body vertices around the shoulder axis are unaffected by the wing shader.
    let craneSamples = 0,
      craneHits = 0
    for (const name of ['Prop_crane_lod0', 'Prop_crane_lod1']) {
      const mesh = scene.getObjectByName(name),
        p = mesh.geometry.attributes.position
      for (let j = 0; j < mesh.count; j++) {
        mesh.getMatrixAt(j, matrices).premultiply(mesh.matrixWorld)
        for (let i = 0; i < p.count; i++) {
          if (Math.abs(p.getZ(i)) > 0.05 || p.getY(i) < 0.12) continue
          point.fromBufferAttribute(p, i).applyMatrix4(matrices)
          craneSamples++
          if (insideAnyCollider(point.x, point.y, point.z, 0.25, true)) craneHits++
          break
        }
      }
    }
    checks.push(['all visible cranes have live body collision', craneSamples === 14 && craneHits === 14])
    return {
      checks,
      coverage,
      bridgeBlocks,
      bridgeWalks,
      gate: gate.toArray(),
      rail: rail.toArray(),
      kun: { clearance, belly: belly.toArray(), stopped: flier.toArray() },
      cranes: { samples: craneSamples, hits: craneHits },
      bollards: { runs: runs.length, misses: bollardMisses, rings: bollardRings },
      registered: surfaceStats().colliders.length,
      moving: surfaceStats().movingColliders,
    }
  })
  for (const [name, ok] of report.coverage.checks) assert.ok(ok, name)
  assert.deepEqual(errors, [])
  console.log(
    `PASS model coverage: ${report.coverage.checks.length} checks; ${report.coverage.coverage.reduce((n, row) => n + row.samples, 0)} rendered surface probes`,
  )
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
