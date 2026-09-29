import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { roadAt } from '../world/environment/t02r/terrain'
import { ORB_COUNT, ORB_GROUP_LABELS, ORBS, orbPosition } from '../world/interact/orbs'
import { Vector3 } from 'three'
import { kunState } from '../world/colossi/kunDeck'
import { turtleState } from '../world/colossi/turtleDeck'
import { COMPENDIUM, COMPENDIUM_GROUPS } from '../world/compendium/compendium'
import { KUN_PATH } from '../world/colossi/layout'
import type { OrbGroup } from '../world/interact/orbs'
import { KIND_LABELS, SITES, sitesOf } from '../world/interact/registry'
import { REGIONS, worldTerrainHeight } from '../world/regions/regions'
import { CLOUD_SEA_Y } from '../world/sky/CloudSea'
import type { SiteSpec } from '../world/interact/registry'
import { getPlayerRuntime } from '../world/player/playerHandle'
import { BRIDGES, ISLANDS, PILLARS } from '../world/sites'
import type { InteractKind } from '../world/sites'
import { LAYOUT } from '../world/worldLayout'
import { formatTrialTime, TRIAL_COURSES } from '../world/trials/courses'
import { uiBridge } from './bridge'
import { Dialog } from './Dialog'
import { COMPENDIUM_LORE, CORE_REGION, STELE_LORE, VIEWPOINT_REGIONS } from './lore'
import { dismissOverlay, useUiStore } from './uiStore'
import type { ScrollTab } from './uiStore'
import { useTranslation } from './i18n'

const TABS: { id: ScrollTab; label: string; en: string }[] = [
  { id: 'map', label: '舆图', en: 'MAP' }, { id: 'codex', label: '碑录', en: 'CODEX' }, { id: 'collection', label: '收集', en: 'PROGRESS' },
  { id: 'compendium', label: '图录', en: 'COMPENDIUM' },
]

/** Tab 卷轴: the sect map, the stele codex, collection progress and the photo compendium. Tab closes it again. */
export function ScrollOverlay() {
  const t = useTranslation()
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
  return <Dialog title={t('卷轴')} hideTitle className="scroll-dialog" onClose={dismissOverlay} onTab={dismissOverlay}>
    <header className="scroll-head">
      <div className="scroll-brand"><span>{t('卷')}</span><div><strong>{t('云阙卷轴')}</strong><small>SECT SCROLL · MAP · CODEX · PROGRESS · COMPENDIUM</small></div></div>
      <div className="scroll-tabs" role="tablist" aria-label={t('卷轴页签')} onKeyDown={onTabKeys}>
        {TABS.map((tabDefinition, i) => <button key={tabDefinition.id} ref={(el) => { tabs.current[i] = el }} role="tab" id={`scroll-tab-${tabDefinition.id}`}
          aria-selected={tab === tabDefinition.id} aria-controls={tab === tabDefinition.id ? `scroll-panel-${tabDefinition.id}` : undefined} tabIndex={tab === tabDefinition.id ? 0 : -1}
          data-autofocus={tab === tabDefinition.id ? true : undefined} onClick={() => setTab(tabDefinition.id)}>{t(tabDefinition.label)}<small>{tabDefinition.en}</small></button>)}
      </div>
          <button className="scroll-close" onClick={dismissOverlay} aria-label={t('收起卷轴')}>{t('收起')} <kbd>Tab</kbd></button>
    </header>
    <div className="scroll-body" role="tabpanel" id={`scroll-panel-${tab}`} aria-labelledby={`scroll-tab-${tab}`}>
      {tab === 'map' && <MapPanel />}
      {tab === 'codex' && <CodexPanel />}
      {tab === 'collection' && <CollectionPanel />}
      {tab === 'compendium' && <CompendiumPanel />}
    </div>
    <footer className="scroll-foot"><span><kbd>Tab</kbd> {t('收起')}</span><span><kbd>←</kbd><kbd>→</kbd> {t('切换页签')}</span><span><kbd>Shift</kbd>+<kbd>Tab</kbd> {t('移动焦点')}</span><span><kbd>Esc</kbd> {t('返回')}</span></footer>
  </Dialog>
}

interface View { x: number; z: number; w: number; h: number }
const SECT_VIEW: View = { x: -380, z: -620, w: 760, h: 840 }
function worldView(): View {
  let minX = -400, maxX = 400, minZ = -620, maxZ = 220
  for (const p of PILLARS.filter((q) => !q.outer)) { minX = Math.min(minX, p.x - p.radius); maxX = Math.max(maxX, p.x + p.radius); minZ = Math.min(minZ, p.z - p.radius); maxZ = Math.max(maxZ, p.z + p.radius) }
  for (const i of ISLANDS) { minX = Math.min(minX, i.top[0] - i.radius); maxX = Math.max(maxX, i.top[0] + i.radius); minZ = Math.min(minZ, i.top[2] - i.radius); maxZ = Math.max(maxZ, i.top[2] + i.radius) }
  for (const [x, , z] of KUN_PATH) { minX = Math.min(minX, x - 180); maxX = Math.max(maxX, x + 180); minZ = Math.min(minZ, z - 180); maxZ = Math.max(maxZ, z + 180) }
  const pad = 60
  return { x: minX - pad, z: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2 }
}
const REALM_VIEW: View = { x: LAYOUT.world.minX, z: LAYOUT.world.minZ, w: LAYOUT.world.maxX - LAYOUT.world.minX, h: LAYOUT.world.maxZ - LAYOUT.world.minZ }
type Zoom = 'sect' | 'world' | 'realm'
const within = (v: View, x: number, z: number) => x >= v.x && x <= v.x + v.w && z >= v.z && z <= v.z + v.h

const RELIEF_STEP = 25
let relief: string | null | undefined
/** Shaded relief of everything above the cloud sea, sampled once from the terrain heightfields; the vector layers sit on top. */
function reliefImage() {
  if (relief !== undefined) return relief
  const w = Math.round(REALM_VIEW.w / RELIEF_STEP), h = Math.round(REALM_VIEW.h / RELIEF_STEP)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const context = canvas.getContext('2d')
  if (!context) return (relief = null)
  const heights = new Float32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) heights[j * w + i] = worldTerrainHeight(REALM_VIEW.x + (i + 0.5) * RELIEF_STEP, REALM_VIEW.z + (j + 0.5) * RELIEF_STEP)
  const image = context.createImageData(w, h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, height = heights[k], above = height - CLOUD_SEA_Y
    if (above <= 0) continue
    // Lit from the north-west, like an ink relief: ground rising toward the south-east faces the light.
    const slope = heights[j * w + Math.min(i + 1, w - 1)] - heights[j * w + Math.max(i - 1, 0)] + heights[Math.min(j + 1, h - 1) * w + i] - heights[Math.max(j - 1, 0) * w + i]
    const shade = Math.min(1.45, Math.max(0.55, 1 + slope / 160)), t = Math.min(above / 900, 1)
    image.data[k * 4] = (46 + 74 * t) * shade
    image.data[k * 4 + 1] = (62 + 66 * t) * shade
    image.data[k * 4 + 2] = (56 + 52 * t) * shade
    image.data[k * 4 + 3] = Math.min(above / 30, 1) * 255
  }
  context.putImageData(image, 0, 0)
  return (relief = canvas.toDataURL())
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
  const t = useTranslation()
  const [x, , z] = site.position, s = unit * 7, color = MARKER_COLORS[site.kind]
  const fill = done ? color : '#15222c'
  const shape = site.kind === 'stele' ? <rect x={-s * 0.55} y={-s * 0.8} width={s * 1.1} height={s * 1.6} fill={fill} stroke={color} strokeWidth={unit * 1.4} />
    : site.kind === 'viewpoint' ? <path d={`M0 ${-s} L${s * 0.8} 0 L0 ${s} L${-s * 0.8} 0Z`} fill={fill} stroke={color} strokeWidth={unit * 1.4} />
      : site.kind === 'teleport' ? <g><circle r={s} fill="none" stroke={color} strokeWidth={unit * 1.4} /><circle r={s * 0.45} fill={done ? color : 'none'} stroke={color} strokeWidth={unit} /></g>
        : site.kind === 'meditation' ? <circle r={s * 0.7} fill="none" stroke={color} strokeWidth={unit * 1.6} />
          : <circle r={s * 0.85} fill={color} stroke="#15222c" strokeWidth={unit} />
  return <g transform={`translate(${x} ${z})`} className="map-marker"><title>{`${t(KIND_LABELS[site.kind])} · ${t(site.name)}${done ? '' : t('（未至）')}`}</title>{shape}</g>
}

function MapPanel() {
  const t = useTranslation()
  const steles = useUiStore((state) => state.steles), viewpoints = useUiStore((state) => state.viewpoints), arrays = useUiStore((state) => state.arrays), orbs = useUiStore((state) => state.orbs)
  const full = useMemo(worldView, [])
  const [zoom, setZoom] = useState<Zoom>(() => {
    const p = getPlayerRuntime()?.position
    return !p || (Math.abs(p.x) < 360 && p.z > -620 && p.z < 220) ? 'sect' : within(full, p.x, p.z) ? 'world' : 'realm'
  })
  const view = zoom === 'sect' ? SECT_VIEW : zoom === 'world' ? full : REALM_VIEW
  // Shading the relief samples every terrain heightfield (tens of milliseconds), so it follows the panel's first paint.
  const [reliefUrl, setReliefUrl] = useState<string | null>(() => relief ?? null)
  useEffect(() => {
    if (zoom !== 'realm' || reliefUrl) return
    const timer = window.setTimeout(() => setReliefUrl(reliefImage()), 0)
    return () => window.clearTimeout(timer)
  }, [zoom, reliefUrl])
  const realmRelief = zoom === 'realm' ? reliefUrl : null
  const unit = view.w / 1000
  const player = useRef<SVGGElement | null>(null)
  const kun = useRef<SVGGElement | null>(null)
  const turtle = useRef<SVGGElement | null>(null)
  const orbNodes = useRef(new Map<string, SVGCircleElement>())
  useEffect(() => {
    let frame = 0
    const orbPoint = new Vector3()
    const tick = () => {
      const p = getPlayerRuntime()?.position
      if (p && player.current) player.current.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.z.toFixed(1)}) rotate(${(uiBridge.heading * 180 / Math.PI).toFixed(1)}) scale(${unit})`)
      if (kun.current) {
        kun.current.style.visibility = kunState.ready ? 'visible' : 'hidden'
        kun.current.setAttribute('transform', `translate(${kunState.center.x} ${kunState.center.z}) rotate(${-kunState.heading * 180 / Math.PI}) scale(${unit})`)
      }
      if (turtle.current) {
        turtle.current.style.visibility = turtleState.ready ? 'visible' : 'hidden'
        turtle.current.setAttribute('transform', `translate(${turtleState.center.x} ${turtleState.center.z}) rotate(${-turtleState.heading * 180 / Math.PI}) scale(${unit})`)
      }
      for (const orb of ORBS) {
        const node = orbNodes.current.get(orb.id)
        if (!node) continue
        const point = orbPosition(orb, orbPoint)
        node.style.visibility = point ? 'visible' : 'hidden'
        if (point) { node.setAttribute('cx', String(point.x)); node.setAttribute('cy', String(point.z)) }
      }
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
  const cover: View = { x: REALM_VIEW.x - 400, z: REALM_VIEW.z - 400, w: REALM_VIEW.w + 800, h: REALM_VIEW.h + 800 }
  const label = (text: string, x: number, z: number, size = 11, className = 'map-label') => <text x={x} y={z} fontSize={unit * size} className={className} textAnchor="middle">{t(text)}</text>
  return <div className="map-panel">
    <div className="map-frame">
      <svg viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={zoom === 'realm'
        ? t('云阙全境舆图：显示宗门、四方外境（{regions}）与你的位置', { regions: REGIONS.map((r) => t(r.name)).join(t('、')) })
        : t('云阙仙宗舆图：显示岛屿、石林、各处碑亭与传送阵，以及你的位置')}>
        <defs>
          <radialGradient id="map-sea" cx="50%" cy="45%" r="75%"><stop offset="0%" stopColor="#223644" /><stop offset="100%" stopColor="#131e27" /></radialGradient>
          <pattern id="map-mist" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="#1a2731" />
            <path d="M0 40 Q30 20 60 40 T120 40 M0 100 Q30 80 60 100 T120 100" fill="none" stroke="#2c3e4a" strokeWidth="3" />
          </pattern>
          <filter id="map-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={unit * 26} /></filter>
          <filter id="map-relief-soft"><feGaussianBlur stdDeviation={RELIEF_STEP * 0.7} /></filter>
          <mask id="map-reveal" maskUnits="userSpaceOnUse" x={cover.x} y={cover.z} width={cover.w} height={cover.h}>
            <rect x={cover.x} y={cover.z} width={cover.w} height={cover.h} fill="white" />
            <g filter="url(#map-soft)">{revealed.map(([x, z, r], i) => <circle key={i} cx={x} cy={z} r={r} fill="black" />)}</g>
          </mask>
        </defs>
        <rect x={cover.x} y={cover.z} width={cover.w} height={cover.h} fill="url(#map-sea)" />
        {realmRelief && <image href={realmRelief} x={REALM_VIEW.x} y={REALM_VIEW.z} width={REALM_VIEW.w} height={REALM_VIEW.h} preserveAspectRatio="none" filter="url(#map-relief-soft)" className="map-relief" />}
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
        <rect x={cover.x} y={cover.z} width={cover.w} height={cover.h} fill="url(#map-mist)" mask="url(#map-reveal)" className="map-fog" />
        {/* A faint trace of the relief shows through the mist, so the realm's outline reads before its overlooks are reached. */}
        {realmRelief && <image href={realmRelief} x={REALM_VIEW.x} y={REALM_VIEW.z} width={REALM_VIEW.w} height={REALM_VIEW.h} preserveAspectRatio="none" filter="url(#map-relief-soft)" mask="url(#map-reveal)" className="map-relief-veil" />}
        <g className="map-labels">
          {label('云阙主殿', main[0], main[2] + unit * 4, 15, 'map-label map-label-major')}
          {zoom === 'realm' ? REGIONS.map((r) => <g key={r.id}>{label(r.name, r.center[0], r.center[1], 15, 'map-label map-label-major')}</g>) : <>
            {label('山门', 34, LAYOUT.gate.position[2] + unit * 4, 10)}
            {label('长阶', 34, -22, 10)}
            {ISLANDS.map((i) => <g key={i.id}>{label(i.name, i.top[0], i.top[2] + i.radius + unit * 16, 11)}</g>)}
          </>}
        </g>
        <g className="map-orbs">{ORBS.filter((o) => orbs.includes(o.id)).map((o) => <circle key={o.id} data-orb-id={o.id} ref={(node) => { if (node) orbNodes.current.set(o.id, node); else orbNodes.current.delete(o.id) }} r={unit * 2.2} />)}</g>
        <g ref={kun} className="map-kun" fill="#91d6c7" stroke="#d7ede1" strokeWidth="1.2"><title>{t('鲲 · 平飞时可停靠')}</title><ellipse rx="7" ry="17" /><path d="M-5 -10 L-13 -19 L0 -15 L13 -19 L5 -10 M-6 2 L-17 -3 L-6 7 M6 2 L17 -3 L6 7" /><text x="17" y="5" fontSize="12" stroke="none">{t('鲲')}</text></g>
        <g ref={turtle} className="map-turtle" fill="#a9c79a" stroke="#e3edd6" strokeWidth="1.2"><title>{t('巨鳌 · 随时可停靠')}</title><ellipse rx="11" ry="13" /><circle cy="17" r="4" /><path d="M-9 6 L-19 10 L-10 11 M9 6 L19 10 L10 11 M-8 -8 L-15 -13 L-7 -12 M8 -8 L15 -13 L7 -12" /><text x="20" y="5" fontSize="12" stroke="none">{t('巨鳌')}</text></g>
        <g className="map-markers">{SITES.map((site) => <Marker key={site.id} site={site} done={siteDone(site, state)} unit={unit} />)}</g>
        <g ref={player} className="map-player"><circle r="11" className="map-player-ring" /><path d="M0 -13 L7.5 8 L0 3.5 L-7.5 8Z" /></g>
      </svg>
      <div className="map-zoom" role="group" aria-label={t('舆图范围')}>
        <button aria-pressed={zoom === 'sect'} onClick={() => setZoom('sect')}>{t('宗门')}</button>
        <button aria-pressed={zoom === 'world'} onClick={() => setZoom('world')}>{t('周边')}</button>
        <button aria-pressed={zoom === 'realm'} onClick={() => setZoom('realm')}>{t('全图')}</button>
      </div>
      <div className="map-compass" aria-hidden="true">{t('北')}</div>
    </div>
    <aside className="map-side">
      <h3>{t('图例')} <small>LEGEND</small></h3>
      <ul className="map-legend">
        <li><i className="legend-stele" />{t('石碑')} <em>{steles.length}/{sitesOf('stele').length}</em></li>
        <li><i className="legend-view" />{t('观景台')} <em>{viewpoints.length}/{sitesOf('viewpoint').length}</em></li>
        <li><i className="legend-array" />{t('传送阵')} <em>{arrays.length}/{sitesOf('teleport').length}</em></li>
        <li><i className="legend-bell" />{t('古钟 · 祭坛')}</li>
        <li><i className="legend-cushion" />{t('蒲团')}</li>
        <li><i className="legend-player" />{t('你的位置')}</li>
      </ul>
      <p className="map-hint">{t('实心为已至之处。云雾遮蔽之地，登临观景台远眺即可揭示。')}</p>
      <h3>{t('已揭示')} <small>REVEALED</small></h3>
      <ul className="map-regions">
        <li data-done="true">{t('宗门腹地')}</li>
        {Object.entries(VIEWPOINT_REGIONS).map(([id, region]) => <li key={id} data-done={viewpoints.includes(id)}>{viewpoints.includes(id) ? t(region.name) : '???'}</li>)}
      </ul>
    </aside>
  </div>
}

function CodexPanel() {
  const t = useTranslation()
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
    <ul className="codex-list" aria-label={t('碑文目录')} onKeyDown={onListKeys}>
      {list.map((site, i) => {
        const done = read.includes(site.id)
        return <li key={site.id}><button aria-pressed={selected === site.id} onClick={() => setSelected(site.id)} data-read={done}
          aria-label={done ? `${t(STELE_LORE[site.id]?.title ?? site.name)}${t('，已研读')}` : t('第 {index} 碑，尚未研读', { index: i + 1 })}>
          <span>{String(i + 1).padStart(2, '0')}</span><b>{done ? t(STELE_LORE[site.id]?.title ?? site.name) : t('未读之碑')}</b><small>{done ? t('已录') : t(STELE_LORE[site.id]?.hint ?? '')}</small>
        </button></li>
      })}
    </ul>
    <article className="codex-page" aria-live="polite">
      {entry && known ? <>
        <header><small>{t(entry.era)}</small><strong>{t(entry.title)}</strong></header>
        <p className="codex-text">{t(entry.text)}</p>
      </> : <div className="codex-unknown"><strong>{t('碑文未录')}</strong><p>{t('此碑尚待亲往研读。')}<br />{t('所在：')}{t(entry?.hint ?? '未知')}</p></div>}
    </article>
  </div>
}

function CompendiumPanel() {
  const t = useTranslation()
  const recorded = useUiStore((state) => state.compendium)
  const [selected, setSelected] = useState(() => recorded[recorded.length - 1] ?? COMPENDIUM[0].id)
  const entry = COMPENDIUM.find((e) => e.id === selected) ?? COMPENDIUM[0]
  const lore = COMPENDIUM_LORE[entry.id]
  const onListKeys = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = (COMPENDIUM.findIndex((e) => e.id === selected) + (event.key === 'ArrowDown' ? 1 : COMPENDIUM.length - 1)) % COMPENDIUM.length
    setSelected(COMPENDIUM[index].id)
    event.currentTarget.querySelectorAll('button')[index]?.focus()
  }
  return <div className="codex-panel">
    <ul className="codex-list" aria-label={t('图录目录')} onKeyDown={onListKeys}>
      {COMPENDIUM.map((item, i) => {
        const done = recorded.includes(item.id)
        return <li key={item.id}><button aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} data-read={done}
          aria-label={done ? `${t(item.name)}${t('，已收录')}` : t('第 {index} 项，尚未收录', { index: i + 1 })}>
          <span>{String(i + 1).padStart(2, '0')}</span><b>{done ? t(item.name) : t('未录之象')}</b><small>{t(COMPENDIUM_GROUPS[item.group])}</small>
        </button></li>
      })}
    </ul>
    <article className="codex-page" aria-live="polite">
      {recorded.includes(entry.id) ? <>
        <header><small>{t(COMPENDIUM_GROUPS[entry.group])} · {t('已收录 {count} / {total}', { count: recorded.length, total: COMPENDIUM.length })}</small><strong>{t(entry.name)}</strong></header>
        <p className="codex-text">{t(lore?.text ?? '')}</p>
      </> : <div className="codex-unknown"><strong>{t('尚未入画')}</strong><p>{t('在拍照模式（P）中将它摄入画面即可收录。')}<br />{t('线索：')}{t(lore?.hint ?? '未知')}</p></div>}
    </article>
  </div>
}

function CollectionPanel() {
  const t = useTranslation()
  const orbs = useUiStore((state) => state.orbs), steles = useUiStore((state) => state.steles)
  const viewpoints = useUiStore((state) => state.viewpoints), arrays = useUiStore((state) => state.arrays)
  const trials = useUiStore((state) => state.trials), compendium = useUiStore((state) => state.compendium)
  const finished = TRIAL_COURSES.filter((course) => trials[course.id] !== undefined).length
  const groups = Object.keys(ORB_GROUP_LABELS) as OrbGroup[]
  const bar = (label: string, value: number, total: number) => <span className="progress-bar" role="progressbar" aria-label={`${t(label)} ${value}/${total}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}><i style={{ width: `${(value / total) * 100}%` }} /></span>
  const rows: [string, string, string[], SiteSpec[]][] = [
    ['碑文', 'STELES', steles, sitesOf('stele')], ['远眺', 'VIEWPOINTS', viewpoints, sitesOf('viewpoint')], ['传送阵', 'ARRAYS', arrays, sitesOf('teleport')],
  ]
  return <div className="collection-panel">
    <section className="collection-orbs">
      <header><small>SPIRIT LIGHT</small><strong>{t('灵光')} <b>{orbs.length}</b> / {ORB_COUNT}</strong>{bar('灵光', orbs.length, ORB_COUNT)}</header>
      <ul>
        {groups.map((group) => {
          const all = ORBS.filter((o) => o.group === group), got = all.filter((o) => orbs.includes(o.id)).length
          return <li key={group} data-done={got === all.length}><span>{t(ORB_GROUP_LABELS[group])}</span>{bar(ORB_GROUP_LABELS[group], got, all.length)}<em>{got} / {all.length}</em></li>
        })}
      </ul>
      <p className="map-hint">{t('金色灵光可步行拾取；青碧与淡紫者，多在桥下、浮屿、石林与殿顶，需御剑方至。罗盘上的 ✦ 指向最近尚有灵光之处。')}</p>
    </section>
    <section className="collection-sites">
      {rows.map(([name, en, done, list]) => <div key={en} className="collection-row">
        <header><small>{en}</small><strong>{t(name)} <b>{done.length}</b> / {list.length}</strong>{bar(name, done.length, list.length)}</header>
        <ul>{list.map((site) => <li key={site.id} data-done={done.includes(site.id)}>{done.includes(site.id) ? t(site.name) : '???'}</li>)}</ul>
      </div>)}
      <div className="collection-row collection-trials">
        <header><small>FLIGHT TRIALS</small><strong>{t('飞行试炼')} <b>{finished}</b> / {TRIAL_COURSES.length}</strong>{bar('飞行试炼', finished, TRIAL_COURSES.length)}</header>
        <ul>{TRIAL_COURSES.map((course) => {
          const best = trials[course.id]
          return <li key={course.id} data-done={best !== undefined}>{t(course.name)} <em>{best !== undefined ? formatTrialTime(best) : t('未完成')}</em></li>
        })}</ul>
        <p className="map-hint">{t('御剑穿过金色的起始环即开始计时，再依次穿过亮起的环；落地、传送或远离航线则试炼中断。罗盘上的 ◯ 指向各试炼起点。')}</p>
      </div>
      <div className="collection-row">
        <header><small>COMPENDIUM</small><strong>{t('万象图录')} <b>{compendium.length}</b> / {COMPENDIUM.length}</strong>{bar('万象图录', compendium.length, COMPENDIUM.length)}</header>
        <ul>{COMPENDIUM.map((item) => <li key={item.id} data-done={compendium.includes(item.id)}>{compendium.includes(item.id) ? t(item.name) : '???'}</li>)}</ul>
        <p className="map-hint">{t('在拍照模式中将巨物、灵物与天象摄入画面即可收录；画面上方会提示取景中之物。')}</p>
      </div>
    </section>
  </div>
}
