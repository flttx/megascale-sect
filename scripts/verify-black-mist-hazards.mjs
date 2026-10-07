import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld, review, telemetry } from './lib/world-session.mjs'
import { anatomySamples } from './lib/eldritch-views.mjs'

// Real-player proximity, posed collision volumes, recovery and collection isolation.
// Run alone against BASE_URL; no direct force-hit hook is used. --no-video omits the attack WebM.
const OUT = 'artifacts/black-mist-hazards'
const MAX_DRAW_CALLS = 400
const report = {
  checks: [],
  attacks: [],
  contacts: [],
  recoveries: [],
  collection: [],
  tiers: [],
  frames: [],
  videos: [],
  errors: [],
  failure: null,
}
const recordings = []
const finitePoint = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
const midpoint = (volume) => volume.a.map((v, i) => (v + volume.b[i]) * 0.5)
const attack = (actor) => actor.attack ?? actor
const transform = (point, matrix) =>
  point.map(
    (_, axis) =>
      matrix[axis] * point[0] + matrix[4 + axis] * point[1] + matrix[8 + axis] * point[2] + matrix[12 + axis],
  )
const pointToSegment = (p, a, b) => {
  const ab = a.map((v, i) => b[i] - v),
    length = ab.reduce((s, v) => s + v * v, 0)
  const t = length ? Math.max(0, Math.min(1, p.reduce((s, v, i) => s + (v - a[i]) * ab[i], 0) / length)) : 0
  return distance(
    p,
    a.map((v, i) => v + ab[i] * t),
  )
}
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear&kunAt=40&turtleAt=0', {
  width: 1440,
  height: 900,
})
report.errors = errors
const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())
const player = () =>
  page.evaluate(async () => {
    const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
    return { ...window.__playerSnapshot(), relocation: getPlayerRuntime()?.relocation }
  })
const hazards = (state) => {
  assert.ok(
    state.hazards &&
      Array.isArray(state.hazards.actors) &&
      Array.isArray(state.hazards.contacts) &&
      Array.isArray(state.hazards.hits),
    'DEV snapshot.hazards must expose live actors, contacts and actual hit history',
  )
  return state.hazards
}
const actorById = (state, id) => {
  const actor = hazards(state).actors.find((entry) => entry.id === id)
  assert.ok(actor, `Actual hazard actor ${id} must exist`)
  return actor
}
function renderedActor(state, actor) {
  if (actor.kind === 'creature')
    return state.creatures.find((entry) => (entry.attack?.id ?? entry.hazardId ?? entry.id) === actor.id)
  if (actor.kind === 'tentacle')
    return state.motion.landmarks.tentacles.find((entry) => (entry.attack?.id ?? entry.hazardId) === actor.id)
  return state.tissue.sites.find((entry) => entry.id === actor.id)
}
function sourceProbes(state, actor) {
  const rendered = renderedActor(state, actor)
  assert.ok(rendered, `${actor.id} must map to actual rendered anatomy`)
  if (actor.kind === 'creature')
    return anatomySamples(rendered).map((probe) => ({
      ...probe,
      world: probe.world ?? transform(probe.posed, rendered.matrix),
    }))
  return (rendered.sourceProbes ?? []).map((probe) => ({ ...probe, world: probe.world ?? probe.position }))
}
const pose = (state, actor) =>
  sourceProbes(state, actor).map(({ index, mesh, role, posed, world }) => ({ index, mesh, role, posed, world }))
const volumes = (state, actor) =>
  hazards(state).contacts.filter(
    (contact) =>
      contact.kind === actor.kind &&
      (contact.id.startsWith(`${actor.id}:`) || contact.id.startsWith(`${actor.id}/`) || contact.id === actor.id),
  )

async function progress() {
  return page.evaluate(async () => {
    const { useUiStore } = await window.__liveImport('/src/ui/uiStore.ts')
    const ui = useUiStore.getState()
    return {
      orbs: [...ui.orbs].sort(),
      steles: [...ui.steles].sort(),
      viewpoints: [...ui.viewpoints].sort(),
      arrays: [...ui.arrays].sort(),
      trials: ui.trials,
      compendium: [...ui.compendium].sort(),
    }
  })
}

async function moveTo(position, yaw = 0) {
  assert.ok(finitePoint(position), 'A finite actual-world player fixture is required')
  const moved = await page.evaluate(
    async ({ position, yaw }) => {
      const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
      return teleportPlayer(position, yaw)
    },
    { position, yaw },
  )
  assert.ok(moved, 'The real player must accept the verification teleport')
  await page.waitForTimeout(60)
  return player()
}

async function capture(name) {
  const filename = `${OUT}/${name}.png`
  await page.screenshot({ path: filename })
  const state = await snapshot(),
    p = await player(),
    perf = await telemetry(page)
  report.frames.push({ filename, name, time: state.motion.time, position: p.position, draws: perf.drawCalls })
  check(
    `${name}: rendered scene stays within the established draw budget`,
    perf.drawCalls > 0 && perf.drawCalls <= MAX_DRAW_CALLS,
  )
}

async function waitForActor(id, phases, timeout = 10000) {
  await page.waitForFunction(
    ({ id, phases }) => {
      const actor = window.__blackMist.snapshot().hazards.actors.find((candidate) => candidate.id === id)
      return actor && phases.includes((actor.attack ?? actor).phase)
    },
    { id, phases },
    { timeout, polling: 40 },
  )
  return actorById(await snapshot(), id)
}

async function holdStrike(id, minimum = 0) {
  const handle = await page.waitForFunction(
    ({ id, minimum }) => {
      const state = window.__blackMist.snapshot(),
        actor = state.hazards.actors.find((entry) => entry.id === id)
      if (actor?.phase !== 'strike' || actor.progress < minimum) return false
      // Freeze in the same browser task that observes the real strike; no asynchronous round-trip can lose its short window.
      window.__blackMist.motionHold(true)
      return state
    },
    { id, minimum },
    { timeout: 10000, polling: 20 },
  )
  try {
    return await handle.jsonValue()
  } finally {
    await handle.dispose()
  }
}

async function settleProtection() {
  await page.waitForFunction(
    () => {
      const state = window.__blackMist.snapshot().hazards
      return state.time >= (state.invulnerableUntil ?? 0)
    },
    null,
    { timeout: 12000 },
  )
}

async function assertCollectedSet(label, expected) {
  const actual = await progress()
  check(
    `${label}: exact collected spirit-light IDs remain unchanged`,
    JSON.stringify(actual.orbs) === JSON.stringify(expected),
  )
  report.collection.push({ label, orbs: actual.orbs })
}

async function assertBlackMistCollectionBlocked(label, expected) {
  const candidates = await page.evaluate(() => {
    const groups = ['road', 'platform', 'sky', 'kun', 'turtle']
    return groups
      .map((group) => window.__interact.orbs().find((orb) => orb.group === group && !orb.collected && orb.position))
      .filter(Boolean)
  })
  check(`${label}: test covers ground, flight and both moving-carrier spirit lights`, candidates.length === 5)
  for (const orb of candidates) {
    const moved = await page.evaluate((id) => window.__interact.visitOrb(id), orb.id)
    check(`${label}/${orb.group}: the real player visits the uncollected light`, moved)
    await page.waitForTimeout(300)
    await assertCollectedSet(`${label}/${orb.group}`, expected)
  }
}

async function assertRecovery(label, previousHits, previousPlayer, timeout = 10000) {
  await page.waitForFunction((count) => window.__blackMist.snapshot().hazards.hits.length > count, previousHits, {
    timeout,
    polling: 30,
  })
  await page.waitForTimeout(180)
  const state = await snapshot(),
    live = hazards(state),
    recovered = await player()
  const hit = live.hits[previousHits]
  const sites = await page.evaluate(() => window.__interact.sites().filter((site) => site.kind === 'teleport'))
  assert.ok(finitePoint(hit.position), 'Actual hit history must retain the pre-recovery world position')
  const nearest = sites
    .slice()
    .sort((a, b) => distance(a.position, hit.position) - distance(b.position, hit.position))[0]
  const footing = await page.evaluate(async () => {
    const [{ getPlayerRuntime }, { groundHit }, { bodyClear }] = await Promise.all([
      window.__liveImport('/src/world/player/playerHandle.ts'),
      window.__liveImport('/src/world/worldLayout.ts'),
      window.__liveImport('/src/world/player/playerMotion.ts'),
    ])
    const runtime = getPlayerRuntime(),
      p = runtime.position,
      ground = groundHit(p.x, p.z, p.y + 0.5)
    return {
      relocation: runtime.relocation,
      phase: runtime.phase,
      velocity: runtime.velocity.toArray(),
      aboard: runtime.aboard?.surfaceId ?? null,
      inAir: runtime.inAir,
      takeoffTime: runtime.takeoffTime,
      jumpBuffer: runtime.jumpBuffer,
      rideMix: runtime.rideMix,
      bank: runtime.bank,
      climb: runtime.climb,
      surface: ground?.surfaceId,
      groundY: ground?.y,
      clear: bodyClear(p.x, p.y, p.z),
    }
  })
  check(`${label}: the collision causes a single real recovery`, live.hits.length === previousHits + 1)
  check(
    `${label}: recovery selects the nearest world waygate independently`,
    hit.respawnId === nearest.id && distance(recovered.position, nearest.position) < 2,
  )
  check(
    `${label}: arrival has safe static footing and a clear player body`,
    footing.surface &&
      footing.surface !== 'kun' &&
      footing.surface !== 'turtle' &&
      Math.abs(recovered.position[1] - footing.groundY) < 0.08 &&
      footing.clear,
  )
  check(
    `${label}: recovery clears flight, carrier and jump state`,
    footing.phase === 'GROUND' &&
      footing.aboard === null &&
      !footing.inAir &&
      footing.takeoffTime === 0 &&
      footing.jumpBuffer === 0 &&
      distance(footing.velocity, [0, 0, 0]) < 0.01 &&
      Math.abs(footing.bank) < 0.01 &&
      Math.abs(footing.climb) < 0.01,
  )
  check(
    `${label}: a real relocation is recorded`,
    Number.isInteger(footing.relocation) && footing.relocation > previousPlayer.relocation,
  )
  check(`${label}: arrival protection prevents a contact respawn loop`, live.invulnerableUntil > live.time)
  await page.waitForTimeout(450)
  check(
    `${label}: one hit remains one hit at the safe arrival`,
    hazards(await snapshot()).hits.length === previousHits + 1,
  )
  const audio = (await snapshot()).audio.hazards
  check(
    `${label}: the actual hit emits one synchronized recovery sound`,
    audio.filter((cue) => cue.id === `hit:${hit.id}` && cue.phase === 'hit').length === 1 &&
      audio.some((cue) => cue.id === `hit:${hit.id}` && Math.abs(cue.time - hit.time) < 0.1),
  )
  const stepStart = (await player()).position
  await page.keyboard.down('w')
  try {
    await page.waitForTimeout(250)
  } finally {
    await page.keyboard.up('w')
  }
  check(`${label}: ordinary movement works after recovery`, distance(stepStart, (await player()).position) > 0.25)
  report.recoveries.push({
    label,
    hit,
    nearest: { id: nearest.id, position: nearest.position },
    player: recovered,
    footing,
  })
  return { state, player: recovered, hit }
}

function assertActualVolumes(state, actor, label) {
  const liveVolumes = volumes(state, actor),
    probes = sourceProbes(state, actor),
    rendered = renderedActor(state, actor)
  check(
    `${label}: contact capsules are finite volumes from real drawn limb probes`,
    liveVolumes.length > 0 &&
      liveVolumes.every(
        (volume) =>
          finitePoint(volume.a) && finitePoint(volume.b) && Number.isFinite(volume.radius) && volume.radius > 0,
      ) &&
      probes.length >= 2 &&
      probes.every(
        (probe) =>
          Number.isInteger(probe.index) &&
          finitePoint(probe.rest) &&
          finitePoint(probe.posed) &&
          finitePoint(probe.world),
      ),
  )
  const authored = rendered.attack.contacts
  check(
    `${label}: renderer and collision registry use the same posed volumes`,
    liveVolumes.every((volume) => {
      const source = authored.find((entry) => entry.id === volume.id)
      return (
        source &&
        distance(source.a, volume.a) < 0.05 &&
        distance(source.b, volume.b) < 0.05 &&
        Math.abs(source.radius - volume.radius) < 0.05
      )
    }),
  )
  if (actor.kind === 'tentacle') {
    const sections = rendered.attack.sections,
      count = rendered.lodBindings[0].attributes.aTentacleWeights.count
    check(
      `${label}: every volume follows consecutive real GLB muscle sections`,
      sections.length >= 10 &&
        sections.every(
          (section) =>
            section.sourceIndices.length >= 4 &&
            section.sourceIndices.every((index) => Number.isInteger(index) && index >= 0 && index < count) &&
            section.world.length === section.sourceIndices.length &&
            section.world.every(
              (point) => finitePoint(point) && distance(point, section.center) <= section.radius + 0.05,
            ),
        ) &&
        liveVolumes.every((volume) =>
          sections.some(
            (section, index) =>
              index > 0 &&
              distance(sections[index - 1].center, volume.a) < 0.05 &&
              distance(section.center, volume.b) < 0.05,
          ),
        ),
    )
  } else {
    check(
      `${label}: wrist contact remains on actual imported surface vertices`,
      authored.every(
        (contact) =>
          contact.sourceIndices?.length >= 6 &&
          contact.sourceIndices.every(Number.isInteger) &&
          contact.world?.every(finitePoint) &&
          distance(contact.a, contact.world[0]) < 0.05 &&
          distance(contact.b, contact.world[1]) < 0.05,
      ),
    )
  }
}

async function testAimAndPhoto(id) {
  await page.evaluate(() => window.__environmentReview(null))
  await settleProtection()
  const initial = actorById(await snapshot(), id),
    origin = initial.root,
    range = initial.range
  const far = [origin[0] + range * 1.9, origin[1] - 0.95, origin[2]]
  await moveTo(far)
  await waitForActor(id, ['idle'], 15000)
  const left = [origin[0] - range * 0.55, origin[1] - 0.95, origin[2]],
    right = [origin[0], origin[1] - 0.95, origin[2] + range * 0.55]
  await moveTo(left)
  await waitForActor(id, ['windup'])
  const first = await snapshot(),
    firstActor = actorById(first, id),
    firstRendered = renderedActor(first, firstActor)
  await moveTo(right)
  await page.waitForTimeout(180)
  const second = await snapshot(),
    secondActor = actorById(second, id),
    secondRendered = renderedActor(second, secondActor),
    p = await player()
  check(
    `${id}: anticipation retargets the real player from a second side`,
    distance(secondActor.target, [p.position[0], p.position[1] + 0.95, p.position[2]]) < 0.1 &&
      distance(firstActor.target, secondActor.target) > range * 0.2 &&
      firstActor.attackSerial === secondActor.attackSerial,
  )
  check(
    `${id}: actual model yaw turns toward the approaching player`,
    Math.abs(
      Math.atan2(Math.sin(secondRendered.yaw - firstRendered.yaw), Math.cos(secondRendered.yaw - firstRendered.yaw)),
    ) > 0.02,
  )
  await page.keyboard.press('p')
  await page.waitForFunction(() => window.__ui.state().cameraMode === 'photo')
  await page.waitForTimeout(100)
  const paused = actorById(await snapshot(), id),
    count = hazards(await snapshot()).hits.length
  await page.waitForTimeout(650)
  const held = await snapshot(),
    heldActor = actorById(held, id)
  check(
    `${id}: photography freezes an unfinished telegraph while ambient life continues`,
    !hazards(held).enabled &&
      heldActor.phase === 'windup' &&
      heldActor.phaseTime === paused.phaseTime &&
      heldActor.progress === paused.progress &&
      heldActor.attackSerial === paused.attackSerial &&
      hazards(held).hits.length === count,
  )
  await page.keyboard.press('p')
  await page.waitForFunction(
    () => window.__ui.state().cameraMode === 'player' && window.__blackMist.snapshot().hazards.enabled,
  )
  const resumed = actorById(await snapshot(), id)
  check(
    `${id}: leaving photography resumes the same readable windup without jumping to a strike`,
    resumed.phase === 'windup' &&
      resumed.attackSerial === paused.attackSerial &&
      resumed.progress >= paused.progress &&
      resumed.progress < paused.progress + 0.1,
  )
  await moveTo(far)
  await waitForActor(id, ['idle'], 15000)
  await review(page, [[origin[0] + 40, origin[1] + 40, origin[2] + 40], origin], 150)
  const reviewed = await snapshot(),
    reviewCount = hazards(reviewed).hits.length
  await page.waitForTimeout(300)
  check(
    'review camera is safe and cannot substitute for the actual player target',
    hazards(await snapshot()).review &&
      !hazards(await snapshot()).enabled &&
      !actorById(await snapshot(), id).target &&
      hazards(await snapshot()).hits.length === reviewCount,
  )
  await page.evaluate(() => window.__environmentReview(null))
  report.attacks.push({
    id,
    twoSides: { first: firstActor, second: secondActor, fromYaw: firstRendered.yaw, toYaw: secondRendered.yaw },
    photo: { paused, resumed },
  })
}

async function testAttack(id, record = false) {
  await page.evaluate(() => window.__environmentReview(null))
  await settleProtection()
  let actor = actorById(await snapshot(), id)
  const root = actor.root ?? actor.position,
    range = actor.range ?? attack(actor).range
  assert.ok(
    finitePoint(root) && Number.isFinite(range) && range > 1,
    `${id} must expose its actual sensing origin and range`,
  )
  const far = [root[0] + range * 1.4, root[1], root[2]]
  await moveTo(far)
  await waitForActor(id, ['idle'], 15000)
  const idleState = await snapshot(),
    idle = actorById(idleState, id),
    idleHits = hazards(idleState).hits.length
  await page.waitForTimeout(600)
  check(
    `${id}: distant player does not trigger a targeted attack`,
    attack(actorById(await snapshot(), id)).phase === 'idle' && hazards(await snapshot()).hits.length === idleHits,
  )
  const anatomy = renderedActor(idleState, idle)
  const reachable =
    idle.kind === 'creature'
      ? anatomy.attack.contacts[0].world[0]
      : anatomy.attack.sections
          .filter((section) => section.s > 0.55)
          .sort((a, b) => distance(a.center, root) - distance(b.center, root))[0].world[0]
  assert.ok(
    finitePoint(reachable) && distance(reachable, root) < range,
    `${id} has a real anatomical point inside sensing range`,
  )
  const outward = reachable.map((value, axis) => value - root[axis]),
    length = distance(reachable, root)
  const near = reachable.map(
    (value, axis) => value + (length ? (outward[axis] / length) * 2 : 0) - (axis === 1 ? 0.95 : 0),
  )
  const originalPlayer = await player()
  let recording
  if (record && !process.argv.includes('--no-video')) {
    recording = recordAttackVideo(id)
    recordings.push(recording)
  }
  await moveTo(near, Math.atan2(root[0] - near[0], -(root[2] - near[2])))
  actor = await waitForActor(id, ['windup'])
  check(
    `${id}: entering sensing range acquires the actual player`,
    finitePoint(attack(actor).target) && distance(attack(actor).target, (await player()).position) < 3,
  )
  const windup = await waitForActor(id, ['windup'])
  check(
    `${id}: a visible windup precedes the active strike`,
    !volumes(await snapshot(), windup).some((volume) => volume.active) &&
      attack(windup).progress >= 0 &&
      attack(windup).progress < 1,
  )
  const woundAt = hazards(await snapshot()).time
  // Keep the aimed target in reach, then leave after aim locks. This lets the actual strike be inspected before overlap.
  await page.waitForFunction(
    (id) => {
      const actor = window.__blackMist.snapshot().hazards.actors.find((entry) => entry.id === id)
      return actor?.phase === 'windup' && actor.progress > 0.68
    },
    id,
    { polling: 25, timeout: 7000 },
  )
  const locked = actorById(await snapshot(), id)
  await moveTo([root[0] + range * 1.25, root[1], root[2]])
  const strikeState = await holdStrike(id, 0.3)
  actor = actorById(strikeState, id)
  check(
    `${id}: the strike follows a readable windup interval`,
    hazards(strikeState).time - woundAt > 0.15 && volumes(strikeState, actor).some((volume) => volume.active),
  )
  assertActualVolumes(strikeState, actor, id)
  const moved = sourceProbes(strikeState, actor).filter((probe) => {
    const previous = sourceProbes(idleState, idle).find(
      (sample) => sample.index === probe.index && sample.mesh === probe.mesh,
    )
    return previous && distance(probe.posed, previous.posed) > 0.003
  })
  check(`${id}: indexed anatomy bends during the aimed strike`, moved.length >= 2)
  const value = attack(actor),
    target = value.target,
    strikeVolumes = volumes(strikeState, actor)
  const actualAnatomy = renderedActor(strikeState, actor)
  check(
    `${id}: the strike retains its captured player aim`,
    finitePoint(target) && distance(target, locked.target) < 0.05,
  )
  if (actor.kind === 'creature') {
    const desired = Math.atan2(target[0] - actualAnatomy.position[0], target[2] - actualAnatomy.position[2])
    check(
      `${id}: the real body faces the aimed player during its limited wrist sweep`,
      Math.abs(Math.atan2(Math.sin(actualAnatomy.yaw - desired), Math.cos(actualAnatomy.yaw - desired))) < 0.25,
    )
  } else {
    const behavior = actualAnatomy.attack.behavior,
      direction = behavior.direction,
      matrix = actualAnatomy.modelMatrix
    const worldDirection = [
      matrix[0] * direction[0] + matrix[8] * direction[2],
      matrix[2] * direction[0] + matrix[10] * direction[2],
    ]
    const aimed = [target[0] - actualAnatomy.root[0], target[2] - actualAnatomy.root[2]]
    const alignment =
      worldDirection.reduce((sum, value, axis) => sum + value * aimed[axis], 0) /
      (Math.hypot(...worldDirection) * Math.hypot(...aimed))
    check(
      `${id}: normalized muscle steering follows the locked player side within its natural angular limits`,
      finitePoint(direction) &&
        Math.abs(Math.hypot(direction[0], direction[2]) - 1) < 0.00001 &&
        Math.abs(direction[1]) < 0.00001 &&
        behavior.phase === 'strike' &&
        behavior.sequence === value.attackSerial &&
        alignment > 0.2,
    )
    const restRoot = sourceProbes(idleState, idle).find((probe) => probe.role === 'root'),
      strikeRoot = sourceProbes(strikeState, actor).find((probe) => probe.role === 'root')
    check(
      `${id}: aiming bends the actual muscle without moving the attached root`,
      distance(restRoot.world, strikeRoot.world) < 0.01,
    )
  }
  const count = hazards(await snapshot()).hits.length
  if (count === idleHits) {
    // Enter the actual current strike capsule; this still exercises real swept collision and the recovery path.
    const strikePoint = midpoint(strikeVolumes.find((volume) => volume.active))
    report.attemptedContact = {
      id,
      strikePoint,
      contacts: strikeVolumes,
      phase: value.phase,
      progress: value.progress,
      sourcePose: pose(strikeState, actor),
    }
    await moveTo([strikePoint[0], strikePoint[1] - 0.9, strikePoint[2]])
    report.attemptedContact.player = await player()
    report.attemptedContact.held = await snapshot()
    await page.evaluate(() => window.__blackMist.motionHold(false))
    await assertRecovery(id, count, originalPlayer)
  } else {
    await page.evaluate(() => window.__blackMist.motionHold(false))
    await assertRecovery(id, idleHits, originalPlayer)
  }
  report.attacks.push({
    id,
    idle: { attack: attack(idle), pose: pose(idleState, idle) },
    windup: attack(windup),
    strike: { attack: value, pose: pose(strikeState, actor), volumes: strikeVolumes },
  })
  const audio = (await snapshot()).audio.hazards.filter((cue) => cue.id === `${id}:${value.attackSerial}`)
  check(
    `${id}: actual windup and strike sounds share the rendered attack sequence`,
    ['windup', 'strike'].every((phase) => audio.filter((cue) => cue.phase === phase).length === 1) &&
      audio.every((cue) => Number.isFinite(cue.pan) && Math.abs(cue.pan) <= 1),
  )
  report.attacks.at(-1).audio = audio
  if (recording) await recording
}

async function testEvade(id) {
  await page.evaluate(() => window.__environmentReview(null))
  await settleProtection()
  const actor = actorById(await snapshot(), id),
    root = actor.root ?? actor.position,
    range = actor.range ?? attack(actor).range
  assert.ok(finitePoint(root) && Number.isFinite(range), `${id} exposes its live sensing geometry`)
  const far = [root[0], root[1], root[2] + range * 1.9],
    near = [root[0], root[1], root[2] - range * 0.65]
  await moveTo(far)
  await waitForActor(id, ['idle'], 15000)
  const count = hazards(await snapshot()).hits.length
  await moveTo(near)
  const windup = await waitForActor(id, ['windup'])
  await moveTo(far)
  await waitForActor(id, ['idle'], 15000)
  const after = await snapshot()
  check(`${id}: escaping during the telegraph avoids a hit`, hazards(after).hits.length === count)
  check(
    `${id}: escaped player is released after attack recovery`,
    attack(actorById(after, id)).phase === 'idle' && !attack(actorById(after, id)).target,
  )
  report.attacks.push({ id, evaded: true, windup: attack(windup), position: (await player()).position })
}

function assertVariants(state) {
  const variants = hazards(state).actors.filter((actor) => actor.kind === 'creature')
  const creatures = variants.map((actor) => renderedActor(state, actor))
  check(
    'six creature instances retain genuine reused PBR geometry',
    creatures.length === 6 &&
      creatures.every(
        (creature) =>
          creature?.visible &&
          creature.draws.length > 0 &&
          creature.draws.every(
            (draw) =>
              draw.sourceUrl?.startsWith('/assets/black-mist/') &&
              draw.sourceUrl.endsWith('.glb') &&
              draw.triangles > 1000 &&
              draw.pbr?.baseColor &&
              draw.pbr.normal &&
              draw.pbr.roughness,
          ),
      ),
  )
  check(
    'variants occupy independent world placements and anatomy instances',
    new Set(creatures.map((creature) => creature.id)).size === creatures.length &&
      new Set(creatures.map((creature) => creature.position.map((value) => value.toFixed(1)).join(','))).size ===
        creatures.length &&
      new Set(creatures.map((creature) => creature.variantId)).size >= 5 &&
      new Set(creatures.map((creature) => creature.sourceType)).size === 2,
  )
  report.variants = creatures.map(({ id, sourceType, height, position, draws }) => ({
    id,
    sourceType,
    height,
    position,
    draws,
  }))
}

async function recordAttackVideo(id, seconds = 12) {
  const bytes = await page.evaluate(async (seconds) => {
    const { mixer } = await window.__liveImport('/src/world/audio/mixer.ts')
    const context = mixer.audioContext,
      master = mixer.master
    if (!context || context.state !== 'running' || !master)
      throw Error('The actual mastered game audio must be running')
    const canvas = document.querySelector('canvas'),
      stream = canvas.captureStream(24)
    const tap = context.createMediaStreamDestination(),
      analyser = context.createAnalyser()
    master.connect(tap)
    master.connect(analyser)
    tap.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    )
    if (!mimeType) throw Error('Canvas WebM recording is unavailable')
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 96_000 }),
      chunks = []
    let maxRms = 0
    const samples = new Float32Array(analyser.fftSize)
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      maxRms = Math.max(maxRms, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length))
    }, 100)
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearInterval(meter)
        master.disconnect(tap)
        master.disconnect(analyser)
        tap.disconnect()
        analyser.disconnect()
        stream.getTracks().forEach((track) => track.stop())
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        cleanup()
        reject(Error('Real attack recording failed'))
      }
      recorder.onstop = async () => {
        cleanup()
        const data = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
        let binary = ''
        for (let n = 0; n < data.length; n += 32768) binary += String.fromCharCode(...data.subarray(n, n + 32768))
        resolve({
          bytes: data.length,
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
  const filename = `${OUT}/${id}-approach-windup-strike-${seconds}s.webm`
  check(
    `${id}: real rendered approach and attack are recorded with mastered sound`,
    bytes.bytes > 10000 && bytes.audioTracks === 1 && bytes.maxRms > 0.001,
  )
  await fs.writeFile(filename, Buffer.from(bytes.data, 'base64'))
  report.videos.push({
    filename,
    seconds,
    bytes: bytes.bytes,
    mimeType: bytes.mimeType,
    audioTracks: bytes.audioTracks,
    maxRms: bytes.maxRms,
  })
}

async function assertRoarPatrolBridge(id) {
  await page.evaluate(() => window.__blackMist.motionHold(true))
  const before = await snapshot(),
    actor = actorById(before, id),
    rendered = renderedActor(before, actor)
  check(
    `${id}: an attack consumes life time independently of the paused patrol clock`,
    rendered.attack.clock > rendered.attack.patrolTime + 0.2,
  )
  const next = await page.evaluate(
    async ({ id, after }) => {
      const [{ HORROR_LAYOUT }, { sampleHorrorMotion }] = await Promise.all([
        window.__liveImport('/src/world/blackMist/horrorLayout.ts'),
        window.__liveImport('/src/world/blackMist/horrorMotion.ts'),
      ])
      const placement = HORROR_LAYOUT.find((entry) => entry.id === id)
      for (let time = after + 1; time < after + placement.patrol.period * 2; time += 0.05) {
        const motion = sampleHorrorMotion(placement, time)
        if (motion.roarEvent && motion.roarStrength > 0.8)
          return {
            patrolTime: time,
            cycle: motion.cycle,
            eventId: motion.roarEventId,
            sourceType: placement.sourceType,
          }
      }
      throw Error('The actual authored patrol has no future roar window')
    },
    { id: rendered.id, after: rendered.attack.patrolTime },
  )
  await page.evaluate(
    async ({ from, to }) => {
      // Small frame steps preserve the actual delayed patrol clock; a large DEV seek intentionally resets it.
      for (let time = from; time < to - 1e-6;) {
        time = Math.min(to, time + 0.1)
        window.__blackMist.seekMotion(time)
        await new Promise(requestAnimationFrame)
      }
    },
    { from: before.motion.time, to: before.motion.time + next.patrolTime - rendered.attack.patrolTime },
  )
  await page.waitForTimeout(220)
  const state = await snapshot(),
    actual = renderedActor(state, actorById(state, id))
  check(
    `${id}: rendered roar follows its real slowed patrol clock`,
    actual.motion.roarEvent &&
      actual.motion.cycle === next.cycle &&
      Math.abs(actual.attack.patrolTime - next.patrolTime) < 0.06 &&
      actual.sourceType === next.sourceType,
  )
  check(
    `${id}: real roar audio is keyed to the same creature and patrol cycle`,
    state.audio.roars.some(
      (cue) =>
        cue.creature === actual.id &&
        cue.cycle === next.cycle &&
        cue.id === next.eventId &&
        cue.voiceActive &&
        !cue.stopping,
    ),
  )
  report.roarBridge = {
    next,
    motionTime: state.motion.time,
    patrolTime: actual.attack.patrolTime,
    sourceType: actual.sourceType,
    roar: state.audio.roars.filter((cue) => cue.creature === actual.id && cue.cycle === next.cycle),
  }
  await page.evaluate(() => window.__blackMist.motionHold(false))
}

async function testContact(kind) {
  await page.evaluate(() => window.__environmentReview(null))
  await settleProtection()
  const state = await snapshot(),
    sites = state.tissue.sites.filter((entry) => entry.surface === kind && entry.visible)
  assert.ok(sites.length, `${kind} must have visible living tissue sites`)
  const site = sites[0]
  const recording = kind === 'ground' && !process.argv.includes('--no-video') ? recordAttackVideo(site.id) : null
  if (recording) recordings.push(recording)
  assert.ok(finitePoint(site.approachPoint), `${kind} must publish its actual safe approach surface`)
  const face = Math.atan2(site.root[0] - site.approachPoint[0], -(site.root[2] - site.approachPoint[2]))
  const count = hazards(state).hits.length,
    before = await moveTo(site.approachPoint, face)
  await capture(`${kind}-living-tissue-on-real-ground`)
  const winding = await waitForActor(site.id, ['windup'])
  check(
    `${kind}: rooted tissue telegraphs before contact becomes dangerous`,
    !volumes(await snapshot(), winding).some((volume) => volume.active),
  )
  await capture(`${kind}-tissue-windup`)
  const active = await holdStrike(site.id)
  const contact = volumes(active, actorById(active, site.id)).find(
    (volume) => volume.active && Math.max(volume.a[1], volume.b[1]) > site.approachPoint[1] + 0.3,
  )
  assert.ok(contact, `${kind} must publish a live posed strike capsule`)
  const liveSite = active.tissue.sites.find((entry) => entry.id === site.id)
  check(
    `${kind}: contact capsule comes from the actual textured claw or tendril`,
    liveSite.sourceProbes.every((probe) => Number.isInteger(probe.index) && finitePoint(probe.position)) &&
      liveSite.sourceProbes.some((probe) => distance(probe.position, contact.a) < 0.05) &&
      liveSite.sourceProbes.some((probe) => distance(probe.position, contact.b) < 0.05),
  )
  await capture(`${kind}-tissue-strike`)
  const p = site.kind === 'claw' ? (contact.a[1] > contact.b[1] ? contact.a : contact.b) : midpoint(contact)
  await moveTo([p[0], p[1] - 0.9, p[2]])
  let entryPhase = (await player()).phase
  if (kind === 'ground' && entryPhase === 'GROUND') {
    await page.keyboard.press('f')
    entryPhase = (await player()).phase
    check('a real sword-summoning transition can begin beside the paused claw', entryPhase === 'SUMMONING')
  }
  await page.evaluate(() => window.__blackMist.motionHold(false))
  await assertRecovery(kind, count, before)
  report.contacts.push({ site: liveSite, contact, entryPhase })
  if (recording) await recording
}

async function testSweptFlight() {
  await page.evaluate(() => window.__environmentReview(null))
  await settleProtection()
  const start = await snapshot(),
    site = start.tissue.sites.find(
      (entry) => entry.surface === 'ground' && entry.kind === 'claw' && entry.root[0] > 130 && entry.root[2] > -170,
    )
  assert.ok(site, 'An open forecourt claw is required for real fast-flight collision verification')
  await moveTo(site.approachPoint)
  await waitForActor(site.id, ['windup'])
  let held = await holdStrike(site.id, 0.5)
  let volume = volumes(held, actorById(held, site.id)).find(
    (contact) => contact.active && midpoint(contact)[1] > site.approachPoint[1] + 0.5,
  )
  assert.ok(volume, 'A real above-ground finger capsule must be active before pausing its pose')
  const crossing = midpoint(volume),
    oldHitCount = hazards(held).hits.length
  await moveTo([crossing[0], site.approachPoint[1] + 0.65, crossing[2] + 30])
  await page.evaluate(() => window.__blackMist.motionHold(false))
  await page.waitForFunction(() => window.__blackMist.snapshot().hazards.enabled, null, { polling: 'raf' })
  held = await page.evaluate(
    async ({ position }) => {
      const { teleportPlayer } = await window.__liveImport('/src/world/player/playerHandle.ts')
      if (!teleportPlayer(position)) throw Error('The real player must accept the discontinuous teleport fixture')
      await new Promise(requestAnimationFrame)
      const state = window.__blackMist.snapshot()
      window.__blackMist.motionHold(true)
      return state
    },
    { position: [crossing[0], site.approachPoint[1] + 0.65, crossing[2] - 30] },
  )
  check(
    'teleporting across a currently active claw does not create a swept world hit',
    hazards(held).enabled &&
      hazards(held).hits.length === oldHitCount &&
      volumes(held, actorById(held, site.id)).some((contact) => contact.active),
  )
  volume = volumes(held, actorById(held, site.id)).find(
    (contact) => contact.active && midpoint(contact)[1] > site.approachPoint[1] + 0.5,
  )
  assert.ok(volume, 'The same real finger strike must remain available after the discontinuous jump')
  const point = midpoint(volume),
    y = site.approachPoint[1] + 0.65
  await moveTo([point[0], y, point[2] + 200], 0)
  await page.evaluate(async () => {
    const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
    getPlayerRuntime().pitch = 0
  })
  check('fast-flight fixture starts the real controller above open terrain', (await player()).phase === 'FLIGHT')
  const count = hazards(held).hits.length,
    before = await player()
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('w')
  try {
    await page.waitForFunction((z) => window.__playerSnapshot().position[2] < z + 20, point[2], {
      timeout: 8000,
      polling: 'raf',
    })
    const moving = await player()
    check(
      'real boost input reaches high speed before the claw',
      Math.hypot(...moving.velocity) > 100 && moving.position[2] > point[2] + 4,
    )
    await page.evaluate(() => window.__blackMist.motionHold(false))
    await page.waitForFunction((count) => window.__blackMist.snapshot().hazards.hits.length > count, count, {
      timeout: 5000,
      polling: 30,
    })
    await page.keyboard.up('w')
    await page.keyboard.up('ShiftLeft')
    await assertRecovery('boosted flight through a finger', count, before, 5000)
    report.sweptFlight = { site: site.id, capsule: volume, moving, hit: hazards(await snapshot()).hits.at(-1) }
  } finally {
    await page.keyboard.up('w')
    await page.keyboard.up('ShiftLeft')
    await page.evaluate(() => window.__blackMist.motionHold(false))
  }
}

async function assertPaused(label) {
  await page.waitForTimeout(150)
  const before = await snapshot()
  await page.waitForTimeout(550)
  const after = await snapshot()
  check(
    `${label}: threat clock and posed collision volumes freeze`,
    hazards(before).paused &&
      hazards(after).paused &&
      hazards(before).time === hazards(after).time &&
      JSON.stringify(hazards(before).actors) === JSON.stringify(hazards(after).actors) &&
      JSON.stringify(hazards(before).contacts) === JSON.stringify(hazards(after).contacts),
  )
  check(
    `${label}: paused threats cannot move or respawn the player`,
    hazards(before).hits.length === hazards(after).hits.length,
  )
}

try {
  const ordinary = await snapshot()
  check(
    'ordinary exploration has no active threats or optional model requests',
    !ordinary.active &&
      !ordinary.hazards?.actors?.length &&
      !ordinary.hazards?.contacts?.length &&
      !(await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /\/assets\/black-mist\/.*\.glb$/.test(new URL(entry.name).pathname)),
      )),
  )
  const orb = await page.evaluate(() =>
    window.__interact.orbs().find((entry) => entry.group === 'road' && !entry.collected),
  )
  await page.evaluate((id) => window.__interact.visitOrb(id), orb.id)
  await page.waitForTimeout(450)
  const initialProgress = await progress()
  check('ordinary exploration still gathers a real spirit light', initialProgress.orbs.includes(orb.id))
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 180000 })
  await page.evaluate(() => {
    window.__blackMist.hold(true)
    window.__blackMist.seek(55)
  })
  await assertBlackMistCollectionBlocked('cinematic', initialProgress.orbs)
  const cinematic = await snapshot()
  check('cinematic safely disables player damage', !hazards(cinematic).enabled && hazards(cinematic).hits.length === 0)
  await page.evaluate(() => window.__blackMist.skip())
  const handoff = await snapshot()
  check('unlocked cinematic handoff cannot damage the player', !hazards(handoff).enabled && handoff.awaitingExplore)
  await page.locator('.black-mist-explore').click()
  await page.waitForFunction(() => !!document.pointerLockElement && window.__blackMist.snapshot().hazards.enabled)
  await assertBlackMistCollectionBlocked('aftermath', initialProgress.orbs)
  await page.evaluate(async () => {
    const { flushSave } = await window.__liveImport('/src/ui/save.ts')
    flushSave()
  })
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('yunque.save.v2')))
  check(
    'black-mist visits preserve exact existing saved collection progress',
    JSON.stringify(persisted.orbs.slice().sort()) === JSON.stringify(initialProgress.orbs),
  )
  const active = hazards(await snapshot())
  check(
    'giant limbs and independent real-model creature variants are registered',
    active.actors.some((entry) => entry.kind === 'tentacle') &&
      active.actors.filter((entry) => entry.kind === 'creature').length >= 5 &&
      new Set(active.actors.map((entry) => entry.id)).size === active.actors.length,
  )
  const creatureActor = active.actors.find((entry) => entry.kind === 'creature')
  const tentacleActor = active.actors.find((entry) => entry.kind === 'tentacle')
  assertVariants(await snapshot())
  await testAimAndPhoto(creatureActor.id)
  await testAttack(creatureActor.id, true)
  await capture('creature-attack-recovery')
  await testAttack(tentacleActor.id)
  await capture('giant-tentacle-attack-recovery')
  const variant = active.actors.find((entry) => entry.kind === 'creature' && entry.id !== creatureActor.id)
  await testEvade(variant.id)
  await assertRoarPatrolBridge(creatureActor.id)
  await testContact('building')
  await testContact('ground')
  await testSweptFlight()
  await assertCollectedSet('all hostile contacts', initialProgress.orbs)
  await page.evaluate(() => window.__environmentReview(null))
  await page.evaluate(() => document.exitPointerLock())
  await page.locator('.settings-dialog').waitFor()
  await assertPaused('settings')
  await page.locator('.settings-resume').click()
  await page.waitForFunction(() => !!document.pointerLockElement)
  await page.keyboard.press('Tab')
  await page.getByRole('tabpanel').waitFor()
  await assertPaused('scroll overlay')
  await page.locator('.scroll-close').click()
  await page.waitForFunction(() => !!document.pointerLockElement)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await assertPaused('background document')
  await page.evaluate(() => {
    delete document.hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(200)
  check('returning to the visible world resumes threat motion safely', !hazards(await snapshot()).paused)
  for (const quality of ['high', 'mid', 'low']) {
    await page.evaluate(async (quality) => {
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      useWorldStore.getState().setQuality(quality, false)
    }, quality)
    await page.waitForTimeout(900)
    const value = await snapshot(),
      perf = await telemetry(page)
    check(
      `${quality}: hazards remain registered within 400 scene calls`,
      hazards(value).actors.length === active.actors.length && perf.drawCalls <= MAX_DRAW_CALLS,
    )
    report.tiers.push({
      quality,
      drawCalls: perf.drawCalls,
      actors: hazards(value).actors.map(({ id, kind }) => ({ id, kind })),
    })
  }
  await page.evaluate(() => window.__blackMist.reset())
  await page.waitForTimeout(200)
  const replay = hazards(await snapshot())
  check(
    'replay clears hits, targets and attacking state before growth',
    !replay.enabled &&
      replay.hits.length === 0 &&
      replay.actors.every((entry) => !attack(entry).active && !attack(entry).target),
  )
  await assertCollectedSet('replay', initialProgress.orbs)
  await page.evaluate(async () => {
    const { stopBlackMist } = await window.__liveImport('/src/world/blackMist/runtime.ts')
    stopBlackMist()
  })
  await page.waitForTimeout(450)
  const stopped = await snapshot()
  check(
    'ordinary mode removes every threat, tissue contact and optional model',
    !stopped.active &&
      hazards(stopped).actors.length === 0 &&
      hazards(stopped).contacts.length === 0 &&
      stopped.creatures.length === 0,
  )
  await assertCollectedSet('ordinary mode return', initialProgress.orbs)
  check('no console, shader or page errors', errors.length === 0)
} catch (error) {
  report.failure = error.stack ?? String(error)
  report.failureState = {
    world: await snapshot().catch(() => null),
    player: await player().catch(() => null),
    progress: await progress().catch(() => null),
  }
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  console.error(report.failure)
} finally {
  await Promise.allSettled(recordings)
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`${report.checks.length} checks; ${report.failure ? 'FAILED' : 'PASS'}`)
if (report.failure) process.exitCode = 1
