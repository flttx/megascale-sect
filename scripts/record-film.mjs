// Deterministic offline film renderer: the page runs on a virtual clock (fixed 1/60 s steps), every frame is read
// back from the canvas and piped into ffmpeg, so render cost never shows up as stutter. Part one is scenery shots
// on spline cameras; part two hands the camera to the gameplay rig and flies the player by simulated input.
// Usage: node scripts/record-film.mjs [stills|preview|render] [segment ids…]   (dev server at BASE_URL)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './lib/chrome.mjs'
import { installLiveImports } from './lib/world-session.mjs'
import { SEGMENTS, STILLS, shotPose } from './film-shots.mjs'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const OUT = path.resolve(process.env.FILM_OUT || 'artifacts/tmp/film')
const [mode = 'stills', ...only] = process.argv.slice(2)
const FPS = 60, DT = 1000 / FPS
const SIZE = mode === 'render' ? { width: 1920, height: 1080 } : { width: 960, height: 540 }
mkdirSync(OUT, { recursive: true })

/** Runs in the page before any app code: virtual clock, rAF queue, camera override, autopilot. */
function harness() {
  const film = { virtual: false, now: 0, queue: new Map(), id: 0, scenes: [], camera: null, pose: null, blend: 0, rig: null, pilot: null }
  window.__film = film
  const realNow = performance.now.bind(performance)
  const realRaf = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window)
  performance.now = () => (film.virtual ? film.now : realNow())
  window.requestAnimationFrame = (cb) => { if (!film.virtual) return realRaf(cb); film.queue.set(++film.id, cb); return -film.id }
  window.cancelAnimationFrame = (h) => { if (h < 0) film.queue.delete(-h); else realCancel(h) }
  // UI timers (notices, captions, toasts) run on the virtual clock too; short ones (scheduler yields) stay real.
  const realTimeout = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window)
  const realInterval = window.setInterval.bind(window), realClearInterval = window.clearInterval.bind(window)
  film.timers = new Map(); film.timerId = 0
  const virtualTimer = (every) => (cb, delay = 0, ...args) => {
    if (!film.virtual || delay < 50 || typeof cb !== 'function') return (every ? realInterval : realTimeout)(cb, delay, ...args)
    const id = --film.timerId
    film.timers.set(id, { at: film.now + delay, cb, args, every: every ? delay : 0 })
    return id
  }
  window.setTimeout = virtualTimer(false); window.setInterval = virtualTimer(true)
  window.clearTimeout = (id) => (id < 0 ? film.timers.delete(id) : realClear(id))
  window.clearInterval = (id) => (id < 0 ? film.timers.delete(id) : realClearInterval(id))
  // CSS transitions and animations are held paused and advanced by hand, one frame at a time.
  film.anims = new WeakSet()
  film.syncCss = (ms) => {
    for (const a of document.getAnimations()) {
      if (!film.anims.has(a)) { film.anims.add(a); a.pause(); a.currentTime = 0; continue }
      if (!ms) continue
      const end = a.effect?.getComputedTiming().endTime, next = (a.currentTime ?? 0) + ms
      if (Number.isFinite(end) && next >= end) a.finish(); else { a.pause(); a.currentTime = next }
    }
  }
  const devtools = new EventTarget()
  devtools.addEventListener('observe', (e) => { if (e.detail?.isScene) film.scenes.push(e.detail) })
  window.__THREE_DEVTOOLS__ = devtools

  film.engage = () => { film.now = realNow(); film.virtual = true }
  film.object = (name) => film.scenes.map((s) => s.getObjectByName(name)).find(Boolean)
  film.anchor = (rel) => {
    if (!rel) return null
    const object = film.object(rel === 'kun' ? 'Colossus_kun' : rel === 'turtle' ? 'Colossus_turtle' : 'playerRoot')
    return object ? object.position : null
  }
  film.install = () => {
    const camera = film.camera = film.object('camera')
    if (!camera?.isPerspectiveCamera) return false
    const V = camera.position.constructor, Q = camera.quaternion.constructor
    const rig = film.rig = { position: new V(), quaternion: new Q(), fov: camera.fov, valid: false }
    const eye = new V(), look = new V(), q = new Q(), probe = camera.clone(false)
    const original = camera.updateProjectionMatrix
    let inside = false
    // The follow rig ends every frame with updateProjectionMatrix, before the sky, clouds and LODs read the camera.
    camera.updateProjectionMatrix = function () {
      if (!inside && film.pose) {
        inside = true
        rig.position.copy(this.position); rig.quaternion.copy(this.quaternion); rig.fov = this.fov; rig.valid = true
        const pose = film.pose, anchor = film.anchor(pose.rel), lookAnchor = film.anchor(pose.lookRel)
        eye.fromArray(pose.eye); look.fromArray(pose.look)
        if (anchor) { eye.add(anchor); look.add(anchor) }
        if (lookAnchor) look.add(lookAnchor)
        probe.position.copy(eye); probe.up.set(0, 1, 0); probe.lookAt(look); probe.rotateZ(pose.roll || 0)
        q.copy(probe.quaternion)
        const b = film.blend
        this.position.lerpVectors(rig.position, eye, b)
        this.quaternion.slerpQuaternions(rig.quaternion, q, b)
        this.fov = rig.fov + (pose.fov - rig.fov) * b
        inside = false
      }
      return original.call(this)
    }
    return true
  }
  film.step = (ms) => {
    // The rig eases its fov from the camera's: hand it back its own before the frame runs.
    if (film.pose && film.rig?.valid) film.camera.fov = film.rig.fov
    film.now += ms
    const callbacks = [...film.queue.values()]
    film.queue.clear()
    for (const cb of callbacks) { try { cb(film.now) } catch (error) { console.error(error) } }
    for (const [id, timer] of [...film.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > film.now || !film.timers.has(id)) continue
      if (timer.every) timer.at += timer.every; else film.timers.delete(id)
      try { timer.cb(...timer.args) } catch (error) { console.error(error) }
    }
    film.syncCss(ms)
  }
  film.key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }))

  // Autopilot: a critically damped spring on yaw and pitch toward a pursuit point, so the view turns like a steady
  // hand on the mouse (no step in turn rate however the target moves).
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  film.fly = (runtime, target, config, dt) => {
    const s = film.pilot || (film.pilot = { yawRate: 0, pitchRate: 0 })
    const p = runtime.position
    const dx = target[0] - p.x, dy = target[1] - p.y, dz = target[2] - p.z
    const wantYaw = runtime.yaw + wrap(Math.atan2(dx, -dz) - runtime.yaw)
    const wantPitch = config.pitch ?? Math.max(config.minPitch ?? -0.5, Math.min(config.maxPitch ?? 0.5, Math.atan2(dy, Math.hypot(dx, dz))))
    const w = config.omega ?? 1.2, wp = config.pitchOmega ?? 1
    s.yawRate += (w * w * (wantYaw - runtime.yaw) - 2 * w * s.yawRate) * dt
    s.yawRate = Math.max(-(config.maxRate ?? 0.45), Math.min(config.maxRate ?? 0.45, s.yawRate))
    s.pitchRate += (wp * wp * (wantPitch - runtime.pitch) - 2 * wp * s.pitchRate) * dt
    runtime.yaw += s.yawRate * dt
    runtime.pitch += s.pitchRate * dt
  }
}

async function openFilm() {
  const browser = await launchBrowser({ headless: true, args: ['--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio'] })
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error' && !/warning X\d+/.test(m.text())) errors.push(m.text().slice(0, 300)) })
  await page.addInitScript(harness)
  await page.goto(new URL('?quality=high&hours=17&weather=clear', BASE_URL).href, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('yunque.language', 'en') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('WORLD READY') && window.__playerSnapshot?.().characterReady?.male, null, { timeout: 240000 })
  await page.locator('.enter-button').click()
  await page.waitForTimeout(3000)
  await installLiveImports(page)
  const ok = await page.evaluate(async () => {
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    window.__ui.setHudHidden(true)
    window.__ui.setDevInput(true)
    useWorldStore.setState({ locked: true })
    window.__setWeather('clear', true)
    return window.__film.install()
  })
  if (!ok) throw new Error('film camera not found')
  // Both characters are loaded up front, so a switch mid-take never waits on a download.
  await page.evaluate(async () => {
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    useWorldStore.getState().selectCharacter('female')
  })
  await page.waitForFunction(() => window.__playerSnapshot().characterReady.female, null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.evaluate(async () => {
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    useWorldStore.getState().selectCharacter('male')
  })
  await page.waitForTimeout(1500)
  // The walkthrough's captions replace the key-hint bar.
  await page.addStyleTag({ content: '.controls, .brand-mark { display: none !important; }' })
  await page.evaluate(() => window.__film.engage())
  await page.waitForTimeout(300)
  const cdp = await page.context().newCDPSession(page)
  return { browser, page, cdp, errors }
}

/** Puts the world in a segment's starting state (time of day, colossi, player) and warms up streaming at its first pose. */
async function setup(page, full) {
  const segment = { hours: full.hours, kunAt: full.kunAt, turtleAt: full.turtleAt, showPlayer: !!full.showPlayer, hud: !!full.hud, character: full.character ?? null, weather: full.weather ?? 'clear', player: full.player ?? { position: [0, 0, 150], yaw: 0 } }
  const first = full.shots?.[0]
  const pose = first ? shotPose(first, 0) : null
  await page.evaluate(async ({ s, pose }) => {
    const film = window.__film
    const { teleportPlayer, getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
    window.__setTimeOfDay(s.hours ?? 17)
    window.__setWeather(s.weather, true)
    if (useWorldStore.getState().cameraMode === 'photo') window.__ui.exitPhoto(true)
    window.__ui.dismiss()
    window.__ui.setHudHidden(!s.hud)
    useWorldStore.getState().setNotice(null)
    if (s.character) useWorldStore.getState().selectCharacter(s.character)
    const runtime = getPlayerRuntime()
    window.__filmRuntime = runtime
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyC', 'KeyF']) film.key('keyup', code)
    if (runtime.phase !== 'GROUND' && runtime.phase !== 'FLIGHT') { runtime.phase = 'FLIGHT'; runtime.elapsed = 0 }
    teleportPlayer(s.player.position, s.player.yaw)
    runtime.pitch = s.player.pitch ?? 0.1
    film.pilot = null
    // Scenery shots are empty of the player.
    film.object('playerRoot').visible = s.showPlayer
    film.pose = pose; film.blend = pose ? 1 : 0
  }, { s: segment, pose })
  // Streaming and shader warm-up at the opening pose; real time passes between batches so loads can land. The
  // colossi wait well before their mark, so the kun cannot breach (and restart its breach) during the warm-up.
  for (let i = 0; i < 16; i++) {
    await page.evaluate(({ s }) => {
      if (s.kunAt !== undefined) window.__kunSetTime(s.kunAt - 12)
      if (s.turtleAt !== undefined) window.__turtleSetTime(s.turtleAt)
      for (let k = 0; k < 6; k++) window.__film.step(1000 / 60)
    }, { s: segment })
    await page.waitForTimeout(i < 4 ? 600 : 150)
  }
  // Two seconds of pre-roll up to the mark: the kun's bank and heading and the follow rig settle before frame one.
  await page.evaluate(async ({ s }) => {
    const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const { cloudSwell } = await window.__liveImport('/src/world/sky/cloudSwell.ts')
    teleportPlayer(s.player.position, s.player.yaw)
    window.__filmRuntime.pitch = s.player.pitch ?? 0.1
    if (s.kunAt !== undefined) window.__kunSetTime(s.kunAt - 2)
    if (s.turtleAt !== undefined) window.__turtleSetTime(s.turtleAt - 2)
    cloudSwell.set(0, 0, -1, 0)
    for (let k = 0; k < 120; k++) window.__film.step(1000 / 60)
    // A player placed on the kun (offset: left, up over its deck, forward) is placed after the pre-roll, when it has arrived.
    if (s.player.kun) {
      const { kunDeckHit } = await window.__liveImport('/src/world/colossi/kunDeck.ts')
      const kun = window.__film.object('Colossus_kun'), q = kun.quaternion, [ox, oy, oz] = s.player.kun
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), h = Math.hypot(fx, fz)
      const x = kun.position.x + (fz / h) * ox + (fx / h) * oz, z = kun.position.z - (fx / h) * ox + (fz / h) * oz
      const deck = kunDeckHit(x, z)?.y ?? kun.position.y + 20
      teleportPlayer([x, deck + oy, z], Math.atan2(fx, -fz))
      window.__filmRuntime.pitch = s.player.pitch ?? 0
      window.__film.step(1000 / 60)
    }
  }, { s: segment })
}

/** One frame: key edges, the camera pose (cinematic weight `blend`), the autopilot, one 1/60 s step, the read-back. */
function frameScript({ pose, blend, keys, pilot, capture, dt, dom }) {
  const film = window.__film, runtime = window.__filmRuntime
  for (const [type, code] of keys) film.key(type, code)
  film.pose = pose; film.blend = blend
  if (pilot) film.fly(runtime, pilot.target, pilot, dt / 1000)
  film.step(dt)
  const kun = film.object('Colossus_kun'), q = kun.quaternion
  // The kun's local +Z is its forward.
  const kunForward = [2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)]
  const ui = window.__ui.state()
  const state = { phase: runtime.phase, p: runtime.position.toArray(), v: runtime.velocity.length(), yaw: runtime.yaw, pitch: runtime.pitch, kun: kun.position.toArray(), kunForward,
    aboard: runtime.aboard?.surfaceId ?? null, wind: runtime.wind, orbs: ui.orbs, overlay: ui.overlay?.kind ?? null, nearby: ui.nearby?.id ?? null, cameraMode: ui.cameraMode }
  if (!capture || dom) return { state }
  return { state, data: document.querySelector('canvas').toDataURL('image/jpeg', capture) }
}

function encoder(file) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', mode === 'render' ? 'slow' : 'veryfast', '-crf', mode === 'render' ? '12' : '22', '-pix_fmt', 'yuv420p', file]
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))))
  const write = (buffer) => new Promise((resolve) => { if (child.stdin.write(buffer)) resolve(); else child.stdin.once('drain', resolve) })
  return { write, end: async () => { child.stdin.end(); await done } }
}

async function renderSegment(page, cdp, segment) {
  await setup(page, segment)
  // Preview keeps every frame's simulation but encodes one in `every`, played back at the same speed.
  const every = mode === 'preview' ? Number(process.env.PREVIEW_EVERY || 4) : 1
  const quality = mode === 'render' ? 0.95 : 0.8
  const out = encoder(path.join(OUT, `${segment.id}${mode === 'render' ? '' : '.preview'}.mp4`))
  const track = []
  const total = Math.round(segment.seconds * FPS)
  const shot = segment.shots?.[0]
  let state = null
  const started = Date.now()
  for (let i = 0; i < total; i++) {
    const t = i / FPS
    const f = segment.frame ? segment.frame(t, state) : {}
    if (f.act) await f.act(page, state)
    const pose = shot ? shotPose(shot, Math.min(1, t / (shot.seconds ?? segment.seconds))) : null
    const blend = pose ? (segment.blend ? segment.blend(t) : 1) : 0
    const capture = i % every === 0 ? quality : 0
    const result = await page.evaluate(frameScript, { pose: blend > 0 ? pose : null, blend, keys: f.keys ?? [], pilot: f.pilot ?? null, capture, dt: DT, dom: !!segment.hud })
    state = result.state
    // With the HUD on, the page itself is captured (canvas and DOM), once React has committed and new CSS
    // transitions are held at their start.
    if (capture && segment.hud) {
      await page.evaluate(() => new Promise((resolve) => requestIdleCallback(() => { window.__film.syncCss(0); resolve() }, { timeout: 50 })))
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: Math.round(capture * 100) })
      result.data = ',' + shot.data
    }
    if (result.data) {
      const buffer = Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64')
      await out.write(buffer)
      if (mode === 'preview' && i % 120 === 0) writeFileSync(path.join(OUT, `${segment.id}_${String(i / 60).padStart(3, '0')}s.jpg`), buffer)
    }
    if (i % 15 === 0) track.push({ t: +t.toFixed(2), phase: state.phase, p: state.p.map((v) => +v.toFixed(1)), v: +state.v.toFixed(1), yaw: +state.yaw.toFixed(3), pitch: +state.pitch.toFixed(3), kun: state.kun.map(Math.round), target: f.pilot?.target?.map(Math.round), aboard: state.aboard, wind: +state.wind.toFixed(2), orbs: state.orbs, overlay: state.overlay, nearby: state.nearby, mode: state.cameraMode })
  }
  await out.end()
  writeFileSync(path.join(OUT, `${segment.id}.track.json`), JSON.stringify(track))
  console.log(`${segment.id}: ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`)
}

async function renderStills(page) {
  for (const still of STILLS.filter((s) => !only.length || only.includes(s.id))) {
    const pose = { eye: still.eye, look: still.look, fov: still.fov ?? 50, roll: 0, rel: still.rel ?? null, lookRel: still.lookRel ?? null }
    await setup(page, { ...still, shots: [{ eye: [still.eye], look: [still.look], fov: pose.fov, rel: pose.rel, lookRel: pose.lookRel }] })
    const { data } = await page.evaluate(frameScript, { pose, blend: 1, keys: [], pilot: null, capture: 0.9, dt: DT })
    writeFileSync(path.join(OUT, `still_${still.id}.jpg`), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
    console.log('still', still.id)
  }
}

const { browser, page, cdp, errors } = await openFilm()
try {
  if (mode === 'stills') await renderStills(page)
  else for (const segment of SEGMENTS.filter((s) => !only.length || only.includes(s.id))) await renderSegment(page, cdp, segment)
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 10))
  await browser.close()
}
