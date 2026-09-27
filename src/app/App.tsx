import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { World } from '../world/World'
import { DebugHud } from '../world/debug/DebugHud'
import { mixer } from '../world/audio/mixer'
import { useWorldStore } from '../world/store'
import { CHARACTER_ASSETS } from '../world/player/characterAssets'
import { PHASE_LABELS } from '../world/player/playerMotion'
import { playerAudio } from '../world/player/playerAudio'
import { getPlayerRuntime, teleportPlayer } from '../world/player/playerHandle'
import { enterPhoto, exitPhoto, photo, requestLock, uiBridge } from '../ui/bridge'
import { CharacterPicker } from '../ui/CharacterPicker'
import { Hud } from '../ui/Hud'
import { IntroScreen } from '../ui/IntroScreen'
import { Modals } from '../ui/Modals'
import { PhotoMode } from '../ui/PhotoMode'
import { applySave, loadSave, startAutosave } from '../ui/save'
import type { SavedPosition } from '../ui/save'
import { SettingsMenu } from '../ui/SettingsMenu'
import { dismissOverlay, showOverlay, useUiStore } from '../ui/uiStore'
import type { Overlay } from '../ui/uiStore'
import { useUiKeys } from '../ui/useUiKeys'

function routeStage(z: number) {
  if (z > 64) return { name: '山门前路', number: '01 / 04', progress: 12, next: '目标 · 穿山门，登主平台，接近主殿' }
  if (z > 20) return { name: '穿越山门', number: '02 / 04', progress: 32, next: '目标 · 沿长阶而上，直抵主平台' }
  if (z > -65) return { name: '登临长阶', number: '03 / 04', progress: 58, next: '目标 · 登顶长阶，入云阙广场' }
  return { name: '主平台 · 云阙', number: '04 / 04', progress: 100, next: '自由探索 · 灵光、碑文、观景台与传送阵' }
}
/** The route card announces each stage, then fades so the view stays clear. */
const ROUTE_CARD_SECONDS = 7
/** The full key strip shows for the first minute of play; afterwards only the everyday keys stay. */
const FULL_CONTROLS_SECONDS = 45

const CONTROLS: [string, string][] = [
  ['W A S D', '移动'], ['MOUSE', '视角'], ['SHIFT', '加速'], ['F', '召剑 / 落地'], ['SPACE / C', '升降'],
  ['E', '交互'], ['TAB', '卷轴'], ['P', '拍照'], ['H', '隐藏'], ['ESC', '设置'], ['M', '音效'],
]
const COMPACT_CONTROLS: [string, string][] = [['E', '交互'], ['TAB', '卷轴'], ['P', '拍照'], ['H', '隐藏界面'], ['ESC', '设置与操作']]

/** Telemetry-driven HUD cards (re-render with telemetry; the modal/UI layers live beside it). */
function Interface() {
  const started = useWorldStore((state) => state.started)
  const telemetry = useWorldStore((state) => state.telemetry)
  const assets = useWorldStore((state) => state.assets)
  const character = useWorldStore((state) => state.character)
  const characterReady = useWorldStore((state) => state.characterReady[state.character])
  const phase = useWorldStore((state) => state.phase)
  const notice = useWorldStore((state) => state.notice)
  const soundEnabled = useWorldStore((state) => state.soundEnabled)
  const toggleSound = useWorldStore((state) => state.toggleSound)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  const hudHidden = useUiStore((state) => state.hudHidden)
  const { active, progress } = useProgress()
  const aboard = !!getPlayerRuntime()?.aboard
  const route = aboard ? { name: '鲲背 · 云上巡游', number: '随鲲而行', progress: 100, next: '自由探索 · 拾取灵光，F 召剑离开' } : routeStage(telemetry.position[2])
  const ready = Object.keys(assets).length === 3
  // H hides the HUD; photo mode and cinematic shots clear the screen on their own.
  const hud = started && !hudHidden && cameraMode === 'player'
  const [routeShown, setRouteShown] = useState(true)
  const [fullControls, setFullControls] = useState(true)
  useEffect(() => {
    if (!started) return
    setRouteShown(true)
    const timer = window.setTimeout(() => setRouteShown(false), ROUTE_CARD_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [route.number, started])
  useEffect(() => {
    if (!started) return
    const timer = window.setTimeout(() => setFullControls(false), FULL_CONTROLS_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [started])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => useWorldStore.getState().setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  return (
    <>
      {(!started || hud) && <header className="topbar">
        {started && <>
          <div className="brand-mark">云</div>
          <div className="brand-copy"><strong>云阙仙宗</strong><span>CELESTIAL SECT · ABOVE THE CLOUD SEA</span></div>
        </>}
        {!started && <div className="topbar-right"><span className="status-dot" />{ready ? 'WORLD READY' : active ? `LOADING ${Math.round(progress)}%` : 'PREPARING WORLD'}</div>}
      </header>}

      {hud && <>
        <div className="crosshair" aria-hidden="true"><i /><i /></div>
        <div className="route-card" data-shown={routeShown} aria-hidden={!routeShown}>
          <div className="eyebrow">PILGRIMAGE ROUTE <span>{route.number}</span></div>
          <strong>{route.name}</strong>
          <div className="route-bar"><span style={{ width: `${route.progress}%` }} /></div>
          <div className="route-next">{route.next}</div>
        </div>
        <div className="character-dock">
          <button className="sound-button" aria-pressed={soundEnabled} onClick={toggleSound} aria-label={soundEnabled ? '关闭声音' : '开启声音'}>{soundEnabled ? '♪ 音效开' : '♪ 音效关'} <kbd>M</kbd></button>
          <CharacterPicker />
        </div>
        <div className="mode-card" data-phase={phase}><span className="mode-icon">{telemetry.mode === 'FLIGHT' ? '↗' : '⌁'}</span><div><small>TRAVEL MODE</small><b>{PHASE_LABELS[phase]}</b></div><em>{phase === 'GROUND' ? 'F 召剑' : phase === 'FLIGHT' ? 'F 落地' : phase === 'LANDING' ? 'F 取消' : '聚气中'}</em></div>
        <div className="controls" aria-label="操作提示">{(fullControls ? CONTROLS : COMPACT_CONTROLS).map(([key, action], i) => <span key={key} className="control-item">{i > 0 && <i />}{key} <span>{action}</span></span>)}</div>
      </>}
      {started && !hudHidden && cameraMode !== 'photo' && (!characterReady || notice) && <div className="player-notice" role="status">{!characterReady ? `正在载入${CHARACTER_ASSETS[character].name}与佩剑… ${Math.round(progress)}%` : notice}</div>}

    </>
  )
}

/** DEV-only handles for headless verification (`window.__ui`). */
function exposeUiHooks() {
  const target = window as Window & { __ui?: unknown }
  target.__ui = {
    state: () => {
      const ui = useUiStore.getState(), world = useWorldStore.getState()
      return {
        overlay: ui.overlay, nearby: ui.nearby, hudHidden: ui.hudHidden, caption: ui.caption, photoFilter: ui.photoFilter,
        orbs: ui.orbs.length, steles: ui.steles.length, viewpoints: ui.viewpoints.length, arrays: ui.arrays.length,
        cameraMode: world.cameraMode, locked: world.locked, started: world.started,
        fov: world.fov, timeScale: world.timeScale, timePaused: world.timePaused, autoWeather: world.autoWeather, weather: world.weather, quality: world.quality,
        settingsOpen: document.querySelector('.settings-dialog') !== null, photos: photo.count,
      }
    },
    setDevInput: (value: boolean) => useUiStore.getState().setDevInput(value),
    open: (overlay: Overlay) => showOverlay(overlay),
    dismiss: dismissOverlay,
    enterPhoto, exitPhoto,
    capture: () => { photo.capture = true },
    setHudHidden: (value: boolean) => useUiStore.getState().setHudHidden(value),
  }
  return () => { delete target.__ui }
}

export default function App() {
  const setLocked = useWorldStore((state) => state.setLocked)
  const setStarted = useWorldStore((state) => state.setStarted)
  const started = useWorldStore((state) => state.started)
  const [save] = useState(loadSave)
  useEffect(() => { if (save) applySave(save) }, [save])
  useEffect(() => startAutosave(), [])
  useEffect(() => {
    mixer.setMuted(!useWorldStore.getState().soundEnabled)
    return useWorldStore.subscribe((state, previous) => { if (state.soundEnabled !== previous.soundEnabled) mixer.setMuted(!state.soundEnabled) })
  }, [])
  useEffect(() => {
    const onChange = () => setLocked(uiBridge.canvas !== null && document.pointerLockElement === uiBridge.canvas)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [setLocked])
  useEffect(() => import.meta.env.DEV ? exposeUiHooks() : undefined, [])
  useUiKeys()
  const enter = (resume: SavedPosition | null = null) => {
    playerAudio.unlock()
    const first = !useWorldStore.getState().started
    setStarted(true)
    requestLock()
    if (!first || !resume) return
    const ok = teleportPlayer([resume.x, resume.y + 0.2, resume.z], resume.yaw)
    useWorldStore.getState().setNotice(ok ? '已回到上次停留之处' : '未能回到上次停留处，已自山门启程')
  }
  return (
    <main className="app-shell">
      <Canvas
        // Anti-aliasing, tone mapping and fog happen in the post-processing chain.
        gl={{ antialias: false, stencil: false, powerPreference: 'high-performance' }}
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={{ position: [0, 3, 154], fov: 72, near: 0.08, far: 8000 }}
        onCreated={({ gl }) => { uiBridge.canvas = gl.domElement }}
        onPointerDown={() => {
          const world = useWorldStore.getState()
          if (world.started && !world.locked && world.cameraMode === 'player' && !useUiStore.getState().overlay) enter()
        }}
      >
        <World />
      </Canvas>
      <div className="interface">
        <Interface />
        <Hud />
        <PhotoMode />
        <Modals />
        <SettingsMenu />
        {!started && <IntroScreen saved={save?.position ?? null} onEnter={enter} />}
        <DebugHud />
      </div>
    </main>
  )
}
