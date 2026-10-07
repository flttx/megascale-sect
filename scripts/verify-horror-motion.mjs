import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { installLiveImports, openWorld, review, telemetry } from './lib/world-session.mjs'
import { anatomySamples, creatureView } from './lib/eldritch-views.mjs'

// Run this GPU verification on its own. BASE_URL / CHROME_PATH follow world-session.
// --no-video preserves the pose/audio checks while omitting two 14-second mastered-audio WebMs.
const OUT = 'artifacts/horror-motion'
const SKYLINE_ONLY = process.argv.includes('--skyline-only')
const RECOVERY_ONLY = process.argv.includes('--recovery-only')
const CAMERA_SCOUT = process.argv.includes('--behemoth-cameras')
const PREVIEW_ONLY = process.argv.includes('--preview-only') || SKYLINE_ONLY || CAMERA_SCOUT
const report = { checks: [], schedules: {}, poses: {}, videos: [], frames: [], kun: [], errors: [], failure: null }
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]))
const maxDifference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear&kunAt=55&turtleAt=0', {
  width: 1440,
  height: 900,
})
report.errors = errors
const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())
const creature = (state, id) => {
  const value = state.creatures?.find((candidate) => candidate.id === id)
  assert.ok(value, `actual rendered ${id} must be published`)
  return value
}
const roar = (state, id, cycle) => state.audio.roars.filter((event) => event.creature === id && event.cycle === cycle)
const movingSamples = (before, after) =>
  anatomySamples(after).map((sample) => {
    const previous = anatomySamples(before).find((candidate) => candidate.id === sample.id)
    return { ...sample, displacement: previous ? distance(previous.posed, sample.posed) : 0 }
  })

async function seekMotion(time) {
  await page.evaluate((time) => {
    window.__blackMist.motionHold(true)
    window.__blackMist.seekMotion(time)
  }, time)
  await page.waitForTimeout(180)
  return snapshot()
}

async function capture(name) {
  const filename = `${OUT}/${name}.png`
  await page.screenshot({ path: filename })
  const state = await snapshot()
  report.frames.push({
    name,
    filename,
    motionTime: state.motion.time,
    creatures: state.creatures.map((item) => ({ id: item.id, position: item.position, phase: item.motion.phase })),
  })
  return state
}

async function nextRoar(id, after = 100) {
  return page.evaluate(
    async ({ id, after }) => {
      const [{ HORROR_LAYOUT }, { sampleHorrorMotion }] = await Promise.all([
        window.__liveImport('/src/world/blackMist/horrorLayout.ts'),
        window.__liveImport('/src/world/blackMist/horrorMotion.ts'),
      ])
      const placement = HORROR_LAYOUT.find((item) => item.id === id)
      let first = null,
        end = null
      // Read the shared sequence's event window rather than copying its patrol or roar formula.
      for (let time = after; time < after + placement.patrol.period * 2; time += 0.05) {
        const pose = sampleHorrorMotion(placement, time)
        if (!first && pose.roarEvent) first = { time, pose }
        else if (first && !pose.roarEvent) {
          end = time
          break
        }
      }
      if (!first || !end) throw Error(`No future ${id} roar event window`)
      return {
        start: first.time,
        peak: first.time + (end - first.time) * 0.45,
        end,
        cycle: first.pose.cycle,
        period: placement.patrol.period,
        eventId: first.pose.roarEventId,
      }
    },
    { id, after },
  )
}

function assertBoundAnatomy(value, id) {
  const samples = anatomySamples(value)
  check(
    `${id} publishes actual indexed source-geometry motion samples`,
    samples.length >= 3 &&
      samples.every(
        (sample) => Number.isInteger(sample.index) && finitePoint(sample.rest) && finitePoint(sample.posed),
      ),
  )
  check(
    `${id} keeps the imported PBR models and real motion shaders`,
    value.draws.length > 0 &&
      value.draws.every(
        (draw) =>
          draw.triangles > 20000 && draw.motionPatched && draw.pbr.baseColor && draw.pbr.normal && draw.pbr.roughness,
      ),
  )
  check(
    `${id} binds real four-weight geometry to the articulated joint palette`,
    value.motion.joints?.length >= 8 &&
      value.draws.every(
        (draw) =>
          draw.bindings.joints?.count > 1000 &&
          draw.bindings.joints.itemSize === 4 &&
          draw.bindings.weights?.count === draw.bindings.joints.count &&
          draw.bindings.weights.itemSize === 4,
      ) &&
      value.motion.lods?.length === 2 &&
      value.motion.lods.every(
        (lod) => lod.time === value.motionTime && lod.phase === value.motion.phase && lod.probes.length >= 3,
      ),
  )
}

async function recordVideo(id, seconds = 14) {
  const result = await page.evaluate(async (seconds) => {
    const { mixer } = await window.__liveImport('/src/world/audio/mixer.ts')
    const context = mixer.audioContext,
      master = mixer.master,
      canvas = document.querySelector('canvas')
    if (!context || context.state !== 'running' || !master || !canvas)
      throw Error('The actual mastered game audio must be running for recording')
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    )
    if (!mimeType) throw Error('Canvas/audio WebM recording is unavailable')
    const tap = context.createMediaStreamDestination(),
      analyser = context.createAnalyser()
    master.connect(tap)
    master.connect(analyser)
    const stream = canvas.captureStream(24)
    tap.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 96_000 })
    const chunks = [],
      samples = new Float32Array(analyser.fftSize)
    let maxRms = 0
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      maxRms = Math.max(maxRms, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length))
    }, 100)
    const cleanup = () => {
      clearInterval(meter)
      master.disconnect(tap)
      master.disconnect(analyser)
      analyser.disconnect()
      tap.disconnect()
      stream.getTracks().forEach((track) => track.stop())
    }
    return new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        cleanup()
        reject(Error('Creature motion/audio recording failed'))
      }
      recorder.onstop = async () => {
        cleanup()
        const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
        resolve({
          bytes: bytes.length,
          data: btoa(binary),
          mimeType,
          audioTracks: stream.getAudioTracks().length,
          maxRms,
        })
      }
      recorder.start(500)
      setTimeout(() => recorder.stop(), seconds * 1000)
    })
  }, seconds)
  check(
    `${id} records real rendered gait and roar with mastered game audio`,
    result.bytes > 10000 && result.audioTracks === 1 && result.maxRms > 0.001,
  )
  const filename = `${OUT}/${id}-gait-roar-${seconds}s.webm`
  await fs.writeFile(filename, Buffer.from(result.data, 'base64'))
  report.videos.push({
    filename,
    seconds,
    ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'data')),
  })
}

function frozenPose(state) {
  return state.creatures.map((item) => ({
    id: item.id,
    position: item.position,
    yaw: item.yaw,
    samples: anatomySamples(item),
    joints: item.motion.joints,
  }))
}

async function assertPaused(label) {
  await page.waitForTimeout(220)
  const before = await snapshot()
  await page.waitForTimeout(550)
  const after = await snapshot()
  check(
    `${label} freezes patrol positions and actual local articulated poses`,
    before.motion.time === after.motion.time &&
      after.motion.paused &&
      JSON.stringify(frozenPose(before)) === JSON.stringify(frozenPose(after)),
  )
  check(
    `${label} stops roar voices and closes sound gates`,
    !after.audio.audible &&
      (after.audio.state === 'suspended' || after.audio.gates.sfx === 0) &&
      after.audio.roars.every((event) => !event.voiceActive || event.stopping),
  )
  return after
}

async function assertPausedRecovery() {
  await page.evaluate(async () => {
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    useWorldStore.getState().setQuality('low', false)
    window.__environmentReview(null)
    window.__blackMist.reset()
    window.__blackMist.hold(true)
    window.__blackMist.seek(35)
  })
  await page.waitForTimeout(300)
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await page.locator('.settings-dialog').waitFor()
  await page.evaluate(() => window.__blackMist.hold(false))
  await page.waitForTimeout(150)
  const before = await snapshot()
  report.recovery = { before: { time: before.motion.time, camera: before.camera, shot: before.cameraShot } }
  check(
    'recovery starts in a real manually paused Watcher apparition',
    before.manualPaused && before.cameraShot.id === 'watcher-apparition' && before.elapsed === 35,
  )
  await page.evaluate(() => {
    window.__horrorOldCanvas = document.querySelector('canvas')
    window.__horrorLostContext = window.__horrorOldCanvas.getContext('webgl2').getExtension('WEBGL_lose_context')
    window.__horrorLostContext.loseContext()
  })
  await page.locator('.graphics-recovery').waitFor()
  await page.waitForTimeout(150)
  const lost = await snapshot()
  report.recovery.lostAudio = lost.audio
  check(
    'graphics loss immediately disposes every mist sound source and node',
    lost.audio.sources === 0 && lost.audio.nodes === 0 && !lost.audio.audible,
  )
  await page.evaluate(() => window.__horrorLostContext.restoreContext())
  await page.waitForFunction(
    () =>
      !document.querySelector('.graphics-recovery') &&
      window.__blackMist?.snapshot().assets.ready &&
      document.querySelector('canvas') !== window.__horrorOldCanvas,
    null,
    { timeout: 30000 },
  )
  await installLiveImports(page)
  await page.waitForTimeout(350)
  const after = await snapshot()
  report.recovery.after = {
    time: after.motion.time,
    camera: after.camera,
    shot: after.cameraShot,
    cameraDelta: distance(before.camera, after.camera),
    eyeDelta: distance(before.cameraShot.eye, after.cameraShot.eye),
    aimDelta: distance(before.cameraShot.aim, after.cameraShot.aim),
  }
  check(
    'manual pause and both clocks survive the rebuilt canvas',
    after.manualPaused && after.motion.time === before.motion.time && after.elapsed === before.elapsed,
  )
  check(
    'paused reconstruction preserves the real creature positions and poses',
    before.creatures.every((value) => {
      const rebuilt = creature(after, value.id)
      return (
        distance(value.position, rebuilt.position) < 0.00001 &&
        Math.abs(value.yaw - rebuilt.yaw) < 0.000001 &&
        movingSamples(value, rebuilt).every((sample) => sample.displacement < 0.000001)
      )
    }),
  )
  check(
    'paused reconstruction keeps the apparition camera on the real rebuilt creature',
    distance(before.camera, after.camera) < 0.01 &&
      distance(before.cameraShot.eye, after.cameraShot.eye) < 0.01 &&
      distance(before.cameraShot.aim, after.cameraShot.aim) < 0.01,
  )
  await capture('paused-watcher-recovered')
  await page.locator('.settings-resume').click()
  await page.locator('.settings-dialog').waitFor({ state: 'detached' })
  await page.waitForTimeout(350)
  const resumed = await snapshot()
  check(
    'the rebuilt apparition resumes its living sequence',
    !resumed.manualPaused && !resumed.motion.paused && resumed.motion.time > after.motion.time,
  )
}

try {
  const ordinary = await snapshot(),
    resources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
    )
  check(
    'ordinary exploration has no optional horror models or requests',
    ordinary.creatures.length === 0 && !resources.some((url) => /\/assets\/black-mist\/.*\.glb$/.test(url)),
  )
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 180000 })
  await page.evaluate(() => {
    window.__blackMist.hold(true)
    window.__blackMist.seek(55)
    window.__blackMist.skip()
    window.__ui.setHudHidden(true)
  })
  await page.waitForFunction(() =>
    ['watcher', 'behemoth'].every((id) =>
      window.__blackMist.snapshot().creatures.some((creature) => creature.id === id),
    ),
  )
  if (RECOVERY_ONLY) {
    await assertPausedRecovery()
  } else if (CAMERA_SCOUT) {
    const candidates = { left: [-0.9, 1.4, 1.15], highLeft: [-0.7, 1.65, 0.9], close: [0, 1.15, 0.85] }
    const captureAngles = async (label) => {
      const value = creature(await snapshot(), 'behemoth'),
        [x, y, z] = value.position,
        h = value.height,
        cos = Math.cos(value.yaw),
        sin = Math.sin(value.yaw)
      for (const [name, [lx, ly, lz]] of Object.entries(candidates)) {
        const view = [
          [x + h * (lx * cos + lz * sin), y + h * ly, z + h * (lz * cos - lx * sin)],
          [x, y + h * 0.68, z],
        ]
        await review(page, view, 350)
        await capture(`behemoth-camera-${label}-${name}`)
        report.poses[`${label}-${name}`] = { localEye: [lx, ly, lz], localAim: [0, 0.68, 0], camera: view }
      }
    }
    await page.evaluate(() => {
      window.__blackMist.hold(true)
      window.__blackMist.seek(39)
    })
    await page.waitForTimeout(200)
    await captureAngles('film')
    await page.evaluate(() => window.__blackMist.skip())
    await seekMotion((await nextRoar('behemoth')).peak)
    await captureAngles('roar')
  } else if (PREVIEW_ONLY) {
    await seekMotion(106)
    for (const [name, view] of Object.entries({
      hero: [
        [0, 40, 210],
        [0, 100, -350],
      ],
      overview: [
        [0, 420, 520],
        [0, 250, -1100],
      ],
      reverse: [
        [0, 720, -900],
        [0, 400, -2350],
      ],
    })) {
      await review(page, view, 500)
      await capture(`preview-${name}`)
    }
    if (!SKYLINE_ONLY)
      for (const id of ['watcher', 'behemoth']) {
        const schedule = await nextRoar(id, (await snapshot()).motion.time + 10)
        report.schedules[id] = schedule
        const walking = creature(await seekMotion(schedule.start - 8), id)
        assertBoundAnatomy(walking, id)
        await review(page, creatureView(walking, 'full'), 500)
        await capture(`preview-${id}-walk`)
        const roaring = creature(await seekMotion(schedule.peak), id)
        await review(page, creatureView(roaring, 'full'), 300)
        await capture(`preview-${id}-roar`)
      }
    if (!SKYLINE_ONLY) {
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
        await page.evaluate((time) => window.__blackMist.seek(time), time)
        await page.waitForTimeout(400)
        await capture(`preview-cinematic-${id}`)
      }
    }
  } else {
    await page.evaluate(() => {
      window.__blackMist.reset()
      window.__blackMist.hold(true)
      window.__blackMist.seek(39)
      window.__environmentReview(null)
      window.__ui.setHudHidden(true)
    })
    await page.waitForTimeout(350)
    await capture('final-cinematic-behemoth')
    await page.evaluate(() => window.__blackMist.skip())
    const behemothPreview = await nextRoar('behemoth')
    const behemothPose = creature(await seekMotion(behemothPreview.peak), 'behemoth')
    await review(page, creatureView(behemothPose, 'full'), 350)
    await capture('final-behemoth-roar')
    console.log('FINAL COMPOSITION FRAMES', `${OUT}/final-cinematic-behemoth.png`, `${OUT}/final-behemoth-roar.png`)
    for (const id of ['watcher', 'behemoth']) {
      const schedule = await nextRoar(id, Math.max(100, (await snapshot()).motion.time + 10))
      report.schedules[id] = schedule
      const first = creature(await seekMotion(schedule.start - 8), id),
        second = creature(await seekMotion(schedule.start - 4), id)
      assertBoundAnatomy(second, id)
      const limbChanges = movingSamples(first, second).filter((sample) =>
        /limb|arm|leg|wrist|tendril|tentacle/i.test(`${sample.id} ${sample.role ?? ''}`),
      )
      check(
        `${id} slowly traverses its world patrol while several real limbs articulate`,
        first.motion.phase === 'walk' &&
          second.motion.phase === 'walk' &&
          distance(first.position, second.position) > 1 &&
          limbChanges.filter((sample) => sample.displacement > 0.002).length >= 2,
      )
      await review(page, creatureView(second, 'full'), 400)
      await capture(`${id}-walking`)
      const lifted = creature(await seekMotion(schedule.peak), id),
        heads = movingSamples(first, lifted).filter((sample) =>
          /head|face|snout/i.test(`${sample.id} ${sample.role ?? ''}`),
        )
      check(
        `${id} stops its patrol and raises real head geometry for the roar`,
        lifted.motion.phase === 'roar' &&
          lifted.motion.headLift > 0.8 &&
          heads.some((sample) => sample.displacement > 0.005),
      )
      const stopped = creature(await seekMotion(schedule.peak + 0.35), id)
      check(
        `${id} planted roar has no whole-body sliding or yaw rotation`,
        distance(lifted.position, stopped.position) < 0.01 && Math.abs(lifted.yaw - stopped.yaw) < 0.00001,
      )
      await capture(`${id}-roaring`)
      const fixed = await snapshot(),
        palette = JSON.stringify(creature(fixed, id).motion.joints)
      for (const quality of ['high', 'mid', 'low']) {
        await page.evaluate(async (quality) => {
          const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
          useWorldStore.getState().setQuality(quality, false)
        }, quality)
        await page.waitForTimeout(250)
        const state = await snapshot(),
          value = creature(state, id),
          counts = await telemetry(page)
        assertBoundAnatomy(value, id)
        check(
          `${id}/${quality} LOD retains the same actual articulated pose`,
          JSON.stringify(value.motion.joints) === palette && state.motion.time === fixed.motion.time,
        )
        check(
          `${id}/${quality} respects the 400 draw-call scene budget`,
          counts.drawCalls > 0 && counts.drawCalls <= 400,
        )
        if (quality === 'low') check(`${id}/low uses the reduced real model`, value.lod === 1)
      }
      await page.evaluate(async () => {
        const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
        useWorldStore.getState().setQuality('high', false)
      })
      const next = await nextRoar(id, schedule.end + 10)
      const starting = creature(await seekMotion(next.start - 4), id)
      await review(page, creatureView(starting, 'full'), 350)
      await page.evaluate(() => window.__blackMist.motionHold(false))
      if (!process.argv.includes('--no-video')) await recordVideo(id)
      else
        await page.waitForFunction(
          ({ id, cycle }) =>
            window.__blackMist.snapshot().audio.roars.some((event) => event.creature === id && event.cycle === cycle),
          { id, cycle: next.cycle },
          { timeout: 15000 },
        )
      let state = await snapshot(),
        events = roar(state, id, next.cycle)
      check(
        `${id} actual roar voice starts with its held head/roar sequence`,
        events.length === 1 &&
          events[0].id === next.eventId &&
          events[0].motionTime >= next.start - 0.1 &&
          events[0].motionTime < next.start + 0.3,
      )
      report.poses[id] = {
        patrolDistance: distance(first.position, second.position),
        limbChanges: limbChanges.map(({ id, index, displacement }) => ({ id, index, displacement })),
        roar: events[0],
        sourceSamples: anatomySamples(lifted),
      }
      const pauseSequence = await nextRoar(id, next.end + 10)
      await seekMotion(pauseSequence.peak)
      if ((await snapshot()).awaitingExplore) {
        await page.evaluate(() => window.__ui.setHudHidden(false))
        await page.locator('.black-mist-explore').click()
        await page.waitForFunction(() => !!document.pointerLockElement)
      }
      check(
        `${id} held roar is audibly active before a real settings pause`,
        roar(await snapshot(), id, pauseSequence.cycle).some((event) => event.voiceActive && !event.stopping),
      )
      await page.evaluate(() => {
        window.__blackMist.motionHold(false)
        document.exitPointerLock()
      })
      await page.locator('.settings-dialog').waitFor()
      const paused = await assertPaused(`${id} settings`),
        old = roar(paused, id, pauseSequence.cycle)[0]
      await page.locator('.settings-resume').click()
      await page.waitForFunction(() => !!document.pointerLockElement)
      await page.waitForTimeout(400)
      state = await snapshot()
      events = roar(state, id, pauseSequence.cycle)
      check(
        `${id} resume continues one cue with a bounded voice graph`,
        events.length === 1 &&
          events[0].id === old.id &&
          events[0].resumes > old.resumes &&
          events[0].voiceActive &&
          !events[0].stopping &&
          state.audio.sources < 80 &&
          state.audio.nodes < 180,
      )
      await page.evaluate(() => window.__ui.setHudHidden(true))
    }
    await page.evaluate(() => window.__blackMist.motionHold(false))
    await page.keyboard.press('Tab')
    await page.getByRole('tabpanel').waitFor()
    await assertPaused('the scroll overlay')
    await page.locator('.scroll-close').click()
    await page.waitForFunction(() => !!document.pointerLockElement)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    try {
      await assertPaused('background visibility')
    } finally {
      await page.evaluate(() => {
        delete document.hidden
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    for (const [time, view] of [
      [
        55,
        [
          [950, 650, -300],
          [760, 540, -720],
        ],
      ],
      [
        110,
        [
          [-1280, 550, -400],
          [-1030, 410, -780],
        ],
      ],
    ]) {
      await page.evaluate((time) => window.__kunSetTime(time), time)
      await review(page, view, 500)
      await capture(`kun-former-intersection-${time}`)
      report.kun.push({ time, camera: view, kun: await page.evaluate(() => window.__kun()) })
    }
    await assertPausedRecovery()
    await page.evaluate(() => {
      window.__environmentReview(null)
      window.__blackMist.reset()
      window.__blackMist.hold(true)
    })
    await page.waitForTimeout(250)
    const replay = await snapshot()
    check(
      'replay resets the patrol and all roar history',
      replay.motion.time === 0 && replay.audio.roars.length === 0 && replay.creatures.every((value) => !value.visible),
    )
    await page.evaluate(async () => {
      const { stopBlackMist } = await window.__liveImport('/src/world/blackMist/runtime.ts')
      stopBlackMist()
    })
    await page.waitForTimeout(250)
    const normal = await snapshot()
    check(
      'leaving the mode disposes the animated creatures and roar voices',
      !normal.active && normal.creatures.length === 0 && normal.audio.roars.length === 0 && normal.audio.voices === 0,
    )
  }
  report.unexpectedErrors = errors.filter((error) => !/Context Lost|CONTEXT_LOST_WEBGL/.test(error))
  check(
    'new movement, deformation and sound render without unexpected browser or shader errors',
    report.unexpectedErrors.length === 0,
  )
} catch (error) {
  report.failure = error.stack ?? String(error)
  report.failureState = await snapshot().catch(() => null)
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(
    `${OUT}/${RECOVERY_ONLY ? 'report-recovery' : PREVIEW_ONLY ? 'report-preview' : 'report'}.json`,
    JSON.stringify(report, null, 2) + '\n',
  )
  await browser.close()
}
