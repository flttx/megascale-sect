// CPU-only complement to verify-horror-clearance: actual articulated creature vertices vs world terrain/pillars.
// node --experimental-strip-types scripts/verify-horror-terrain.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  OUT = path.join(ROOT, 'artifacts/horror-terrain')
const STRIDE = 47,
  VISIBLE_Y = -84,
  POINT = new Vector3()
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !path.extname(specifier))
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
    return next(specifier, context)
  },
})
const moduleAt = (file) => import(pathToFileURL(path.join(ROOT, file)).href)
const { HORROR_LAYOUT: SHARED_HORROR_LAYOUT } = await moduleAt('src/world/blackMist/horrorLayout.ts')
const fixtureTideZ = process.env.TEST_TIDE_Z === undefined ? null : Number(process.env.TEST_TIDE_Z)
assert.ok(
  fixtureTideZ === null || (Number.isFinite(fixtureTideZ) && fixtureTideZ >= -3300 && fixtureTideZ <= 2700),
  'offline Tide fixture Z stays inside world bounds',
)
const HORROR_LAYOUT =
  fixtureTideZ === null
    ? SHARED_HORROR_LAYOUT
    : SHARED_HORROR_LAYOUT.map((placement) =>
        placement.id === 'behemoth-tide'
          ? { ...placement, position: [placement.position[0], placement.position[1], fixtureTideZ] }
          : placement,
      )
const { worldTerrainHeight } = await moduleAt('src/world/regions/regions.ts')
const { PILLARS, PILLAR_BASE_Y } = await moduleAt('src/world/sites.ts')
const {
  bindHorrorGeometry,
  createHorrorRig,
  evaluateHorrorMotionVertex,
  sampleHorrorMotion,
  sampleHorrorPlacement,
  updateHorrorRig,
} = await moduleAt('src/world/blackMist/horrorMotion.ts')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function load(placement, lod = 0, sharedNormalization) {
  const file = `public/assets/black-mist/${placement.sourceType === 'watcher' ? 'shroud-watcher' : 'abyss-behemoth'}${lod ? '.lod1' : ''}.glb`
  const bytes = await fs.readFile(path.join(ROOT, file)),
    doc = await io.readBinary(bytes),
    root = doc.getRoot()
  const sourceBounds = getBounds(root.listScenes()[0]),
    sourceHeight = sourceBounds.max[1] - sourceBounds.min[1]
  const normalization =
    sharedNormalization ??
    new Matrix4()
      .makeScale(1 / sourceHeight, 1 / sourceHeight, 1 / sourceHeight)
      .multiply(new Matrix4().makeRotationY(placement.sourceYaw))
      .multiply(
        new Matrix4().makeTranslation(
          -(sourceBounds.min[0] + sourceBounds.max[0]) / 2,
          -sourceBounds.min[1],
          -(sourceBounds.min[2] + sourceBounds.max[2]) / 2,
        ),
      )
  const values = [],
    primitives = []
  for (const node of root.listNodes())
    if (node.getMesh()) {
      const transform = normalization.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()))
      for (const primitive of node.getMesh().listPrimitives()) {
        const position = primitive.getAttribute('POSITION'),
          material = primitive.getMaterial()
        const maps = {
          baseColor: material?.getBaseColorTexture(),
          normal: material?.getNormalTexture(),
          roughness: material?.getMetallicRoughnessTexture(),
        }
        assert.ok(
          position && material && Object.values(maps).every(Boolean),
          `${placement.id} retains its actual inspected PBR maps`,
        )
        assert.ok(
          primitive.getAttribute('NORMAL') && primitive.getAttribute('TEXCOORD_0'),
          `${placement.id} retains authored normals/UVs`,
        )
        primitives.push({
          node: node.getName(),
          material: material.getName(),
          vertices: position.getCount(),
          triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
          pbr: Object.fromEntries(
            Object.entries(maps).map(([channel, texture]) => [
              channel,
              { present: true, name: texture.getName(), size: texture.getSize(), mimeType: texture.getMimeType() },
            ]),
          ),
        })
        for (let index = 0; index < position.getCount(); index++)
          values.push(...POINT.fromArray(position.getElement(index, [])).applyMatrix4(transform).toArray())
      }
    }
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(values), 3))
  const geometryHash = digest(Buffer.from(geometry.getAttribute('position').array.buffer)),
    rig = createHorrorRig(placement.sourceType, placement.phase)
  bindHorrorGeometry(geometry, rig)
  assert.equal(
    digest(Buffer.from(geometry.getAttribute('position').array.buffer)),
    geometryHash,
    `${placement.id} binding preserves real source vertices`,
  )
  assert.ok(
    geometry.getAttribute('position').count >= (lod ? 12000 : 44000),
    `${placement.id} checks its real source LOD${lod}`,
  )
  return { file, lod, sha256: digest(bytes), sourceBounds, geometryHash, primitives, geometry, rig, normalization }
}

function phaseTimes(placement) {
  const schedule = sampleHorrorMotion(placement, 0),
    times = new Set(Array.from({ length: 16 }, (_, index) => (placement.patrol.period * index) / 16))
  for (const time of [
    34,
    37,
    schedule.roarStart,
    schedule.roarStart + 1.3,
    schedule.roarEnd - 0.35,
    placement.patrol.period - 1,
  ])
    times.add(time)
  return [...times].sort((a, b) => a - b)
}

function inspectSourcePose(loaded, matrix, tag, result, phase) {
  const positions = loaded.geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += STRIDE) {
    evaluateHorrorMotionVertex(loaded.geometry, loaded.rig, index, POINT).applyMatrix4(matrix)
    if (POINT.y <= VISIBLE_Y) continue
    phase.visibleSamples++
    result.visibleSamples++
    const height = worldTerrainHeight(POINT.x, POINT.z),
      terrainGap = POINT.y - height
    if (terrainGap < result.minimumTerrainGap) {
      result.minimumTerrainGap = terrainGap
      result.nearestTerrain = { ...tag, lod: loaded.lod, index, point: POINT.toArray(), terrain: height }
    }
    if (terrainGap <= 0) {
      result.terrainIntersections++
      phase.terrainIntersections++
    }
    for (const pillar of PILLARS) {
      const horizontal = Math.hypot(POINT.x - pillar.x, POINT.z - pillar.z) - pillar.radius
      const vertical = Math.max(POINT.y - pillar.topY, PILLAR_BASE_Y - POINT.y, 0)
      const gap =
        horizontal < 0 && vertical === 0
          ? Math.max(horizontal, POINT.y - pillar.topY, PILLAR_BASE_Y - POINT.y)
          : Math.hypot(Math.max(0, horizontal), vertical)
      if (gap < result.minimumPillarGap) {
        result.minimumPillarGap = gap
        result.nearestPillar = {
          ...tag,
          lod: loaded.lod,
          index,
          point: POINT.toArray(),
          pillar: { id: pillar.id, x: pillar.x, z: pillar.z, topY: pillar.topY, radius: pillar.radius },
          horizontal,
          vertical,
        }
      }
      if (horizontal <= 0 && vertical === 0) {
        result.pillarIntersections++
        phase.pillarIntersections++
      }
    }
  }
}

const report = {
  method:
    'Sampled visible actual source vertices: unchanged high-model walk/settle/roar/recover checks, plus both LODs at four patrol anchors, eight turn/target octants, four grounded/flying target heights, either hand and three attack poses. Not a continuous-time or full-triangle terrain proof. Companion clearance clips all actual source triangles for body envelopes.',
  baseline:
    'One-time CPU discovery at previous centers: watcher [-1770,-160,-1050] had 858 terrain/0 pillar hits; behemoth [1770,-180,-1050] had 3256 terrain/370 pillar hits in the initial 21/22-pose samples. Those obsolete layouts are not rerun.',
  stride: STRIDE,
  visibleFloor: VISIBLE_Y,
  pillarModel: 'Shared PILLARS mean-radius cylinders, PILLAR_BASE_Y through topY.',
  offlineFixture: fixtureTideZ === null ? null : { id: 'behemoth-tide', z: fixtureTideZ, productionUnchanged: true },
  creatures: [],
  sourceHashes: {},
  failure: null,
}
try {
  for (const placement of HORROR_LAYOUT) {
    const loaded = await load(placement),
      low = await load(placement, 1, loaded.normalization),
      levels = [loaded, low]
    const times = phaseTimes(placement),
      positions = loaded.geometry.getAttribute('position')
    const result = {
      id: placement.id,
      sourceType: placement.sourceType,
      center: placement.position,
      height: placement.height,
      patrol: placement.patrol,
      source: loaded.file,
      sha256: loaded.sha256,
      sources: levels.map((source) => ({
        lod: source.lod,
        file: source.file,
        sha256: source.sha256,
        geometryHash: source.geometryHash,
        vertices: source.geometry.getAttribute('position').count,
        primitives: source.primitives,
      })),
      vertices: positions.count,
      geometryHash: loaded.geometryHash,
      primitives: loaded.primitives,
      bindings: {
        joints: { count: loaded.geometry.getAttribute('aHorrorJoints').count, itemSize: 4 },
        weights: { count: loaded.geometry.getAttribute('aHorrorWeights').count, itemSize: 4 },
      },
      times,
      visibleSamples: 0,
      terrainIntersections: 0,
      pillarIntersections: 0,
      minimumTerrainGap: Infinity,
      minimumPillarGap: Infinity,
      nearestTerrain: null,
      nearestPillar: null,
      phases: [],
      idleVisibleSamples: 0,
      attackEvidence: {
        targets: 32,
        octants: 8,
        hands: 2,
        heightsNormalized: [-0.2, 0.2, 0.65, 1.15],
        patrolAnchors: 4,
        phases: ['windup:1', 'strike:.35', 'strike:1'],
        lods: 2,
        stride: STRIDE,
        poses: 0,
        visibleSamples: 0,
        class: 'Sampled actual geometry against shared world functions; not an all-time/full-triangle terrain proof',
      },
    }
    report.creatures.push(result)
    levels.forEach((source) => {
      report.sourceHashes[source.file] = source.sha256
    })
    for (const time of times) {
      const sampled = sampleHorrorPlacement(placement, time)
      updateHorrorRig(loaded.rig, placement, sampled.motion)
      const phase = {
        time,
        phase: sampled.motion.phase,
        visibleSamples: 0,
        terrainIntersections: 0,
        pillarIntersections: 0,
      }
      // Fully revealed body for every phase; apparition masking cannot hide a collision.
      inspectSourcePose(loaded, sampled.matrix, { time, phase: sampled.motion.phase }, result, phase)
      result.idleVisibleSamples += phase.visibleSamples
      result.phases.push(phase)
    }
    assert.ok(
      result.idleVisibleSamples > 10000,
      `${result.id} preserves the original meaningful high-LOD idle coverage`,
    )
    for (const fraction of [0.1, 0.35, 0.65, 0.9])
      for (let target = 0; target < 32; target++)
        for (const hand of [0, 1]) {
          for (const [phaseName, progress] of [
            ['windup', 1],
            ['strike', 0.35],
            ['strike', 1],
          ]) {
            const time = placement.patrol.period * fraction,
              sampled = sampleHorrorPlacement(placement, time)
            const angle = ((target % 8) * Math.PI) / 4,
              localTarget = [
                0.7 * Math.sin(angle),
                [-0.2, 0.2, 0.65, 1.15][Math.floor(target / 8)],
                0.7 * Math.cos(angle),
              ]
            const motion = {
              ...sampled.motion,
              time,
              stepStrength: 0,
              velocity: [0, 0, 0],
              angularVelocity: 0,
              roarStrength: 0,
              headLift: 0,
              roarEvent: false,
            }
            const yaw = sampled.yaw + angle,
              matrix = new Matrix4()
                .makeTranslation(...sampled.position)
                .multiply(new Matrix4().makeRotationY(yaw))
                .multiply(new Matrix4().makeScale(placement.height, placement.height, placement.height))
            const phase = { visibleSamples: 0, terrainIntersections: 0, pillarIntersections: 0 }
            for (const source of levels) {
              updateHorrorRig(source.rig, placement, motion, yaw - motion.yawOffset, {
                phase: phaseName,
                progress,
                sequence: 1,
                localTarget,
                hand,
              })
              inspectSourcePose(
                source,
                matrix,
                { time, phase: phaseName, progress, target, targetHeight: localTarget[1], hand, yaw },
                result,
                phase,
              )
            }
            result.attackEvidence.poses++
            result.attackEvidence.visibleSamples += phase.visibleSamples
          }
        }
    for (const source of levels) {
      assert.equal(
        digest(await fs.readFile(path.join(ROOT, source.file))),
        source.sha256,
        `${placement.id} LOD${source.lod} GLB stays untouched`,
      )
      source.geometry.dispose()
    }
  }
  for (const file of [
    'src/world/blackMist/horrorLayout.ts',
    'src/world/blackMist/horrorMotion.ts',
    'src/world/regions/regions.ts',
    'src/world/environment/t02r/terrain.ts',
    'src/world/sites.ts',
  ])
    report.sourceHashes[file] = digest(await fs.readFile(path.join(ROOT, file)))
  for (const result of report.creatures) {
    assert.ok(result.visibleSamples > 10000, `${result.id} has meaningful visible source coverage`)
    assert.equal(result.terrainIntersections, 0, `${result.id} sampled anatomy stays above rendered terrain`)
    assert.equal(result.pillarIntersections, 0, `${result.id} sampled anatomy clears the shared pillar cylinders`)
  }
} catch (error) {
  report.failure = error.stack ?? String(error)
  throw error
} finally {
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    {
      report: path.join(OUT, 'report.json'),
      creatures: report.creatures.map(
        ({
          id,
          center,
          vertices,
          times,
          visibleSamples,
          terrainIntersections,
          pillarIntersections,
          minimumTerrainGap,
          minimumPillarGap,
        }) => ({
          id,
          center,
          vertices,
          poses: times.length,
          visibleSamples,
          terrainIntersections,
          pillarIntersections,
          minimumTerrainGap,
          minimumPillarGap,
        }),
      ),
    },
    null,
    2,
  ),
)
