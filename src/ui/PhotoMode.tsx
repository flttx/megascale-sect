import { useEffect, useRef, useState } from 'react'
import { COMPENDIUM, compendiumView } from '../world/compendium/compendium'
import { useWorldStore } from '../world/store'
import { photo, uiBridge } from './bridge'
import { PHOTO_FILTER_CSS, PHOTO_FILTER_LABELS, PHOTO_FILTERS, useUiStore } from './uiStore'
import { useTranslation } from './i18n'

const ENTRY_NAMES: Record<string, string> = Object.fromEntries(COMPENDIUM.map((entry) => [entry.id, entry.name]))

/**
 * Optional photo panel: filter chips, vignette, key hints and the shot counter.
 * Camera input lives in usePhotoInput so it is ready before this panel finishes loading.
 */
export function PhotoMode() {
  const t = useTranslation()
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
    {!hidden && <Viewfinder />}
    <SurveyToast />
    {!hidden && <section className="photo-panel" aria-label={t('拍照模式')}>
      <header><small>PHOTO MODE</small><strong>{t('拍照模式')}</strong>{saved && <em aria-live="polite">{t('已存 {count} 张', { count: saved.count })}</em>}</header>
      <div className="segmented" role="group" aria-label={t('滤镜（F 切换）')}>
        {PHOTO_FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => useUiStore.getState().setPhotoFilter(f)}>{t(PHOTO_FILTER_LABELS[f])}</button>)}
      </div>
      <button className="toggle" aria-pressed={vignette} onClick={() => useUiStore.getState().setPhotoVignette(!vignette)}>{t('暗角')} <kbd>V</kbd></button>
      <ul className="photo-keys">
        <li><kbd>WASD</kbd>{t('移动')}</li><li><kbd>Q</kbd><kbd>E</kbd>{t('降 · 升')}</li><li><kbd>Shift</kbd>{t('疾速')}</li><li><kbd>滚轮</kbd>{t('焦距')}</li>
        <li><kbd>F</kbd>{t('滤镜')}</li><li><kbd>Enter</kbd>/ {t('左键 拍摄')}</li><li><kbd>H</kbd>{t('隐藏面板')}</li><li><kbd>P</kbd>/<kbd>Esc</kbd>{t('退出')}</li>
      </ul>
      {saved && <p className="photo-saved">{saved.name}</p>}
    </section>}
  </div>
}

interface Sight { id: string; close: boolean; recorded: boolean }

/** The entry the viewfinder names: an unrecorded one framed well enough, else any framed well enough, else the largest in view. */
function currentSight(): Sight | null {
  const recorded = useUiStore.getState().compendium, framed = compendiumView.framed
  const pick = framed.find((f) => f.ratio >= 1 && !recorded.includes(f.id)) ?? framed.find((f) => f.ratio >= 1) ?? framed[0]
  return pick ? { id: pick.id, close: pick.ratio >= 1, recorded: recorded.includes(pick.id) } : null
}
const sameSight = (a: Sight | null, b: Sight | null) => a?.id === b?.id && a?.close === b?.close && a?.recorded === b?.recorded

/** Names what the lens frames, from the viewfinder state the render loop refreshes a few times a second. */
function Viewfinder() {
  const t = useTranslation()
  const [sight, setSight] = useState<Sight | null>(currentSight)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = currentSight()
      setSight((prev) => sameSight(prev, next) ? prev : next)
    }, 250)
    return () => window.clearInterval(timer)
  }, [])
  const name = sight ? t(ENTRY_NAMES[sight.id] ?? '') : ''
  // Not live: it changes as the lens pans; the shot's result is announced by the toast.
  return <p className="photo-sight" role="status" aria-live="off" aria-label={t('取景提示')} data-close={sight?.close}>
    {sight && (sight.close ? <><b>{t('取景')}</b> {name} · {t(sight.recorded ? '已在图录' : '按快门收录')}</> : <>{name} · {t('再近些，或拉近焦距')}</>)}
  </p>
}

const TOAST_MS = 4500

/** What the last shot did for the compendium, for a few seconds after it (even if this panel loaded after the shot). */
function SurveyToast() {
  const t = useTranslation()
  const survey = useUiStore((state) => state.photoSurvey)
  const [expired, setExpired] = useState(() => {
    const last = useUiStore.getState().photoSurvey
    return last && performance.now() - last.at >= TOAST_MS ? last.key : 0
  })
  useEffect(() => {
    if (!survey) return
    const timer = window.setTimeout(() => setExpired(survey.key), Math.max(0, TOAST_MS - (performance.now() - survey.at)))
    return () => window.clearTimeout(timer)
  }, [survey])
  const current = survey && survey.key !== expired ? survey : null
  const names = (ids: string[]) => ids.map((id) => t(ENTRY_NAMES[id] ?? '')).join(t('、'))
  const known = current ? current.found.filter((id) => !current.fresh.includes(id)) : []
  return <div className="photo-toast" role="status">
    {current && current.fresh.length > 0 && <p key={current.key} data-fresh="true"><b>{t('图录新录')}</b> {names(current.fresh)}</p>}
    {current && !current.fresh.length && known.length > 0 && <p key={current.key}>{t('已在图录：{names}', { names: names(known) })}</p>}
    {current && current.blocked.length > 0 && <p key={`${current.key}-blocked`}>{t('{names}被遮挡，未能收录', { names: names(current.blocked) })}</p>}
  </div>
}
