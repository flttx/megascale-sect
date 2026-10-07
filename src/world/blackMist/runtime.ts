import { create } from 'zustand'
import { releaseLock, requestLock } from '../../ui/bridge'
import { useUiStore } from '../../ui/uiStore'
import { director } from '../interact/cinematics'
import { resetCameraRig } from '../player/CameraRig'
import { teleportPlayer } from '../player/playerHandle'
import { useWorldStore } from '../store'
import { BLACK_MIST_UNIFORMS } from './materials'
import { blackMistAudio } from './audio'
import { preloadEldritchAssets, useEldritchLoadingStore } from './eldritchLoading'

export type BlackMistPhase = 'horizon' | 'approach' | 'impact' | 'transformation' | 'aftermath'
export const BLACK_MIST_DURATION = 68
export const BLACK_MIST_SPAWN = [0, 24, -116] as const
const ramp = (time: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

export const blackMistRuntime = {
  active: false,
  cinematic: false,
  paused: false,
  manualPaused: false,
  awaitingExplore: false,
  elapsed: 0,
  corruption: 0,
  front: 2600,
  phase: 'horizon' as BlackMistPhase,
  serial: 0,
  testHeld: false,
  motionTime: 0,
  motionPaused: false,
  testMotionHeld: false,
}
export interface BlackMistSnapshot {
  cinematic: boolean
  paused: boolean
  manualPaused: boolean
  awaitingExplore: boolean
  phase: BlackMistPhase
  elapsed: number
  corruption: number
}
export const useBlackMistStore = create<BlackMistSnapshot>(() => ({
  cinematic: false,
  paused: false,
  manualPaused: false,
  awaitingExplore: false,
  phase: 'horizon',
  elapsed: 0,
  corruption: 0,
}))
let publishedSecond = -1
export function publishBlackMist(force = false) {
  const r = blackMistRuntime,
    snapshot = useBlackMistStore.getState(),
    second = Math.floor(r.elapsed)
  if (
    !force &&
    second === publishedSecond &&
    snapshot.phase === r.phase &&
    snapshot.paused === r.paused &&
    snapshot.cinematic === r.cinematic
  )
    return
  publishedSecond = second
  useBlackMistStore.setState({
    phase: r.phase,
    cinematic: r.cinematic,
    paused: r.paused,
    manualPaused: r.manualPaused,
    awaitingExplore: r.awaitingExplore,
    elapsed: r.elapsed,
    corruption: r.corruption,
  })
}
function deriveTimeline() {
  const r = blackMistRuntime,
    t = r.elapsed
  r.phase = t < 10 ? 'horizon' : t < 26 ? 'approach' : t < 40 ? 'impact' : t < 58 ? 'transformation' : 'aftermath'
  r.front = 2600 - 6200 * ramp(t, 8, 43)
  r.corruption = ramp(t, 26, 56)
}
export function resetBlackMist() {
  preloadEldritchAssets()
  blackMistAudio.dispose()
  releaseLock()
  director.shot = null
  useUiStore.setState({
    overlay: null,
    caption: null,
    veil: false,
    photoUnlocked: false,
    hudHidden: false,
    lockError: null,
  })
  Object.assign(blackMistRuntime, {
    active: true,
    cinematic: true,
    paused: false,
    manualPaused: false,
    awaitingExplore: false,
    elapsed: 0,
    corruption: 0,
    front: 2600,
    phase: 'horizon',
    testHeld: false,
    motionTime: 0,
    motionPaused: false,
    testMotionHeld: false,
    serial: blackMistRuntime.serial + 1,
  })
  const world = useWorldStore.getState()
  world.setGameMode('black-mist')
  world.setCameraMode('cinematic')
  world.setNotice(null)
  // Replay is refused by the HUD mid takeoff/landing; every accepted start begins on the safe plaza.
  teleportPlayer(BLACK_MIST_SPAWN, 0)
  resetCameraRig()
  publishBlackMist(true)
}
export function stopBlackMist() {
  blackMistAudio.dispose()
  Object.assign(blackMistRuntime, {
    active: false,
    cinematic: false,
    paused: false,
    manualPaused: false,
    awaitingExplore: false,
    elapsed: 0,
    corruption: 0,
    front: 2600,
    phase: 'horizon',
    testHeld: false,
    motionTime: 0,
    motionPaused: false,
    testMotionHeld: false,
  })
  BLACK_MIST_UNIFORMS.uMistCorruption.value = 0
  BLACK_MIST_UNIFORMS.uMistAmount.value = 0
  BLACK_MIST_UNIFORMS.uMistFlash.value = 0
  useWorldStore.getState().setGameMode('exploration')
  if (useWorldStore.getState().cameraMode === 'cinematic') useWorldStore.getState().setCameraMode('player')
  resetCameraRig()
  publishBlackMist(true)
}
function finishCinematic() {
  const r = blackMistRuntime
  r.elapsed = BLACK_MIST_DURATION
  r.cinematic = false
  r.manualPaused = false
  r.paused = false
  r.awaitingExplore = true
  r.testHeld = false
  r.testMotionHeld = false
  r.motionTime = Math.max(r.motionTime, BLACK_MIST_DURATION)
  deriveTimeline()
  teleportPlayer(BLACK_MIST_SPAWN, 0)
  resetCameraRig()
  useWorldStore.getState().setCameraMode('player')
  publishBlackMist(true)
}
export function skipBlackMistCinematic() {
  if (!blackMistRuntime.active || !blackMistRuntime.cinematic || useEldritchLoadingStore.getState().status !== 'ready')
    return
  finishCinematic()
}
export function beginBlackMistExploration() {
  if (!blackMistRuntime.active || blackMistRuntime.cinematic) return
  blackMistRuntime.awaitingExplore = false
  publishBlackMist(true)
  requestLock()
}
export function setBlackMistPaused(value: boolean) {
  if (!blackMistRuntime.cinematic) return
  blackMistRuntime.manualPaused = value
  blackMistRuntime.paused = value
  publishBlackMist(true)
}
export function stepBlackMist(delta: number) {
  const r = blackMistRuntime
  if (!r.active || r.paused || r.testHeld || !Number.isFinite(delta) || delta <= 0) {
    publishBlackMist()
    return
  }
  r.elapsed += Math.min(delta, 0.1)
  if (r.cinematic && r.elapsed >= BLACK_MIST_DURATION) finishCinematic()
  else {
    deriveTimeline()
    publishBlackMist()
  }
}

/** Living anatomy keeps moving in the aftermath even before the player acquires pointer lock. */
export function stepBlackMistMotion(delta: number) {
  const r = blackMistRuntime
  if (!r.active || r.motionPaused || r.testMotionHeld || !Number.isFinite(delta) || delta <= 0) return
  r.motionTime += Math.min(delta, 0.05)
}

/** Controlled-clock verification uses the same timeline; no DEV scene mutation bypasses its effects. */
export function seekBlackMist(seconds: number) {
  if (!import.meta.env.DEV || !blackMistRuntime.active || !Number.isFinite(seconds)) return
  blackMistRuntime.elapsed = Math.max(0, Math.min(BLACK_MIST_DURATION, seconds))
  blackMistRuntime.motionTime = blackMistRuntime.elapsed
  deriveTimeline()
  if (seconds >= BLACK_MIST_DURATION) finishCinematic()
  publishBlackMist(true)
}
