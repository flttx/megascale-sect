// No browser/GPU needed: actual approved GLB vertices, shared production samplers and palette.
// Node 22+: node --experimental-strip-types scripts/verify-horror-skinning.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three'
import { HORROR_LAYOUT } from '../src/world/blackMist/horrorLayout.ts'
import {
  bindHorrorGeometry,
  createHorrorRig,
  evaluateHorrorMotionVertex,
  sampleHorrorMotion,
  sampleHorrorPlacement,
  updateHorrorRig,
} from '../src/world/blackMist/horrorMotion.ts'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
async function load(id, lod, normalization) {
  const name = id === 'watcher' ? 'shroud-watcher' : 'abyss-behemoth'
  const doc = await io.read(`public/assets/black-mist/${name}${lod ? '.lod1' : ''}.glb`)
  const bounds = getBounds(doc.getRoot().listScenes()[0])
  if (!normalization) {
    const height = bounds.max[1] - bounds.min[1]
    normalization = new Matrix4()
      .makeScale(1 / height, 1 / height, 1 / height)
      .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
      .multiply(
        new Matrix4().makeTranslation(
          -(bounds.min[0] + bounds.max[0]) / 2,
          -bounds.min[1],
          -(bounds.min[2] + bounds.max[2]) / 2,
        ),
      )
  }
  const positions = []
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    const transform = normalization.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix())),
      raw = [0, 0, 0]
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute('POSITION')
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, raw)
        positions.push(...new Vector3(...raw).applyMatrix4(transform).toArray())
      }
    }
  }
  return {
    geometry: new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3)),
    normalization,
  }
}
const report = { creatures: [], failure: null }
try {
  for (const placement of HORROR_LAYOUT) {
    const high = await load(placement.sourceType, 0),
      low = await load(placement.sourceType, 1, high.normalization),
      rig = createHorrorRig(placement.sourceType, placement.phase)
    const result = {
      id: placement.id,
      geometry: [],
      maxSourceDisplacement: 0,
      maxContinuityJump: 0,
      maxBoundaryVelocityJump: 0,
      walkProbeDisplacement: 0,
      headRise: 0,
      roarFeetDrift: 0,
    }
    const hash = (geometry) =>
      createHash('sha256')
        .update(Buffer.from(geometry.getAttribute('position').array.buffer))
        .digest('hex')
    for (const source of [high, low]) {
      const before = hash(source.geometry)
      bindHorrorGeometry(source.geometry, rig)
      assert.equal(hash(source.geometry), before, 'authored GLB positions stay intact')
      result.geometry.push({
        vertices: source.geometry.getAttribute('position').count,
        joints: source.geometry.getAttribute('aHorrorJoints').itemSize,
        weights: source.geometry.getAttribute('aHorrorWeights').itemSize,
        sourceHash: before,
      })
    }
    const targets = [new Vector3(0, 0.78, 0.26), ...rig.limbs.map((limb) => limb.foot)],
      indices = []
    const positions = high.geometry.getAttribute('position'),
      vertex = new Vector3(),
      posed = new Vector3()
    for (const target of targets) {
      let best = Infinity,
        chosen = 0
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i)
        const d = vertex.distanceToSquared(target)
        if (d < best) {
          best = d
          chosen = i
        }
      }
      indices.push(chosen)
    }
    const period = placement.patrol.period
    for (let time = 0; time <= period * 2; time += 0.5) {
      const sample = sampleHorrorMotion(placement, time)
      updateHorrorRig(rig, placement, sample)
      for (let i = 0; i < positions.count; i += 29) {
        vertex.fromBufferAttribute(positions, i)
        evaluateHorrorMotionVertex(high.geometry, rig, i, posed)
        result.maxSourceDisplacement = Math.max(result.maxSourceDisplacement, posed.distanceTo(vertex))
      }
      if (sample.phase === 'walk' && sample.stepStrength > 0.5) {
        for (const index of indices.slice(1)) {
          vertex.fromBufferAttribute(positions, index)
          evaluateHorrorMotionVertex(high.geometry, rig, index, posed)
          result.walkProbeDisplacement = Math.max(result.walkProbeDisplacement, posed.distanceTo(vertex))
        }
      }
      if (sample.phase === 'roar' && sample.roarStrength > 0.9) {
        vertex.fromBufferAttribute(positions, indices[0])
        evaluateHorrorMotionVertex(high.geometry, rig, indices[0], posed)
        result.headRise = Math.max(result.headRise, posed.y - vertex.y)
        for (const index of indices.slice(1)) {
          vertex.fromBufferAttribute(positions, index)
          evaluateHorrorMotionVertex(high.geometry, rig, index, posed)
          result.roarFeetDrift = Math.max(result.roarFeetDrift, posed.distanceTo(vertex))
        }
      }
    }
    const phase = sampleHorrorMotion(placement, 0),
      boundaries = [0, phase.roarStart - 2.8, phase.roarStart, phase.roarEnd, period]
    for (const boundary of boundaries) {
      const at = boundary === 0 ? period : boundary
      const epsilon = 0.0001,
        beforeTime = at - epsilon,
        afterTime = at + epsilon
      updateHorrorRig(rig, placement, sampleHorrorMotion(placement, beforeTime))
      const before = indices.map((index) => evaluateHorrorMotionVertex(high.geometry, rig, index, new Vector3()))
      updateHorrorRig(rig, placement, sampleHorrorMotion(placement, afterTime))
      indices.forEach((index, i) => {
        result.maxContinuityJump = Math.max(
          result.maxContinuityJump,
          before[i].distanceTo(evaluateHorrorMotionVertex(high.geometry, rig, index, new Vector3())),
        )
      })
      const a = sampleHorrorPlacement(placement, beforeTime),
        b = sampleHorrorPlacement(placement, afterTime)
      assert.ok(a.position.distanceTo(b.position) < 0.01, 'patrol closes without teleporting')
      const qa = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw),
        qb = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b.yaw)
      assert.ok(qa.angleTo(qb) < 0.001, 'body facing closes continuously')
      updateHorrorRig(rig, placement, sampleHorrorMotion(placement, at - epsilon * 2))
      const outerBefore = indices.map((index) => evaluateHorrorMotionVertex(high.geometry, rig, index, new Vector3()))
      updateHorrorRig(rig, placement, sampleHorrorMotion(placement, at + epsilon * 2))
      indices.forEach((index, i) => {
        const velocityBefore = before[i].clone().sub(outerBefore[i]).divideScalar(epsilon)
        const innerAfter = evaluateHorrorMotionVertex(high.geometry, rig, index, new Vector3())
        updateHorrorRig(rig, placement, sampleHorrorMotion(placement, afterTime))
        const velocityAfter = innerAfter
          .sub(evaluateHorrorMotionVertex(high.geometry, rig, index, new Vector3()))
          .divideScalar(epsilon)
        result.maxBoundaryVelocityJump = Math.max(
          result.maxBoundaryVelocityJump,
          velocityBefore.distanceTo(velocityAfter),
        )
        updateHorrorRig(rig, placement, sampleHorrorMotion(placement, at + epsilon * 2))
      })
    }
    assert.ok(result.walkProbeDisplacement > 0.015, 'actual limbs articulate during walking')
    assert.ok(result.headRise > 0.008, 'actual head rises during the roar')
    assert.ok(result.roarFeetDrift < 0.004, 'wrists plant while stopped and roaring')
    assert.ok(result.maxContinuityJump < 0.0003, 'source probe poses remain continuous at phase and cycle boundaries')
    assert.ok(result.maxBoundaryVelocityJump < 0.005, 'source probe velocities remain continuous at phase boundaries')
    report.creatures.push(result)
    console.log('PASS', JSON.stringify(result))
  }
} catch (error) {
  report.failure = error.stack ?? String(error)
  throw error
} finally {
  await fs.mkdir('artifacts/black-mist/horror-motion', { recursive: true })
  await fs.writeFile('artifacts/black-mist/horror-motion/skinning-report.json', JSON.stringify(report, null, 2))
}
