import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { World } from '../world/World'
import { DebugHud } from '../world/debug/DebugHud'
import { useWorldStore } from '../world/store'
import { CHARACTER_ASSETS, type CharacterId } from '../world/player/characterAssets'
import { PHASE_LABELS } from '../world/player/playerMotion'
import { playerAudio } from '../world/player/playerAudio'

function CharacterPicker() {
  const character = useWorldStore((state) => state.character)
  const phase = useWorldStore((state) => state.phase)
  const select = useWorldStore((state) => state.selectCharacter)
  return <div className="character-picker" aria-label="选择角色">
    {(['male', 'female'] as CharacterId[]).map((id) => <button key={id}
      aria-pressed={character === id} disabled={!['GROUND', 'FLIGHT'].includes(phase)}
      onClick={() => select(id)}><kbd>{CHARACTER_ASSETS[id].key}</kbd>{CHARACTER_ASSETS[id].name}</button>)}
  </div>
}

function routeStage(z: number) {
  if (z > 64) return { name: '山门前路', number: '01 / 04', progress: 12 }
  if (z > 20) return { name: '穿越山门', number: '02 / 04', progress: 32 }
  if (z > -65) return { name: '登临长阶', number: '03 / 04', progress: 58 }
  return { name: '主平台 · 云阙', number: '04 / 04', progress: 100 }
}

function Interface({ enter }: { enter: () => void }) {
  const started = useWorldStore((state) => state.started)
  const locked = useWorldStore((state) => state.locked)
  const telemetry = useWorldStore((state) => state.telemetry)
  const assets = useWorldStore((state) => state.assets)
  const character = useWorldStore((state) => state.character)
  const characterReady = useWorldStore((state) => state.characterReady[state.character])
  const phase = useWorldStore((state) => state.phase)
  const notice = useWorldStore((state) => state.notice)
  const soundEnabled = useWorldStore((state) => state.soundEnabled)
  const toggleSound = useWorldStore((state) => state.toggleSound)
  const { active, progress } = useProgress()
  const route = routeStage(telemetry.position[2])
  const ready = Object.keys(assets).length === 3
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => useWorldStore.getState().setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  return (
    <div className="interface">
      <header className="topbar">
        <div className="brand-mark">云</div>
        <div className="brand-copy"><strong>云阙仙宗</strong><span>MEGASCALE SECT · FIELD PROTOTYPE</span></div>
        <div className="topbar-right"><span className="status-dot" />{ready ? 'WORLD READY' : active ? `LOADING ${Math.round(progress)}%` : 'PREPARING WORLD'}</div>
      </header>

      <div className="crosshair" aria-hidden="true"><i /><i /></div>

      <div className="route-card">
        <div className="eyebrow">PILGRIMAGE ROUTE <span>{route.number}</span></div>
        <strong>{route.name}</strong>
        <div className="route-bar"><span style={{ width: `${route.progress}%` }} /></div>
        <div className="route-next">目标 · 穿山门，登主平台，接近主殿</div>
      </div>

      <div className="character-dock">
        <button className="sound-button" aria-pressed={soundEnabled} onClick={toggleSound}>{soundEnabled ? '♪ 音效开' : '♪ 音效关'} <kbd>M</kbd></button>
        <small>{CHARACTER_ASSETS[character].name} · 本命佩剑</small>
        <CharacterPicker />
      </div>
      <div className="mode-card" data-phase={phase}><span className="mode-icon">{telemetry.mode === 'FLIGHT' ? '↗' : '⌁'}</span><div><small>TRAVEL MODE</small><b>{PHASE_LABELS[phase]}</b></div><em>{phase === 'GROUND' ? 'F 召剑' : phase === 'FLIGHT' ? 'F 落地' : phase === 'LANDING' ? 'F 取消' : '聚气中'}</em></div>
      {started && (!characterReady || notice) && <div className="player-notice" role="status">{!characterReady ? `正在载入${CHARACTER_ASSETS[character].name}与佩剑… ${Math.round(progress)}%` : notice}</div>}

      <div className="controls">W A S D <span>移动</span><i /> MOUSE <span>视角</span><i /> ALT <span>环视</span><i /> SHIFT <span>加速</span><i /> X <span>刹停</span><i /> F <span>召剑 / 落地</span><i /> SPACE / C <span>升降</span><i /> 1 / 2 <span>换人</span><i /> M <span>音效</span><i /> F3 <span>数据</span></div>

      {!started && (
        <div className="intro-screen">
          <div className="intro-panel">
            <div className="intro-kicker"><span /> 云端 · 巨构实境漫游</div>
            <h1>入山，<br /><em>见天地。</em></h1>
            <p>以一人之躯，丈量四百二十米的云阙。沿石道穿过山门，登阶入宗，或御空绕行高殿。</p>
            <CharacterPicker />
            <button className="enter-button" onClick={enter} disabled={!ready || !characterReady}>{ready && characterReady ? '进入仙宗' : `载入仙宗 ${Math.round(progress)}%`} <span>→</span></button>
            <div className="intro-meta"><span>MG01 · 主殿 420m</span><span>MG02 · 山门 56m</span><span>MG04 · 侧塔 6座</span></div>
          </div>
          <div className="intro-side">WORLD 01 <span>—</span> PROTOTYPE</div>
        </div>
      )}
      {started && !locked && <button className="resume-button" onClick={enter}>点击继续控制视角 <span>↗</span></button>}
      <DebugHud />
    </div>
  )
}

export default function App() {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const setLocked = useWorldStore((state) => state.setLocked)
  const setStarted = useWorldStore((state) => state.setStarted)
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement === canvas.current)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [setLocked])
  const enter = () => {
    playerAudio.unlock()
    setStarted(true)
    canvas.current?.requestPointerLock()
  }
  return (
    <main className="app-shell">
      <Canvas
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 3, 154], fov: 72, near: 0.08, far: 2500 }}
        onCreated={({ gl }) => { canvas.current = gl.domElement }}
        onPointerDown={() => { if (useWorldStore.getState().started && !useWorldStore.getState().locked) enter() }}
      >
        <World />
      </Canvas>
      <Interface enter={enter} />
    </main>
  )
}
