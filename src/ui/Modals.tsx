import { chooseWeather, travel } from '../world/interact/actions'
import { SITE_BY_ID, sitesOf } from '../world/interact/registry'
import { useWorldStore } from '../world/store'
import { WEATHER_KINDS, WEATHER_LABELS } from '../world/weather/weatherMachine'
import type { WeatherKind } from '../world/weather/weatherMachine'
import { Dialog } from './Dialog'
import { STELE_LORE } from './lore'
import { dismissOverlay, useUiStore } from './uiStore'
import { useTranslation } from './i18n'

const ScrollOverlay = lazy(() => import('./ScrollOverlay').then((module) => ({ default: module.ScrollOverlay })))

/** The open modal layer (lore card, weather picker, teleport list or the Tab scroll). */
export function Modals() {
  const t = useTranslation()
  const overlay = useUiStore((state) => state.overlay)
  if (!overlay) return null
  switch (overlay.kind) {
    case 'lore': return <LoreCard id={overlay.id} />
    case 'weather': return <WeatherPicker />
    case 'teleport': return <TeleportList from={overlay.from} />
    case 'scroll': return <Suspense fallback={<Dialog title={t('卷轴')} onClose={dismissOverlay} onTab={dismissOverlay}><p role="status">{t('正在展开卷轴…')}</p></Dialog>}><ScrollOverlay /></Suspense>
  }
}

function LoreCard({ id }: { id: string }) {
  const t = useTranslation()
  const language = useUiStore((state) => state.language)
  const entry = STELE_LORE[id]
  const read = useUiStore((state) => state.steles.length)
  const total = sitesOf('stele').length
  if (!entry) return null
  return <Dialog title={`${t('碑文 · ')}${t(entry.title)}`} hideTitle className="lore-dialog" onClose={dismissOverlay}>
    <div className="lore-scroll">
      <i className="lore-rod" aria-hidden="true" />
      <div className="lore-paper">
        <header className="lore-head">
          <small>STELE INSCRIPTION</small>
          <strong>{t(entry.title)}</strong>
          <span>{t(entry.era)}</span>
        </header>
        <p className="lore-text">{t(entry.text)}</p>
        <div className="lore-seal" aria-hidden="true">{language === 'en' ? <>{t('云阙')}<br />{t('藏经')}</> : <>云阙<br />藏经</>}</div>
      </div>
      <i className="lore-rod" aria-hidden="true" />
    </div>
    <footer className="lore-foot">
      <span>{t('已录入卷轴')} · {read} / {total}</span>
      <button data-autofocus onClick={dismissOverlay} aria-label={t('收起碑文')}>{t('收起')} <kbd>E</kbd></button>
    </footer>
  </Dialog>
}

const WEATHER_SEALS: Record<WeatherKind, [string, string]> = {
  clear: ['晴', 'CLEAR'], mist: ['岚', 'MIST'], rain: ['雨', 'RAIN'], snow: ['雪', 'SNOW'], storm: ['雷', 'STORM'],
}

function WeatherPicker() {
  const t = useTranslation()
  const language = useUiStore((state) => state.language)
  const weather = useWorldStore((state) => state.weather)
  const auto = useWorldStore((state) => state.autoWeather)
  return <Dialog title={t('司天祭坛 · 祈天')} className="panel-dialog weather-dialog" onClose={dismissOverlay}>
    <p className="dialog-lead">{t('焚香祈天，风云随之而变。')}{auto ? t('所择天象将驻留八分钟，而后复归自然流转。') : t('自然流转已停，天象将一直驻留。')}</p>
    <div className="weather-grid" role="group" aria-label={t('选择天象')}>
      {WEATHER_KINDS.map((kind) => <button key={kind} aria-pressed={weather === kind} aria-label={`${t('祈求')}${t(WEATHER_LABELS[kind])}`}
        data-autofocus={weather === kind ? true : undefined} onClick={() => chooseWeather(kind)}>
        <span className="weather-seal" aria-hidden="true">{language === 'en' ? ({ clear: 'C', mist: 'M', rain: 'R', snow: 'S', storm: 'T' } as const)[kind] : WEATHER_SEALS[kind][0]}</span>
        <b>{t(WEATHER_LABELS[kind])}</b><small>{WEATHER_SEALS[kind][1]}</small>
      </button>)}
    </div>
    <div className="dialog-actions">
      <button className="ghost-button" aria-pressed={auto} onClick={() => chooseWeather('auto')} aria-label={t('顺其自然，恢复自动天象')}>{t('顺其自然')} <small>AUTO</small></button>
      <button className="ghost-button" onClick={dismissOverlay} aria-label={t('离开祭坛')}>{t('离开')} <kbd>Esc</kbd></button>
    </div>
  </Dialog>
}

const ARRAY_REGIONS: Record<string, string> = {
  teleport_spawn: '山门前路', teleport_forecourt: '云阙广场', teleport_back: '后山台地', teleport_isle_west: '听松屿', teleport_star: '摘星台',
}

function TeleportList({ from }: { from: string }) {
  const t = useTranslation()
  const arrays = useUiStore((state) => state.arrays)
  const origin = SITE_BY_ID.get(from)
  const list = sitesOf('teleport')
  return <Dialog title={t('传送阵 · 择地而往')} className="panel-dialog teleport-dialog" onClose={dismissOverlay}>
    <p className="dialog-lead">{t('已感应 {count} / {total} 座阵法。未感应之阵，须亲身踏足方能相连。', { count: arrays.length, total: list.length })}</p>
    <ul className="array-list">
      {list.map((site) => {
        const here = site.id === from, active = arrays.includes(site.id)
        const distance = origin ? Math.round(Math.hypot(site.position[0] - origin.position[0], site.position[1] - origin.position[1], site.position[2] - origin.position[2])) : 0
        const status = here ? t('此处') : active ? `${distance} m` : t('未感应')
        return <li key={site.id}>
          <button disabled={here || !active} onClick={() => travel(from, site.id)} data-state={here ? 'here' : active ? 'active' : 'dormant'}
            aria-label={here ? t('{name}（当前所在）', { name: t(site.name) }) : active ? t('传送至{name}，{region}，{distance} 米', { name: t(site.name), region: t(ARRAY_REGIONS[site.id]), distance }) : t('{name}尚未感应', { name: t(site.name) })}>
            <span className="array-mark" aria-hidden="true" />
            <b>{t(site.name)}</b><small>{t(ARRAY_REGIONS[site.id])}</small><em>{status}</em>
          </button>
        </li>
      })}
    </ul>
    <div className="dialog-actions">
      <button className="ghost-button" onClick={dismissOverlay} aria-label={t('离开传送阵')}>{t('离开')} <kbd>Esc</kbd></button>
    </div>
  </Dialog>
}
import { lazy, Suspense } from 'react'
