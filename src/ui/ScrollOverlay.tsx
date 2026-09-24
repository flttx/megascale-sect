import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { roadAt } from '../world/environment/t02r/terrain'
import { ORB_COUNT, ORB_GROUP_LABELS, ORBS } from '../world/interact/orbs'
import type { OrbGroup } from '../world/interact/orbs'
import { KIND_LABELS, SITES, sitesOf } from '../world/interact/registry'
import type { SiteSpec } from '../world/interact/registry'
import { getPlayerRuntime } from '../world/player/playerHandle'
import { BRIDGES, ISLANDS, PILLARS } from '../world/sites'
import type { InteractKind } from '../world/sites'
import { LAYOUT } from '../world/worldLayout'
import { uiBridge } from './bridge'
import { Dialog } from './Dialog'
import { CORE_REGION, STELE_LORE, VIEWPOINT_REGIONS } from './lore'
import { dismissOverlay, useUiStore } from './uiStore'
import type { ScrollTab } from './uiStore'

const TABS: { id: ScrollTab; label: string; en: string }[] = [
  { id: 'map', label: '舆图', en: 'MAP' }, { id: 'codex', label: '碑录', en: 'CODEX' }, { id: 'collection', label: '收集', en: 'PROGRESS' },
]

/** Tab 卷轴: the sect map, the stele codex and collection progress. Tab closes it again. */
export function ScrollOverlay() {
  const tab = useUiStore((state) => state.scrollTab)
  const setTab = useUiStore((state) => state.setScrollTab)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const onTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = (TABS.findIndex((t) => t.id === tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    setTab(TABS[index].id)
    tabs.current[index]?.focus()
  }
  return <Dialog title="卷轴" hideTitle className="scroll-dialog" onClose={dismissOverlay} onTab={dismissOverlay}>
    <header className="scroll-head">
      <div className="scroll-brand"><span>卷</span><div><strong>云阙卷轴</strong><small>SECT SCROLL · 舆图 碑录 收集</small></div></div>
      <div className="scroll-tabs" role="tablist" aria-label="卷轴页签" onKeyDown={onTabKeys}>
        {TABS.map((t, i) => <button key={t.id} ref={(el) => { tabs.current[i] = el }} role="tab" id={`scroll-tab-${t.id}`}
          aria-selected={tab === t.id} aria-controls={`scroll-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
          data-autofocus={tab === t.id ? true : undefined} onClick={() => setTab(t.id)}>{t.label}<small>{t.en}</small></button>)}
      </div>
      <button className="scroll-close" onClick={dismissOverlay} aria-label="收起卷轴">收起 <kbd>Tab</kbd></button>
    </header>
    <div className="scroll-body" role="tabpanel" id={`scroll-panel-${tab}`} aria-labelledby={`scroll-tab-${tab}`}>
      {tab === 'map' && <MapPanel />}
      {tab === 'codex' && <CodexPanel />}
      {tab === 'collection' && <CollectionPanel />}
    </div>
    <footer className="scroll-foot"><span><kbd>Tab</kbd> 收起</span><span><kbd>←</kbd><kbd>→</kbd> 切换页签</span><span><kbd>Shift</kbd>+<kbd>Tab</kbd> 移动焦点</span><span><kbd>Esc</kbd> 返回</span></footer>
  </Dialog>
}

interface View { x: number; z: number; w: number; h: number }
const SECT_VIEW: View = { x: -380, z: -620, w: 760, h: 840 }
function worldView(): View {
  let minX = -400, maxX = 400, minZ = -620, maxZ = 220
  for (const p of PILLARS) { minX = Math.min(minX, p.x - p.radius); maxX = Math.max(maxX, p.x + p.radius); minZ = Math.min(minZ, p.z - p.radius); maxZ = Math.max(maxZ, p.z + p.radius) }
  for (const i of ISLANDS) { minX = Math.min(minX, i.top[0] - i.radius); maxX = Math.max(maxX, i.top[0] + i.radius); minZ = Math.min(minZ, i.top[2] - i.radius); maxZ = Math.max(maxZ, i.top[2] + i.radius) }
  const pad = 60
  return { x: minX - pad, z: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2 }
}

const MARKER_COLORS: Record<InteractKind, string> = {
  stele: '#e3cf9f', viewpoint: '#9fe6cf', bell: '#e8b877', altar: '#e8b877', meditation: '#c9d6f0', teleport: '#f1d58f',
}

function siteDone(site: SiteSpec, progress: { steles: string[]; viewpoints: string[]; arrays: string[] }) {
  if (site.kind === 'stele') return progress.steles.includes(site.id)
  if (site.kind === 'viewpoint') return progress.viewpoints.includes(site.id)
  if (site.kind === 'teleport') return progress.arrays.includes(site.id)
  return true
}

function Marker({ site, done, unit }: { site: SiteSpec; done: boolean; unit: number }) {
  const [x, , z] = site.position, s = unit * 7, color = MARKER_COLORS[site.kind]
  const fill = done ? color : '#15222c'
  const shape = site.kind === 'stele' ? <rect x={-s * 0.55} y={-s * 0.8} width={s * 1.1} height={s * 1.6} fill={fill} stroke={color} strokeWidth={unit * 1.4} />
    : site.kind === 'viewpoint' ? <path d={`M0 ${-s} L${s * 0.8} 0 L0 ${s} L${-s * 0.8} 0Z`} fill={fill} stroke={color} strokeWidth={unit * 1.4} />
      : site.kind === 'teleport' ? <g><circle r={s} fill="none" stroke={color} strokeWidth={unit * 1.4} /><circle r={s * 0.45} fill={done ? color : 'none'} stroke={color} strokeWidth={unit} /></g>
        : site.kind === 'meditation' ? <circle r={s * 0.7} fill="none" stroke={color} strokeWidth={unit * 1.6} />
          : <circle r={s * 0.85} fill={color} stroke="#15222c" strokeWidth={unit} />
  return <g transform={`translate(${x} ${z})`} className="map-marker"><title>{`${KIND_LABELS[site.kind]} · ${site.name}${done ? '' : '（未至）'}`}</title>{shape}</g>
}

function MapPanel() {
  const steles = useUiStore((state) => state.steles), viewpoints = useUiStore((state) => state.viewpoints), arrays = useUiStore((state) => state.arrays), orbs = useUiStore((state) => state.orbs)
  const full = useMemo(worldView, [])
  const [zoom, setZoom] = useState<'sect' | 'world'>(() => {
    const p = getPlayerRuntime()?.position
    return !p || (Math.abs(p.x) < 360 && p.z > -620 && p.z < 220) ? 'sect' : 'world'
  })
  const view = zoom === 'sect' ? SECT_VIEW : full
  const unit = view.w / 1000
  const player = useRef<SVGGElement | null>(null)
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const p = getPlayerRuntime()?.position
      if (p && player.current) player.current.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.z.toFixed(1)}) rotate(${(uiBridge.heading * 180 / Math.PI).toFixed(1)}) scale(${unit})`)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [unit])
  const road = useMemo(() => {
    const points: string[] = []
    for (let z = LAYOUT.road.fromZ; z >= LAYOUT.road.toZ; z -= 4) points.push(`${roadAt(z).x.toFixed(1)},${z}`)
    return points.join(' ')
  }, [])
  const revealed = [...CORE_REGION, ...viewpoints.flatMap((id) => VIEWPOINT_REGIONS[id]?.circles ?? [])]
  const state = { steles, viewpoints, arrays }
  const main = LAYOUT.main.position, hall = LAYOUT.mainCollider, platform = LAYOUT.platform
  const label = (text: string, x: number, z: number, size = 11, className = 'map-label') => <text x={x} y={z} fontSize={unit * size} className={className} textAnchor="middle">{text}</text>
  return <div className="map-panel">
    <div className="map-frame">
      <svg viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="云阙仙宗舆图：显示岛屿、石林、各处碑亭与传送阵，以及你的位置">
        <defs>
          <radialGradient id="map-sea" cx="50%" cy="45%" r="75%"><stop offset="0%" stopColor="#223644" /><stop offset="100%" stopColor="#131e27" /></radialGradient>
          <pattern id="map-mist" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="#1a2731" />
            <path d="M0 40 Q30 20 60 40 T120 40 M0 100 Q30 80 60 100 T120 100" fill="none" stroke="#2c3e4a" strokeWidth="3" />
          </pattern>
          <filter id="map-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={unit * 26} /></filter>
          <mask id="map-reveal" maskUnits="userSpaceOnUse" x={full.x - 400} y={full.z - 400} width={full.w + 800} height={full.h + 800}>
            <rect x={full.x - 400} y={full.z - 400} width={full.w + 800} height={full.h + 800} fill="white" />
            <g filter="url(#map-soft)">{revealed.map(([x, z, r], i) => <circle key={i} cx={x} cy={z} r={r} fill="black" />)}</g>
          </mask>
        </defs>
        <rect x={full.x - 400} y={full.z - 400} width={full.w + 800} height={full.h + 800} fill="url(#map-sea)" />
        <g className="map-land">
          <ellipse cx={0} cy={95} rx={150} ry={112} className="map-mountain" />
          {PILLARS.map((p) => <circle key={p.id} cx={p.x} cy={p.z} r={p.radius} className="map-pillar" />)}
          {ISLANDS.map((i) => <g key={i.id}><circle cx={i.top[0]} cy={i.top[2]} r={i.radius} className="map-island" /><circle cx={i.top[0]} cy={i.top[2]} r={i.padRadius} className="map-pad" /></g>)}
          {BRIDGES.map((b) => <line key={b.id} x1={b.from[0]} y1={b.from[2]} x2={b.to[0]} y2={b.to[2]} strokeWidth={b.halfWidth * 2 + unit * 2} className="map-bridge" />)}
          <rect x={-platform.width / 2} y={platform.backZ} width={platform.width} height={platform.frontZ - platform.backZ} className="map-platform" />
          <rect x={-LAYOUT.stairs.width / 2} y={LAYOUT.stairs.endZ} width={LAYOUT.stairs.width} height={LAYOUT.stairs.startZ - LAYOUT.stairs.endZ} className="map-stairs" />
          <polyline points={road} strokeWidth={LAYOUT.road.width} className="map-road" />
          <rect x={-LAYOUT.spawn.size[0] / 2} y={150 - LAYOUT.spawn.size[1] / 2} width={LAYOUT.spawn.size[0]} height={LAYOUT.spawn.size[1]} className="map-stairs" />
          <rect x={main[0] - hall.halfWidth} y={main[2] - hall.halfDepth} width={hall.halfWidth * 2} height={hall.halfDepth * 2} className="map-hall" />
          <rect x={main[0] - hall.halfWidth * 0.62} y={main[2] - hall.halfDepth * 0.62} width={hall.halfWidth * 1.24} height={hall.halfDepth * 1.24} className="map-hall-inner" />
          {LAYOUT.towers.map((t, i) => <rect key={i} x={t.position[0] - 13} y={t.position[2] - 13} width={26} height={26} className="map-tower" transform={`rotate(${-t.rotation[1] * 180 / Math.PI} ${t.position[0]} ${t.position[2]})`} />)}
          <line x1={-26} y1={LAYOUT.gate.position[2]} x2={26} y2={LAYOUT.gate.position[2]} strokeWidth={unit * 6} className="map-gate" />
        </g>
        <rect x={full.x - 400} y={full.z - 400} width={full.w + 800} height={full.h + 800} fill="url(#map-mist)" mask="url(#map-reveal)" className="map-fog" />
        <g className="map-labels">
          {label('云阙主殿', main[0], main[2] + unit * 4, 15, 'map-label map-label-major')}
          {label('山门', 34, LAYOUT.gate.position[2] + unit * 4, 10)}
          {label('长阶', 34, -22, 10)}
          {ISLANDS.map((i) => <g key={i.id}>{label(i.name, i.top[0], i.top[2] + i.radius + unit * 16, 11)}</g>)}
        </g>
        <g className="map-orbs">{ORBS.filter((o) => orbs.includes(o.id)).map((o) => <circle key={o.id} cx={o.position[0]} cy={o.position[2]} r={unit * 2.2} />)}</g>
        <g className="map-markers">{SITES.map((site) => <Marker key={site.id} site={site} done={siteDone(site, state)} unit={unit} />)}</g>
        <g ref={player} className="map-player"><circle r="11" className="map-player-ring" /><path d="M0 -13 L7.5 8 L0 3.5 L-7.5 8Z" /></g>
      </svg>
      <div className="map-zoom" role="group" aria-label="舆图范围">
        <button aria-pressed={zoom === 'sect'} onClick={() => setZoom('sect')}>宗门</button>
        <button aria-pressed={zoom === 'world'} onClick={() => setZoom('world')}>全图</button>
      </div>
      <div className="map-compass" aria-hidden="true">北</div>
    </div>
    <aside className="map-side">
      <h3>图例 <small>LEGEND</small></h3>
      <ul className="map-legend">
        <li><i className="legend-stele" />石碑 <em>{steles.length}/{sitesOf('stele').length}</em></li>
        <li><i className="legend-view" />观景台 <em>{viewpoints.length}/{sitesOf('viewpoint').length}</em></li>
        <li><i className="legend-array" />传送阵 <em>{arrays.length}/{sitesOf('teleport').length}</em></li>
        <li><i className="legend-bell" />古钟 · 祭坛</li>
        <li><i className="legend-cushion" />蒲团</li>
        <li><i className="legend-player" />你的位置</li>
      </ul>
      <p className="map-hint">实心为已至之处。云雾遮蔽之地，登临观景台远眺即可揭示。</p>
      <h3>已揭示 <small>REVEALED</small></h3>
      <ul className="map-regions">
        <li data-done="true">宗门腹地</li>
        {Object.entries(VIEWPOINT_REGIONS).map(([id, region]) => <li key={id} data-done={viewpoints.includes(id)}>{viewpoints.includes(id) ? region.name : '？？？'}</li>)}
      </ul>
    </aside>
  </div>
}

function CodexPanel() {
  const read = useUiStore((state) => state.steles)
  const list = sitesOf('stele')
  const [selected, setSelected] = useState(() => read[read.length - 1] ?? list[0].id)
  const entry = STELE_LORE[selected]
  const known = read.includes(selected)
  const onListKeys = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = (list.findIndex((s) => s.id === selected) + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length
    setSelected(list[index].id)
    event.currentTarget.querySelectorAll('button')[index]?.focus()
  }
  return <div className="codex-panel">
    <ul className="codex-list" aria-label="碑文目录" onKeyDown={onListKeys}>
      {list.map((site, i) => {
        const done = read.includes(site.id)
        return <li key={site.id}><button aria-pressed={selected === site.id} onClick={() => setSelected(site.id)} data-read={done}
          aria-label={done ? `${STELE_LORE[site.id]?.title ?? site.name}，已研读` : `第 ${i + 1} 碑，尚未研读`}>
          <span>{String(i + 1).padStart(2, '0')}</span><b>{done ? STELE_LORE[site.id]?.title ?? site.name : '未读之碑'}</b><small>{done ? '已录' : STELE_LORE[site.id]?.hint}</small>
        </button></li>
      })}
    </ul>
    <article className="codex-page" aria-live="polite">
      {entry && known ? <>
        <header><small>{entry.era}</small><strong>{entry.title}</strong></header>
        <p className="codex-text">{entry.text}</p>
      </> : <div className="codex-unknown"><strong>碑文未录</strong><p>此碑尚待亲往研读。<br />所在：{entry?.hint ?? '未知'}</p></div>}
    </article>
  </div>
}

function CollectionPanel() {
  const orbs = useUiStore((state) => state.orbs), steles = useUiStore((state) => state.steles)
  const viewpoints = useUiStore((state) => state.viewpoints), arrays = useUiStore((state) => state.arrays)
  const groups = Object.keys(ORB_GROUP_LABELS) as OrbGroup[]
  const bar = (value: number, total: number) => <span className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}><i style={{ width: `${(value / total) * 100}%` }} /></span>
  const rows: [string, string, string[], SiteSpec[]][] = [
    ['碑文', 'STELES', steles, sitesOf('stele')], ['远眺', 'VIEWPOINTS', viewpoints, sitesOf('viewpoint')], ['传送阵', 'ARRAYS', arrays, sitesOf('teleport')],
  ]
  return <div className="collection-panel">
    <section className="collection-orbs">
      <header><small>SPIRIT LIGHT</small><strong>灵光 <b>{orbs.length}</b> / {ORB_COUNT}</strong>{bar(orbs.length, ORB_COUNT)}</header>
      <ul>
        {groups.map((group) => {
          const all = ORBS.filter((o) => o.group === group), got = all.filter((o) => orbs.includes(o.id)).length
          return <li key={group} data-done={got === all.length}><span>{ORB_GROUP_LABELS[group]}</span>{bar(got, all.length)}<em>{got} / {all.length}</em></li>
        })}
      </ul>
      <p className="map-hint">金色灵光可步行拾取；青碧与淡紫者，多在桥下、浮屿、石林与殿顶，需御剑方至。罗盘上的 ✦ 指向最近尚有灵光之处。</p>
    </section>
    <section className="collection-sites">
      {rows.map(([name, en, done, list]) => <div key={en} className="collection-row">
        <header><small>{en}</small><strong>{name} <b>{done.length}</b> / {list.length}</strong>{bar(done.length, list.length)}</header>
        <ul>{list.map((site) => <li key={site.id} data-done={done.includes(site.id)}>{done.includes(site.id) ? site.name : '？？？'}</li>)}</ul>
      </div>)}
    </section>
  </div>
}
