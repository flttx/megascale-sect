import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld, review } from './lib/world-session.mjs'
import { anatomySamples, creatureView, tentacleView } from './lib/eldritch-views.mjs'

// Living motion uses real rendered GLB parts and published geometry/skin reference samples.
// Run on its own: BASE_URL / CHROME_PATH follow world-session. --no-video collects the same 14-second source probes without recording WebM.
// --creatures-only captures the new creature apparitions/aftermath without repeating motion and pause checks.
const OUT = 'artifacts/eldritch-motion'
const CREATURES_ONLY = process.argv.includes('--creatures-only')
const VIEWS = {
  eye: [
    [0, 570, -120],
    [0, 550, -430],
  ],
}
const report = {
  checks: [],
  motion: {},
  carriers: {},
  creatures: [],
  phases: [],
  frames: [],
  video: null,
  errors: [],
  failure: null,
}
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]))
const maxDifference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
const boundTentacle = (binding) =>
  binding?.materialPatched &&
  binding.geometry?.tentacleMotion?.bound &&
  binding.attributes?.aTentacleJoints?.count > 1000 &&
  binding.attributes.aTentacleJoints.itemSize === 4 &&
  binding.attributes.aTentacleWeights?.count === binding.attributes.aTentacleJoints.count &&
  binding.attributes.aTentacleWeights.itemSize === 4 &&
  binding.attributes.aTentaclePhase?.count >= 6
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear&kunAt=40&turtleAt=0', {
  width: 1280,
  height: 720,
})
report.errors = errors
const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())

function anatomy(state) {
  const motion = state.motion
  assert.ok(
    motion && Number.isFinite(motion.time) && motion.landmarks,
    'DEV snapshot.motion must expose the rendered anatomy',
  )
  return motion.landmarks
}

function eyeSamples(eye, role) {
  const samples = eye.samples.filter((sample) => sample.role === role)
  assert.ok(samples.length, `${role} requires actual source-geometry reference samples`)
  return samples
}

function assertTentacleMotion(before, after) {
  const a = anatomy(before),
    b = anatomy(after)
  check(
    'the living clock advances independently of pointer lock',
    after.motion.time > before.motion.time + 0.25 && !after.motion.paused,
  )
  const movements = b.tentacles.map((tentacle) => {
    const previous = a.tentacles.find((candidate) => candidate.id === tentacle.id)
    assert.ok(previous, `tentacle ${tentacle.id} must persist`)
    const roots = distance(previous.root, tentacle.root),
      middle = distance(previous.mid, tentacle.mid),
      tip = distance(previous.tip, tentacle.tip)
    return {
      id: tentacle.id,
      roots,
      middle,
      tip,
      transformChange: maxDifference(previous.modelMatrix, tentacle.modelMatrix),
    }
  })
  check(
    'tentacle tips and middle bend while their roots and instance transforms stay fixed',
    movements.filter(
      (movement) =>
        movement.roots < 0.05 && movement.middle > 0.5 && movement.tip > 1 && movement.transformChange < 0.00001,
    ).length >= 2,
  )
  check(
    'the actual curled muscle has several independently bent segments',
    b.tentacles.every(
      (tentacle) =>
        tentacle.bones.length >= 8 &&
        tentacle.bones.every(
          (bone, index, bones) =>
            index === 0 ||
            Math.abs(distance(bone.rest, bones[index - 1].rest) - distance(bone.posed, bones[index - 1].posed)) <
              0.00001,
        ),
    ) &&
      b.tentacles.some((tentacle) => {
        const previous = a.tentacles.find((candidate) => candidate.id === tentacle.id)
        return (
          tentacle.bones.slice(2).filter((bone, index) => distance(bone.posed, previous.bones[index + 2].posed) > 0.001)
            .length >= 4 && distance(tentacle.bones[0].posed, previous.bones[0].posed) < 0.000001
        )
      }),
  )
  check(
    'actual tentacle draws bind the living deformation and PBR maps',
    b.tentacles.every(
      (tentacle) =>
        tentacle.shaderPatched &&
        Math.abs(tentacle.uniformTime - after.motion.time) < 0.001 &&
        tentacle.pbr?.baseColor &&
        tentacle.pbr.normal &&
        tentacle.pbr.roughness,
    ),
  )
  check(
    'actual imported tentacle vertex buffers and material shaders are bound in both LODs',
    b.tentacles.every(
      (tentacle) =>
        boundTentacle(tentacle.bindings) &&
        tentacle.lodBindings?.length === 2 &&
        tentacle.lodBindings.every(boundTentacle),
    ),
  )
  report.motion.tentacles = { from: before.motion.time, to: after.motion.time, movements }
}

function assertFullMuscleMotion(frames) {
  const thresholds = { root: 0, 'lower-shaft': 0.0075, 'middle-shaft': 0.015, crook: 0.03, tip: 0.025 }
  assert.ok(frames.length >= 10, 'At least ten actual rendered anatomy frames are required')
  const measurements = []
  for (const first of frames[0].tentacles) {
    const sequence = frames.map((frame) => frame.tentacles.find((tentacle) => tentacle.id === first.id))
    check(
      `tentacle ${first.id}: skin moves without rotating or translating its instance`,
      sequence.every((tentacle) => maxDifference(tentacle.modelMatrix, first.modelMatrix) < 0.00001),
    )
    for (const lod of [0, 1]) {
      const probes = sequence.map((tentacle) => tentacle.lodSourceProbes?.find((level) => level.lod === lod)?.probes)
      check(
        `tentacle ${first.id}/LOD${lod}: every muscle region uses actual indexed GLB vertices`,
        probes.every(
          (list) =>
            Array.isArray(list) &&
            Object.keys(thresholds).every((role) => list.some((probe) => probe.role === role)) &&
            list.every(
              (probe) =>
                Number.isInteger(probe.index) &&
                probe.index >= 0 &&
                probe.mesh &&
                finitePoint(probe.rest) &&
                finitePoint(probe.posed) &&
                finitePoint(probe.world),
            ),
        ),
      )
      for (const [role, minimum] of Object.entries(thresholds)) {
        const original = probes[0].find((probe) => probe.role === role)
        const points = probes.map((list) =>
          list.find((probe) => probe.role === role && probe.index === original.index && probe.mesh === original.mesh),
        )
        assert.ok(points.every(Boolean), `${role} must retain its source vertex across frames`)
        const amount = Math.max(...points.map((probe) => distance(original.posed, probe.posed)))
        check(
          `tentacle ${first.id}/LOD${lod}: ${role === 'root' ? 'root skin stays fixed' : `${role} has visible local deformation`}`,
          role === 'root' ? amount < 0.000001 : amount > minimum,
        )
        measurements.push({
          id: first.id,
          lod,
          role,
          index: original.index,
          localDisplacement: amount,
          worldDisplacement: Math.max(...points.map((probe) => distance(original.world, probe.world))),
        })
      }
    }
  }
  report.motion.sourceRegions = { frames: frames.length, from: frames[0].time, to: frames.at(-1).time, measurements }
}

function assertEyeMotion(before, after) {
  const a = anatomy(before),
    b = anatomy(after)
  const oldEye = a.eye,
    eye = b.eye
  check(
    'the eyeball changes local yaw and pitch while the socket remains fixed',
    Math.abs(eye.yaw - oldEye.yaw) > 0.0005 &&
      Math.abs(eye.pitch - oldEye.pitch) > 0.0005 &&
      maxDifference(eye.modelMatrix, oldEye.modelMatrix) < 0.00001,
  )
  const oldBall = eyeSamples(oldEye, 'eyeball'),
    ball = eyeSamples(eye, 'eyeball')
  const oldSocket = eyeSamples(oldEye, 'socket'),
    socket = eyeSamples(eye, 'socket')
  check(
    'mask-one ocular vertices actually move in the imported geometry',
    ball.some((sample) => {
      const previous = oldBall.find((candidate) => candidate.id === sample.id)
      return previous && distance(previous.posed, sample.posed) > 0.001
    }),
  )
  check(
    'mask-zero outer-socket geometry does not spin with the eyeball',
    socket.every((sample) => {
      const previous = oldSocket.find((candidate) => candidate.id === sample.id)
      return previous && distance(previous.posed, sample.posed) < 0.000001
    }),
  )
  check(
    'imported eye geometry distinguishes ocular core, socket and tissue transition',
    eye.roles.globe > 100 &&
      eye.roles.socket > 100 &&
      eye.roles.transition > 100 &&
      ball.every((sample) => sample.weight > 0.999 && Number.isInteger(sample.index)) &&
      socket.every((sample) => sample.weight < 0.001 && Number.isInteger(sample.index)),
  )
  check(
    'the actual eye vertex mask and gradient buffers bind its local material shader',
    eye.bindings?.materialPatched &&
      eye.bindings.attributes?.aEyeMask?.count === eye.roles.globe + eye.roles.socket + eye.roles.transition &&
      eye.bindings.attributes.aEyeMask.itemSize === 1 &&
      eye.bindings.attributes.aEyeMaskGradient?.count === eye.bindings.attributes.aEyeMask.count &&
      eye.bindings.attributes.aEyeMaskGradient.itemSize === 3,
  )
  check(
    'moving ocular geometry retains the real asset materials',
    eye.shaderPatched && eye.pbr?.baseColor && eye.pbr.normal && eye.pbr.roughness,
  )
  report.motion.eye = {
    from: before.motion.time,
    to: after.motion.time,
    yaw: [oldEye.yaw, eye.yaw],
    pitch: [oldEye.pitch, eye.pitch],
    movingCoreDistance: distance(oldBall[0].posed, ball[0].posed),
    fixedSocketDistance: distance(oldSocket[0].posed, socket[0].posed),
    roles: eye.roles,
  }
}

function assertCarrierSurface(state, id) {
  const carrier = state.motion.carriers[id]
  check(
    `${id} has a small set of parasites embedded into real animated skin`,
    carrier.visible &&
      carrier.anchors.length >= 2 &&
      carrier.anchors.length <= 7 &&
      carrier.anchors.every(
        (anchor) =>
          anchor.skinned &&
          anchor.triangle.length === 3 &&
          anchor.boneNames.length &&
          finitePoint(anchor.referencePosition) &&
          finitePoint(anchor.renderedPosition) &&
          anchor.matrixWorld?.length === 16 &&
          distance(anchor.referencePosition, anchor.renderedPosition) < 4.2,
      ),
  )
  check(
    `${id} skin fusion retains textured PBR anatomy`,
    carrier.models.length > 0 &&
      carrier.models.every(
        (model) => model.triangles > 0 && model.pbr.baseColor && model.pbr.normal && model.pbr.roughness,
      ),
  )
  check(
    `${id} has real curved membrane edges measured against native Three skin vertices`,
    carrier.conformance.length > 0 &&
      carrier.conformance.every(
        (patch) =>
          patch.samples >= 10 &&
          patch.edgeSamples.length >= 8 &&
          patch.maxSkinErrorMeters < 0.001 &&
          patch.maxSeamGapMeters < 0.3 &&
          patch.edgeSamples.every(
            (sample) =>
              sample.triangle.length === 3 &&
              sample.barycentrics.length === 3 &&
              Math.abs(sample.barycentrics.reduce((sum, value) => sum + value, 0) - 1) < 0.00001 &&
              finitePoint(sample.referencePosition) &&
              finitePoint(sample.renderedPosition) &&
              distance(sample.referencePosition, sample.renderedPosition) < 0.3,
          ),
      ),
  )
  check(
    `${id} uses the shared living phase for ocular and muscle anatomy`,
    Math.abs(carrier.motionTime - state.motion.time) < 0.001 &&
      carrier.anchors.every((anchor) => anchor.motion?.shaderPatched || anchor.motion?.bones?.length >= 8),
  )
  return {
    anchors: carrier.anchors.length,
    draws: carrier.draws,
    conformance: carrier.conformance.map((patch) => ({
      detail: patch.detail,
      samples: patch.samples,
      maxSkinErrorMeters: patch.maxSkinErrorMeters,
      maxSeamGapMeters: patch.maxSeamGapMeters,
    })),
  }
}

function localPose(state) {
  const model = anatomy(state)
  return {
    time: state.motion.time,
    eye: { yaw: model.eye.yaw, pitch: model.eye.pitch, samples: model.eye.samples },
    tentacles: model.tentacles.map((tentacle) => ({
      id: tentacle.id,
      samples: tentacle.samples,
      sourceProbes: tentacle.sourceProbes,
      lodSourceProbes: tentacle.lodSourceProbes,
    })),
    carriers: Object.fromEntries(
      Object.entries(state.motion.carriers).map(([id, carrier]) => [
        id,
        carrier.anchors.map((anchor) => ({
          id: anchor.id,
          phaseSlot: anchor.phaseSlot,
          time: anchor.motion?.time,
          yaw: anchor.motion?.yaw,
          pitch: anchor.motion?.pitch,
          root: anchor.motion?.root,
          mid: anchor.motion?.mid,
          tip: anchor.motion?.tip,
        })),
      ]),
    ),
  }
}

async function assertFrozen(label) {
  await page.waitForTimeout(200)
  const before = await snapshot()
  await page.waitForTimeout(650)
  const after = await snapshot()
  check(
    `${label} pauses the independent anatomy clock`,
    after.motion.paused && before.motion.time === after.motion.time,
  )
  check(
    `${label} freezes local ocular and tentacle poses`,
    JSON.stringify(localPose(before)) === JSON.stringify(localPose(after)),
  )
  return after
}

async function assertResumed(label, frozen) {
  await page.waitForTimeout(250)
  const state = await snapshot(),
    elapsed = state.motion.time - frozen.motion.time
  check(`${label} resumes the actual muscle clock`, elapsed > 0 && !state.motion.paused)
  const jumps = anatomy(state).tentacles.flatMap((tentacle) => {
    const previous = anatomy(frozen).tentacles.find((candidate) => candidate.id === tentacle.id)
    return tentacle.lodSourceProbes.flatMap((level) =>
      level.probes.map((probe) => {
        const original = previous.lodSourceProbes
          .find((candidate) => candidate.lod === level.lod)
          .probes.find((candidate) => candidate.role === probe.role && candidate.index === probe.index)
        return distance(original.posed, probe.posed)
      }),
    )
  })
  check(
    `${label} continues indexed skin smoothly without a phase jump`,
    jumps.every((jump) => Number.isFinite(jump) && jump < elapsed * 0.5 + 0.001),
  )
  report.motion.resumes ??= []
  report.motion.resumes.push({ label, elapsed, maxLocalVertexStep: Math.max(...jumps) })
}

async function capture(name) {
  const filename = `${OUT}/${name}.png`
  await page.screenshot({ path: filename })
  const state = await snapshot()
  report.frames.push({ name, time: state.motion.time, filename })
  return state
}

async function recordMotionVideo() {
  const record = !process.argv.includes('--no-video')
  const result = await page.evaluate(async (record) => {
    const sample = () => {
      const state = window.__blackMist.snapshot()
      return {
        time: state.motion.time,
        tentacles: state.motion.landmarks.tentacles.map((tentacle) => ({
          id: tentacle.id,
          modelMatrix: tentacle.modelMatrix,
          sourceProbes: tentacle.sourceProbes,
          lodSourceProbes: tentacle.lodSourceProbes,
        })),
      }
    }
    const frames = [sample()],
      sampler = setInterval(() => frames.push(sample()), 1000)
    if (!record) {
      await new Promise((resolve) => setTimeout(resolve, 14000))
      clearInterval(sampler)
      frames.push(sample())
      return { frames }
    }
    const canvas = document.querySelector('canvas')
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    )
    if (!canvas || !mimeType) throw Error('Canvas WebM recording is unavailable')
    const stream = canvas.captureStream(24),
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_800_000 })
    const chunks = []
    return new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        clearInterval(sampler)
        stream.getTracks().forEach((track) => track.stop())
        reject(Error('The motion recording failed'))
      }
      recorder.onstop = async () => {
        clearInterval(sampler)
        frames.push(sample())
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunks, { type: mimeType }),
          bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
        resolve({ mimeType, bytes: bytes.length, data: btoa(binary), frames })
      }
      recorder.start(500)
      setTimeout(() => recorder.stop(), 14000)
    })
  }, record)
  assertFullMuscleMotion(result.frames)
  if (record) {
    check('fourteen seconds of actual full-body WebGL muscle motion are recorded', result.bytes > 10000)
    const filename = `${OUT}/living-tentacle-full-body-14s.webm`
    await fs.writeFile(filename, Buffer.from(result.data, 'base64'))
    report.video = { filename, mimeType: result.mimeType, bytes: result.bytes, seconds: 14 }
  }
}

async function fixedMotion(time) {
  await page.evaluate((value) => {
    window.__blackMist.motionHold(true)
    window.__blackMist.seekMotion(value)
  }, time)
  await page.waitForTimeout(120)
  return snapshot()
}

async function captureCreatures() {
  await page.evaluate(() => {
    window.__environmentReview(null)
    window.__blackMist.reset()
    window.__blackMist.hold(true)
    window.__ui.setHudHidden(true)
  })
  for (const [time, id] of [
    [36, 'watcher'],
    [39, 'behemoth'],
  ]) {
    await page.evaluate((value) => window.__blackMist.seek(value), time)
    await page.waitForTimeout(450)
    const state = await capture(`cinematic-${id}`),
      creature = state.creatures?.find((candidate) => candidate.id === id)
    check(
      `${id} has a visible actual GLB in its apparition shot`,
      state.cameraShot?.id === `${id}-apparition` &&
        creature?.visible &&
        creature.reveal > 0.9 &&
        creature.draws.length > 0 &&
        creature.draws.every(
          (draw) =>
            draw.triangles > 1000 &&
            draw.sourceUrl.endsWith('.glb') &&
            draw.pbr.baseColor &&
            draw.pbr.normal &&
            draw.pbr.roughness &&
            (draw.motionPatched ?? draw.breathingPatched),
        ),
    )
    report.creatures.push({
      id,
      elapsed: time,
      cameraShot: state.cameraShot,
      position: creature.position,
      height: creature.height,
      normalizedBounds: creature.normalizedBounds,
      draws: creature.draws,
    })
  }
  await page.evaluate(() => window.__blackMist.skip())
  await page.waitForTimeout(150)
  for (const id of ['watcher', 'behemoth']) {
    const creature = (await snapshot()).creatures.find((candidate) => candidate.id === id)
    const pose = creatureView(creature)
    await review(page, pose, 400)
    const before = await capture(`aftermath-${id}-00`)
    await page.waitForTimeout(350)
    const middle = await snapshot()
    await page.waitForTimeout(1050)
    const after = await capture(`aftermath-${id}-01`),
      a = before.creatures.find((candidate) => candidate.id === id),
      m = middle.creatures.find((candidate) => candidate.id === id),
      b = after.creatures.find((candidate) => candidate.id === id)
    const source = anatomySamples(a),
      probes = [anatomySamples(m), anatomySamples(b)]
    const vertexMovement = Math.max(
      ...probes.flatMap((samples) =>
        samples.map((sample) => {
          const previous = source.find((candidate) => candidate.id === sample.id)
          return previous ? distance(previous.posed, sample.posed) : 0
        }),
      ),
    )
    report.creatures.push({
      id,
      stage: 'aftermath',
      from: a.motionTime,
      middle: m.motionTime,
      to: b.motionTime,
      rootMovement: distance(a.position, b.position),
      vertexMovement,
      camera: pose,
      awaitingExplore: [before.awaitingExplore, after.awaitingExplore],
      visible: b.visible,
      reveal: b.reveal,
    })
    check(
      `${id} remains alive in the unlocked aftermath`,
      before.awaitingExplore &&
        after.awaitingExplore &&
        b.visible &&
        b.reveal === 1 &&
        b.motionTime > a.motionTime + 0.25 &&
        source.length > 0 &&
        vertexMovement > 0.00001,
    )
  }
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
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
  )
  check(
    'ordinary exploration requests no extra living-anatomy assets',
    !resources.some((url) => /\/assets\/black-mist\/.*\.(?:glb|webp|png)$/.test(url)),
  )
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 70000 })
  if (CREATURES_ONLY) {
    await captureCreatures()
  } else {
    await page.evaluate(() => {
      window.__blackMist.hold(true)
      window.__blackMist.seek(55)
      window.__blackMist.skip()
    })
    await page.waitForFunction(() => window.__blackMist.snapshot().awaitingExplore)
    await page.evaluate(() => window.__ui.setHudHidden(true))
    await review(page, tentacleView(await snapshot()), 300)
    const before = await capture('tentacle-00')
    await page.waitForTimeout(2500)
    const after = await capture('tentacle-02')
    check(
      'the aftermath remains alive before the exploration CTA is clicked',
      before.awaitingExplore &&
        after.awaitingExplore &&
        (await page.evaluate(() => !document.pointerLockElement)) &&
        after.elapsed === before.elapsed,
    )
    assertTentacleMotion(before, after)
    for (const id of ['kun', 'turtle']) {
      report.carriers[id] = assertCarrierSurface(after, id)
      check(
        `${id} parasites follow their moving posed skin rather than a free-floating transform`,
        after.motion.carriers[id].anchors.some((anchor) => {
          const previous = before.motion.carriers[id].anchors.find((candidate) => candidate.id === anchor.id)
          return (
            previous &&
            distance(previous.referencePosition, anchor.referencePosition) > 0.1 &&
            distance(previous.renderedPosition, anchor.renderedPosition) > 0.1
          )
        }),
      )
    }
    await review(page, tentacleView(await snapshot(), 0, 'full'), 300)
    await capture('tentacle-full-body-before')
    await recordMotionVideo()
    await capture('tentacle-full-body-after')
    await review(page, VIEWS.eye, 300)
    await capture('eye-00')
    await page.waitForTimeout(2000)
    await capture('eye-02')
    // Ocular motion intentionally includes several-second fixations. Cross a full fixation interval
    // while keeping the actual camera and instance transform fixed, rather than demanding a saccade every frame.
    const eyeBefore = await fixedMotion(68)
    await capture('eye-phase-68')
    const eyeAfter = await fixedMotion(76)
    await capture('eye-phase-76')
    assertEyeMotion(eyeBefore, eyeAfter)
    const fixed = await fixedMotion(82)
    for (const quality of ['high', 'mid', 'low']) {
      await page.evaluate(async (quality) => {
        const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
        useWorldStore.getState().setQuality(quality, false)
      }, quality)
      await page.waitForTimeout(400)
      const state = await snapshot(),
        model = anatomy(state)
      check(
        `${quality} uses the same local anatomy phase`,
        state.motion.time === fixed.motion.time && Math.abs(model.eye.yaw - anatomy(fixed).eye.yaw) < 0.000001,
      )
      check(
        `${quality} tentacle LODs share the same rooted pose`,
        model.tentacles.every(
          (tentacle) =>
            tentacle.lodSamples &&
            ['root', 'mid', 'tip'].every(
              (point) => distance(tentacle.lodSamples[0][point], tentacle.lodSamples[1][point]) < 0.02,
            ),
        ),
      )
      check(
        `${quality} ocular LODs retain the same socket and gaze phase`,
        model.eye.lodAngles.every(
          (lod) =>
            Math.abs(lod.yaw - model.eye.yaw) < 0.000001 &&
            Math.abs(lod.pitch - model.eye.pitch) < 0.000001 &&
            lod.roles.globe > 100 &&
            lod.roles.socket > 100,
        ),
      )
      for (const id of ['kun', 'turtle']) assertCarrierSurface(state, id)
      report.phases.push({ quality, time: state.motion.time, eyeYaw: model.eye.yaw, eyePitch: model.eye.pitch })
    }
    await page.evaluate(() => {
      window.__blackMist.motionHold(false)
      window.__ui.setHudHidden(false)
      window.__environmentReview(null)
    })
    await page.locator('.black-mist-explore').click()
    await page.waitForFunction(() => !!document.pointerLockElement)
    await page.keyboard.press('Tab')
    await page.getByRole('tabpanel').waitFor()
    const scrollPause = await assertFrozen('the scroll overlay')
    await page.locator('.scroll-close').click()
    await page.waitForFunction(() => !!document.pointerLockElement)
    await assertResumed('the scroll overlay', scrollPause)
    await page.evaluate(() => document.exitPointerLock())
    await page.locator('.settings-dialog').waitFor()
    const settingsPause = await assertFrozen('aftermath settings')
    await page.locator('.settings-resume').click()
    await page.waitForFunction(() => !!document.pointerLockElement)
    await assertResumed('aftermath settings', settingsPause)
    // The application's existing stability checks use an explicit visibility event in headless Chrome.
    // This keeps render frames available to inspect the pause gate, instead of merely freezing the browser.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    let backgroundPause
    try {
      backgroundPause = await assertFrozen('background visibility')
    } finally {
      await page.evaluate(() => {
        delete document.hidden
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    await assertResumed('background visibility', backgroundPause)
    await page.evaluate(() => {
      window.__blackMist.reset()
      window.__blackMist.hold(true)
    })
    await page.waitForTimeout(250)
    check(
      'replay resets the anatomy phase and immature world',
      (await snapshot()).motion.time === 0 && (await snapshot()).corruption === 0,
    )
    await page.evaluate(() => {
      window.__blackMist.seek(55)
      window.__blackMist.hold(false)
    })
    await page.locator('canvas').focus()
    await page.keyboard.press('Escape')
    await page.locator('.settings-dialog').waitFor()
    await assertFrozen('cinematic settings')
    await page.locator('.settings-resume').click()
    await page.locator('.settings-dialog').waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    const resumed = await snapshot()
    check('cinematic anatomy resumes after settings close', !resumed.motion.paused && resumed.motion.time > 55)
    await captureCreatures()
    await page.evaluate(async () => {
      const { stopBlackMist } = await window.__liveImport('/src/world/blackMist/runtime.ts')
      stopBlackMist()
    })
    await page.waitForTimeout(300)
    const ordinary = await snapshot()
    check(
      'ordinary exploration clears living models and resets their phase',
      !ordinary.active &&
        ordinary.motion.time === 0 &&
        ordinary.models.length === 0 &&
        ordinary.creatures.length === 0 &&
        !ordinary.mutations.carriers.kun.visible &&
        !ordinary.mutations.carriers.turtle.visible,
    )
  }
  check('living anatomy renders without shader or browser errors', errors.length === 0)
} catch (error) {
  report.failure = error.stack ?? String(error)
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(
    `${OUT}/${CREATURES_ONLY ? 'report-creatures' : 'report'}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await browser.close()
}
