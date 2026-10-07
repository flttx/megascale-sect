// CPU-only clearance audit: real GLB vertices/skin weights, live shared layouts and shader motion source.
// node --experimental-strip-types scripts/verify-horror-clearance.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { Box3, BufferAttribute, BufferGeometry, CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'artifacts/horror-clearance')
const MIN_GAP = 25,
  PARASITE_RESERVE = 25,
  BANDS = 18,
  NUMERIC_PAD = 0.0002
// Native strip-types does not resolve Vite's extensionless relative imports on its own.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !path.extname(specifier)) {
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return next(specifier, context)
  },
})
const { TENTACLES } = await import('../src/world/blackMist/eldritchLayout.ts')
const { HORROR_LAYOUT: SHARED_HORROR_LAYOUT } = await import('../src/world/blackMist/horrorLayout.ts')
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
const tentacleMotion = await import('../src/world/blackMist/tentacleMotion.ts')
const horrorMotion = await import('../src/world/blackMist/horrorMotion.ts')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const sourceHashes = {}
async function source(file) {
  const buffer = await fs.readFile(path.join(ROOT, file))
  sourceHashes[file] = createHash('sha256').update(buffer).digest('hex')
  return buffer
}
async function glb(file) {
  return io.readBinary(await source(file))
}

function literal(text, name) {
  const declaration = text.search(new RegExp(`export const ${name}\\b`))
  assert.ok(declaration >= 0, `shared ${name} declaration exists`)
  const begin = text.indexOf('=', declaration) + 1
  let first = begin
  while (/\s/.test(text[first])) first++
  const open = text[first],
    close = open === '[' ? ']' : '}'
  assert.ok(open === '[' || open === '{', `${name} is a data literal`)
  let depth = 0,
    last = first
  do {
    const c = text[last++]
    if (c === open) depth++
    if (c === close) depth--
  } while (depth && last < text.length)
  const expression = text.slice(first, last)
  assert.match(expression, /^[\w\s[\]{},:.-]+$/, `${name} contains only literal data`)
  return Function(`return (${expression})`)()
}

const kunLayoutText = (await source('src/world/colossi/layout.ts')).toString()
const KUN_PATH = literal(kunLayoutText, 'KUN_PATH'),
  KUN = literal(kunLayoutText, 'KUN')
const TURTLE_PATH = literal(kunLayoutText, 'TURTLE_PATH'),
  TURTLE = literal(kunLayoutText, 'TURTLE')
assert.ok(Number.isFinite(KUN.scale) && Number.isFinite(KUN.speed), 'shared Kun scale and speed are finite')
await source('src/world/blackMist/tentacleMotion.ts')
await source('src/world/blackMist/eldritchLayout.ts')
await source('src/world/blackMist/horrorLayout.ts')
await source('src/world/blackMist/horrorMotion.ts')
const rendererSource = (await source('src/world/blackMist/EldritchLandmarks.tsx')).toString()
assert.match(
  rendererSource,
  /position\.y -= \(1 - emergence\) \* placement\.height/,
  'runtime tentacle emergence is a downward translation by at most its height',
)

/** Includes every translation/scale key, so the sphere also covers arbitrary blends of the two clips. */
function skinEnvelope(doc, id, scale, rootOffset = 0) {
  const root = doc.getRoot(),
    skinned = root.listNodes().find((node) => node.getSkin() && node.getMesh())
  assert.ok(skinned, `${id} GLB has a native skin`)
  const skin = skinned.getSkin(),
    joints = skin.listJoints(),
    ibm = skin.getInverseBindMatrices()
  const local = new Map(
    root.listNodes().map((node) => [
      node,
      {
        translation: Math.hypot(...node.getTranslation()),
        scale: Math.max(...node.getScale().map(Math.abs)),
      },
    ]),
  )
  const animationChannels = []
  for (const animation of root.listAnimations()) {
    const counts = { rotation: 0, translation: 0, scale: 0 }
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode(),
        field = channel.getTargetPath(),
        sampler = channel.getSampler(),
        output = sampler.getOutput()
      counts[field]++
      if (field !== 'translation' && field !== 'scale') continue
      assert.ok(
        ['LINEAR', 'STEP'].includes(sampler.getInterpolation()),
        'translation/scale bounds support the actual linear/step clips',
      )
      for (let i = 0; i < output.getCount(); i++) {
        const values = output.getElement(i, [])
        if (field === 'translation')
          local.get(target).translation = Math.max(local.get(target).translation, Math.hypot(...values))
        else local.get(target).scale = Math.max(local.get(target).scale, ...values.map(Math.abs))
      }
    }
    animationChannels.push({
      name: animation.getName(),
      counts,
      duration: Math.max(...animation.listSamplers().map((s) => s.getInput().getArray().at(-1))),
    })
  }
  const bounds = new Map()
  function chain(node) {
    if (bounds.has(node)) return bounds.get(node)
    const parent = node.getParentNode(),
      previous = parent ? chain(parent) : { translation: 0, scale: 1 },
      own = local.get(node)
    const value = {
      translation: previous.translation + previous.scale * own.translation,
      scale: previous.scale * own.scale,
    }
    bounds.set(node, value)
    return value
  }
  const inverse = joints.map((_, i) => new Matrix4().fromArray(ibm.getElement(i, []))),
    point = new Vector3(),
    lever = new Vector3()
  let radius = 0,
    vertices = 0,
    winningVertex = null
  for (const primitive of skinned.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION'),
      indices = primitive.getAttribute('JOINTS_0'),
      weights = primitive.getAttribute('WEIGHTS_0')
    // GLTFLoader normalizes weights in the stored component type, including its quantization rounding.
    const nativeWeights = new BufferAttribute(weights.getArray().slice(), 4, weights.getNormalized())
    for (let i = 0; i < positions.getCount(); i++) {
      const rawWeights = [0, 1, 2, 3].map((k) => nativeWeights.getComponent(i, k)),
        sum = rawWeights.reduce((a, b) => a + b, 0)
      assert.ok(sum > 0 && rawWeights.every((w) => w >= 0), `${id} has valid nonnegative skin weights`)
      nativeWeights.setXYZW(i, ...rawWeights.map((w) => w / sum))
      point.fromArray(positions.getElement(i, []))
      const bones = indices.getElement(i, [])
      let reach = 0
      for (let k = 0; k < 4; k++) {
        const weight = nativeWeights.getComponent(i, k),
          bound = chain(joints[bones[k]])
        reach += weight * (bound.translation + bound.scale * lever.copy(point).applyMatrix4(inverse[bones[k]]).length())
      }
      if (reach > radius) {
        radius = reach
        winningVertex = {
          index: i,
          bones: bones.map((bone, k) => ({ name: joints[bone].getName(), weight: nativeWeights.getComponent(i, k) })),
        }
      }
      vertices++
    }
  }
  assert.ok(Number.isFinite(radius), `native ${id} body envelope is finite`)
  return {
    source: `public/assets/colossi/${id}.glb`,
    vertices,
    joints: joints.length,
    animationChannels,
    keyedJointBounds: joints.map((node) => ({
      name: node.getName(),
      maxLocalTranslation: local.get(node).translation,
      maxLocalScale: local.get(node).scale,
      maxChainTranslation: chain(node).translation,
      maxChainScale: chain(node).scale,
    })),
    assetRadius: radius,
    bodyRadiusMeters: radius * scale + 0.02 + rootOffset,
    parasiteReserveMeters: PARASITE_RESERVE,
    auditedRadiusMeters: radius * scale + 0.02 + rootOffset + PARASITE_RESERVE,
    rootOffsetMeters: rootOffset,
    winningVertex,
    proof:
      'Every weighted native vertex is bounded by the sum of maximum keyed parent translations and scales plus its inverse-bind lever; arbitrary rotation, banking and clip blends preserve this bound.',
  }
}

function geometry(doc, normalization) {
  const positions = [],
    indices = [],
    point = new Vector3()
  for (const node of doc.getRoot().listNodes())
    if (node.getMesh()) {
      const transform = normalization.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()))
      for (const primitive of node.getMesh().listPrimitives()) {
        const offset = positions.length / 3,
          position = primitive.getAttribute('POSITION'),
          index = primitive.getIndices()
        for (let i = 0; i < position.getCount(); i++) {
          point.fromArray(position.getElement(i, [])).applyMatrix4(transform)
          positions.push(point.x, point.y, point.z)
        }
        for (let i = 0; i < (index?.getCount() ?? position.getCount()); i++)
          indices.push(offset + (index ? index.getScalar(i) : i))
      }
    }
  const result = new BufferGeometry()
  result.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  result.setIndex(indices)
  return result
}

function tentacleNormalization(doc) {
  const raw = geometry(doc, new Matrix4()),
    positions = raw.getAttribute('position'),
    box = new Box3().setFromBufferAttribute(positions)
  const height = box.max.y - box.min.y,
    base = new Vector3(),
    p = new Vector3()
  let count = 0
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i)
    if (p.y <= box.min.y + height * 0.06) {
      base.add(p)
      count++
    }
  }
  assert.ok(count > 0, 'actual tentacle source has a root')
  base.divideScalar(count)
  base.y = box.min.y
  raw.dispose()
  return new Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z))
}

/** Use the same exported all-time FK limits as production; no source-expression parsing. */
function tentacleLimits(rig, interactive = rig.interactive) {
  assert.equal(typeof tentacleMotion.tentacleMotionBounds, 'function', 'motion source exports its all-time FK bounds')
  assert.equal(
    typeof tentacleMotion.evaluateTentacleMotionVertex,
    'function',
    'motion source exports the real four-buffer CPU shader evaluator',
  )
  assert.ok(tentacleMotion.TENTACLE_MOTION_PARAMETERS, 'motion source exports its production parameters')
  const limits = tentacleMotion.tentacleMotionBounds(rig, interactive)
  for (const field of [
    'angles',
    'lateral',
    'absoluteAngles',
    'absoluteLateral',
    'center',
    'centerX',
    'jointCurl',
    'jointLift',
    'jointTwist',
  ]) {
    assert.equal(limits[field]?.length, rig.rest.length, `exported ${field} covers every native motion joint`)
    assert.ok(
      Array.from(limits[field]).every((value) => Number.isFinite(value) && value >= 0),
      `exported ${field} contains finite nonnegative caps`,
    )
  }
  assert.ok(
    limits.absoluteAngles.every((angle) => angle < Math.PI),
    'absolute joint orientations stay within a convex quaternion cap',
  )
  assert.ok(
    limits.absoluteLateral.every((angle, i) => angle <= limits.absoluteAngles[i]),
    'non-planar caps are included in absolute rotation caps',
  )
  assert.equal(limits.relativeAngles.length, rig.rest.length, 'motion source exports every pair of relative joint caps')
  for (const row of limits.relativeAngles) {
    assert.equal(row.length, rig.rest.length, 'relative joint bounds form a complete matrix')
    assert.ok(
      row.every((angle) => Number.isFinite(angle) && angle >= 0 && angle < Math.PI),
      'relative joint caps stay in the positive DQ hemisphere',
    )
  }
  assert.ok(
    Number.isFinite(limits.maxFrequency) && limits.maxFrequency > 0,
    'motion source exposes a finite maximum frequency',
  )
  assert.equal(
    limits.speedSlots.length,
    tentacleMotion.TENTACLE_MOTION_PHASES,
    'motion bounds cover every stable instance phase',
  )
  assert.ok(
    rig.rest.every((point) => Math.abs(point.x - rig.rest[0].x) < 1e-8),
    'local lateral bound uses the inspected constant-X centreline',
  )
  return {
    ...limits,
    parameters: tentacleMotion.TENTACLE_MOTION_PARAMETERS,
    version: tentacleMotion.TENTACLE_MOTION_VERSION,
  }
}

/** Positive quaternion pair decomposition bounds the real four-weight DQ field, including tiny influences. */
function vertexMotionBound(point, joints, weights, rig, limits) {
  const active = weights.map((w, k) => ({ weight: w, joint: joints[k] })).filter((entry) => entry.weight > 0)
  const sum = active.reduce((total, entry) => total + entry.weight, 0)
  active.forEach((entry) => {
    entry.weight /= sum
  })
  const primary = active.reduce((a, b) => (a.weight > b.weight ? a : b)).joint,
    pivot = rig.rest[primary],
    relative = point.clone().sub(pivot)
  let relativeAngle = 0
  active.forEach((a) =>
    active.forEach((b) => {
      relativeAngle = Math.max(relativeAngle, limits.relativeAngles[a.joint][b.joint])
    }),
  )
  const denominator = Math.cos(relativeAngle / 2)
  let radius = 0,
    xRadius = 0
  for (let a = 0; a < active.length; a++)
    for (let b = a; b < active.length; b++) {
      const first = active[a],
        second = active[b],
        i = first.joint,
        j = second.joint,
        thetaI = limits.absoluteAngles[i],
        thetaJ = limits.absoluteAngles[j]
      const sideI = limits.absoluteLateral[i],
        sideJ = limits.absoluteLateral[j],
        pairDenominator = Math.cos(limits.relativeAngles[i][j] / 2)
      const alpha = (first.weight * second.weight * (a === b ? 1 : 2)) / denominator
      const leverI = rig.rest[i].distanceTo(pivot),
        leverJ = rig.rest[j].distanceTo(pivot)
      const translationI = limits.center[i] + 2 * Math.sin(thetaI / 2) * leverI,
        translationJ = limits.center[j] + 2 * Math.sin(thetaJ / 2) * leverJ
      const translationXI = limits.centerX[i] + 2 * Math.sin(sideI / 2) * leverI,
        translationXJ = limits.centerX[j] + 2 * Math.sin(sideJ / 2) * leverJ
      const rotation = 2 * Math.sin(Math.max(thetaI, thetaJ) / 2) + 1 / pairDenominator - 1
      radius += alpha * (rotation * relative.length() + (0.5 * (translationI + translationJ)) / pairDenominator)
      const epsilonI = Math.sin(sideI / 2),
        epsilonJ = Math.sin(sideJ / 2)
      const rotationX =
        (2 * epsilonI * epsilonJ * Math.abs(relative.x) +
          (epsilonJ * (Math.sin(thetaI / 2) + 1) + epsilonI * (Math.sin(thetaJ / 2) + 1)) *
            (Math.abs(relative.y) + Math.abs(relative.z))) /
        pairDenominator
      const cross =
        i === j
          ? 0
          : (0.5 * (translationI + translationJ) * Math.SQRT2 * Math.sin(Math.min(Math.PI, sideI + sideJ) / 2)) /
            pairDenominator
      xRadius += alpha * (rotationX + 0.5 * (translationXI + translationXJ) + cross)
    }
  return { x: xRadius + NUMERIC_PAD, yz: radius + NUMERIC_PAD }
}

function tentacleBands(geometries, rig, limits) {
  const boxes = Array.from({ length: BANDS }, () => new Box3()),
    point = new Vector3(),
    minimum = new Vector3(),
    maximum = new Vector3()
  const culling = []
  let vertices = 0,
    maxBound = 0
  for (const [lod, geo] of geometries.entries()) {
    tentacleMotion.bindTentacleMotionGeometry(geo, rig)
    assert.ok(
      geo.boundingSphere && Number.isFinite(geo.boundingSphere.radius),
      'bound source geometry has a finite culling sphere',
    )
    const sphere = geo.boundingSphere
    const sphereStats = {
      lod,
      radius: sphere.radius,
      center: sphere.center.toArray(),
      sufficientAllTimeRadius: 0,
      maximumSampleRadius: 0,
    }
    culling.push(sphereStats)
    const position = geo.getAttribute('position'),
      joints = geo.getAttribute('aTentacleJoints'),
      weights = geo.getAttribute('aTentacleWeights')
    const vertexBoxes = Array.from({ length: position.count }, (_, i) => {
      point.fromBufferAttribute(position, i)
      const bound = vertexMotionBound(
        point,
        [0, 1, 2, 3].map((k) => joints.getComponent(i, k)),
        [0, 1, 2, 3].map((k) => weights.getComponent(i, k)),
        rig,
        limits,
      )
      maxBound = Math.max(maxBound, bound.yz)
      vertices++
      sphereStats.sufficientAllTimeRadius = Math.max(
        sphereStats.sufficientAllTimeRadius,
        point.distanceTo(sphere.center) + bound.yz,
      )
      return new Box3(
        minimum.set(point.x - bound.x, point.y - bound.yz, point.z - bound.yz).clone(),
        maximum.set(point.x + bound.x, point.y + bound.yz, point.z + bound.yz).clone(),
      )
    })
    assert.ok(
      sphereStats.sufficientAllTimeRadius <= sphere.radius,
      `LOD${lod} production culling radius ${sphere.radius.toFixed(6)} must contain the all-time four-weight radius ${sphereStats.sufficientAllTimeRadius.toFixed(6)}`,
    )
    for (let i = 0; i < geo.index.count; i += 3) {
      const indices = [geo.index.getX(i), geo.index.getX(i + 1), geo.index.getX(i + 2)]
      const y = indices.map((v) => Math.max(0, Math.min(BANDS - 1, Math.floor(position.getY(v) * BANDS))))
      for (let band = Math.min(...y); band <= Math.max(...y); band++)
        indices.forEach((v) => boxes[band].union(vertexBoxes[v]))
    }
  }
  // Cross-check actual shader-buffer evaluation in all eight slots, including every source vertex at t=0.
  let checks = 0
  for (const [lod, geo] of geometries.entries())
    for (const time of [0, 1.7, 8.3, 17.2, 41.8, 79.4]) {
      tentacleMotion.updateTentacleMotion(rig, time)
      const p = geo.getAttribute('position'),
        stride = time === 0 ? 1 : Math.max(1, Math.floor(p.count / 768)),
        posed = new Vector3()
      for (let slot = 0; slot < tentacleMotion.TENTACLE_MOTION_PHASES; slot++)
        for (let i = 0; i < p.count; i += stride) {
          point.fromBufferAttribute(p, i)
          tentacleMotion.evaluateTentacleMotionVertex(geo, rig, i, posed, slot)
          const band = Math.max(0, Math.min(BANDS - 1, Math.floor(point.y * BANDS)))
          assert.ok(
            boxes[band].containsPoint(posed),
            'analytic motion band contains actual four-weight GPU-reference source vertices',
          )
          const sphereRadius = posed.distanceTo(geo.boundingSphere.center)
          culling[lod].maximumSampleRadius = Math.max(culling[lod].maximumSampleRadius, sphereRadius)
          assert.ok(
            sphereRadius <= geo.boundingSphere.radius,
            'actual shader-reference source vertex remains inside its production culling sphere',
          )
          checks++
        }
    }
  return {
    boxes,
    vertices,
    actualVertexChecks: checks,
    maxNormalizedDisplacementBound: maxBound,
    limits,
    culling,
    proof:
      'Each real indexed triangle contributes all its vertices to every crossed rest-height band. Four-weight DQ is a positive convex combination of quaternion-pair affine transforms; vertex lever, joint-center and lateral-angle bounds cover every time, eight slots and all emergence strengths.',
  }
}

/** Reconstructed cubic Bézier control hulls cover every point between samples, including Catmull overshoot. */
/** Coherent real poses: full indexed buffers, all phase slots, all octants and finite gestures. */
function sampledTentacleInteraction(geometries, rig) {
  const boxes = Array.from({ length: BANDS }, () => new Box3()),
    idleBoxes = Array.from({ length: BANDS }, () => new Box3()),
    point = new Vector3()
  const timeSamples = [0, 8.3, 41.8, 79.4],
    progressSamples = [0, 0.25, 0.5, 0.75, 1],
    padding = 0.05
  const values = geometries.map((geo) => new Float32Array(geo.getAttribute('position').count * 3))
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    crossing = new Vector3()
  const bandAt = (y) => Math.max(0, Math.min(BANDS - 1, Math.floor((y + 0.3) / 0.1)))
  const include = (band, p, idle) => {
    boxes[band].expandByPoint(p)
    if (idle) idleBoxes[band].expandByPoint(p)
  }
  const clipEdge = (band, first, second, y, idle) => {
    const dy = second.y - first.y
    if (Math.abs(dy) < 1e-10) return
    const t = (y - first.y) / dy
    if (t < 0 || t > 1) return
    crossing.copy(first).lerp(second, t)
    include(band, crossing, idle)
  }
  let checks = 0,
    frames = 0,
    cullingOverflow = 0
  for (const [timeIndex, time] of timeSamples.entries())
    for (const phase of ['idle', 'windup', 'strike', 'recover']) {
      for (const progress of phase === 'idle' ? [0] : progressSamples) {
        const behaviors = Array.from({ length: 8 }, (_, slot) => {
          const angle = ((slot + timeIndex * 2) * Math.PI) / 4
          return {
            seed: slot * 19 + 31,
            phase,
            progress,
            sequence: 1,
            localTarget: phase === 'idle' ? null : [Math.sin(angle) * 0.9, 0.05, 0.24 + Math.cos(angle) * 0.9],
          }
        })
        tentacleMotion.updateTentacleMotion(rig, time, 1, behaviors)
        const grounded = rig.rotations.value.slice(),
          groundDual = rig.duals.value.slice()
        for (const y of [0.9, 1.6]) {
          const flying = behaviors.map((behavior) => ({
            ...behavior,
            localTarget: behavior.localTarget ? [behavior.localTarget[0], y, behavior.localTarget[2]] : null,
          }))
          tentacleMotion.updateTentacleMotion(rig, time, 1, flying)
          assert.deepEqual(
            rig.rotations.value,
            grounded,
            'grounded/flying target heights preserve the declared horizontal intent field',
          )
          assert.deepEqual(
            rig.duals.value,
            groundDual,
            'grounded/flying target heights preserve the actual translation palette',
          )
        }
        for (const [lod, geo] of geometries.entries())
          for (let slot = 0; slot < 8; slot++) {
            const posedValues = values[lod],
              count = geo.getAttribute('position').count
            for (let index = 0; index < count; index++) {
              tentacleMotion.evaluateTentacleMotionVertex(geo, rig, index, point, slot)
              point.toArray(posedValues, index * 3)
              cullingOverflow = Math.max(
                cullingOverflow,
                point.distanceTo(geo.boundingSphere.center) - geo.boundingSphere.radius,
              )
              checks++
            }
            // Clip each actual posed triangle to its current height, rather than assigning a high
            // vertex to every old rest band touched by an adjacent long triangle. This retains the
            // coherent cross-section of the real body and does not fill its empty curl with a box.
            const idle = phase === 'idle'
            for (let offset = 0; offset < geo.index.count; offset += 3) {
              a.fromArray(posedValues, geo.index.getX(offset) * 3)
              b.fromArray(posedValues, geo.index.getX(offset + 1) * 3)
              c.fromArray(posedValues, geo.index.getX(offset + 2) * 3)
              const first = bandAt(Math.min(a.y, b.y, c.y)),
                last = bandAt(Math.max(a.y, b.y, c.y))
              if (first === last) {
                include(first, a, idle)
                include(first, b, idle)
                include(first, c, idle)
                continue
              }
              for (let band = first; band <= last; band++) {
                const minY = band === 0 ? -Infinity : -0.3 + band * 0.1,
                  maxY = band === BANDS - 1 ? Infinity : -0.3 + (band + 1) * 0.1
                if (a.y >= minY && a.y <= maxY) include(band, a, idle)
                if (b.y >= minY && b.y <= maxY) include(band, b, idle)
                if (c.y >= minY && c.y <= maxY) include(band, c, idle)
                clipEdge(band, a, b, minY, idle)
                clipEdge(band, b, c, minY, idle)
                clipEdge(band, c, a, minY, idle)
                clipEdge(band, a, b, maxY, idle)
                clipEdge(band, b, c, maxY, idle)
                clipEdge(band, c, a, maxY, idle)
              }
            }
          }
        frames++
      }
    }
  assert.equal(cullingOverflow, 0, 'every full source interaction pose remains inside the production culling sphere')
  boxes.forEach((box) => {
    if (!box.isEmpty()) box.expandByScalar(padding)
  })
  idleBoxes.forEach((box) => {
    if (!box.isEmpty()) box.expandByScalar(padding)
  })
  return {
    boxes,
    idleBoxes,
    evidence: {
      class: 'dense sampled interaction envelopes with explicit margin; not an all-time analytical proof',
      sourceBuffers:
        'Every high/low vertex and every indexed posed triangle clipped to actual horizontal height bands, all eight phase-slot palettes',
      frames,
      actualVertexChecks: checks,
      timeSamples,
      octants: 8,
      targetHeightsNormalized: [0.05, 0.9, 1.6],
      progressSamples,
      phases: ['idle', 'windup', 'strike', 'recover'],
      normalizedMargin: padding,
      cullingOverflow,
      directionsAcrossSlotsAndTimes: true,
      limits: tentacleMotion.TENTACLE_INTERACTION_LIMITS,
    },
  }
}

function routeBoxes(curve, pathLength, speed, heave = 0) {
  const result = [],
    count = pathLength * 96,
    lengths = curve.getLengths(2000)
  const timeAt = (t) => {
    const i = Math.min(1999, Math.floor(t * 2000)),
      f = t * 2000 - i
    return (lengths[i] + (lengths[i + 1] - lengths[i]) * f) / speed
  }
  for (let i = 0; i < count; i++) {
    const t0 = i / count,
      t1 = (i + 1) / count,
      dt = (t1 - t0) / 3
    const p0 = curve.getPoint(t0),
      p1 = curve.getPoint(t0 + dt),
      p2 = curve.getPoint(t0 + dt * 2),
      p3 = curve.getPoint(t1)
    const b1 = p1
      .clone()
      .multiplyScalar(3)
      .addScaledVector(p2, -1.5)
      .addScaledVector(p0, -5 / 6)
      .addScaledVector(p3, 1 / 3)
    const b2 = p2
      .clone()
      .multiplyScalar(3)
      .addScaledVector(p1, -1.5)
      .addScaledVector(p0, 1 / 3)
      .addScaledVector(p3, -5 / 6)
    const box = new Box3().setFromPoints([p0, b1, b2, p3])
    box.min.y -= heave
    box.max.y += heave
    result.push({ box, time: timeAt((t0 + t1) / 2), point: curve.getPoint((t0 + t1) / 2).toArray() })
  }
  return result
}

function boxGap(a, b) {
  const d = [0, 1, 2].map((axis) =>
    Math.max(
      0,
      a.min.getComponent(axis) - b.max.getComponent(axis),
      b.min.getComponent(axis) - a.max.getComponent(axis),
    ),
  )
  return Math.hypot(...d)
}
function cylinderGap(box, creature) {
  const p = creature.position
  const x = Math.max(0, box.min.x - p[0], p[0] - box.max.x),
    z = Math.max(0, box.min.z - p[2], p[2] - box.max.z)
  const horizontal = Math.max(0, Math.hypot(x, z) - creature.radius),
    vertical = Math.max(0, box.min.y - creature.maxY, creature.minY - box.max.y)
  return Math.hypot(horizontal, vertical)
}
function cylinderPairGap(first, second) {
  const horizontal = Math.max(
    0,
    Math.hypot(first.position[0] - second.position[0], first.position[2] - second.position[2]) -
      first.radius -
      second.radius,
  )
  const vertical = Math.max(0, first.minY - second.maxY, second.minY - first.maxY)
  return Math.hypot(horizontal, vertical)
}

/** Both actual LOD buffers and clipped posed triangles; the .65/.80 culling reserves are not collision bounds. */
function sampledCreatureAttack(placement, geometries, rig) {
  const count = 24,
    step = 0.075,
    lower = -0.3,
    padding = 0.03
  const bands = Array.from({ length: count }, (_, index) => ({
    minY: lower + index * step,
    maxY: lower + (index + 1) * step,
    radius: 0,
    samples: 0,
  }))
  const values = geometries.map((geo) => new Float32Array(geo.getAttribute('position').count * 3))
  const point = new Vector3(),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    crossing = new Vector3()
  const bandAt = (y) => Math.max(0, Math.min(count - 1, Math.floor((y - lower) / step)))
  const include = (band, vertex) => {
    bands[band].radius = Math.max(bands[band].radius, Math.hypot(vertex.x, vertex.z))
    bands[band].samples++
  }
  const edge = (band, first, second, y) => {
    const dy = second.y - first.y
    if (Math.abs(dy) < 1e-10) return
    const t = (y - first.y) / dy
    if (t < 0 || t > 1) return
    crossing.copy(first).lerp(second, t)
    include(band, crossing)
  }
  const phases = [
    ['windup', 1],
    ['strike', 0],
    ['strike', 0.35],
    ['strike', 0.7],
    ['strike', 1],
    ['recover', 0.5],
  ]
  let checks = 0,
    poses = 0,
    cullingOverflow = 0
  for (let target = 0; target < 32; target++)
    for (const hand of [0, 1])
      for (const [phase, progress] of phases) {
        const angle = ((target % 8) * Math.PI) / 4,
          targetY = [-0.2, 0.2, 0.65, 1.15][Math.floor(target / 8)]
        const time = 17.2 + target * 0.73 + hand * 8.3 + progress * 2.1
        const sample = {
          ...horrorMotion.sampleHorrorMotion(placement, time),
          time,
          stepStrength: 0,
          velocity: [0, 0, 0],
          angularVelocity: 0,
          roarStrength: 0,
          headLift: 0,
          roarEvent: false,
        }
        const attack = {
          phase,
          progress,
          sequence: 1,
          localTarget: [0.7 * Math.sin(angle), targetY, 0.7 * Math.cos(angle)],
          hand,
        }
        horrorMotion.updateHorrorRig(rig, placement, sample, undefined, attack)
        for (const [lod, geo] of geometries.entries()) {
          const positions = geo.getAttribute('position'),
            posedValues = values[lod]
          for (let index = 0; index < positions.count; index++) {
            horrorMotion.evaluateHorrorMotionVertex(geo, rig, index, point)
            point.toArray(posedValues, index * 3)
            cullingOverflow = Math.max(
              cullingOverflow,
              point.distanceTo(geo.boundingSphere.center) - geo.boundingSphere.radius,
            )
            checks++
          }
          for (let offset = 0; offset < geo.index.count; offset += 3) {
            a.fromArray(posedValues, geo.index.getX(offset) * 3)
            b.fromArray(posedValues, geo.index.getX(offset + 1) * 3)
            c.fromArray(posedValues, geo.index.getX(offset + 2) * 3)
            const first = bandAt(Math.min(a.y, b.y, c.y)),
              last = bandAt(Math.max(a.y, b.y, c.y))
            if (first === last) {
              include(first, a)
              include(first, b)
              include(first, c)
              continue
            }
            for (let band = first; band <= last; band++) {
              const minY = band === 0 ? -Infinity : bands[band].minY,
                maxY = band === count - 1 ? Infinity : bands[band].maxY
              if (a.y >= minY && a.y <= maxY) include(band, a)
              if (b.y >= minY && b.y <= maxY) include(band, b)
              if (c.y >= minY && c.y <= maxY) include(band, c)
              edge(band, a, b, minY)
              edge(band, b, c, minY)
              edge(band, c, a, minY)
              edge(band, a, b, maxY)
              edge(band, b, c, maxY)
              edge(band, c, a, maxY)
            }
          }
        }
        poses++
      }
  assert.equal(
    cullingOverflow,
    0,
    `${placement.sourceType} actual full source attack poses remain inside the production render sphere`,
  )
  return {
    bands: bands
      .filter((band) => band.samples)
      .map((band) => ({
        ...band,
        radius: band.radius + padding,
        minY: band.minY - padding,
        maxY: band.maxY + padding,
      })),
    evidence: {
      class: 'dense sampled real-source interaction envelope; not an all-time analytic proof',
      targets: 32,
      octants: 8,
      targetHeightsNormalized: [-0.2, 0.2, 0.65, 1.15],
      hands: 2,
      phases,
      poses,
      sourceBuffers: 'Every actual high/low source vertex and every indexed triangle clipped to current height',
      actualVertexChecks: checks,
      normalizedMargin: padding,
      fullYaw: true,
      breathingTimes: 'Varied across targets/gesture phases; .03 margin also covers the small chest modulation',
      cullingOverflow,
      limits: horrorMotion.HORROR_ATTACK_LIMITS,
    },
  }
}
const jsonBox = (box) => ({ min: box.min.toArray(), max: box.max.toArray() })

const kun = skinEnvelope(await glb('public/assets/colossi/kun.glb'), 'kun', KUN.scale)
const turtle = skinEnvelope(
  await glb('public/assets/colossi/turtle.glb'),
  'turtle',
  TURTLE.scale,
  Math.abs(TURTLE.centerZ * TURTLE.scale),
)
const curve = new CatmullRomCurve3(
  KUN_PATH.map((p) => new Vector3(...p)),
  true,
  'centripetal',
)
curve.arcLengthDivisions = 2000
const route = routeBoxes(curve, KUN_PATH.length, KUN.speed)
const turtleCurve = new CatmullRomCurve3(
  TURTLE_PATH.map(([x, z]) => new Vector3(x, TURTLE.baseY, z)),
  true,
  'centripetal',
)
turtleCurve.arcLengthDivisions = 2000
const turtleRoute = routeBoxes(turtleCurve, TURTLE_PATH.length, TURTLE.speed, TURTLE.bob)
const carriers = [
  { id: 'kun', envelope: kun, route },
  { id: 'turtle', envelope: turtle, route: turtleRoute },
]
const tentacleDoc = await glb('public/assets/black-mist/abyss-tentacle.glb'),
  normalization = tentacleNormalization(tentacleDoc)
const tentacleRig = tentacleMotion.createTentacleMotionRig(normalization, undefined, { interactive: true }),
  tentacleGeometry = [
    geometry(tentacleDoc, normalization),
    geometry(await glb('public/assets/black-mist/abyss-tentacle.lod1.glb'), normalization),
  ]
const local = tentacleBands(tentacleGeometry, tentacleRig, tentacleLimits(tentacleRig, false))
const interaction = sampledTentacleInteraction(tentacleGeometry, tentacleRig)
local.sampledInteraction = interaction.evidence
const tentacles = TENTACLES.map((placement, index) => {
  const matrix = new Matrix4().compose(
    new Vector3(...placement.root),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), placement.yaw),
    new Vector3().setScalar(placement.height),
  )
  const cinematicBoxes = interaction.idleBoxes
    .filter((box) => !box.isEmpty())
    .map((box) => {
      const world = box.clone().applyMatrix4(matrix)
      // Independent downward reveal phases are enclosed too, not just the final full-height pose.
      world.min.y -= placement.height
      return world
    })
  // The analytic base-field boxes remain in the report as independent proof/culling evidence.
  // Clearance uses coherent real whole-body poses, rather than pairing an unattainable
  // independent joint-cap Y corner with a strike X corner from a different source state.
  const exploreBoxes = interaction.boxes.filter((box) => !box.isEmpty()).map((box) => box.clone().applyMatrix4(matrix))
  return {
    id: `tentacle-${index}`,
    placement,
    boxes: [...cinematicBoxes, ...exploreBoxes],
    cinematicBoxes,
    exploreBoxes,
  }
})
const creatures = [],
  attackCache = new Map()
for (const placement of HORROR_LAYOUT) {
  const name = placement.sourceType === 'watcher' ? 'shroud-watcher' : 'abyss-behemoth',
    high = await glb(`public/assets/black-mist/${name}.glb`)
  const sourceBounds = getBounds(high.getRoot().listScenes()[0]),
    h = sourceBounds.max[1] - sourceBounds.min[1],
    center = sourceBounds.min.map((v, i) => (v + sourceBounds.max[i]) / 2)
  const norm = new Matrix4()
    .makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new Matrix4().makeRotationY(placement.sourceYaw))
    .multiply(new Matrix4().makeTranslation(-center[0], -sourceBounds.min[1], -center[2]))
  const levels = [geometry(high, norm), geometry(await glb(`public/assets/black-mist/${name}.lod1.glb`), norm)],
    rig = horrorMotion.createHorrorRig(placement.sourceType, placement.phase)
  let radius = 0,
    minY = Infinity,
    maxY = -Infinity,
    observedDisplacement = 0,
    samples = 0,
    maximumSample = null
  const point = new Vector3(),
    posed = new Vector3(),
    limit = horrorMotion.HORROR_MOTION_LIMITS[placement.sourceType].displacement
  for (const [lod, geo] of levels.entries()) {
    horrorMotion.bindHorrorGeometry(geo, rig)
    const positions = geo.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i)
      radius = Math.max(radius, Math.hypot(point.x, point.z))
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    for (let frame = 0; frame < 192; frame++) {
      const time = (placement.patrol.period * 2 * frame) / 192,
        sample = horrorMotion.sampleHorrorMotion(placement, time)
      horrorMotion.updateHorrorRig(rig, placement, sample)
      for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 1024))) {
        point.fromBufferAttribute(positions, i)
        horrorMotion.evaluateHorrorMotionVertex(geo, rig, i, posed)
        const displacement = posed.distanceTo(point)
        if (displacement > observedDisplacement) {
          observedDisplacement = displacement
          maximumSample = {
            lod,
            vertex: i,
            timeSeconds: time,
            phase: sample.phase,
            displacementMeters: displacement * placement.height,
          }
        }
        samples++
      }
    }
  }
  assert.ok(
    observedDisplacement <= limit,
    `${placement.id} sampled real source motion stays within its shared deformation reserve`,
  )
  if (!attackCache.has(placement.sourceType))
    attackCache.set(placement.sourceType, sampledCreatureAttack(placement, levels, rig))
  const attack = attackCache.get(placement.sourceType),
    patrol = Math.max(placement.patrol.radiusX, placement.patrol.radiusZ)
  const body = {
    position: [...placement.position],
    radius: (radius + limit) * placement.height + patrol,
    minY: placement.position[1] + (minY - limit) * placement.height,
    maxY: placement.position[1] + (maxY + limit) * placement.height,
  }
  const cinematicCylinders = [{ ...body, minY: body.minY - placement.height * 0.55 }]
  const exploreCylinders = [
    body,
    ...attack.bands.map((band) => ({
      position: [...placement.position],
      radius: band.radius * placement.height + patrol,
      minY: placement.position[1] + band.minY * placement.height,
      maxY: placement.position[1] + band.maxY * placement.height,
    })),
  ]
  creatures.push({
    id: placement.id,
    sourceType: placement.sourceType,
    position: [...placement.position],
    radius: body.radius,
    minY: placement.position[1] + (minY - limit) * placement.height - placement.height * 0.55,
    maxY: placement.position[1] + (maxY + limit) * placement.height,
    geometryRadiusMeters: radius * placement.height,
    deformationReserveMeters: limit * placement.height,
    patrolRadiusMeters: Math.max(placement.patrol.radiusX, placement.patrol.radiusZ),
    observedDisplacementMeters: observedDisplacement * placement.height,
    actualVertexChecks: samples,
    maximumSample,
    sampledAttack: attack,
    cinematicCylinders,
    exploreCylinders,
    motionValidation: {
      class: 'sampled reserve, not an all-time analytic deformation proof',
      framesPerLod: 192,
      completeCycles: 2,
      verticesPerFrame: 'strided approximately 1024 actual vertices in each high/low GLB',
      declaredReserveNormalized: limit,
      observedDisplacementNormalized: observedDisplacement,
      unusedReserveMeters: (limit - observedDisplacement) * placement.height,
    },
    fullYaw: true,
    proof:
      'Every real high/low vertex is inside the static radius; every tangent yaw and patrol position is inside the swept cylinder. Deformation uses the shared sampled reserve, cross-checked against the actual CPU shader evaluator over two full cycles. Unsampled poses are an explicit assumption.',
  })
  levels.forEach((geo) => geo.dispose())
}

const pairs = []
for (const carrier of carriers)
  for (const tentacle of tentacles) {
    let minimum = { gapMeters: Infinity }
    for (const sample of carrier.route)
      for (const [band, box] of tentacle.boxes.entries()) {
        const gap = boxGap(sample.box, box) - carrier.envelope.auditedRadiusMeters
        if (gap < minimum.gapMeters)
          minimum = { gapMeters: gap, routeTimeSeconds: sample.time, routePosition: sample.point, band }
      }
    pairs.push({ a: carrier.id, b: tentacle.id, ...minimum })
  }
for (let i = 0; i < tentacles.length; i++)
  for (let j = i + 1; j < tentacles.length; j++) {
    let minimum = { gapMeters: Infinity }
    for (const phase of ['cinematicBoxes', 'exploreBoxes']) {
      for (const [aBand, a] of tentacles[i][phase].entries())
        for (const [bBand, b] of tentacles[j][phase].entries()) {
          const gap = boxGap(a, b)
          if (gap < minimum.gapMeters) minimum = { gapMeters: gap, aBand, bBand, phase }
        }
    }
    pairs.push({ a: tentacles[i].id, b: tentacles[j].id, ...minimum })
  }
for (const creature of creatures) {
  for (const carrier of carriers) {
    let minimum = { gapMeters: Infinity }
    for (const sample of carrier.route)
      for (const body of [...creature.cinematicCylinders, ...creature.exploreCylinders]) {
        const gap = cylinderGap(sample.box, body) - carrier.envelope.auditedRadiusMeters
        if (gap < minimum.gapMeters)
          minimum = { gapMeters: gap, routeTimeSeconds: sample.time, routePosition: sample.point }
      }
    pairs.push({ a: carrier.id, b: creature.id, ...minimum })
  }
  for (const tentacle of tentacles) {
    let minimum = { gapMeters: Infinity }
    for (const phase of ['cinematic', 'explore'])
      for (const [band, box] of tentacle[`${phase}Boxes`].entries())
        for (const body of creature[`${phase}Cylinders`]) {
          const gap = cylinderGap(box, body)
          if (gap < minimum.gapMeters) minimum = { gapMeters: gap, band, phase }
        }
    pairs.push({ a: creature.id, b: tentacle.id, ...minimum })
  }
}
for (let i = 0; i < creatures.length; i++)
  for (let j = i + 1; j < creatures.length; j++) {
    const first = creatures[i],
      second = creatures[j]
    let minimum = { gapMeters: Infinity }
    for (const phase of ['cinematic', 'explore'])
      for (const a of first[`${phase}Cylinders`])
        for (const b of second[`${phase}Cylinders`]) {
          const gap = cylinderPairGap(a, b)
          if (gap < minimum.gapMeters) minimum = { gapMeters: gap, phase }
        }
    pairs.push({ a: first.id, b: second.id, ...minimum })
  }
let carrierGap = Infinity
for (const a of route)
  for (const b of turtleRoute)
    carrierGap = Math.min(carrierGap, boxGap(a.box, b.box) - kun.auditedRadiusMeters - turtle.auditedRadiusMeters)
pairs.push({ a: 'kun', b: 'turtle', gapMeters: carrierGap })
assert.ok(
  pairs.every((pair) => Number.isFinite(pair.gapMeters)),
  'every measured pair clearance is finite',
)
const failures = pairs.filter((pair) => pair.gapMeters < MIN_GAP)
const report = {
  sourceHashes,
  layouts: { tentacles: TENTACLES, horror: HORROR_LAYOUT },
  requiredGapMeters: MIN_GAP,
  offlineFixture: fixtureTideZ === null ? null : { id: 'behemoth-tide', z: fixtureTideZ, productionUnchanged: true },
  verificationScope: {
    analytic:
      'Complete continuous Kun and Turtle curves, arbitrary keyed native skin rotations/scales/translations and native tentacle base-field/culling bound retained separately.',
    sampled:
      'Scene interaction clearance uses coherent full actual source triangles clipped to current height: tentacle64 poses/all8slots+.05H; horror384 poses/twoLOD+.03H. Horror idle .09/.18 reserves are sampling cushions over192 frames/LOD, not formal all-time bounds.',
    phaseGate:
      'Cinematic organisms may emerge but cannot attack; explored organisms attack only after all reveals have completed. Corresponding phase sets are compared, not a strike mixed with an independent buried reveal.',
  },
  revealCovered:
    'All rigid downward idle emergence offsets; each tentacle by0..height and horror by0..0.55height. Interaction poses are fully revealed, matching the hazard runtime gate.',
  kun: { ...kun, periodSeconds: curve.getLength() / KUN.speed, completeBezierIntervals: route.length },
  turtle: {
    ...turtle,
    nominalPeriodSeconds: turtleCurve.getLength() / TURTLE.speed,
    completeBezierIntervals: turtleRoute.length,
    heaveMeters: TURTLE.bob,
    proof:
      'Native keyed skin chain plus the existing centered child transform, parasite reserve and full vertical heave; complete continuous Catmull-Rom curve, independent of stroke surge timing.',
  },
  tentacleMotion: { ...local, boxes: local.boxes.map(jsonBox) },
  tentacles: tentacles.map((t) => ({
    id: t.id,
    placement: t.placement,
    dynamicBands: t.boxes.map(jsonBox),
    phaseBands: { cinematic: t.cinematicBoxes.map(jsonBox), exploration: t.exploreBoxes.map(jsonBox) },
  })),
  creatures,
  pairs,
  failures,
}
await fs.mkdir(OUT, { recursive: true })
await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
tentacleGeometry.forEach((geo) => geo.dispose())
console.log(
  `Kun: ${kun.bodyRadiusMeters.toFixed(2)} m body sphere + ${PARASITE_RESERVE} m parasites; full ${route.length}-interval closed route`,
)
console.log(
  `Turtle: ${turtle.bodyRadiusMeters.toFixed(2)} m body sphere + ${PARASITE_RESERVE} m parasites; full ${turtleRoute.length}-interval closed route and ${TURTLE.bob} m heave`,
)
console.log(
  'Horror deformation: real high/low shader motion sampled over two cycles; declared reserves are sampling cushions, not an analytic all-time proof.',
)
for (const pair of pairs)
  console.log(
    `${pair.gapMeters >= MIN_GAP ? 'PASS' : 'FAIL'} ${pair.a} / ${pair.b}: ${pair.gapMeters.toFixed(1)} m${pair.routeTimeSeconds === undefined ? '' : ` at ${pair.a} ${pair.routeTimeSeconds.toFixed(1)} s`}`,
  )
assert.equal(
  failures.length,
  0,
  `${failures.length} geometry-envelope pairs need >= ${MIN_GAP} m clearance; see artifacts/horror-clearance/report.json`,
)
