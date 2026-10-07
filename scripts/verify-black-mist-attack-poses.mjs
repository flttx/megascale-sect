// CPU-only source pose check. No browser, paid generation, or substitute geometry.
// node --experimental-strip-types scripts/verify-black-mist-attack-poses.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import { HORROR_LAYOUT } from '../src/world/blackMist/horrorLayout.ts'
import {
  bindHorrorGeometry,
  createHorrorRig,
  evaluateHorrorMotionVertex,
  sampleHorrorMotion,
  updateHorrorRig,
} from '../src/world/blackMist/horrorMotion.ts'
import {
  bindTentacleMotionGeometry,
  createTentacleMotionRig,
  evaluateTentacleMotionVertex,
  sampleTentacleBehavior,
  tentacleContactSourceSections,
  TENTACLE_INTERACTION_LIMITS,
  updateTentacleMotion,
} from '../src/world/blackMist/tentacleMotion.ts'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function load(name, lod) {
  const file = `public/assets/black-mist/${name}${lod ? '.lod1' : ''}.glb`,
    bytes = await fs.readFile(file),
    doc = await io.readBinary(bytes)
  const positions = [],
    indices = [],
    pbr = []
  for (const node of doc.getRoot().listNodes())
    if (node.getMesh())
      for (const primitive of node.getMesh().listPrimitives()) {
        const transform = new Matrix4().fromArray(node.getWorldMatrix()),
          position = primitive.getAttribute('POSITION'),
          offset = positions.length / 3
        const material = primitive.getMaterial(),
          maps = [
            material?.getBaseColorTexture(),
            material?.getNormalTexture(),
            material?.getMetallicRoughnessTexture(),
          ]
        assert.ok(
          maps.every(Boolean) && primitive.getAttribute('NORMAL') && primitive.getAttribute('TEXCOORD_0'),
          'real PBR, normals and UVs',
        )
        pbr.push(maps.map((texture) => ({ name: texture.getName(), size: texture.getSize() })))
        const indexed = primitive.getIndices()
        for (let i = 0; i < (indexed?.getCount() ?? position.getCount()); i++)
          indices.push(offset + (indexed ? indexed.getScalar(i) : i))
        for (let i = 0; i < position.getCount(); i++)
          positions.push(...new Vector3(...position.getElement(i, [])).applyMatrix4(transform).toArray())
      }
  return { file, sha256: hash(bytes), bounds: getBounds(doc.getRoot().listScenes()[0]), positions, indices, pbr }
}
function geometry(source, normalization) {
  const values = new Float32Array(source.positions.length),
    point = new Vector3()
  for (let i = 0; i < values.length; i += 3)
    point.fromArray(source.positions, i).applyMatrix4(normalization).toArray(values, i)
  return new BufferGeometry().setAttribute('position', new BufferAttribute(values, 3)).setIndex(source.indices)
}
function nearest(g, target) {
  const positions = g.getAttribute('position'),
    p = new Vector3()
  let best = Infinity,
    index = 0
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i)
    const d = p.distanceToSquared(target)
    if (d < best) {
      best = d
      index = i
    }
  }
  return index
}
const report = { sources: [], tentacles: {}, creatures: [], failure: null }
try {
  const raw = [await load('abyss-tentacle', 0), await load('abyss-tentacle', 1)],
    h = raw[0].bounds.max[1] - raw[0].bounds.min[1]
  const root = new Vector3()
  let count = 0
  for (let i = 0; i < raw[0].positions.length; i += 3)
    if (raw[0].positions[i + 1] <= raw[0].bounds.min[1] + h * 0.06) {
      root.add(new Vector3(...raw[0].positions.slice(i, i + 3)))
      count++
    }
  root.divideScalar(count)
  root.y = raw[0].bounds.min[1]
  const norm = new Matrix4()
    .makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new Matrix4().makeTranslation(-root.x, -root.y, -root.z))
  const rig = createTentacleMotionRig(norm, undefined, { interactive: true }),
    gs = raw.map((source) => geometry(source, norm))
  gs.forEach((g) => bindTentacleMotionGeometry(g, rig, 8))
  const contacts = tentacleContactSourceSections(gs[0], rig),
    point = new Vector3(),
    posed = new Vector3()
  const result = (report.tentacles = {
    parameters: TENTACLE_INTERACTION_LIMITS,
    samples: [],
    rootDrift: 0,
    maxDisplacement: 0,
    maxContactRadius: 0,
    maxContactGap: 0,
    maxEdgeStretch: 0,
    cullingOverflow: 0,
    recoveryJump: 0,
    directionDot: [],
  })
  for (const [lod, source] of raw.entries())
    report.sources.push({
      file: source.file,
      sha256: source.sha256,
      pbr: source.pbr,
      vertices: gs[lod].getAttribute('position').count,
    })
  for (let direction = 0; direction < 8; direction++) {
    const angle = (direction * Math.PI) / 4,
      localTarget = [0.5 * Math.sin(angle), 0.3, 0.24 + 0.5 * Math.cos(angle)]
    const controls = Array.from({ length: 8 }, (_, slot) => ({
      seed: slot * 19 + 31,
      sequence: 1,
      localTarget,
      phase: 'windup',
      progress: 1,
    }))
    updateTentacleMotion(rig, 37, 1, controls)
    const before = gs.map((g) =>
      [nearest(g, rig.rest[5]), nearest(g, rig.rest[11])].map((index) =>
        evaluateTentacleMotionVertex(g, rig, index, new Vector3(), 0),
      ),
    )
    for (const phase of ['windup', 'strike'])
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        controls.forEach((control) => {
          control.phase = phase
          control.progress = progress
        })
        updateTentacleMotion(rig, 37, 1, controls)
        for (const [lod, g] of gs.entries()) {
          const positions = g.getAttribute('position')
          for (let index = 0; index < positions.count; index += 47) {
            point.fromBufferAttribute(positions, index)
            evaluateTentacleMotionVertex(g, rig, index, posed, direction)
            result.maxDisplacement = Math.max(result.maxDisplacement, posed.distanceTo(point))
            if (point.y <= 0.065 * rig.unitHeight)
              result.rootDrift = Math.max(result.rootDrift, posed.distanceTo(point))
            result.cullingOverflow = Math.max(
              result.cullingOverflow,
              posed.distanceTo(g.boundingSphere.center) - g.boundingSphere.radius,
            )
          }
          if (phase === 'strike' && progress === 1) {
            const tip = nearest(g, rig.rest[11]),
              current = evaluateTentacleMotionVertex(g, rig, tip, new Vector3(), 0)
            const crook = nearest(g, rig.rest[5]),
              crookPose = evaluateTentacleMotionVertex(g, rig, crook, new Vector3(), 0)
            result.samples.push({
              lod,
              direction,
              index: tip,
              anticipationToStrike: current.distanceTo(before[lod][1]),
              crookSwing: crookPose.distanceTo(before[lod][0]),
            })
          }
        }
        const sections = contacts.map((section) => {
          const vertices = section.indices.map((index) =>
            evaluateTentacleMotionVertex(gs[0], rig, index, new Vector3(), direction),
          )
          const center = vertices
            .reduce((sum, vertex) => sum.add(vertex), new Vector3())
            .multiplyScalar(1 / vertices.length)
          const radius = Math.max(...vertices.map((vertex) => vertex.distanceTo(center)))
          result.maxContactRadius = Math.max(result.maxContactRadius, radius)
          return { center, radius }
        })
        sections.slice(1).forEach((section, i) => {
          result.maxContactGap = Math.max(result.maxContactGap, section.center.distanceTo(sections[i].center))
        })
      }
    // Cancellation captures the actual anticipation instead of jumping to an unplayed strike.
    controls.forEach((control) => {
      control.phase = 'windup'
      control.progress = 0.38
    })
    updateTentacleMotion(rig, 37, 1, controls)
    const cancellation = evaluateTentacleMotionVertex(gs[0], rig, contacts[3].indices[0], new Vector3(), 0)
    const capture = rig.behavior[0]
    controls.forEach((control) => {
      control.phase = 'recover'
      control.progress = 0
      control.recoveryFrom = capture
    })
    updateTentacleMotion(rig, 37, 1, controls)
    result.recoveryJump = Math.max(
      result.recoveryJump,
      cancellation.distanceTo(evaluateTentacleMotionVertex(gs[0], rig, contacts[3].indices[0], new Vector3(), 0)),
    )
  }
  // Full indexed-edge strain witness at the strongest two opposite swings.
  for (const angle of [0, Math.PI])
    for (const [lod, g] of gs.entries()) {
      const controls = Array.from({ length: 8 }, (_, slot) => ({
        seed: slot * 19 + 31,
        sequence: 1,
        phase: 'strike',
        progress: 1,
        localTarget: [0.5 * Math.sin(angle), 0.3, 0.24 + 0.5 * Math.cos(angle)],
      }))
      updateTentacleMotion(rig, 37, 1, controls)
      const positions = g.getAttribute('position'),
        values = new Float32Array(positions.count * 3)
      for (let i = 0; i < positions.count; i++) evaluateTentacleMotionVertex(g, rig, i, posed, 0).toArray(values, i * 3)
      const a = new Vector3(),
        b = new Vector3(),
        ra = new Vector3(),
        rb = new Vector3(),
        indices = raw[lod].indices
      for (let i = 0; i < indices.length; i += 3)
        for (const [j, k] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ]) {
          ra.fromBufferAttribute(positions, indices[i + j])
          rb.fromBufferAttribute(positions, indices[i + k])
          const rest = ra.distanceTo(rb)
          if (rest < 0.0002) continue
          a.fromArray(values, indices[i + j] * 3)
          b.fromArray(values, indices[i + k] * 3)
          result.maxEdgeStretch = Math.max(result.maxEdgeStretch, a.distanceTo(b) / rest)
        }
    }
  assert.equal(result.rootDrift, 0, 'actual lowest 6.5% remains pinned')
  assert.ok(result.cullingOverflow === 0 && result.recoveryJump < 1e-6, 'culling and cancelled anticipation continuity')
  assert.ok(
    result.samples.every((sample) => sample.anticipationToStrike > 0.06 && sample.crookSwing > 0.15),
    'real distal body has a readable directional strike',
  )
  assert.ok(result.maxContactRadius < 150 / 1420, 'actual world capsule radii fit registry cap')
  assert.ok(result.maxEdgeStretch < 1.85, 'actual indexed skin remains connected under the large gesture')
  const idleA = sampleTentacleBehavior(0, { seed: 31, sequence: 0, phase: 'idle', progress: 0, localTarget: null })
  const idleB = sampleTentacleBehavior(13, { seed: 31, sequence: 0, phase: 'idle', progress: 0, localTarget: null })
  assert.notEqual(idleA.idleDirection, idleB.idleDirection, 'idle direction evolves deterministically')

  for (const type of ['watcher', 'behemoth']) {
    const placement = HORROR_LAYOUT.find((candidate) => candidate.id === type),
      raw = [
        await load(type === 'watcher' ? 'shroud-watcher' : 'abyss-behemoth', 0),
        await load(type === 'watcher' ? 'shroud-watcher' : 'abyss-behemoth', 1),
      ]
    const bounds = raw[0].bounds,
      h = bounds.max[1] - bounds.min[1]
    const norm = new Matrix4()
      .makeScale(1 / h, 1 / h, 1 / h)
      .multiply(new Matrix4().makeRotationY(placement.sourceYaw))
      .multiply(
        new Matrix4().makeTranslation(
          -(bounds.min[0] + bounds.max[0]) / 2,
          -bounds.min[1],
          -(bounds.min[2] + bounds.max[2]) / 2,
        ),
      )
    const gs = raw.map((source) => geometry(source, norm)),
      rig = createHorrorRig(type, placement.phase)
    gs.forEach((g) => bindHorrorGeometry(g, rig))
    const sample = {
      ...sampleHorrorMotion(placement, 37),
      time: 37,
      stepStrength: 0,
      roarStrength: 0,
      headLift: 0,
      roarEvent: false,
    }
    const result = {
      type,
      lods: [],
      maxDisplacement: 0,
      cullingOverflow: 0,
      recoveryJump: 0,
      strain: [],
      attackBands: Array.from({ length: 24 }, (_, band) => ({
        minY: -0.3 + band * 0.075,
        maxY: -0.3 + (band + 1) * 0.075,
        radius: 0,
        samples: 0,
      })),
    }
    const indices = gs.map((g) => nearest(g, rig.limbs[1].foot))
    for (let direction = -1; direction <= 1; direction++) {
      const attack = { phase: 'windup', progress: 1, sequence: 1, localTarget: [direction * 0.35, 0.05, 0.4], hand: 1 }
      updateHorrorRig(rig, placement, sample, undefined, attack)
      const raised = gs.map((g, lod) => evaluateHorrorMotionVertex(g, rig, indices[lod], new Vector3()))
      attack.phase = 'strike'
      attack.progress = 1
      updateHorrorRig(rig, placement, sample, undefined, attack)
      for (const [lod, g] of gs.entries()) {
        const wrist = evaluateHorrorMotionVertex(g, rig, indices[lod], new Vector3())
        result.lods.push({
          lod,
          direction,
          index: indices[lod],
          raised: raised[lod].toArray(),
          strike: wrist.toArray(),
          swing: wrist.distanceTo(raised[lod]),
        })
        const positions = g.getAttribute('position')
        for (let index = 0; index < positions.count; index += 37) {
          point.fromBufferAttribute(positions, index)
          evaluateHorrorMotionVertex(g, rig, index, posed)
          result.maxDisplacement = Math.max(result.maxDisplacement, posed.distanceTo(point))
          result.cullingOverflow = Math.max(
            result.cullingOverflow,
            posed.distanceTo(g.boundingSphere.center) - g.boundingSphere.radius,
          )
        }
      }
      // Both ordinary and aborted windups recover from their actual feet/head palette.
      for (const fromPhase of ['windup', 'strike']) {
        attack.phase = fromPhase
        attack.progress = 0.38
        attack.recoveryFrom = undefined
        attack.recoveryHead = undefined
        updateHorrorRig(rig, placement, sample, undefined, attack)
        const previous = gs.map((g, lod) => evaluateHorrorMotionVertex(g, rig, indices[lod], new Vector3()))
        attack.recoveryFrom = rig.feet.map((foot) => foot.target.toArray())
        attack.recoveryHead = Array.from(rig.rotations.value.slice(4, 8))
        attack.recoveryAttention = fromPhase === 'windup' ? 0.38 ** 2 * (3 - 2 * 0.38) : 1
        attack.phase = 'recover'
        attack.progress = 0
        updateHorrorRig(rig, placement, sample, undefined, attack)
        gs.forEach((g, lod) => {
          result.recoveryJump = Math.max(
            result.recoveryJump,
            previous[lod].distanceTo(evaluateHorrorMotionVertex(g, rig, indices[lod], new Vector3())),
          )
        })
      }
    }
    assert.ok(
      result.lods.every((lod) => lod.swing > 0.12),
      'actual bound wrist anticipates and swings',
    )
    assert.ok(result.cullingOverflow === 0 && result.recoveryJump < 1e-6, 'actual limb culling/recovery remain valid')
    // Supplement clearance with honest sampled radial-height evidence, not a claimed infinite proof.
    // Both real LOD buffers, either leading hand, targets above/below/around the actor.
    result.attackEnvelopeEvidence = {
      targets: 32,
      hands: 2,
      stride: 47,
      phases: ['windup:1', 'strike:.5', 'strike:1'],
      padding: 0.025,
      kind: 'sampled source geometry witness; NOT an all-time analytical bound',
    }
    for (let target = 0; target < 32; target++)
      for (const hand of [0, 1])
        for (const [phase, progress] of [
          ['windup', 1],
          ['strike', 0.5],
          ['strike', 1],
        ]) {
          const angle = (target * Math.PI * 2) / 8,
            localTarget = [
              0.7 * Math.sin(angle),
              [-0.2, 0.2, 0.65, 1.15][Math.floor(target / 8)],
              0.7 * Math.cos(angle),
            ]
          updateHorrorRig(rig, placement, sample, undefined, { phase, progress, sequence: 1, localTarget, hand })
          for (const g of gs)
            for (let index = 0; index < g.getAttribute('position').count; index += 47) {
              evaluateHorrorMotionVertex(g, rig, index, posed)
              for (const band of result.attackBands)
                if (posed.y >= band.minY - 0.025 && posed.y <= band.maxY + 0.025) {
                  band.radius = Math.max(band.radius, Math.hypot(posed.x, posed.z) + 0.025)
                  band.samples++
                }
            }
        }
    for (const [lod, g] of gs.entries())
      for (const hand of [0, 1])
        for (const phase of ['windup', 'strike']) {
          updateHorrorRig(rig, placement, sample, undefined, {
            phase,
            progress: 1,
            sequence: 1,
            localTarget: [hand ? 0.3 : -0.3, 0.05, 0.4],
            hand,
          })
          const positions = g.getAttribute('position'),
            values = new Float32Array(positions.count * 3),
            stretches = []
          let worst = { value: 0, vertices: [] }
          for (let index = 0; index < positions.count; index++)
            evaluateHorrorMotionVertex(g, rig, index, posed).toArray(values, index * 3)
          const a = new Vector3(),
            b = new Vector3(),
            ra = new Vector3(),
            rb = new Vector3(),
            indices = raw[lod].indices
          for (let i = 0; i < indices.length; i += 3)
            for (const [j, k] of [
              [0, 1],
              [1, 2],
              [2, 0],
            ]) {
              ra.fromBufferAttribute(positions, indices[i + j])
              rb.fromBufferAttribute(positions, indices[i + k])
              const rest = ra.distanceTo(rb)
              if (rest < 0.0002) continue
              a.fromArray(values, indices[i + j] * 3)
              b.fromArray(values, indices[i + k] * 3)
              const stretch = a.distanceTo(b) / rest
              stretches.push(stretch)
              if (stretch > worst.value)
                worst = {
                  value: stretch,
                  vertices: [indices[i + j], indices[i + k]].map((index) => ({
                    index,
                    rest: new Vector3().fromBufferAttribute(positions, index).toArray(),
                    posed: Array.from(values.slice(index * 3, index * 3 + 3)),
                    joints: [0, 1, 2, 3].map((k) => g.getAttribute('aHorrorJoints').getComponent(index, k)),
                    weights: [0, 1, 2, 3].map((k) => g.getAttribute('aHorrorWeights').getComponent(index, k)),
                  })),
                }
            }
          stretches.sort((a, b) => a - b)
          result.strain.push({
            lod,
            hand,
            phase,
            max: stretches.at(-1),
            p99: stretches[Math.floor(stretches.length * 0.99)],
            p999: stretches[Math.floor(stretches.length * 0.999)],
            worst,
            rotations: Array.from(rig.rotations.value),
          })
        }
    report.creatures.push(result)
    assert.ok(
      result.strain.every((pose) => pose.max < 2.2 && pose.p99 < 1.5),
      `real indexed source skin stays within the bounded muscle gesture strain: ${type} ${JSON.stringify(result.strain.map((pose) => ({ lod: pose.lod, hand: pose.hand, phase: pose.phase, max: pose.max, p99: pose.p99 })))}`,
    )
    for (const pose of result.strain)
      for (let a = 0; a < 9; a++)
        for (let b = 0; b < 9; b++) {
          const dot = [0, 1, 2, 3].reduce((sum, k) => sum + pose.rotations[a * 4 + k] * pose.rotations[b * 4 + k], 0)
          assert.ok(dot > 0, 'all actual joints share a positive DQ hemisphere without source-edge sign switching')
        }
    raw.forEach((source, lod) =>
      report.sources.push({
        file: source.file,
        sha256: source.sha256,
        pbr: source.pbr,
        vertices: gs[lod].getAttribute('position').count,
      }),
    )
  }
  console.log(
    'PASS',
    JSON.stringify({
      tentacles: {
        rootDrift: report.tentacles.rootDrift,
        maxDisplacement: report.tentacles.maxDisplacement,
        maxEdgeStretch: report.tentacles.maxEdgeStretch,
        recoveryJump: report.tentacles.recoveryJump,
      },
      creatures: report.creatures.map((creature) => ({
        type: creature.type,
        maxDisplacement: creature.maxDisplacement,
        recoveryJump: creature.recoveryJump,
        strain: creature.strain,
      })),
    }),
  )
} catch (error) {
  report.failure = error.stack ?? String(error)
  throw error
} finally {
  await fs.mkdir('artifacts/black-mist/attack-poses', { recursive: true })
  await fs.writeFile('artifacts/black-mist/attack-poses/report.json', JSON.stringify(report, null, 2))
}
