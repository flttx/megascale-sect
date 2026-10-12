import { CatmullRomCurve3, MathUtils, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { useUiStore } from '../../ui/uiStore'
import { cameraClearance, cameraSolid, resetCameraRig } from '../player/CameraRig'
import { carrierDepth } from '../colossi/carriers'
import { getPlayerRuntime } from '../player/playerHandle'
import { useWorldStore } from '../store'
import { groundHeight } from '../worldLayout'
import type { SiteSpec } from './registry'

/**
 * Scripted cameras for viewpoints (a spline sweep out over the view) and meditation (a slow orbit and
 * pull-back). While a shot runs, cameraMode is 'cinematic' so the player rig leaves the camera alone.
 * Every exit dips through a short veil and hands the camera back behind the player.
 */
export type ShotKind = 'viewpoint' | 'meditation'

interface Shot {
  kind: ShotKind
  site: SiteSpec
  /** Seconds; 0 = runs until `endShot()`. */
  duration: number
  t: number
  ready: boolean
  /** Time the exit veil started, or −1 while playing. */
  ending: number
  fromPos: Vector3
  fromLook: Vector3
  fromFov: number
  curve: CatmullRomCurve3 | null
  orbitAngle: number
  onEnd: (() => void) | null
}

const VEIL_SECONDS = 0.42
export const director = { shot: null as Shot | null }

const look = new Vector3(),
  target = new Vector3(),
  dir = new Vector3(),
  side = new Vector3(),
  pos = new Vector3()
const previous = new Vector3(),
  travel = new Vector3()
const smoother = (x: number) => {
  const t = MathUtils.clamp(x, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function startShot(kind: ShotKind, site: SiteSpec, duration: number, onEnd: (() => void) | null = null) {
  director.shot = {
    kind,
    site,
    duration,
    t: 0,
    ready: false,
    ending: -1,
    fromPos: new Vector3(),
    fromLook: new Vector3(),
    fromFov: 72,
    curve: null,
    orbitAngle: 0,
    onEnd,
  }
  useWorldStore.getState().setCameraMode('cinematic')
}

/** Starts the exit (veil, then hand-back). Safe to call repeatedly. */
export function endShot() {
  const shot = director.shot
  if (!shot || shot.ending >= 0) return
  shot.ending = shot.t
  useUiStore.getState().setVeil(true)
}

export const shotActive = () => director.shot !== null

function init(shot: Shot, camera: PerspectiveCamera) {
  shot.ready = true
  shot.fromPos.copy(camera.position)
  camera.getWorldDirection(dir)
  shot.fromLook.copy(camera.position).addScaledVector(dir, 12)
  shot.fromFov = camera.fov
  const [sx, sy, sz] = shot.site.position,
    [fx, , fz] = shot.site.faceToward
  if (shot.kind === 'viewpoint') {
    dir.set(fx - sx, 0, fz - sz).normalize()
    side.set(-dir.z, 0, dir.x)
    const base = new Vector3(sx, sy, sz)
    const point = (up: number, forward: number, lateral: number) =>
      base
        .clone()
        .addScaledVector(dir, forward)
        .addScaledVector(side, lateral)
        .setY(sy + up)
    const lift = shot.site.viewpointLift ?? 0
    const points = [shot.fromPos.clone(), point(5, -4, 2), point(14 + lift / 2, 22, 8), point(28 + lift, 55, -6)]
    // Seat control points above terrain; the per-frame sweep also checks between them.
    for (const p of points) {
      const ground = groundHeight(p.x, p.z, p.y + 2)
      if (ground !== null) p.y = Math.max(p.y, ground + 2)
    }
    shot.curve = new CatmullRomCurve3(points, false, 'centripetal')
  } else {
    const runtime = getPlayerRuntime()
    const centre = runtime ? runtime.position : new Vector3(sx, sy, sz)
    shot.orbitAngle = Math.atan2(camera.position.z - centre.z, camera.position.x - centre.x)
  }
}

function poseViewpoint(shot: Shot, camera: PerspectiveCamera) {
  const u = shot.t / shot.duration
  shot.curve!.getPoint(smoother(u), pos)
  const [fx, fy, fz] = shot.site.faceToward
  target.set(fx, fy, fz)
  // Drift the aim sideways a little late in the shot so the overlook keeps "breathing".
  target.addScaledVector(
    side.set(-(fz - shot.site.position[2]), 0, fx - shot.site.position[0]).normalize(),
    Math.sin(u * Math.PI) * 18,
  )
  look.lerpVectors(shot.fromLook, target, smoother(u / 0.42))
  // Sweep from the last rendered eye, not merely the spline's control points. This also catches an
  // obstacle introduced after the shot starts and prevents low-frame-rate steps crossing a thin model.
  previous.copy(camera.position)
  const depth = carrierDepth(previous.x, previous.y, previous.z)
  if (depth > 0) previous.y += depth + 0.4
  // A moving prop can occupy the last eye between frames; retreat up to a clear eye before sweeping.
  for (let i = 0; i < 80 && cameraSolid(previous); i++) previous.y += 0.5
  travel.subVectors(pos, previous)
  const distance = travel.length()
  if (distance > 1e-6) {
    travel.divideScalar(distance)
    const free = Math.max(0, cameraClearance(previous, travel, distance + 0.15) - 0.15)
    camera.position.copy(previous).addScaledVector(travel, Math.min(distance, free))
  } else camera.position.copy(previous)
  camera.up.set(0, 1, 0)
  camera.lookAt(look)
  camera.fov = MathUtils.lerp(shot.fromFov, 58, smoother(u / 0.6))
  camera.updateProjectionMatrix()
}

function poseMeditation(shot: Shot, camera: PerspectiveCamera, delta: number) {
  const runtime = getPlayerRuntime()
  if (!runtime) return
  const centre = runtime.position
  const t = shot.t
  shot.orbitAngle += delta * 0.075
  const radius = Math.min(15, 5.5 + t * 0.9),
    height = Math.min(7.5, 2.2 + t * 0.5)
  pos.set(
    centre.x + Math.cos(shot.orbitAngle) * radius,
    centre.y + height,
    centre.z + Math.sin(shot.orbitAngle) * radius,
  )
  const ground = groundHeight(pos.x, pos.z, pos.y + 2)
  if (ground !== null) pos.y = Math.max(pos.y, ground + 1)
  const w = smoother(t / 2.2)
  camera.position.lerpVectors(shot.fromPos, pos, w)
  target.set(centre.x, centre.y + 1 + height * 0.12, centre.z)
  look.lerpVectors(shot.fromLook, target, w)
  camera.up.set(0, 1, 0)
  camera.lookAt(look)
  camera.fov = MathUtils.lerp(shot.fromFov, 55, w)
  camera.updateProjectionMatrix()
}

/** Hands the camera back to the player rig, which snaps straight to its framing on its next update. */
export function handBack(camera: PerspectiveCamera) {
  resetCameraRig()
  camera.fov = useWorldStore.getState().fov
  camera.updateProjectionMatrix()
}

function finish(shot: Shot, camera: PerspectiveCamera) {
  director.shot = null
  handBack(camera)
  const ui = useUiStore.getState()
  ui.setCaption(null)
  const world = useWorldStore.getState()
  if (world.cameraMode === 'cinematic') world.setCameraMode('player')
  window.setTimeout(() => useUiStore.getState().setVeil(false), 60)
  shot.onEnd?.()
}

/** Runs the active shot; call every frame after the player has moved. */
export function updateDirector(camera: PerspectiveCamera, delta: number) {
  const shot = director.shot
  if (!shot) return
  if (!shot.ready) init(shot, camera)
  shot.t += delta
  if (shot.ending < 0 && shot.duration > 0 && shot.t >= shot.duration) endShot()
  if (shot.ending >= 0 && shot.t - shot.ending >= VEIL_SECONDS) {
    finish(shot, camera)
    return
  }
  if (shot.kind === 'viewpoint') poseViewpoint(shot, camera)
  else poseMeditation(shot, camera, delta)
}
