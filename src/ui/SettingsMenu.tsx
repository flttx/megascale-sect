import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { mixer } from '../world/audio/mixer'
import type { VolumeChannel } from '../world/audio/mixer'
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../world/quality'
import { useShallow } from 'zustand/react/shallow'
import { useWorldStore } from '../world/store'
import { getHours } from '../world/weather/timeOfDay'
import { WEATHER_LABELS } from '../world/weather/weatherMachine'
import { requestLock } from './bridge'
import { Dialog } from './Dialog'
import { useUiStore } from './uiStore'

const TIME_SCALES: [number, string][] = [[0, '静止'], [0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']]
const CHANNELS: [VolumeChannel, string][] = [['master', '总音量'], ['music', '乐曲'], ['ambience', '环境'], ['sfx', '音效']]
const CONTROLS: [string, string][] = [
  ['W A S D', '行走 / 御剑'], ['鼠标', '视角'], ['Shift', '疾行 / 加速'], ['Space · C', '跃起 · 升降'], ['F', '召剑 / 落地'], ['X', '刹停'],
  ['Alt', '环视'], ['E', '交互'], ['Tab', '卷轴'], ['P', '拍照'], ['H', '隐藏界面'], ['M', '音效'], ['1 · 2', '换人'], ['Esc', '设置'],
]

/**
 * Pause / settings menu. Replaces the old 「点击继续」 button: it appears when pointer lock is lost in play
 * (and no modal or scripted camera owns the screen), and Resume takes the mouse back.
 */
export function SettingsMenu() {
  const started = useWorldStore((state) => state.started)
  const locked = useWorldStore((state) => state.locked)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  const overlay = useUiStore((state) => state.overlay)
  const devInput = useUiStore((state) => state.devInput)
  const wanted = started && !locked && !overlay && cameraMode === 'player' && !devInput
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!wanted) { setOpen(false); return }
    // Overlays and shots hand the lock back asynchronously; wait a beat so they don't flash the menu.
    const timer = window.setTimeout(() => setOpen(true), 180)
    return () => window.clearTimeout(timer)
  }, [wanted])
  if (!open || !wanted) return null
  return <SettingsPanel />
}

function Row({ label, en, children }: { label: string; en: string; children: ReactNode }) {
  return <div className="settings-row"><span className="settings-label">{label}<small>{en}</small></span><div className="settings-control">{children}</div></div>
}

function Slider({ label, min, max, step, value, format, onChange }: {
  label: string; min: number; max: number; step: number; value: number; format: (value: number) => string; onChange: (value: number) => void
}) {
  const id = useId()
  return <span className="settings-slider">
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={format(value)}
      onChange={(event) => onChange(Number(event.currentTarget.value))} />
    <output htmlFor={id}>{format(value)}</output>
  </span>
}

function Clock() {
  const [hours, setHoursState] = useState(getHours)
  useEffect(() => {
    const timer = window.setInterval(() => setHoursState(getHours()), 500)
    return () => window.clearInterval(timer)
  }, [])
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60)
  return <b className="settings-clock">{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}</b>
}

function SettingsPanel() {
  // Only the settings fields: the store also carries telemetry that changes several times a second.
  const world = useWorldStore(useShallow((s) => ({
    quality: s.quality, autoQuality: s.autoQuality, setQuality: s.setQuality, fov: s.fov, setFov: s.setFov,
    mouseSensitivity: s.mouseSensitivity, setMouseSensitivity: s.setMouseSensitivity, soundEnabled: s.soundEnabled,
    toggleSound: s.toggleSound, weather: s.weather, timeScale: s.timeScale, setTimeScale: s.setTimeScale,
    timePaused: s.timePaused, setTimePaused: s.setTimePaused, autoWeather: s.autoWeather, setAutoWeather: s.setAutoWeather,
  })))
  const volumes = useUiStore((state) => state.volumes)
  const setVolume = (channel: VolumeChannel, value: number) => {
    useUiStore.getState().setVolumes({ ...useUiStore.getState().volumes, [channel]: value })
    mixer.setVolume(channel, value)
  }
  const percent = (v: number) => `${Math.round(v * 100)}%`
  // Pointer lock needs a user gesture and Esc is not one, so Esc only returns focus to 继续 (Enter or a click resumes).
  const focusResume = () => document.querySelector<HTMLElement>('.settings-resume')?.focus({ preventScroll: true })
  return <Dialog title="暂停 · 设置" hideTitle className="panel-dialog settings-dialog" onClose={requestLock} onEscape={focusResume}>
    <header className="settings-head">
      <div><small>PAUSED · SETTINGS</small><strong>暂停 · 设置</strong></div>
      <button className="settings-resume" data-autofocus onClick={requestLock} aria-label="继续游戏并锁定视角">继续 <span aria-hidden="true">→</span></button>
    </header>
    <div className="settings-grid">
      <section className="settings-section" aria-label="画面">
        <h3>画面 <small>DISPLAY</small></h3>
        <Row label="画质" en="QUALITY">
          <div className="segmented" role="group" aria-label="画质档位">
            {QUALITY_LEVELS.map((level) => <button key={level} aria-pressed={world.quality === level}
              onClick={() => world.setQuality(level, world.autoQuality)}>{QUALITY_PRESETS[level].label}</button>)}
          </div>
          <button className="toggle" aria-pressed={world.autoQuality} onClick={() => world.setQuality(world.quality, !world.autoQuality)}
            aria-label="自动降档：帧率不足时自动调低画质">自动</button>
        </Row>
        <Row label="视野" en="FOV">
          <Slider label="视野角度" min={55} max={90} step={1} value={world.fov} format={(v) => `${v}°`} onChange={world.setFov} />
        </Row>
        <Row label="灵敏度" en="MOUSE">
          <Slider label="鼠标灵敏度" min={0.2} max={3} step={0.05} value={world.mouseSensitivity} format={(v) => `${v.toFixed(2)}×`} onChange={world.setMouseSensitivity} />
        </Row>
      </section>
      <section className="settings-section" aria-label="声音">
        <h3>声音 <small>AUDIO</small></h3>
        <Row label="静音" en="MUTE">
          <button className="toggle" aria-pressed={!world.soundEnabled} onClick={world.toggleSound} aria-label="静音">{world.soundEnabled ? '有声' : '已静音'} <kbd>M</kbd></button>
        </Row>
        {CHANNELS.map(([channel, label]) => <Row key={channel} label={label} en={channel.toUpperCase()}>
          <Slider label={`${label}音量`} min={0} max={1} step={0.05} value={volumes[channel]} format={percent} onChange={(v) => setVolume(channel, v)} />
        </Row>)}
      </section>
      <section className="settings-section" aria-label="天时">
        <h3>天时 <small>TIME · WEATHER</small></h3>
        <Row label="时辰" en="CLOCK"><Clock /><span className="settings-note">{WEATHER_LABELS[world.weather]}</span></Row>
        <Row label="流速" en="TIME SCALE">
          <div className="segmented" role="group" aria-label="时间流速">
            {TIME_SCALES.map(([scale, label]) => <button key={scale} aria-pressed={world.timeScale === scale} onClick={() => world.setTimeScale(scale)}>{label}</button>)}
          </div>
        </Row>
        <Row label="暂停时间" en="PAUSE">
          <button className="toggle" aria-pressed={world.timePaused} onClick={() => world.setTimePaused(!world.timePaused)} aria-label="暂停昼夜流转">{world.timePaused ? '已暂停' : '流转中'}</button>
        </Row>
        <Row label="天象" en="WEATHER">
          <button className="toggle" aria-pressed={world.autoWeather} onClick={() => world.setAutoWeather(!world.autoWeather)} aria-label="自动变换天象">{world.autoWeather ? '自然流转' : '固定'}</button>
        </Row>
      </section>
      <section className="settings-section settings-keys" aria-label="操作说明">
        <h3>操作 <small>CONTROLS</small></h3>
        <dl>{CONTROLS.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}</dl>
      </section>
    </div>
    <footer className="settings-foot"><span>设置自动保存于本机</span><span><kbd>Esc</kbd> 再 <kbd>Enter</kbd>，或点击空白处继续</span></footer>
  </Dialog>
}
