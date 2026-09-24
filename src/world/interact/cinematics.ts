import { CatmullRomCurve3, MathUtils, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { useUiStore } from '../../ui/uiStore'
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
  kind: ShotKind; site: SiteSpec
  /** Seconds; 0 = runs until `endShot()`. */
  duration: number
  t: number; ready: boolean
  /** Time the exit veil started, or −1 while playing. */
  ending: number
  fromPos: Vector3; fromLook: Vector3; fromFov: number
  curve: CatmullRomCurve3 | null
  orbitAngle: number
  onEnd: (() => void) | null
}

const VEIL_SECONDS = 0.42
export const director = { shot: null as Shot | null }

const look = new Vector3(), target = new Vector3(), dir = new Vector3(), side = new Vector3(), pos = new Vector3()
const smoother = (x: number) => { const t = MathUtils.clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10) }

export function startShot(kind: ShotKind, site: SiteSpec, duration: number, onEnd: (() => void) | null = null) {
  director.shot = {
    kind, site, duration, t: 0, ready: false, ending: -1,
    fromPos: new Vector3(), fromLook: new Vector3(), fromFov: 72, curve: null, orbitAngle: 0, onEnd,
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
  const [sx, sy, sz] = shot.site.position, [fx, , fz] = shot.site.faceToward
  if (shot.kind === 'viewpoint') {
    dir.set(fx - sx, 0, fz - sz).normalize()
    side.set(-dir.z, 0, dir.x)
    const base = new Vector3(sx, sy, sz)
    const point = (up: number, forward: number, lateral: number) => base.clone().addScaledVector(dir, forward).addScaledVector(side, lateral).setY(sy + up)
    const points = [shot.fromPos.clone(), point(5, -4, 2), point(14, 22, 8), point(28, 55, -6)]
    // Never dip into terrain or the platform along the sweep.
    for (const p of points) { const ground = groundHeight(p.x, p.z, p.y + 2); if (ground !== null) p.y = Math.max(p.y, ground + 2) }
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
  target.addScaledVector(side.set(-(fz - shot.site.position[2]), 0, fx - shot.site.position[0]).normalize(), Math.sin(u * Math.PI) * 18)
  look.lerpVectors(shot.fromLook, target, smoother(u / 0.42))
  camera.position.copy(pos)
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
  const radius = Math.min(15, 5.5 + t * 0.9), height = Math.min(7.5, 2.2 + t * 0.5)
  pos.set(centre.x + Math.cos(shot.orbitAngle) * radius, centre.y + height, centre.z + Math.sin(shot.orbitAngle) * radius)
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

/** Puts the camera where the player rig would (behind and above the player) so the hand-back is seamless. */
export function handBack(camera: PerspectiveCamera) {
  const runtime = getPlayerRuntime()
  const fov = useWorldStore.getState().fov
  if (runtime) {
    const p = runtime.position, fx = Math.sin(runtime.yaw), fz = -Math.cos(runtime.yaw)
    camera.position.set(p.x - fx * 4.8, p.y + 2.75, p.z - fz * 4.8)
    camera.lookAt(p.x + fx * 3, p.y + 1.05 + Math.tan(runtime.pitch) * 7, p.z + fz * 3)
    const previous = camera.userData.followPrevious as Vector3 | undefined
    if (previous) previous.copy(p)
  }
  camera.fov = fov
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
  if (shot.ending >= 0 && shot.t - shot.ending >= VEIL_SECONDS) { finish(shot, camera); return }
  if (shot.kind === 'viewpoint') poseViewpoint(shot, camera)
  else poseMeditation(shot, camera, delta)
}

