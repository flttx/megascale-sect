import { chooseWeather, travel } from '../world/interact/actions'
import { SITE_BY_ID, sitesOf } from '../world/interact/registry'
import { useWorldStore } from '../world/store'
import { WEATHER_KINDS, WEATHER_LABELS } from '../world/weather/weatherMachine'
import type { WeatherKind } from '../world/weather/weatherMachine'
import { Dialog } from './Dialog'
import { STELE_LORE } from './lore'
import { ScrollOverlay } from './ScrollOverlay'
import { dismissOverlay, useUiStore } from './uiStore'

/** The open modal layer (lore card, weather picker, teleport list or the Tab scroll). */
export function Modals() {
  const overlay = useUiStore((state) => state.overlay)
  if (!overlay) return null
  switch (overlay.kind) {
    case 'lore': return <LoreCard id={overlay.id} />
    case 'weather': return <WeatherPicker />
    case 'teleport': return <TeleportList from={overlay.from} />
    case 'scroll': return <ScrollOverlay />
  }
}

function LoreCard({ id }: { id: string }) {
  const entry = STELE_LORE[id]
  const read = useUiStore((state) => state.steles.length)
  const total = sitesOf('stele').length
  if (!entry) return null
  return <Dialog title={`碑文 · ${entry.title}`} hideTitle className="lore-dialog" onClose={dismissOverlay}>
    <div className="lore-scroll">
      <i className="lore-rod" aria-hidden="true" />
      <div className="lore-paper">
        <header className="lore-head">
          <small>STELE INSCRIPTION</small>
          <strong>{entry.title}</strong>
          <span>{entry.era}</span>
        </header>
        <p className="lore-text">{entry.text}</p>
        <div className="lore-seal" aria-hidden="true">云阙<br />藏经</div>
      </div>
      <i className="lore-rod" aria-hidden="true" />
    </div>
    <footer className="lore-foot">
      <span>已录入卷轴 · {read} / {total}</span>
      <button data-autofocus onClick={dismissOverlay} aria-label="收起碑文">收起 <kbd>E</kbd></button>
    </footer>
  </Dialog>
}

const WEATHER_SEALS: Record<WeatherKind, [string, string]> = {
  clear: ['晴', 'CLEAR'], mist: ['岚', 'MIST'], rain: ['雨', 'RAIN'], snow: ['雪', 'SNOW'], storm: ['雷', 'STORM'],
}

function WeatherPicker() {
  const weather = useWorldStore((state) => state.weather)
  const auto = useWorldStore((state) => state.autoWeather)
  return <Dialog title="司天祭坛 · 祈天" className="panel-dialog weather-dialog" onClose={dismissOverlay}>
    <p className="dialog-lead">焚香祈天，风云随之而变。{auto ? '所择天象将驻留八分钟，而后复归自然流转。' : '自然流转已停，天象将一直驻留。'}</p>
    <div className="weather-grid" role="group" aria-label="选择天象">
      {WEATHER_KINDS.map((kind) => <button key={kind} aria-pressed={weather === kind} aria-label={`祈求${WEATHER_LABELS[kind]}`}
        data-autofocus={weather === kind ? true : undefined} onClick={() => chooseWeather(kind)}>
        <span className="weather-seal" aria-hidden="true">{WEATHER_SEALS[kind][0]}</span>
        <b>{WEATHER_LABELS[kind]}</b><small>{WEATHER_SEALS[kind][1]}</small>
      </button>)}
    </div>
    <div className="dialog-actions">
      <button className="ghost-button" aria-pressed={auto} onClick={() => chooseWeather('auto')} aria-label="顺其自然，恢复自动天象">顺其自然 <small>AUTO</small></button>
      <button className="ghost-button" onClick={dismissOverlay} aria-label="离开祭坛">离开 <kbd>Esc</kbd></button>
    </div>
  </Dialog>
}

const ARRAY_REGIONS: Record<string, string> = {
  teleport_spawn: '山门前路', teleport_forecourt: '云阙广场', teleport_back: '后山台地', teleport_isle_west: '听松屿', teleport_star: '摘星台',
}

function TeleportList({ from }: { from: string }) {
  const arrays = useUiStore((state) => state.arrays)
  const origin = SITE_BY_ID.get(from)
  const list = sitesOf('teleport')
  return <Dialog title="传送阵 · 择地而往" className="panel-dialog teleport-dialog" onClose={dismissOverlay}>
    <p className="dialog-lead">已感应 {arrays.length} / {list.length} 座阵法。未感应之阵，须亲身踏足方能相连。</p>
    <ul className="array-list">
      {list.map((site) => {
        const here = site.id === from, active = arrays.includes(site.id)
        const distance = origin ? Math.round(Math.hypot(site.position[0] - origin.position[0], site.position[1] - origin.position[1], site.position[2] - origin.position[2])) : 0
        const status = here ? '此处' : active ? `${distance} m` : '未感应'
        return <li key={site.id}>
          <button disabled={here || !active} onClick={() => travel(from, site.id)} data-state={here ? 'here' : active ? 'active' : 'dormant'}
            aria-label={here ? `${site.name}（当前所在）` : active ? `传送至${site.name}，${ARRAY_REGIONS[site.id]}，${distance} 米` : `${site.name}尚未感应`}>
            <span className="array-mark" aria-hidden="true" />
            <b>{site.name}</b><small>{ARRAY_REGIONS[site.id]}</small><em>{status}</em>
          </button>
        </li>
      })}
    </ul>
    <div className="dialog-actions">
      <button className="ghost-button" onClick={dismissOverlay} aria-label="离开传送阵">离开 <kbd>Esc</kbd></button>
    </div>
  </Dialog>
}
