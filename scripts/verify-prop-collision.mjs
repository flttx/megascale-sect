import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

const out = 'artifacts/prop-collision'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear')
const report = { runs: [], errors, failure: null }
try {
  for (const quality of ['high', 'low', 'mid', 'high']) {
    await page.evaluate(async (level) => {
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      useWorldStore.getState().setQuality(level, false)
    }, quality)
    await page.waitForTimeout(1800)
    const result = await page.evaluate(async (quality) => {
      const { Matrix4, Quaternion, Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
      const { buildPropLayout } = await window.__liveImport('/src/world/props/placement.ts')
      const { PROP_IDS, isPine } = await window.__liveImport('/src/world/props/propCatalog.ts')
      const { pineBarkGeometry } = await window.__liveImport('/src/world/props/colliders.ts')
      const { boulderShape, boulderShapeGeometries } = await window.__liveImport('/src/world/props/stoneSource.ts')
      const { surfaceStats, bodyInsideAnyCollider, insideAnyCollider } =
        await window.__liveImport('/src/world/surfaces.ts')
      const { stepGround } = await window.__liveImport('/src/world/player/GroundController.tsx')
      const { stepFlight } = await window.__liveImport('/src/world/player/FlightController.tsx')
      const { groundHeight } = await window.__liveImport('/src/world/worldLayout.ts')
      const scene = window.__postfx().composer.passes.find((pass) => pass.scene?.getObjectByName('PropField')).scene
      const layout = buildPropLayout(),
        density = { high: 1, mid: 0.7, low: 0.4 }[quality]
      const meshNames = new Set(
        surfaceStats()
          .colliders.filter((c) => c.kind === 'mesh')
          .map((c) => c.name),
      )
      const checks = [],
        counts = {}
      // Every prop collides with its rendered mesh; pines with their bark only, so needle cards stay passable.
      for (const id of PROP_IDS) {
        const name = isPine(id) ? `Prop_${id}_bark` : `Prop_${id}`
        counts[id] = { instances: layout.props[id].filter((p) => p.rank < density).length }
        checks.push([
          `${id} mesh density matches render`,
          layout.props[id].every((p, i) => meshNames.has(`${name}/${i}`) === p.rank < density),
        ])
      }
      const paths = []
      for (const [id, x, z] of [
        ['rock_moss', 50, -73],
        ['rock_scholar', 36, -74],
        ['pine_guest', 44, -80],
      ]) {
        const placement = layout.props[id].find((p) => p.x === x && p.z === z)
        const floor = groundHeight(x, z)
        // How far the collision mesh reaches from the placement axis at torso height.
        const source = scene.getObjectByName(`Prop_${id}_lod0`).geometry
        const boulders = source.getAttribute('aBoulder') ? boulderShapeGeometries(source) : null
        const solid = isPine(id)
          ? pineBarkGeometry(source)
          : (boulders?.[boulderShape(x, z, boulders.length)] ?? source)
        const matrix = new Matrix4().compose(
          new Vector3(x, placement.y, z),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), placement.yaw),
          new Vector3().setScalar(placement.scale),
        )
        const index = solid.index,
          positions = solid.attributes.position,
          vertex = new Vector3()
        let reach = 0
        for (let i = 0; i < index.count; i++) {
          vertex.fromBufferAttribute(positions, index.getX(i)).applyMatrix4(matrix)
          if (vertex.y >= floor + 0.45 && vertex.y <= floor + 1.7)
            reach = Math.max(reach, Math.hypot(vertex.x - x, vertex.z - z))
        }
        checks.push([`${id} solid at torso height`, reach > 0.1])
        for (const fps of [20, 60, 144])
          for (const sprint of [false, true]) {
            const position = new Vector3(x + reach + 2, floor, z),
              velocity = new Vector3()
            const start = position.x
            let penetrated = bodyInsideAnyCollider(position.x, floor + 0.45, floor + 1.7, position.z, 0.35)
            for (let n = 0; n < fps * 2; n++) {
              stepGround(position, velocity, new Vector3(-1, 0, 0), 0, sprint, false, 1 / fps)
              penetrated ||= bodyInsideAnyCollider(position.x, position.y + 0.45, position.y + 1.7, position.z, 0.35)
            }
            // No air gap: the body stops at the obstacle itself, which blocks it 0.3 m further on.
            const contactY = groundHeight(position.x - 0.3, position.z, position.y) ?? position.y
            const contact = bodyInsideAnyCollider(position.x - 0.3, contactY + 0.45, contactY + 1.7, position.z, 0.35)
            checks.push([`${id} walk ${fps}/${sprint}`, !penetrated && contact && position.x < start - 0.5])
            paths.push({ id, fps, sprint, start, end: position.toArray(), penetrated })
          }
        const position = new Vector3(x + reach + 5, floor + 1, z),
          velocity = new Vector3(-140, 0, 0)
        let penetrated = false
        for (let n = 0; n < 20; n++) {
          stepFlight(position, velocity, new Vector3(-1, 0, 0), 0, 0, true, 1 / 20)
          penetrated ||= insideAnyCollider(position.x, position.y, position.z, 0, true)
        }
        checks.push([`${id} boosted flight`, !penetrated && position.x > x])
        const escape = new Vector3(x, floor, z),
          speed = new Vector3()
        for (let n = 0; n < 120; n++) stepGround(escape, speed, new Vector3(1, 0, 0), 0, false, false, 1 / 60)
        checks.push([
          `${id} old save can escape`,
          escape.x > x + reach + 0.35 &&
            !bodyInsideAnyCollider(escape.x, escape.y + 0.45, escape.y + 1.7, escape.z, 0.35),
        ])
      }
      return {
        quality,
        counts,
        meshColliders: meshNames.size,
        moving: surfaceStats().movingColliders,
        checks,
        paths,
      }
    }, quality)
    report.runs.push(result)
    for (const [name, ok] of result.checks) assert.ok(ok, `${quality}: ${name}`)
    console.log(`PASS ${quality}: ${result.checks.length} checks; ${result.meshColliders} mesh colliders`)
  }
  assert.equal(
    report.runs[0].meshColliders,
    report.runs[3].meshColliders,
    'mesh registrations must not leak across tiers',
  )
  report.keyboard = []
  for (const id of ['rock_moss', 'pine_guest']) {
    const route = report.runs[0].paths.find((p) => p.id === id && p.fps === 60 && p.sprint)
    await page.evaluate(async (route) => {
      const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
      teleportPlayer([route.start, route.end[1], route.end[2]], -Math.PI / 2)
    }, route)
    await page.keyboard.down('Shift')
    await page.keyboard.down('w')
    await page.waitForTimeout(2000)
    await page.keyboard.up('w')
    await page.keyboard.up('Shift')
    const position = await page.evaluate(() => window.__playerSnapshot().position)
    report.keyboard.push({ id, position })
    assert.ok(
      position[0] < route.start - 0.5 && position[0] >= route.end[0] - 0.2,
      `${id}: real keyboard motion stops at obstacle`,
    )
    await page.screenshot({ path: `${out}/${id}-blocked.png` })
  }
  assert.deepEqual(errors, [])
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
