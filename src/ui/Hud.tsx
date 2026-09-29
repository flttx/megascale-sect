import { useEffect, useMemo, useRef, useState } from 'react'
import { ORB_COUNT, ORBS, orbPosition } from '../world/interact/orbs'
import { Vector3 } from 'three'
import { director } from '../world/interact/cinematics'
import { sitesOf } from '../world/interact/registry'
import { getPlayerRuntime } from '../world/player/playerHandle'
import { useWorldStore } from '../world/store'
import type { InteractKind } from '../world/sites'
import { LAYOUT } from '../world/worldLayout'
import { formatTrialTime, TRIAL_COURSES } from '../world/trials/courses'
import type { TrialCourse, TrialId } from '../world/trials/courses'
import { trialState } from '../world/trials/trials'
import { angleDelta, bearing, uiBridge } from './bridge'
import { useUiStore } from './uiStore'
import { useTranslation } from './i18n'

const KIND_EN: Record<InteractKind, string> = { stele: 'STELE', viewpoint: 'OVERLOOK', bell: 'BELL', altar: 'ALTAR', meditation: 'MEDITATE', teleport: 'ARRAY' }

/** Half of the compass field of view (radians) and the strip's half width in px. */
const SPAN = (80 * Math.PI) / 180
const HALF = 230

interface CompassItem {
  key: string
  className: string
  label: string
  /** Fixed bearing, or a world point the bearing is taken toward from the player. */
  angle?: number
  target?: readonly [number, number]
  title?: string
}

const CARDINALS: [number, string][] = [[0, '北'], [90, '东'], [180, '南'], [270, '西']]

function staticItems(t: ReturnType<typeof useTranslation>): CompassItem[] {
  const items: CompassItem[] = []
  for (let deg = 0; deg < 360; deg += 15) {
    const cardinal = CARDINALS.find(([d]) => d === deg)
    if (cardinal) items.push({ key: `c${deg}`, className: 'compass-cardinal', label: t(cardinal[1]), angle: (deg * Math.PI) / 180 })
    else items.push({ key: `t${deg}`, className: deg % 45 === 0 ? 'compass-tick compass-tick-major' : 'compass-tick', label: '', angle: (deg * Math.PI) / 180 })
  }
  return items
}

/** Nearest cluster that still has uncollected orbs: [centroid x, centroid z, distance] or null. */
function nearestOrbCluster(x: number, y: number, z: number, collected: string[]) {
  const sums = new Map<string, [number, number, number, number]>()
  const point = new Vector3()
  for (const orb of ORBS) {
    if (collected.includes(orb.id)) continue
    if (!orbPosition(orb, point)) continue
    const sum = sums.get(orb.cluster) ?? [0, 0, 0, 0]
    sum[0] += point.x; sum[1] += point.y; sum[2] += point.z; sum[3]++
    sums.set(orb.cluster, sum)
  }
  let best: [number, number, number] | null = null
  sums.forEach(([sx, sy, sz, n]) => {
    const cx = sx / n, cy = sy / n, cz = sz / n
    const d = Math.hypot(cx - x, cy - y, cz - z)
    if (!best || d < best[2]) best = [cx, cz, d]
  })
  return best as [number, number, number] | null
}

const distanceText = (metres: number) => metres < 1000 ? `${Math.round(metres)}m` : `${(metres / 1000).toFixed(1)}km`

/**
 * Top-centre compass bar: cardinals, ticks, overlooks, arrays, the main hall, flight-trial starts and the nearest orb
 * cluster; during a trial the starts give way to the next ring and its distance.
 */
function Compass() {
  const t = useTranslation()
  const language = useUiStore((state) => state.language)
  const viewpoints = useUiStore((state) => state.viewpoints)
  const arrays = useUiStore((state) => state.arrays)
  const trials = useUiStore((state) => state.trials)
  const ticks = useMemo(() => staticItems(t), [language])
  const sites = useMemo<CompassItem[]>(() => [
    { key: 'hall', className: 'compass-marker compass-hall', label: t('殿'), target: [LAYOUT.main.position[0], LAYOUT.main.position[2]], title: t('云阙主殿') },
    ...sitesOf('viewpoint').map((s) => ({ key: s.id, className: 'compass-marker compass-view', label: '◇', target: [s.position[0], s.position[2]] as const, title: `${t('观景 · ')}${t(s.name)}` })),
    ...sitesOf('teleport').map((s) => ({ key: s.id, className: 'compass-marker compass-array', label: '◎', target: [s.position[0], s.position[2]] as const, title: `${t('传送阵 · ')}${t(s.name)}` })),
    ...TRIAL_COURSES.map((c) => ({ key: `trial-${c.id}`, className: 'compass-marker compass-trial', label: '◯', target: [c.rings[0][0], c.rings[0][2]] as const, title: `${t('飞行试炼 · ')}${t(c.name)}` })),
  ], [language])
  const refs = useRef(new Map<string, HTMLElement>())
  const orbRef = useRef<HTMLElement | null>(null)
  const orbText = useRef<HTMLElement | null>(null)
  const ringRef = useRef<HTMLElement | null>(null)
  const ringText = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let frame = 0, count = 0
    let cluster: [number, number, number] | null = null
    const place = (el: HTMLElement, angle: number, heading: number) => {
      const delta = angleDelta(angle, heading)
      const visible = Math.abs(delta) < SPAN
      el.style.opacity = visible ? String(Math.min(1, (SPAN - Math.abs(delta)) / 0.25)) : '0'
      if (visible) el.style.transform = `translateX(${((delta / SPAN) * HALF).toFixed(1)}px)`
    }
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const p = getPlayerRuntime()?.position
      const heading = uiBridge.heading
      const px = p?.x ?? 0, pz = p?.z ?? 150
      for (const item of ticks) { const el = refs.current.get(item.key); if (el && item.angle !== undefined) place(el, item.angle, heading) }
      for (const item of sites) {
        const el = refs.current.get(item.key)
        if (!el || !item.target) continue
        if (trialState.course && item.className.includes('compass-trial')) { el.style.opacity = '0'; continue }
        const far = Math.hypot(item.target[0] - px, item.target[1] - pz)
        if (far < 6) { el.style.opacity = '0'; continue }
        place(el, bearing(px, pz, item.target[0], item.target[1]), heading)
      }
      if (count++ % 20 === 0 && p) cluster = nearestOrbCluster(p.x, p.y, p.z, useUiStore.getState().orbs)
      if (orbRef.current) {
        if (!cluster || !p) orbRef.current.style.opacity = '0'
        else {
          place(orbRef.current, bearing(px, pz, cluster[0], cluster[1]), heading)
          if (orbText.current) orbText.current.textContent = distanceText(cluster[2])
        }
      }
      if (ringRef.current) {
        const run = trialState.course
        if (!run || !p) ringRef.current.style.opacity = '0'
        else {
          const [x, y, z] = run.rings[trialState.next]
          place(ringRef.current, bearing(px, pz, x, z), heading)
          if (ringText.current) ringText.current.textContent = distanceText(Math.hypot(x - p.x, y - p.y, z - p.z))
        }
      }
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [ticks, sites])
  const done = (key: string) => viewpoints.includes(key) || arrays.includes(key) || (key.startsWith('trial-') && trials[key.slice(6) as TrialId] !== undefined)
  return <div className="compass" role="img" aria-label={t('罗盘：显示方位、观景台、传送阵、主殿、飞行试炼与最近的灵光')}>
    <div className="compass-strip" aria-hidden="true">
      {ticks.map((item) => <span key={item.key} ref={(el) => { if (el) refs.current.set(item.key, el); else refs.current.delete(item.key) }} className={item.className}>{item.label}</span>)}
      {sites.map((item) => <span key={item.key} ref={(el) => { if (el) refs.current.set(item.key, el); else refs.current.delete(item.key) }}
        className={item.className} data-done={done(item.key)} title={item.title}>{item.label}</span>)}
      <span ref={orbRef} className="compass-marker compass-orb">✦<small ref={orbText} /></span>
      <span ref={ringRef} className="compass-marker compass-ring">◉<small ref={ringText} /></span>
    </div>
    <i className="compass-needle" aria-hidden="true" />
  </div>
}

/** 「E 研读 · 入山碑」 above the crosshair when something is in reach. */
function InteractPrompt() {
  const t = useTranslation()
  const nearby = useUiStore((state) => state.nearby)
  const overlay = useUiStore((state) => state.overlay)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  if (!nearby || overlay || cameraMode !== 'player') return null
  return <div className="interact-prompt" role="status" aria-live="polite">
    <kbd>E</kbd><b>{t(nearby.verb)}</b><span>·</span><strong>{t(nearby.name)}</strong><small>{KIND_EN[nearby.kind]}</small>
  </div>
}

function OrbCounter() {
  const t = useTranslation()
  const orbs = useUiStore((state) => state.orbs.length)
  return <div className="orb-counter" aria-label={`${t('已收集灵光')} ${orbs} / ${ORB_COUNT}`}>
    <i aria-hidden="true" /><span>{t('灵光')}</span><b>{orbs}</b><em>/ {ORB_COUNT}</em>
  </div>
}

/** Course, rings taken and clock of the flight trial under way; the clock is written each frame outside React. */
function TrialTimer() {
  const t = useTranslation()
  const [course, setCourse] = useState<TrialCourse | null>(null)
  const clock = useRef<HTMLElement | null>(null)
  const count = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let frame = 0, shown: TrialCourse | null = null
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const run = trialState.course
      if (run !== shown) { shown = run; setCourse(run) }
      if (!run) return
      if (clock.current) clock.current.textContent = formatTrialTime(trialState.time)
      if (count.current) count.current.textContent = `${trialState.next - 1} / ${run.rings.length - 1}`
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [])
  if (!course) return null
  return <div className="trial-timer" role="timer" aria-label={`${t('飞行试炼计时')} · ${t(course.name)}`}>
    <small>{t('试炼')}</small><strong>{t(course.name)}</strong>
    <b ref={clock} />
    <span>{t('环')} <em ref={count} /></span>
  </div>
}

/** Cinematic caption plus letterbox bars (viewpoint sweeps and meditation). */
function CaptionView() {
  const t = useTranslation()
  const caption = useUiStore((state) => state.caption)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  const cinematic = cameraMode === 'cinematic'
  const skip = t(director.shot?.kind === 'meditation' ? '按 E 起身' : '按 E / Esc / 点击 跳过')
  return <>
    <div className="letterbox" data-on={cinematic} aria-hidden="true"><i /><i /></div>
    {cinematic && caption && <div className="cinema-caption" role="status" aria-live="polite">
      <small>{t(caption.kicker)}</small>
      <strong>{t(caption.title)}</strong>
      <p>{t(caption.text)}</p>
      <em>{skip}</em>
    </div>}
  </>
}

/** White-gold teleport flash, cinematic veil and the photo shutter, replayed by key bumps. */
function Effects() {
  const flashKey = useUiStore((state) => state.flashKey)
  const shutterKey = useUiStore((state) => state.shutterKey)
  const veil = useUiStore((state) => state.veil)
  return <>
    {flashKey > 0 && <div key={`f${flashKey}`} className="teleport-flash" aria-hidden="true" />}
    {shutterKey > 0 && <div key={`s${shutterKey}`} className="photo-shutter" aria-hidden="true" />}
    <div className="cinema-veil" data-on={veil} aria-hidden="true" />
  </>
}

/** The in-game HUD layer: H, photo mode and cinematics hide the widgets; effects always play. */
export function Hud() {
  const started = useWorldStore((state) => state.started)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  const hidden = useUiStore((state) => state.hudHidden)
  return <>
    {started && !hidden && cameraMode === 'player' && <>
      <Compass />
      <OrbCounter />
      <TrialTimer />
      <InteractPrompt />
    </>}
    {started && cameraMode !== 'photo' && <CaptionView />}
    <Effects />
  </>
}
