import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { openWorld, review, telemetry } from './lib/world-session.mjs'

// Building tissue, mutations attached to the posed Kun/turtle, and exploration on their original decks.
// BASE_URL / CHROME_PATH follow world-session. Run this GPU verification on its own.
// --cinematic-only captures both carrier shots and checks their settings freeze without repeating deck/quality tests.
const OUT = 'artifacts/black-mist-mutations'
const CINEMATIC_ONLY = process.argv.includes('--cinematic-only')
const QUALITIES = ['high', 'mid', 'low']
const MAX_DRAW_CALLS = 400
const VIEWS = {
  main: [
    [0, 80, -115],
    [25, 130, -210],
  ],
  gate: [
    [55, 18, 100],
    [15, 26, 55],
  ],
  tower: [
    [-135, 60, -100],
    [-200, 72, -170],
  ],
  wide: [
    [-780, 640, 900],
    [0, 260, -380],
  ],
  distant: [
    [-2800, 1200, 2400],
    [0, 260, -380],
  ],
}
const report = { checks: [], timeline: [], tiers: [], decks: {}, frames: [], errors: [], failure: null }
const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]))
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
const draws = (group) =>
  group?.visible
    ? (Array.isArray(group.draws) ? group.draws : (group.models ?? [])).filter((draw) => draw.instances > 0)
    : []
const instances = (group) => draws(group).reduce((sum, draw) => sum + draw.instances, 0)
const isFar = (draw) => draw.lod === 1 || draw.lod === 'far'
const groups = (mutations) => [mutations.buildings, mutations.carriers.kun, mutations.carriers.turtle]
const fullPbr = (draw) => draw.triangles > 0 && draw.pbr?.baseColor && draw.pbr.normal && draw.pbr.roughness
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear&kunAt=40&turtleAt=0', {
  width: 1600,
  height: 900,
})
report.errors = errors
const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())

async function seek(time) {
  await page.evaluate((value) => {
    window.__blackMist.hold(true)
    window.__blackMist.seek(value)
  }, time)
  await page.waitForTimeout(450)
  const state = await snapshot()
  assert.ok(
    state.mutations?.buildings && state.mutations.carriers?.kun && state.mutations.carriers.turtle,
    'DEV snapshot.mutations must contain building tissue and both carriers',
  )
  return state
}

async function capture(name) {
  const bytes = await page.screenshot({ path: `${OUT}/${name}.png` })
  const gray = await sharp(bytes).greyscale().toBuffer()
  const {
    channels: [luma],
  } = await sharp(gray).stats()
  const frame = { name, mean: Number(luma.mean.toFixed(1)), stdev: Number(luma.stdev.toFixed(1)) }
  report.frames.push(frame)
  check(`${name} renders a scene with visible depth`, frame.mean > 7 && frame.mean < 240 && frame.stdev > 5)
}

function assertAttachment(carrier, id) {
  check(
    `${id} has visible parasites attached to the actual skinned body`,
    carrier.visible &&
      carrier.anchors.length >= 2 &&
      carrier.anchors.every(
        (anchor) =>
          anchor.skinned &&
          anchor.triangle?.length === 3 &&
          anchor.boneNames?.length &&
          finitePoint(anchor.referencePosition) &&
          finitePoint(anchor.renderedPosition),
      ),
  )
  for (const anchor of carrier.anchors) {
    const error = distance(anchor.referencePosition, anchor.renderedPosition)
    // The smaller parasites are recessed into the skin; their membrane edge is the visible seam.
    assert.ok(error < 4.2, `${id}/${anchor.id}: attachment drift ${error.toFixed(3)} m`)
  }
  check(`${id} rendered origins remain on independently posed skin anchors`, true)
  check(
    `${id} has curved tissue transitions on its live body surface`,
    carrier.conformance?.length > 0 &&
      carrier.conformance.every((patch) => patch.samples >= 10 && patch.edgeSamples.length >= 8),
  )
  for (const patch of carrier.conformance) {
    check(
      `${id}/${patch.detail}: skin palette matches Three's independent posed vertices`,
      patch.maxSkinErrorMeters < 0.001,
    )
    check(
      `${id}/${patch.detail}: membrane rims remain embedded in actual skin`,
      patch.maxSeamGapMeters < 0.3 &&
        patch.edgeSamples.every(
          (sample) =>
            finitePoint(sample.referencePosition) &&
            finitePoint(sample.renderedPosition) &&
            sample.triangle.length === 3 &&
            sample.barycentrics.length === 3 &&
            Math.abs(sample.barycentrics.reduce((sum, value) => sum + value, 0) - 1) < 0.00001 &&
            sample.barycentrics.every((value) => value >= -0.000001) &&
            distance(sample.referencePosition, sample.renderedPosition) < 0.3,
        ),
    )
  }
  check(
    `${id} uses normal-mapped PBR geometry for its mutation`,
    draws(carrier).length > 0 && draws(carrier).every(fullPbr),
  )
}

function assertBuildingCoverage(buildings, quality) {
  const byBuilding = new Map()
  for (const site of buildings.sites) {
    const list = byBuilding.get(site.buildingId) ?? []
    list.push(site)
    byBuilding.set(site.buildingId, list)
  }
  const main = byBuilding.get('MG01') ?? [],
    gate = byBuilding.get('MG02') ?? []
  const towers = [...byBuilding.entries()].filter(([id]) => id.startsWith('MG04_Tower'))
  check(
    `${quality}: main hall, gate and all six towers have dense tissue sites`,
    main.length >= 120 && gate.length >= 24 && towers.length === 6 && towers.every(([, sites]) => sites.length >= 20),
  )
  check(
    `${quality}: tissue anchors cover physical side surfaces and preserve walkable tops`,
    buildings.sites.every((site) => finitePoint(site.position) && finitePoint(site.normal) && site.normal[1] <= 0.35) &&
      new Set(buildings.sites.map((site) => site.position.map((value) => value.toFixed(2)).join(','))).size >
        buildings.sites.length * 0.95,
  )
  const verticalSpan = (sites) =>
    Math.max(...sites.map((site) => site.position[1])) - Math.min(...sites.map((site) => site.position[1]))
  check(
    `${quality}: coverage spans walls and columns at several heights`,
    verticalSpan(main) > 30 && verticalSpan(gate) > 8 && towers.every(([, sites]) => verticalSpan(sites) > 10),
  )
  check(
    `${quality}: building tissue has normal and roughness maps with visible geometry`,
    instances(buildings) > 0 &&
      draws(buildings).every(fullPbr) &&
      draws(buildings).every((draw) => draw.textureSize?.every((size) => size >= 256)),
  )
  return {
    quality,
    sites: buildings.sites.length,
    main: main.length,
    gate: gate.length,
    towers: Object.fromEntries(towers.map(([id, sites]) => [id, sites.length])),
  }
}

async function assertPausedShot(time, expectedId) {
  await seek(time)
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await page.locator('.settings-dialog').waitFor()
  const before = await snapshot()
  await page.waitForTimeout(500)
  const after = await snapshot()
  check(
    `${expectedId} is a real cinematic camera shot`,
    before.cameraShot?.id === expectedId && finitePoint(before.cameraShot.eye) && finitePoint(before.cameraShot.aim),
  )
  check(
    `${expectedId} settings freeze its moving-carrier camera`,
    before.manualPaused && after.elapsed === before.elapsed && distance(before.camera, after.camera) < 0.001,
  )
  await capture(`paused-${expectedId}`)
  await page.locator('.settings-resume').click()
  await page.locator('.settings-dialog').waitFor({ state: 'detached' })
  await capture(`cinematic-${expectedId}`)
}

async function sampleDecks() {
  return page.evaluate(async () => {
    const [kun, turtle, carriers, three] = await Promise.all([
      window.__liveImport('/src/world/colossi/kunDeck.ts'),
      window.__liveImport('/src/world/colossi/turtleDeck.ts'),
      window.__liveImport('/src/world/colossi/carriers.ts'),
      window.__liveImport('/node_modules/.vite/deps/three.js'),
    ])
    const { Vector3 } = three
    const sample = (id, orbPosition, count) =>
      Array.from({ length: count }, (_, index) => {
        const point = orbPosition(index, new Vector3())
        const hit = point && carriers.carrierHit(point.x, point.z, point.y)
        const anchor = hit && carriers.carrierAnchor(hit)
        const reference = anchor && carriers.evaluateCarrierAnchor(anchor, new Vector3())
        const open =
          hit && carriers.carrierClearance(new Vector3(point.x, hit.y + 0.2, point.z), new Vector3(0, 1, 0), 3)
        return {
          id,
          index,
          point: point?.toArray(),
          surfaceId: hit?.surfaceId,
          normalY: hit?.normalY,
          open,
          anchor: anchor && { triangle: anchor.triangle, u: anchor.u, v: anchor.v, surfaceId: anchor.surfaceId },
          error: reference && reference.distanceTo(new Vector3(point.x, hit.y, point.z)),
        }
      })
    return {
      kun: { ready: kun.kunState.ready, dockable: kun.kunDockable(), spots: sample('kun', kun.kunOrbPosition, 6) },
      turtle: {
        ready: turtle.turtleState.ready,
        dockable: carriers.carrierDockable('turtle'),
        spots: sample('turtle', turtle.turtleOrbPosition, 3),
      },
    }
  })
}

async function resetCarrierTimes() {
  await page.evaluate(() => {
    window.__kunSetTime(40)
    window.__turtleSetTime(0)
  })
  await page.waitForTimeout(300)
}

async function boardAndWalk(id) {
  const boarded = await page.evaluate(async (id) => {
    const [deck, carriers, player, three] = await Promise.all([
      window.__liveImport(`/src/world/colossi/${id === 'kun' ? 'kunDeck' : 'turtleDeck'}.ts`),
      window.__liveImport('/src/world/colossi/carriers.ts'),
      window.__liveImport('/src/world/player/playerHandle.ts'),
      window.__liveImport('/node_modules/.vite/deps/three.js'),
    ])
    const state = id === 'kun' ? deck.kunState : deck.turtleState
    const point = (id === 'kun' ? deck.kunOrbPosition : deck.turtleOrbPosition)(0, new three.Vector3())
    const hit = point && carriers.carrierHit(point.x, point.z, point.y)
    return hit?.surfaceId === id && player.teleportPlayer([point.x, hit.y + 0.1, point.z], Math.PI - state.heading)
  }, id)
  check(`the player can board the mutated ${id} on its preserved deck`, boarded)
  await page.waitForFunction((id) => window.__playerSnapshot().aboard?.surfaceId === id, id, { timeout: 10000 })
  const start = await page.evaluate(() => window.__playerSnapshot())
  await page.waitForTimeout(650)
  const drift = await page.evaluate(async (address) => {
    const [carriers, player, three] = await Promise.all([
      window.__liveImport('/src/world/colossi/carriers.ts'),
      window.__liveImport('/src/world/player/playerHandle.ts'),
      window.__liveImport('/node_modules/.vite/deps/three.js'),
    ])
    const expected = carriers.evaluateCarrierAnchor(address, new three.Vector3())
    return expected ? player.getPlayerRuntime().position.distanceTo(expected) : Infinity
  }, start.aboard)
  check(`standing on the mutated ${id} keeps a stable moving anchor`, drift < 0.35)
  await page.keyboard.down('w')
  try {
    await page.waitForTimeout(900)
  } finally {
    await page.keyboard.up('w')
  }
  const moved = await page.evaluate(async (address) => {
    const [carriers, player, three] = await Promise.all([
      window.__liveImport('/src/world/colossi/carriers.ts'),
      window.__liveImport('/src/world/player/playerHandle.ts'),
      window.__liveImport('/node_modules/.vite/deps/three.js'),
    ])
    const runtime = player.getPlayerRuntime(),
      expected = carriers.evaluateCarrierAnchor(address, new three.Vector3())
    return {
      aboard: runtime.aboard?.surfaceId,
      displacement: expected && runtime.position.distanceTo(expected),
      inAir: runtime.inAir,
    }
  }, start.aboard)
  check(`walking remains possible on the mutated ${id}`, moved.aboard === id && moved.displacement > 1 && !moved.inAir)
  report.decks[id] = { ...report.decks[id], standingDrift: drift, walkDisplacement: moved.displacement }
  await capture(`walking-${id}`)
  await page.evaluate(async () => {
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    if (!teleportPlayer([0, 24.1, -116], 0)) throw Error('Could not leave the stable carrier deck')
  })
}

try {
  await page.waitForFunction(
    async () => {
      const kun = await window.__liveImport('/src/world/colossi/kunDeck.ts'),
        turtle = await window.__liveImport('/src/world/colossi/turtleDeck.ts')
      return kun.kunState.ready && turtle.turtleState.ready
    },
    null,
    { timeout: 180000 },
  )
  const normal = await snapshot()
  check(
    'normal exploration has no visible mutation draws',
    normal.mutations && groups(normal.mutations).every((group) => !group.visible && instances(group) === 0),
  )
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
  )
  check(
    'normal exploration does not request mutation models or maps',
    !resources.some((url) => /\/assets\/black-mist\/.*\.(?:glb|webp|png)$/.test(url)),
  )
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 70000 })
  for (const time of [0, 28, 37, 45, 48, 60]) {
    const state = await seek(time)
    report.timeline.push({
      elapsed: time,
      buildings: state.mutations.buildings.growth,
      kun: state.mutations.carriers.kun.growth,
      turtle: state.mutations.carriers.turtle.growth,
    })
    check(
      `${time}s mutation growth is finite and bounded`,
      groups(state.mutations).every((group) => Number.isFinite(group.growth) && group.growth >= 0 && group.growth <= 1),
    )
    if (time === 0)
      check(
        'replay starts with unmutated buildings and carriers',
        groups(state.mutations).every((group) => !group.visible && group.growth === 0),
      )
  }
  check(
    'building and both carrier mutations emerge progressively',
    ['buildings', 'kun', 'turtle'].every((id) => {
      const values = report.timeline.map((frame) => frame[id])
      return (
        values.some((value) => value > 0 && value < 1) &&
        values.every((value, index) => index === 0 || value >= values[index - 1]) &&
        values.at(-1) > 0.9
      )
    }),
  )
  await assertPausedShot(45, 'kun-mutation')
  await assertPausedShot(48, 'turtle-mutation')
  if (!CINEMATIC_ONLY) {
    await page.evaluate(() => {
      window.__blackMist.skip()
      window.__blackMist.hold(true)
      window.__ui.setHudHidden(true)
    })
    await resetCarrierTimes()
    const before = (await snapshot()).mutations.carriers
    for (const id of ['kun', 'turtle']) assertAttachment(before[id], id)
    await page.waitForTimeout(600)
    const after = (await snapshot()).mutations.carriers
    for (const id of ['kun', 'turtle']) {
      assertAttachment(after[id], id)
      check(
        `${id} mutations follow the moving posed body instead of orbiting independently`,
        after[id].anchors.some((anchor) => {
          const previous = before[id].anchors.find((candidate) => candidate.id === anchor.id)
          return (
            previous &&
            distance(previous.referencePosition, anchor.referencePosition) > 0.1 &&
            distance(previous.renderedPosition, anchor.renderedPosition) > 0.1
          )
        }),
      )
    }
    for (const quality of QUALITIES) {
      await page.evaluate(async (value) => {
        const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
        useWorldStore.getState().setQuality(value, false)
      }, quality)
      for (const [view, pose] of Object.entries(VIEWS)) {
        await review(page, pose, 1000)
        const state = await snapshot(),
          sample = await telemetry(page)
        check(
          `${quality}/${view} preserves the scene draw-call budget`,
          sample.drawCalls > 0 && sample.drawCalls <= MAX_DRAW_CALLS,
        )
        if (view === 'main') report.tiers.push(assertBuildingCoverage(state.mutations.buildings, quality))
        check(
          `${quality}/${view} keeps all mutations after the cinematic`,
          groups(state.mutations).every((group) => group.visible && group.growth > 0.9),
        )
        if (view === 'main' && quality !== 'low')
          check(
            `${quality}: close architecture keeps the detailed tissue LOD`,
            draws(state.mutations.buildings).some((draw) => !isFar(draw)),
          )
        if (quality === 'low' || view === 'distant')
          check(
            `${quality}/${view}: distant and low-quality mutations use reduced LODs`,
            groups(state.mutations).every((group) => draws(group).every(isFar)),
          )
        report.tiers.at(-1).views ??= []
        report.tiers.at(-1).views.push({
          view,
          drawCalls: sample.drawCalls,
          triangles: sample.triangles,
          mutations: groups(state.mutations).map((group) => ({ growth: group.growth, draws: draws(group) })),
        })
        if ((quality === 'high' && view !== 'distant') || view === 'wide') await capture(`${quality}-${view}`)
      }
    }
    check(
      'quality tiers reduce building density without removing a building class',
      report.tiers[0].sites > report.tiers[1].sites && report.tiers[1].sites > report.tiers[2].sites,
    )
    await page.evaluate(() => window.__environmentReview(null))
    await resetCarrierTimes()
    const deckSamples = await sampleDecks()
    for (const id of ['kun', 'turtle']) {
      check(
        `the original ${id} deck query and docking window survive mutation`,
        deckSamples[id].ready && deckSamples[id].dockable,
      )
      check(
        `several ${id} deck locations remain safe and precisely anchored`,
        deckSamples[id].spots.length >= 3 &&
          deckSamples[id].spots.every(
            (spot) =>
              spot.surfaceId === id &&
              spot.anchor &&
              spot.normalY >= Math.cos((52 * Math.PI) / 180) &&
              spot.open >= 1.8 &&
              spot.error < 0.05,
          ),
      )
      report.decks[id] = deckSamples[id]
    }
    await page.evaluate(() => window.__ui.setHudHidden(false))
    await page.locator('.black-mist-explore').click()
    await page.waitForFunction(() => !!document.pointerLockElement)
    await boardAndWalk('kun')
    await boardAndWalk('turtle')
    await page.evaluate(() => {
      window.__blackMist.reset()
      window.__blackMist.hold(true)
    })
    await page.waitForTimeout(400)
    check(
      'replaying clears mature tissue before regrowth begins',
      groups((await snapshot()).mutations).every((group) => !group.visible && group.growth === 0),
    )
    await seek(48)
    check(
      'replaying grows new tissue again',
      groups((await snapshot()).mutations).every((group) => group.visible && group.growth > 0),
    )
    await page.evaluate(async () => {
      const { stopBlackMist } = await window.__liveImport('/src/world/blackMist/runtime.ts')
      stopBlackMist()
    })
    await page.waitForTimeout(400)
    check(
      'leaving Black Mist clears every building and carrier mutation',
      groups((await snapshot()).mutations).every((group) => !group.visible && instances(group) === 0),
    )
  }
  check('mutation geometry and materials render without browser or shader errors', errors.length === 0)
} catch (error) {
  report.failure = error.stack ?? String(error)
  const state = await snapshot().catch(() => null)
  if (state)
    report.failureState = {
      active: state.active,
      elapsed: state.elapsed,
      corruption: state.corruption,
      assets: state.assets,
      camera: state.camera,
      mutations: state.mutations,
    }
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(
    `${OUT}/${CINEMATIC_ONLY ? 'report-cinematic' : 'report'}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser.close()
}
