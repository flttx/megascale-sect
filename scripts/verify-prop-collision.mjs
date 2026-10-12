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
      const { Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
      const { buildPropLayout } = await window.__liveImport('/src/world/props/placement.ts')
      const { PROP_IDS } = await window.__liveImport('/src/world/props/propCatalog.ts')
      const { propCollisionShapes, placePropColliders } = await window.__liveImport('/src/world/props/colliders.ts')
      const { surfaceStats, bodyInsideAnyCollider, insideAnyCollider } =
        await window.__liveImport('/src/world/surfaces.ts')
      const { stepGround } = await window.__liveImport('/src/world/player/GroundController.tsx')
      const { stepFlight } = await window.__liveImport('/src/world/player/FlightController.tsx')
      const { groundHeight } = await window.__liveImport('/src/world/worldLayout.ts')
      const scene = window.__postfx().composer.passes.find((pass) => pass.scene?.getObjectByName('PropField')).scene
      const layout = buildPropLayout(),
        density = { high: 1, mid: 0.7, low: 0.4 }[quality]
      const key = (c) => [c.x, c.z, c.minY, c.maxY, c.radius].map((n) => n.toFixed(5)).join('/')
      const registered = new Set(
        surfaceStats()
          .colliders.filter((c) => c.kind === 'cylinder')
          .map(key),
      )
      const meshNames = new Set(
        surfaceStats()
          .colliders.filter((c) => c.kind === 'mesh')
          .map((c) => c.name),
      )
      const shapes = {},
        checks = [],
        counts = {}
      for (const id of PROP_IDS) {
        shapes[id] = propCollisionShapes(id, scene.getObjectByName(`Prop_${id}_lod0`).geometry)
        const visible = layout.props[id].filter((p) => p.rank < density)
        const hidden = layout.props[id].filter((p) => p.rank >= density)
        counts[id] = { instances: visible.length, slices: shapes[id].length }
        if (!shapes[id].length) {
          checks.push([
            `${id} mesh density matches render`,
            layout.props[id].every((p, i) => meshNames.has(`Prop_${id}/${i}`) === p.rank < density),
          ])
          continue
        }
        checks.push([
          `${id} visible registered`,
          visible.every((p) => placePropColliders(shapes[id], p).every((c) => registered.has(key(c)))),
        ])
        checks.push([
          `${id} hidden unregistered`,
          hidden.every((p) => placePropColliders(shapes[id], p).every((c) => !registered.has(key(c)))),
        ])
        if (id.startsWith('pine'))
          checks.push([`${id} trunk is narrow`, Math.max(...shapes[id].map((s) => s.radius)) < 1.5])
      }
      const paths = []
      for (const [id, x, z] of [
        ['rock_moss', 50, -73],
        ['rock_scholar', 36, -74],
        ['pine_guest', 44, -80],
      ]) {
        const placement = layout.props[id].find((p) => p.x === x && p.z === z)
        const floor = groundHeight(x, z)
        const slices = placePropColliders(shapes[id], placement)
        const slice = slices
          .filter((c) => c.minY < floor + 1.7 && c.maxY > floor + 0.45)
          .sort((a, b) => b.radius - a.radius)[0]
        for (const fps of [20, 60, 144])
          for (const sprint of [false, true]) {
            const position = new Vector3(slice.x + slice.radius + 2, floor, slice.z),
              velocity = new Vector3()
            const start = position.x
            let penetrated = bodyInsideAnyCollider(position.x, floor + 0.45, floor + 1.7, position.z, 0.35)
            for (let n = 0; n < fps * 2; n++) {
              stepGround(position, velocity, new Vector3(-1, 0, 0), 0, sprint, false, 1 / fps)
              penetrated ||= bodyInsideAnyCollider(position.x, position.y + 0.45, position.y + 1.7, position.z, 0.35)
            }
            checks.push([
              `${id} walk ${fps}/${sprint}`,
              !penetrated && position.x < start - 0.5 && position.x >= slice.x + slice.radius + 0.34,
            ])
            paths.push({ id, fps, sprint, start, end: position.toArray(), penetrated })
          }
        const position = new Vector3(slice.x + slice.radius + 5, floor + 1, slice.z),
          velocity = new Vector3(-140, 0, 0)
        let penetrated = false
        for (let n = 0; n < 20; n++) {
          stepFlight(position, velocity, new Vector3(-1, 0, 0), 0, 0, true, 1 / 20)
          penetrated ||= insideAnyCollider(position.x, position.y, position.z, 0, true)
        }
        checks.push([`${id} boosted flight`, !penetrated && position.x > slice.x])
        const escape = new Vector3(slice.x, floor, slice.z),
          speed = new Vector3()
        for (let n = 0; n < 120; n++) stepGround(escape, speed, new Vector3(1, 0, 0), 0, false, false, 1 / 60)
        checks.push([`${id} old save can escape`, escape.x > slice.x + slice.radius + 0.35])
      }
      return {
        quality,
        counts,
        registered: registered.size,
        meshColliders: meshNames.size,
        moving: surfaceStats().movingColliders,
        checks,
        paths,
      }
    }, quality)
    report.runs.push(result)
    for (const [name, ok] of result.checks) assert.ok(ok, `${quality}: ${name}`)
    console.log(`PASS ${quality}: ${result.checks.length} checks; ${result.registered} cylinder slices`)
  }
  assert.equal(
    report.runs[0].registered,
    report.runs[3].registered,
    'switching back must not leak collider registrations',
  )
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
