import { useWorldStore } from '../world/store'
import { mixer } from '../world/audio/mixer'
import { useUiStore } from './uiStore'

/**
 * Mutable per-frame values shared between the R3F scene and DOM widgets (compass, map) that update
 * themselves in requestAnimationFrame, so camera motion never re-renders React.
 */
export const uiBridge = {
  canvas: null as HTMLCanvasElement | null,
  graphicsBlocked: false,
  /** Camera heading in radians: 0 = north (−z), π/2 = east (+x). */
  heading: 0,
  camera: { x: 0, y: 0, z: 0 },
}

/** Re-acquires pointer lock on the game canvas (needs a user gesture unless the lock was released by script). */
export function requestLock() {
  if (uiBridge.graphicsBlocked) return
  mixer.unlock()
  // R3F may replace the canvas after a remount; never request a lock on a detached element.
  const canvas = uiBridge.canvas?.isConnected ? uiBridge.canvas : document.querySelector('canvas')
  uiBridge.canvas = canvas
  if (!canvas || document.pointerLockElement === canvas) return
  const refused = () => useUiStore.setState({ lockError: '视角锁定未成功，请稍候再点击继续' })
  try {
    const result: unknown = canvas.requestPointerLock()
    if (result instanceof Promise) result.catch(refused)
  } catch {
    refused()
  }
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock()
}

/** Signed smallest angle a − b in (−π, π]. */
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Compass bearing from (x, z) toward (tx, tz); same convention as `uiBridge.heading`. */
export const bearing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, -(tz - z))

export interface PhotoInfo { name: string; width: number; height: number; bytes: number; filter: string }

/** Photo-mode input gathered by the DOM layer and consumed by the free camera each frame. */
export const photo = {
  keys: new Set<string>(),
  dx: 0, dy: 0,
  /** Accumulated wheel steps (positive = zoom out). */
  zoom: 0,
  /** Set to request a PNG of the next rendered frame. */
  capture: false,
  count: 0,
  last: null as PhotoInfo | null,
}

export function enterPhoto() {
  photo.keys.clear(); photo.dx = 0; photo.dy = 0; photo.zoom = 0
  useWorldStore.getState().setCameraMode('photo')
}

export function exitPhoto(lostLock = false) {
  photo.keys.clear(); photo.capture = false
  if (useWorldStore.getState().cameraMode === 'photo') useWorldStore.getState().setCameraMode('player')
  if (lostLock) {
    useUiStore.setState({ photoUnlocked: true })
    useWorldStore.getState().setNotice('已退出拍照，点击画面继续；Esc 打开设置')
  }
}
