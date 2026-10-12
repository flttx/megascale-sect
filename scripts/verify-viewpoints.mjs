import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

const out = 'artifacts/viewpoints'
await fs.mkdir(out, { recursive: true })
const { browser, page, errors } = await openWorld(
  '?quality=high&hours=22&weather=clear',
  { width: 1600, height: 900 },
  { language: 'zh' },
)
const report = { paths: [], playback: [], errors, failure: null }
try {
  await page.evaluate(async () => {
    const [cinema, registry, collision, layout, carriers, rig, store, ui, three, fiber] = await Promise.all(
      [
        '/src/world/interact/cinematics.ts',
        '/src/world/interact/registry.ts',
        '/src/world/surfaces.ts',
        '/src/world/worldLayout.ts',
        '/src/world/colossi/carriers.ts',
        '/src/world/player/CameraRig.tsx',
        '/src/world/store.ts',
        '/src/ui/uiStore.ts',
        '/node_modules/.vite/deps/three.js',
        '/node_modules/.vite/deps/@react-three_fiber.js',
      ].map((path) => window.__liveImport(path)),
    )
    const pass = window.__postfx().composer.passes.find((p) => p.scene?.getObjectByName('PropField'))
    // Check the rendered eye independently of the director's sweep, including the near-plane footprint.
    const blocked = (p) => {
      const floor = layout.groundHeight(p.x, p.z, p.y)
      return (
        (floor !== null && p.y < floor + 0.25) ||
        layout.insideStructure(p.x, p.y, p.z) ||
        collision.insideAnyCollider(p.x, p.y, p.z, 0.25) ||
        carriers.carrierDepth(p.x, p.y, p.z) > 0
      )
    }
    const props = []
    pass.scene.getObjectByName('PropField').traverse((o) => {
      if (o.isMesh && o.name.startsWith('Prop_') && o.name !== 'Prop_lantern_glow') props.push(o)
    })
    const ray = new three.Raycaster(),
      screen = new three.Vector2()
    ray.far = 8
    const nearOcclusion = (camera) => {
      const hits = []
      for (const x of [-0.7, 0, 0.7])
        for (const y of [-0.6, 0, 0.6]) {
          ray.setFromCamera(screen.set(x, y), camera)
          const hit = ray.intersectObjects(
            props.filter((o) => o.visible),
            false,
          )[0]
          if (hit) hits.push({ screen: [x, y], name: hit.object.name, distance: hit.distance })
        }
      return hits
    }
    window.__viewTest = {
      cinema,
      registry,
      collision,
      layout,
      rig,
      store,
      ui,
      three,
      fiber,
      camera: pass.camera,
      blocked,
      nearOcclusion,
    }
    window.__ui.setDevInput(true)
  })
  const sites = await page.evaluate(() => window.__interact.sites().filter((s) => s.kind === 'viewpoint'))
  assert.equal(sites.length, 10)

  // All quality densities, full paths at 20/60/144 Hz, and four approach-side/orbit variants.
  for (const quality of ['high', 'low', 'mid']) {
    await page.evaluate((q) => window.__viewTest.store.useWorldStore.getState().setQuality(q), quality)
    await page.waitForTimeout(1200)
    for (const site of sites) {
      await page.evaluate((id) => window.__interact.standAt(id), site.id)
      await page.waitForTimeout(400)
      const result = await page.evaluate(
        ({ id, quality }) => {
          const { cinema, registry, layout, rig, store, ui, three, camera, blocked } = window.__viewTest
          const site = registry.SITE_BY_ID.get(id),
            failures = [],
            variants = []
          let samples = 0,
            maxStep = 0
          for (const fps of [20, 60, 144]) {
            for (let approach = 0; approach < 5; approach++) {
              const eye = camera.clone()
              if (approach > 0) {
                const yaw = ((approach - 1) * Math.PI) / 2
                const p = new three.Vector3(...site.position)
                p.x += Math.cos(yaw) * 2.5
                p.z += Math.sin(yaw) * 2.5
                p.y = layout.groundHeight(p.x, p.z, p.y + 1) ?? p.y
                rig.resetCameraRig()
                rig.updateCameraRig(eye, p, yaw, 0.1, 'GROUND', 1 / fps)
              }
              cinema.startShot('viewpoint', site, 9.5)
              cinema.updateDirector(eye, 0)
              const endpoint = cinema.director.shot.curve.getPoint(1)
              const last = eye.position.clone()
              for (let frame = 0; frame < Math.ceil(9.5 * fps); frame++) {
                cinema.updateDirector(eye, 1 / fps)
                samples++
                if (blocked(eye.position) && failures.length < 8)
                  failures.push({ fps, approach, frame, eye: eye.position.toArray() })
                maxStep = Math.max(maxStep, eye.position.distanceTo(last))
                last.copy(eye.position)
              }
              variants.push({ fps, approach, endError: eye.position.distanceTo(endpoint) })
              // Complete the actual exit path too, including FOV restoration.
              for (let frame = 0; frame < fps; frame++) cinema.updateDirector(eye, 1 / fps)
              if (
                cinema.director.shot ||
                store.useWorldStore.getState().cameraMode !== 'player' ||
                eye.fov !== store.useWorldStore.getState().fov
              )
                failures.push({ fps, approach, exit: 'camera not returned' })
            }
          }
          ui.useUiStore.getState().setVeil(false)
          return { id, quality, samples, maxStep, failures, variants }
        },
        { id: site.id, quality },
      )
      report.paths.push(result)
      console.log(
        'PATH',
        quality,
        site.id,
        result.samples,
        'blocked',
        result.failures.length,
        'end error',
        Math.max(...result.variants.map((v) => v.endError)).toFixed(3),
      )
      assert.deepEqual(result.failures, [], `${quality}/${site.id} collision or exit failure`)
      assert(
        result.variants.every((v) => v.endError < 0.3),
        `${site.id}: path stalled before the authored overlook`,
      )
    }
  }

  // A thin obstacle introduced after start must stop the sweep at every supported frame rate.
  report.guards = await page.evaluate(() => {
    const { cinema, registry, collision, camera, blocked, ui } = window.__viewTest
    const site = registry.SITE_BY_ID.get('view_spawn'),
      results = []
    for (const fps of [20, 60, 144]) {
      const eye = camera.clone()
      eye.position.set(-5.5, 2.7, 164.7)
      eye.lookAt(0, 10, 60)
      cinema.startShot('viewpoint', site, 9.5)
      cinema.updateDirector(eye, 0)
      const off = collision.registerColliders([{ kind: 'box', min: [-80, -5, 135], max: [80, 100, 135.04] }])
      let overlaps = 0,
        crossed = false
      try {
        for (let i = 0; i < Math.floor(9.4 * fps); i++) {
          cinema.updateDirector(eye, 1 / fps)
          overlaps += Number(blocked(eye.position))
          crossed ||= eye.position.z < 135.3
        }
        results.push({ fps, overlaps, crossed, end: eye.position.toArray() })
      } finally {
        off()
        cinema.director.shot = null
      }
    }
    // A moving prop enters the *previous* eye between frames, not just the desired next position.
    const eye = camera.clone()
    eye.position.set(-5.5, 2.7, 164.7)
    cinema.startShot('viewpoint', site, 9.5)
    for (let i = 0; i < 240; i++) cinema.updateDirector(eye, 1 / 60)
    const at = eye.position.clone()
    const off = collision.registerMovingCollider(
      (x, bottom, top, z, radius, vertical) =>
        Math.abs(x - at.x) < 0.2 + radius &&
        Math.abs(z - at.z) < 0.2 + radius &&
        top + vertical > at.y - 0.2 &&
        bottom - vertical < at.y + 0.2,
    )
    try {
      cinema.updateDirector(eye, 1 / 60)
      results.push({
        movingEye: true,
        overlaps: Number(blocked(eye.position)),
        displacement: eye.position.distanceTo(at),
      })
    } finally {
      off()
      cinema.director.shot = null
      ui.useUiStore.getState().setVeil(false)
    }
    return results
  })
  assert(
    report.guards.every((r) => r.overlaps === 0 && !r.crossed),
    'sweep/recovery guard failed',
  )

  await page.evaluate(() => {
    const t = window.__viewTest
    t.store.useWorldStore.getState().setQuality('high')
    t.store.useWorldStore.getState().setCameraMode('player')
    t.rig.resetCameraRig()
  })
  await page.waitForTimeout(1200)
  // Real rendered playback, caption, final composition and natural hand-back at every site.
  for (const site of sites) {
    await page.evaluate((id) => window.__interact.standAt(id), site.id)
    await page.waitForTimeout(750)
    await page.evaluate(() => {
      const t = window.__viewTest
      t.frames = { samples: 0, collisions: [], occlusions: [], maxDraws: 0, lastTime: 0, lastOcclusion: 3 }
      t.stop = t.fiber.addAfterEffect(() => {
        const shot = t.cinema.director.shot
        if (!shot || shot.kind !== 'viewpoint') return
        t.frames.samples++
        t.frames.lastTime = shot.t
        t.frames.maxDraws = Math.max(t.frames.maxDraws, window.__playerSnapshot().telemetry.drawCalls)
        if (t.blocked(t.camera.position) && t.frames.collisions.length < 8)
          t.frames.collisions.push({ t: shot.t, position: t.camera.position.toArray() })
        if (shot.t - t.frames.lastOcclusion >= 1) {
          t.frames.lastOcclusion = shot.t
          const hits = t.nearOcclusion(t.camera)
          if (hits.length) t.frames.occlusions.push({ t: shot.t, hits })
        }
      })
    })
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.__interact.state().shot === 'viewpoint')
    assert(await page.locator('.cinema-caption').isVisible(), `${site.id}: caption missing`)
    await page.waitForFunction(() => window.__viewTest.cinema.director.shot?.t >= 9, null, { timeout: 45000 })
    // Freeze only for capture; screenshot latency must not consume the exit or change the measured pose.
    await page.evaluate(() => {
      const t = window.__viewTest
      t.paused = t.cinema.director.shot
      t.cinema.director.shot = null
    })
    await page.screenshot({ path: `${out}/${site.id}-late.png` })
    await page.evaluate(() => {
      const t = window.__viewTest
      t.cinema.director.shot = t.paused
    })
    await page.waitForFunction(
      () => window.__interact.state().shot === null && window.__interact.state().cameraMode === 'player',
    )
    const result = await page.evaluate(() => {
      const t = window.__viewTest
      t.stop()
      return t.frames
    })
    report.playback.push({ id: site.id, ...result })
    console.log('PLAY', site.id, JSON.stringify(result))
    assert(result.samples > 100 && result.lastTime >= 9.5, `${site.id}: incomplete playback`)
    assert.deepEqual(result.collisions, [], `${site.id}: rendered camera collision`)
    assert.deepEqual(result.occlusions, [], `${site.id}: nearby prop/canopy obscures the overlook`)
    assert(result.maxDraws <= 400, `${site.id}: draw-call budget exceeded`)
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.cinema-caption').count(), 0, `${site.id}: stale caption`)
  }
  for (const skip of ['e', 'Escape', 'click']) {
    await page.evaluate(() => window.__interact.standAt('view_spawn'))
    await page.waitForTimeout(600)
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.__interact.state().shot === 'viewpoint')
    if (skip === 'click') await page.mouse.click(800, 450)
    else await page.keyboard.press(skip)
    await page.waitForFunction(
      () => window.__interact.state().shot === null && window.__interact.state().cameraMode === 'player',
    )
    console.log('SKIP', skip, 'PASS')
  }
  assert.deepEqual(errors, [], 'browser errors')
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
  console.error(error)
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
