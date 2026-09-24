import { useEffect, useRef, useState } from 'react'
import { useWorldStore } from '../world/store'
import { photo, uiBridge } from './bridge'
import { PHOTO_FILTER_CSS, PHOTO_FILTER_LABELS, PHOTO_FILTERS, useUiStore } from './uiStore'

const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'shift']

/** Cycles to the next photo look (F). */
function cyclePhotoFilter() {
  const ui = useUiStore.getState()
  ui.setPhotoFilter(PHOTO_FILTERS[(PHOTO_FILTERS.indexOf(ui.photoFilter) + 1) % PHOTO_FILTERS.length])
}

/**
 * Photo mode overlay (P): filter chips, vignette, key hints and the shot counter. Feeds keyboard, mouse
 * and wheel input into `photo` for the free camera, and tints the live canvas with the chosen look.
 */
export function PhotoMode() {
  const active = useWorldStore((state) => state.cameraMode === 'photo')
  const filter = useUiStore((state) => state.photoFilter)
  const vignette = useUiStore((state) => state.photoVignette)
  const hidden = useUiStore((state) => state.hudHidden)
  const shutterKey = useUiStore((state) => state.shutterKey)
  const [saved, setSaved] = useState<{ count: number; name: string } | null>(null)
  const seen = useRef(photo.count)

  useEffect(() => {
    const canvas = uiBridge.canvas
    if (!canvas) return
    canvas.style.filter = active ? PHOTO_FILTER_CSS[filter] : ''
    return () => { canvas.style.filter = '' }
  }, [active, filter])

  useEffect(() => {
    if (!shutterKey) return
    // PNGs are encoded asynchronously (slower on large canvases): watch for 4 s so a burst's later shots land too.
    let tries = 0
    const timer = window.setInterval(() => {
      const last = photo.last
      if (photo.count !== seen.current && last) { seen.current = photo.count; setSaved({ count: photo.count, name: last.name }) }
      if (++tries >= 40) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [shutterKey])

  useEffect(() => {
    if (!active) return
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (MOVE_KEYS.includes(key)) { photo.keys.add(key); event.preventDefault(); return }
      if (event.repeat) return
      if (key === 'f') { cyclePhotoFilter(); event.preventDefault() }
      else if (key === 'v') { useUiStore.getState().setPhotoVignette(!useUiStore.getState().photoVignette); event.preventDefault() }
      else if (key === 'enter') { photo.capture = true; event.preventDefault() }
    }
    const up = (event: KeyboardEvent) => { photo.keys.delete(event.key.toLowerCase()); if (!event.shiftKey) photo.keys.delete('shift') }
    const move = (event: MouseEvent) => { if (document.pointerLockElement) { photo.dx += event.movementX; photo.dy += event.movementY } }
    const click = (event: MouseEvent) => { if (event.button === 0 && document.pointerLockElement) photo.capture = true }
    const wheel = (event: WheelEvent) => { photo.zoom += Math.sign(event.deltaY) }
    const blur = () => photo.keys.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', move)
    window.addEventListener('mousedown', click)
    window.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mousedown', click)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('blur', blur)
      photo.keys.clear()
    }
  }, [active])

  if (!active) return null
  return <div className="photo-ui">
    {vignette && <div className="photo-vignette" aria-hidden="true" />}
    <div className="photo-frame" aria-hidden="true"><i /><i /><i /><i /></div>
    {!hidden && <section className="photo-panel" aria-label="拍照模式">
      <header><small>PHOTO MODE</small><strong>拍照模式</strong>{saved && <em aria-live="polite">已存 {saved.count} 张</em>}</header>
      <div className="segmented" role="group" aria-label="滤镜（F 切换）">
        {PHOTO_FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => useUiStore.getState().setPhotoFilter(f)}>{PHOTO_FILTER_LABELS[f]}</button>)}
      </div>
      <button className="toggle" aria-pressed={vignette} onClick={() => useUiStore.getState().setPhotoVignette(!vignette)}>暗角 <kbd>V</kbd></button>
      <ul className="photo-keys">
        <li><kbd>WASD</kbd>移动</li><li><kbd>Q</kbd><kbd>E</kbd>降 · 升</li><li><kbd>Shift</kbd>疾速</li><li><kbd>滚轮</kbd>焦距</li>
        <li><kbd>F</kbd>滤镜</li><li><kbd>Enter</kbd>/ 左键 拍摄</li><li><kbd>H</kbd>隐藏面板</li><li><kbd>P</kbd>/<kbd>Esc</kbd>退出</li>
      </ul>
      {saved && <p className="photo-saved">{saved.name}</p>}
    </section>}
  </div>
}
