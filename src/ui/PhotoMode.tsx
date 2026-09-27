import { useEffect, useRef, useState } from 'react'
import { useWorldStore } from '../world/store'
import { photo, uiBridge } from './bridge'
import { PHOTO_FILTER_CSS, PHOTO_FILTER_LABELS, PHOTO_FILTERS, useUiStore } from './uiStore'

/**
 * Optional photo panel: filter chips, vignette, key hints and the shot counter.
 * Camera input lives in usePhotoInput so it is ready before this panel finishes loading.
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
