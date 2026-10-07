// CPU-only actual Tripo high/low vertices, PBR and four-weight GPU bindings.
// Node 22+: node --experimental-strip-types scripts/verify-tentacle-skinning.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import {
  bindTentacleMotionGeometry,
  createTentacleMotionRig,
  evaluateTentacleMotionVertex,
  sampleTentacleMotion,
  TENTACLE_MOTION_PARAMETERS,
  TENTACLE_MOTION_VERSION,
  updateTentacleMotion,
} from '../src/world/blackMist/tentacleMotion.ts'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function extract(file) {
  const bytes = await fs.readFile(file),
    doc = await io.readBinary(bytes),
    positions = [],
    indices = [],
    pbr = []
  for (const node of doc.getRoot().listNodes())
    if (node.getMesh()) {
      const transform = new Matrix4().fromArray(node.getWorldMatrix())
      for (const primitive of node.getMesh().listPrimitives()) {
        const position = primitive.getAttribute('POSITION'),
          offset = positions.length / 3,
          indexed = primitive.getIndices(),
          material = primitive.getMaterial()
        for (let index = 0; index < (indexed?.getCount() ?? position.getCount()); index++)
          indices.push(offset + (indexed ? indexed.getScalar(index) : index))
        for (let index = 0; index < position.getCount(); index++)
          positions.push(...new Vector3(...position.getElement(index, [])).applyMatrix4(transform).toArray())
        const maps = {
          baseColor: material?.getBaseColorTexture(),
          normal: material?.getNormalTexture(),
          roughness: material?.getMetallicRoughnessTexture(),
        }
        assert.ok(
          Object.values(maps).every(Boolean) &&
            primitive.getAttribute('NORMAL') &&
            primitive.getAttribute('TEXCOORD_0'),
          'actual PBR/normal/UV data is retained',
        )
        pbr.push(
          Object.fromEntries(
            Object.entries(maps).map(([channel, texture]) => [
              channel,
              { name: texture.getName(), size: texture.getSize() },
            ]),
          ),
        )
      }
    }
  return { file, sha256: hash(bytes), positions, indices, pbr, bounds: getBounds(doc.getRoot().listScenes()[0]) }
}
const high = await extract('public/assets/black-mist/abyss-tentacle.glb'),
  low = await extract('public/assets/black-mist/abyss-tentacle.lod1.glb')
const size = high.bounds.max[1] - high.bounds.min[1],
  base = new Vector3()
let count = 0
for (let index = 0; index < high.positions.length; index += 3)
  if (high.positions[index + 1] <= high.bounds.min[1] + size * 0.06) {
    base.add(new Vector3(...high.positions.slice(index, index + 3)))
    count++
  }
base.divideScalar(count)
base.y = high.bounds.min[1]
const normalization = new Matrix4()
  .makeScale(1 / size, 1 / size, 1 / size)
  .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z))
const rig = createTentacleMotionRig(normalization),
  point = new Vector3(),
  posed = new Vector3()
const report = {
  source: 'actual high/low GLB four-weight buffers',
  version: TENTACLE_MOTION_VERSION,
  parameters: TENTACLE_MOTION_PARAMETERS,
  sourceNormalization: normalization.toArray(),
  bounds: rig.bounds,
  geometry: [],
  rootDrift: 0,
  maxBoneLengthError: 0,
  phaseTipDisplacement: [],
  maxVertexDisplacement: 0,
  maxEdgeStretch: 0,
  minimumEdgeStretch: 1,
  volumeRatios: [],
  regions: {},
  strain: [],
  worstEdges: [],
  maxBoundaryVelocityJump: 0,
  failure: null,
}
const sources = [],
  poses = new Map()
const addPose = (time, slot) => poses.set(`${time}:${slot}`, { time, slot })
function signedVolume(position, indices) {
  let volume = 0
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3,
      b = indices[index + 1] * 3,
      c = indices[index + 2] * 3
    volume +=
      position[a] * (position[b + 1] * position[c + 2] - position[b + 2] * position[c + 1]) +
      position[a + 1] * (position[b + 2] * position[c] - position[b] * position[c + 2]) +
      position[a + 2] * (position[b] * position[c + 1] - position[b + 1] * position[c])
  }
  return volume / 6
}
try {
  const lowerCenter = rig.rest[1].clone().lerp(rig.rest[2], 0.35),
    middleCenter = rig.rest[2].clone().lerp(rig.rest[3], 0.6)
  const targets = {
    root: rig.rest[0].clone(),
    lower: lowerCenter.clone().add(new Vector3(0, 0, 0.15 * rig.unitHeight)),
    middle: middleCenter.clone().add(new Vector3(0, 0, 0.13 * rig.unitHeight)),
    crook: rig.rest[5].clone(),
    tip: rig.rest[11].clone(),
  }
  for (const [lod, source] of [high, low].entries()) {
    const values = new Float32Array(source.positions.length)
    for (let index = 0; index < source.positions.length; index += 3)
      point.fromArray(source.positions, index).applyMatrix4(normalization).toArray(values, index)
    const geometry = new BufferGeometry()
      .setAttribute('position', new BufferAttribute(values, 3))
      .setIndex(source.indices)
    const before = hash(Buffer.from(values.buffer))
    bindTentacleMotionGeometry(geometry, rig, 8)
    assert.equal(hash(Buffer.from(values.buffer)), before, 'binding preserves every actual source position')
    const joints = geometry.getAttribute('aTentacleJoints'),
      weights = geometry.getAttribute('aTentacleWeights')
    let movingLowerBindings = 0
    const probes = Object.entries(targets).map(([id, target]) => {
      let best = Infinity,
        index = 0
      for (let candidate = 0; candidate < values.length / 3; candidate++) {
        point.fromArray(values, candidate * 3)
        const distance = point.distanceToSquared(target)
        if (distance < best) {
          best = distance
          index = candidate
        }
      }
      return {
        id,
        index,
        rest: Array.from(values.slice(index * 3, index * 3 + 3)),
        maxDisplacement: 0,
        time: 0,
        slot: 0,
      }
    })
    for (let index = 0; index < joints.count; index++) {
      let sum = 0
      for (let influence = 0; influence < 4; influence++) {
        const joint = joints.getComponent(index, influence),
          weight = weights.getComponent(index, influence)
        assert.ok(Number.isInteger(joint) && joint >= 0 && joint < 12 && weight >= 0 && weight <= 1)
        sum += weight
        if (
          values[index * 3 + 1] >= 0.15 &&
          values[index * 3 + 1] <= 0.35 &&
          (joint === 1 || joint === 2) &&
          weight > 0.1
        )
          movingLowerBindings++
      }
      assert.ok(Math.abs(sum - 1) < 1e-6, 'actual four weights sum to one')
    }
    assert.ok(movingLowerBindings > 100, 'real lower-shaft skin binds to active bones 1/2')
    const result = {
      lod,
      file: source.file,
      sha256: source.sha256,
      vertices: joints.count,
      originalPositionHash: before,
      pbr: source.pbr,
      movingLowerBindings,
      deformationBound: geometry.userData.tentacleMotion.deformationBound,
      probes,
    }
    report.geometry.push(result)
    sources.push({ geometry, values, indices: source.indices, result })
  }
  for (let slot = 0; slot < 8; slot++) {
    let maxTip = 0
    for (let time = 0; time <= 140; time += 0.5) {
      updateTentacleMotion(rig, time)
      for (let joint = 1; joint < rig.rest.length; joint++)
        report.maxBoneLengthError = Math.max(
          report.maxBoneLengthError,
          Math.abs(
            rig.posed[slot][joint].distanceTo(rig.posed[slot][joint - 1]) /
              rig.rest[joint].distanceTo(rig.rest[joint - 1]) -
              1,
          ),
        )
      const tip = sampleTentacleMotion(rig, 1, slot)
      maxTip = Math.max(maxTip, new Vector3(...tip.posed).distanceTo(new Vector3(...tip.rest)) / rig.unitHeight)
      for (const source of sources)
        for (const probe of source.result.probes) {
          evaluateTentacleMotionVertex(source.geometry, rig, probe.index, posed, slot)
          const displacement = posed.distanceTo(new Vector3(...probe.rest)) / rig.unitHeight
          if (displacement > probe.maxDisplacement) {
            probe.maxDisplacement = displacement
            probe.time = time
            probe.slot = slot
          }
        }
    }
    report.phaseTipDisplacement.push(maxTip)
  }
  for (const source of sources)
    for (const probe of source.result.probes) {
      report.regions[`${source.result.lod}:${probe.id}`] = { ...probe }
      if (probe.id !== 'root') addPose(probe.time, probe.slot)
      if (probe.id === 'lower')
        assert.ok(
          probe.maxDisplacement >= 0.02 && probe.maxDisplacement <= 0.055,
          'actual lower shaft visibly bends 2–5% of height',
        )
      if (probe.id === 'middle')
        assert.ok(
          probe.maxDisplacement >= 0.05 && probe.maxDisplacement <= 0.125,
          'actual middle shaft bends 5–12% of height',
        )
      if (probe.id === 'crook')
        assert.ok(
          probe.maxDisplacement >= 0.075 && probe.maxDisplacement <= 0.18,
          'real crook participates without excessive folding',
        )
      if (probe.id === 'tip')
        assert.ok(
          probe.maxDisplacement >= 0.12 && probe.maxDisplacement <= 0.205,
          'actual tip visibly articulates within 12–20% of height',
        )
    }
  assert.ok(report.maxBoneLengthError < 1e-6, 'measured muscle segments retain length')
  for (let slot = 0; slot < 8; slot++) addPose(8, slot)
  const upperPercentiles = []
  for (const { time, slot } of poses.values()) {
    updateTentacleMotion(rig, time)
    for (const source of sources) {
      const moved = new Float64Array(source.values.length)
      for (let index = 0; index < source.values.length / 3; index++) {
        evaluateTentacleMotionVertex(source.geometry, rig, index, posed, slot)
        posed.toArray(moved, index * 3)
        point.fromArray(source.values, index * 3)
        const displacement = posed.distanceTo(point) / rig.unitHeight
        report.maxVertexDisplacement = Math.max(report.maxVertexDisplacement, displacement)
        assert.ok(
          displacement * rig.unitHeight <= source.result.deformationBound + 1e-6,
          'real geometry stays inside the expanded culling sphere',
        )
        if (point.y <= rig.rest[0].y + rig.unitHeight * TENTACLE_MOTION_PARAMETERS.rootHeight)
          report.rootDrift = Math.max(report.rootDrift, posed.distanceTo(point))
      }
      const stretches = []
      for (let triangle = 0; triangle < source.indices.length; triangle += 3)
        for (let edge = 0; edge < 3; edge++) {
          const a = source.indices[triangle + edge] * 3,
            b = source.indices[triangle + ((edge + 1) % 3)] * 3
          const rest = Math.hypot(
            source.values[a] - source.values[b],
            source.values[a + 1] - source.values[b + 1],
            source.values[a + 2] - source.values[b + 2],
          )
          if (rest < 0.0001 * rig.unitHeight) continue
          const ratio = Math.hypot(moved[a] - moved[b], moved[a + 1] - moved[b + 1], moved[a + 2] - moved[b + 2]) / rest
          stretches.push(ratio)
          report.maxEdgeStretch = Math.max(report.maxEdgeStretch, ratio)
          report.minimumEdgeStretch = Math.min(report.minimumEdgeStretch, ratio)
          if (ratio > 1.8 && source.result.lod === 0)
            report.worstEdges.push({
              ratio,
              time,
              slot,
              length: rest,
              a: Array.from(source.values.slice(a, a + 3)),
              b: Array.from(source.values.slice(b, b + 3)),
              jointsA: [0, 1, 2, 3].map((k) => source.geometry.getAttribute('aTentacleJoints').getComponent(a / 3, k)),
              weightsA: [0, 1, 2, 3].map((k) =>
                source.geometry.getAttribute('aTentacleWeights').getComponent(a / 3, k),
              ),
              jointsB: [0, 1, 2, 3].map((k) => source.geometry.getAttribute('aTentacleJoints').getComponent(b / 3, k)),
              weightsB: [0, 1, 2, 3].map((k) =>
                source.geometry.getAttribute('aTentacleWeights').getComponent(b / 3, k),
              ),
            })
        }
      stretches.sort((a, b) => a - b)
      const volumeRatio = signedVolume(moved, source.indices) / signedVolume(source.values, source.indices)
      report.volumeRatios.push(volumeRatio)
      const strain = {
        lod: source.result.lod,
        time,
        slot,
        minimum: stretches[0],
        maximum: stretches.at(-1),
        percentiles: [0.001, 0.01, 0.5, 0.99, 0.999].map((p) => stretches[Math.floor((stretches.length - 1) * p)]),
        volumeRatio,
      }
      report.strain.push(strain)
      upperPercentiles.push(strain.percentiles[4])
    }
  }
  assert.ok(report.rootDrift < 1e-7, 'every real vertex in the fixed bottom 6.5% stays fixed')
  report.worstEdges.sort((a, b) => b.ratio - a.ratio)
  report.worstEdges = report.worstEdges.slice(0, 8)
  assert.ok(report.maxEdgeStretch < 1.5, 'full-muscle articulation does not tear short real triangles')
  assert.ok(Math.max(...upperPercentiles) < 1.25, '99.9% of each posed LOD edges preserve muscle shape closely')
  assert.ok(
    report.volumeRatios.every((ratio) => ratio > 0.9 && ratio < 1.1),
    'real mesh volume stays within10% through full-muscle poses',
  )
  for (const time of [16, 70, 140, 630])
    for (let slot = 0; slot < 8; slot++) {
      const source = sources[0],
        index = source.result.probes.find((probe) => probe.id === 'middle').index,
        epsilon = 0.0001
      updateTentacleMotion(rig, time - epsilon)
      const before = evaluateTentacleMotionVertex(source.geometry, rig, index, new Vector3(), slot)
      updateTentacleMotion(rig, time)
      const at = evaluateTentacleMotionVertex(source.geometry, rig, index, new Vector3(), slot)
      updateTentacleMotion(rig, time + epsilon)
      const after = evaluateTentacleMotionVertex(source.geometry, rig, index, new Vector3(), slot)
      report.maxBoundaryVelocityJump = Math.max(
        report.maxBoundaryVelocityJump,
        before
          .sub(at)
          .multiplyScalar(-1 / epsilon)
          .distanceTo(after.sub(at).multiplyScalar(1 / epsilon)),
      )
    }
  assert.ok(report.maxBoundaryVelocityJump < 0.002 * rig.unitHeight, 'shaft velocity has no phase jumps')
  for (const source of [high, low])
    assert.equal(hash(await fs.readFile(source.file)), source.sha256, 'approved GLB remains untouched')
  console.log(
    'PASS real high/low buffers, full-muscle articulation, fixed root, volume and PBR',
    JSON.stringify({
      version: report.version,
      regions: report.regions,
      rootDrift: report.rootDrift,
      maxBoneLengthError: report.maxBoneLengthError,
      maxVertexDisplacement: report.maxVertexDisplacement,
      maxEdgeStretch: report.maxEdgeStretch,
      volumeRange: [Math.min(...report.volumeRatios), Math.max(...report.volumeRatios)],
      maxBoundaryVelocityJump: report.maxBoundaryVelocityJump,
    }),
  )
} catch (error) {
  report.failure = error.stack ?? String(error)
  throw error
} finally {
  sources.forEach(({ geometry }) => geometry.dispose())
  await fs.mkdir('artifacts/black-mist/tentacle-motion', { recursive: true })
  await fs.writeFile(
    'artifacts/black-mist/tentacle-motion/skinning-report.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
