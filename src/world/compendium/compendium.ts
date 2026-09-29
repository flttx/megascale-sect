import { MathUtils, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { COLOSSUS_META } from '../colossi/colossiMeta'
import { kunState } from '../colossi/kunDeck'
import { ARMILLARY, COLOSSI } from '../colossi/layout'
import { worldTerrainHeight } from '../regions/regions'
import { atmosphere } from '../sky/atmosphere'
import { CLOUD_SEA_Y } from '../sky/CloudSea'
import { insideAnyCollider } from '../surfaces'
import { weather } from '../weather/weatherMachine'

/**
 * 万象图录 (R10d): the colossi, creatures and sky phenomena a photo can record. A thing is recorded when a shot
 * frames it (centred and large enough, or filling the frame) with a clear line of sight; a phenomenon when it is
 * happening and the camera faces it. Detection runs on the shutter, against the frame just presented.
 */
export type CompendiumGroup = 'colossus' | 'creature' | 'phenomenon'

interface Sphere { center: Vector3; radius: number }
interface EntryBase { id: string; group: CompendiumGroup; name: string }
/** Framed when one of its bounding spheres spans at least `minShare` of the frame height. */
interface BodyEntry extends EntryBase { kind: 'body'; minShare: number; spheres: () => readonly Sphere[] }
interface SkyEntry extends EntryBase { kind: 'sky'; framed: (camera: PerspectiveCamera, forward: Vector3) => boolean }
export type CompendiumEntry = BodyEntry | SkyEntry

/** A placed colossus from the cloud tops (or its base, if higher) to its crown. */
function colossusSphere(id: string): Sphere {
  const c = COLOSSI.find((p) => p.id === id)!
  const top = c.position[1] + COLOSSUS_META[c.model].height * c.scale, bottom = Math.max(c.position[1], CLOUD_SEA_Y)
  return { center: new Vector3(c.position[0], (top + bottom) / 2, c.position[2]), radius: (top - bottom) / 2 }
}
/** A wide colossus as three spheres across its local x span (asset m), so either end frames on its own. */
function colossusRow(id: string, halfWidth: number): Sphere[] {
  const c = COLOSSI.find((p) => p.id === id)!, middle = colossusSphere(id)
  const span = Math.max(0, halfWidth * c.scale - middle.radius), yaw = c.rotation[1]
  return [-1, 0, 1].map((k) => ({ center: middle.center.clone().add(new Vector3(Math.cos(yaw) * span * k, 0, -Math.sin(yaw) * span * k)), radius: middle.radius }))
}
const still = (...spheres: Sphere[]) => () => spheres

/** Live crane positions, filled by the flock (Cranes.tsx) and emptied when it unmounts. */
export const cranePositions: Vector3[] = []
const CRANE_RADIUS = 5
/** The kun's bounding sphere (312 m nose to flukes); only counted while above the cloud sea. */
const kun: Sphere = { center: kunState.center, radius: 130 }

const LIGHTNING_WINDOW = 1.5
let sinceFlash = Infinity
/** Where the last strike met the cloud sea; its bolt rises some 600 m above. */
const strikePoint = new Vector3()
const BOLT_HEIGHTS = [120, 320, 540]
const view = new Vector3()

/** Frame coordinates of `p` (±1 at the edges), its depth (m, ≤ 0 behind) and tan of the half vertical fov. */
function project(camera: PerspectiveCamera, p: Vector3) {
  view.copy(p).applyMatrix4(camera.matrixWorldInverse)
  const depth = -view.z, tan = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
  return { x: view.x / (depth * tan * camera.aspect), y: view.y / (depth * tan), depth, tan }
}
const inFrame = (f: { x: number; y: number; depth: number }, limit: number) => f.depth > 0 && Math.abs(f.x) <= limit && Math.abs(f.y) <= limit
const sunPoint = new Vector3(), boltPoint = new Vector3()

export const COMPENDIUM: CompendiumEntry[] = [
  { id: 'guardians', group: 'colossus', name: '云海双神', kind: 'body', minShare: 0.25, spheres: still(colossusSphere('guardian_east'), colossusSphere('guardian_west')) },
  { id: 'giant_sword', group: 'colossus', name: '镇山巨剑', kind: 'body', minShare: 0.25, spheres: still(colossusSphere('giant_sword')) },
  { id: 'armillary', group: 'colossus', name: '浑天仪', kind: 'body', minShare: 0.2, spheres: still({ center: new Vector3(...ARMILLARY.position), radius: ARMILLARY.radius }) },
  { id: 'seated_sage', group: 'colossus', name: '玄穹坐忘像', kind: 'body', minShare: 0.25, spheres: still(colossusSphere('seated_sage')) },
  { id: 'dragon_pillar', group: 'colossus', name: '盘龙天柱', kind: 'body', minShare: 0.25, spheres: still(colossusSphere('dragon_pillar')) },
  { id: 'sky_gate', group: 'colossus', name: '归墟天门', kind: 'body', minShare: 0.25, spheres: still(...colossusRow('sky_gate', 140)) },
  { id: 'sword_tomb', group: 'colossus', name: '万剑冢', kind: 'body', minShare: 0.25, spheres: still(colossusSphere('tomb_sword_0')) },
  { id: 'kun', group: 'creature', name: '鲲', kind: 'body', minShare: 0.2, spheres: () => kunState.ready && kun.center.y > CLOUD_SEA_Y + 20 ? [kun] : [] },
  { id: 'cranes', group: 'creature', name: '仙鹤', kind: 'body', minShare: 0.06, spheres: () => cranePositions.map((center) => ({ center, radius: CRANE_RADIUS })) },
  {
    // A strike within the last moment with some stretch of its bolt inside the frame.
    id: 'lightning', group: 'phenomenon', name: '雷霆裂空', kind: 'sky',
    framed: (camera) => weather.target === 'storm' && sinceFlash < LIGHTNING_WINDOW
      && BOLT_HEIGHTS.some((h) => inFrame(project(camera, boltPoint.copy(strikePoint).setY(strikePoint.y + h)), 1)),
  },
  { id: 'stars', group: 'phenomenon', name: '星河垂野', kind: 'sky', framed: (_, forward) => atmosphere.stars > 0.6 && atmosphere.overcast < 0.3 && forward.y > 0.25 },
  {
    // The sun low on the horizon (rising or setting) and inside the frame.
    id: 'golden_hour', group: 'phenomenon', name: '金乌衔山', kind: 'sky',
    framed: (camera) => {
      const sun = atmosphere.sunDirection
      if (sun.y < -0.02 || sun.y > 0.16 || atmosphere.overcast > 0.4) return false
      return inFrame(project(camera, sunPoint.copy(camera.position).addScaledVector(sun, 1000)), 0.9)
    },
  },
  { id: 'snow_peaks', group: 'phenomenon', name: '千峰积雪', kind: 'sky', framed: (_, forward) => weather.snowCover > 0.45 && forward.y < 0.2 && forward.y > -0.6 },
]
export const COMPENDIUM_IDS = COMPENDIUM.map((entry) => entry.id)
export const COMPENDIUM_GROUPS: Record<CompendiumGroup, string> = { colossus: '巨物', creature: '灵物', phenomenon: '天象' }

/** Beyond this (m, to the sphere's surface) a body is lost in the haze. */
const MAX_RANGE = 4500
const toCenter = new Vector3(), closest = new Vector3()

interface Framing { ratio: number; sphere: Sphere; aim: Vector3 }
/**
 * How well a body is framed: its best sphere's share of the frame height over the entry's minimum (≥ 1 counts),
 * and the point the shot aims at — the centre, or where the view axis passes through a sphere too close to centre.
 */
function framing(entry: BodyEntry, camera: PerspectiveCamera, forward: Vector3): Framing | null {
  let best: Framing | null = null
  for (const sphere of entry.spheres()) {
    toCenter.subVectors(sphere.center, camera.position)
    const distance = toCenter.length()
    if (distance - sphere.radius > MAX_RANGE) continue
    const f = project(camera, sphere.center)
    let aim: Vector3
    if (inFrame(f, 0.85)) aim = sphere.center
    else {
      const along = toCenter.dot(forward)
      if (along <= 0 || closest.copy(camera.position).addScaledVector(forward, along).distanceTo(sphere.center) > sphere.radius * 0.6) continue
      aim = closest.clone()
    }
    const ratio = sphere.radius / (Math.max(distance, sphere.radius) * f.tan) / entry.minShare
    if (!best || ratio > best.ratio) best = { ratio, sphere, aim }
  }
  return best
}

const ray = new Vector3(), point = new Vector3(), sample = new Vector3(), right = new Vector3(), up = new Vector3()
/** Whether the straight line from `from` to where it enters `sphere` on its way to `to` is free of terrain, colliders and the cloud sea. */
function unobstructed(from: Vector3, to: Vector3, sphere: Sphere) {
  ray.subVectors(to, from)
  const length = ray.length()
  ray.divideScalar(length)
  toCenter.subVectors(from, sphere.center)
  const b = toCenter.dot(ray), c = toCenter.lengthSq() - sphere.radius * sphere.radius
  // From inside the sphere the body's own colliders lie ahead, so only terrain and the cloud sea can hide it.
  const inside = c < 0, disc = b * b - c
  const end = inside ? length * 0.95 : Math.min(length, disc > 0 ? -b - Math.sqrt(disc) : length)
  const steps = Math.min(240, Math.ceil(end / 12))
  // Skip the first metres: the photo camera may hover just above the ground.
  for (let i = 1; i <= steps; i++) {
    const t = 3 + ((end - 3) * i) / steps
    point.copy(from).addScaledVector(ray, t)
    if (point.y < CLOUD_SEA_Y + 2 || point.y < worldTerrainHeight(point.x, point.z) || (!inside && insideAnyCollider(point.x, point.y, point.z, 0))) return false
  }
  return true
}

const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const
/** At least two of five lines (the aim point and four around it, across the frame) reach the body unhidden. */
function clearView(camera: PerspectiveCamera, { sphere, aim }: Framing) {
  const e = camera.matrixWorld.elements
  right.set(e[0], e[1], e[2]).normalize(); up.set(e[4], e[5], e[6]).normalize()
  const spread = 0.45 * Math.min(sphere.radius, camera.position.distanceTo(aim) * project(camera, aim).tan * 0.6)
  let clear = 0
  for (const [a, b] of OFFSETS) {
    sample.copy(aim).addScaledVector(right, a * spread).addScaledVector(up, b * spread)
    if (unobstructed(camera.position, sample, sphere) && ++clear >= 2) return true
  }
  return false
}

const forward = new Vector3()
function viewAxis(camera: PerspectiveCamera) {
  const e = camera.matrixWorld.elements
  return forward.set(-e[8], -e[9], -e[10]).normalize()
}

/** What a shot from `camera` records: entries in view with a clear line of sight, and bodies framed but hidden. */
export function surveyPhoto(camera: PerspectiveCamera) {
  const axis = viewAxis(camera), found: string[] = [], blocked: string[] = []
  for (const entry of COMPENDIUM) {
    if (entry.kind === 'sky') { if (entry.framed(camera, axis)) found.push(entry.id); continue }
    const f = framing(entry, camera, axis)
    if (f && f.ratio >= 1) (clearView(camera, f) ? found : blocked).push(entry.id)
  }
  return { found, blocked }
}

/** Viewfinder state for the photo panel: entries in view by descending framing ratio (no line-of-sight test). */
export const compendiumView = { framed: [] as { id: string; ratio: number }[] }
const HINT_EVERY = 0.25
let hintTimer = 0

/** A strike just happened (the `lightning` world event): opens the window for recording it. */
export function noteLightning({ position }: { position: readonly [number, number, number] }) {
  sinceFlash = 0
  strikePoint.set(...position)
}

/** Clears the viewfinder and the lightning memory as photo mode opens. */
export function resetCompendiumView() {
  compendiumView.framed = []; sinceFlash = Infinity; hintTimer = 0
}

/** Per photo-mode frame: ages the last strike and refreshes the viewfinder a few times a second. */
export function tickCompendium(camera: PerspectiveCamera, delta: number) {
  sinceFlash += delta
  hintTimer -= delta
  if (hintTimer > 0) return
  hintTimer = HINT_EVERY
  const axis = viewAxis(camera), framed: { id: string; ratio: number }[] = []
  for (const entry of COMPENDIUM) {
    const ratio = entry.kind === 'sky' ? Number(entry.framed(camera, axis)) : framing(entry, camera, axis)?.ratio ?? 0
    if (ratio >= 0.35) framed.push({ id: entry.id, ratio })
  }
  compendiumView.framed = framed.sort((a, b) => b.ratio - a.ratio)
}
