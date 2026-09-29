import { STELE_LORE, VIEWPOINT_LINES, VIEWPOINT_REGIONS } from '../../ui/lore'
import { dismissOverlay, showOverlay, useUiStore } from '../../ui/uiStore'
import { translate } from '../../ui/i18n'
import { hasGameInput } from '../../ui/gameKeys'
import { worldEvents } from '../events'
import { getPlayerRuntime, teleportPlayer } from '../player/playerHandle'
import { useWorldStore } from '../store'
import type { Vec3 } from '../surfaces'
import { fastForward } from '../weather/timeOfDay'
import { WEATHER_LABELS } from '../weather/weatherMachine'
import type { WeatherKind } from '../weather/weatherMachine'
import { director, endShot, startShot } from './cinematics'
import { bellWave, emitSparks } from './effects'
import { facingYaw, SITE_BY_ID, sitesOf } from './registry'
import type { SiteSpec } from './registry'
import { playAttune, playBell, playTeleport } from './sounds'

const notice = (text: string, values: Record<string, string | number> = {}) => useWorldStore.getState().setNotice(translate(text, useUiStore.getState().language, values))
const onFoot = () => getPlayerRuntime()?.phase === 'GROUND'
let lastBell = -Infinity

function strikeBell(site: SiteSpec) {
  const now = performance.now() / 1000
  if (now - lastBell < 3.2) return
  lastBell = now
  playBell()
  bellWave.position = site.position
  bellWave.pending = true
  worldEvents.emit('bell', { position: site.position })
}

function meditate(site: SiteSpec) {
  if (!onFoot()) { notice('请先落地，再于蒲团上静坐'); return }
  const [x, y, z] = site.position
  teleportPlayer([x, y + 0.6, z], facingYaw(site.position, site.faceToward))
  useUiStore.getState().setCaption({ kicker: 'MEDITATION · 静坐观云', title: site.name, text: '心随云动，一坐六时。按 E 起身。' })
  startShot('meditation', site, 0, () => { fastForward(0, 0.1).catch((error: unknown) => console.warn('[interact] could not stop the time advance', error)) })
  fastForward(6, 8).then(() => { if (director.shot?.kind === 'meditation') endShot() })
    .catch((error: unknown) => { console.warn('[interact] meditation time advance failed', error); endShot() })
}

function overlook(site: SiteSpec) {
  if (!onFoot()) { notice('请先落地，再凭栏远眺'); return }
  const first = useUiStore.getState().visitViewpoint(site.id)
  const region = VIEWPOINT_REGIONS[site.id]
  useUiStore.getState().setCaption({ kicker: 'VIEWPOINT · 远眺', title: site.name, text: VIEWPOINT_LINES[site.id] ?? '' })
  startShot('viewpoint', site, 9.5, () => {
    if (first && region) { notice('卷轴地图已揭示 · {region}', { region: translate(region.name, useUiStore.getState().language) }); playAttune() }
  })
}

/** Runs a site's interaction. Returns false when the site is unknown. */
export function triggerSite(id: string): boolean {
  const site = SITE_BY_ID.get(id)
  if (!site) return false
  worldEvents.emit('interact', { id, kind: site.kind })
  const ui = useUiStore.getState()
  switch (site.kind) {
    case 'stele': ui.readStele(id); showOverlay({ kind: 'lore', id }); break
    case 'bell': strikeBell(site); break
    case 'altar': showOverlay({ kind: 'weather' }); break
    case 'meditation': meditate(site); break
    case 'viewpoint': overlook(site); break
    case 'teleport':
      if (ui.activateArray(id)) announceArray(site)
      showOverlay({ kind: 'teleport', from: id })
      break
  }
  return true
}

export function announceArray(site: SiteSpec) {
  const total = sitesOf('teleport').length, count = useUiStore.getState().arrays.length
  notice('传送阵已感应 · {name}（{count} / {total}）', { name: translate(site.name, useUiStore.getState().language), count, total })
  playAttune()
  const [x, y, z] = site.position
  emitSparks([x, y + 0.5, z], 36, [1, 0.82, 0.5], 4, 2.5, 1.4)
}

/**
 * E key: skips a running cinematic / stands up from meditation, closes a lore card, otherwise uses the
 * nearby site. Only acts while playing (pointer locked, or DEV `devInput`) with the player camera.
 */
export function interactPressed(): boolean {
  if (director.shot) { endShot(); return true }
  const world = useWorldStore.getState(), ui = useUiStore.getState()
  if (ui.overlay?.kind === 'lore') { dismissOverlay(); return true }
  if (!world.started || world.cameraMode !== 'player' || ui.overlay) return false
  if (!hasGameInput()) return false
  return ui.nearby ? triggerSite(ui.nearby.id) : false
}

/** Travel between two attuned arrays: white-gold flash, then the jump at the flash's peak. */
export function travel(fromId: string, toId: string) {
  const from = SITE_BY_ID.get(fromId), to = SITE_BY_ID.get(toId)
  if (!from || !to) return
  dismissOverlay()
  const runtime = getPlayerRuntime()
  if (!runtime || !['GROUND', 'FLIGHT'].includes(runtime.phase)) { notice('阵法感应不到你的气息，请先站稳再试'); return }
  const start: Vec3 = [runtime.position.x, runtime.position.y, runtime.position.z]
  useUiStore.getState().flash()
  playTeleport()
  emitSparks([start[0], start[1] + 1, start[2]], 40, [1, 0.9, 0.7], 3, 3, 1)
  window.setTimeout(() => {
    const [x, y, z] = to.position
    const target: Vec3 = [x, y + 0.2, z]
    if (!teleportPlayer(target, facingYaw(to.position, to.faceToward))) { notice('阵法感应不到你的气息，请先站稳再试'); return }
    worldEvents.emit('teleport', { from: start, to: target })
    emitSparks([x, y + 0.8, z], 48, [1, 0.85, 0.55], 4.5, 2.5, 1.4)
    notice('已抵达 · {name}', { name: translate(to.name, useUiStore.getState().language) })
  }, 420)
}

export function chooseWeather(kind: WeatherKind | 'auto') {
  const world = useWorldStore.getState()
  dismissOverlay()
  if (kind === 'auto') { world.setAutoWeather(true); notice('司天祭坛 · 天象顺其自然'); return }
  world.setWeather(kind)
  notice('司天祭坛 · 天象将转为{weather}', { weather: translate(WEATHER_LABELS[kind], useUiStore.getState().language) })
  playAttune()
}

/** DEV: stand the player in front of a site, facing it (verification scripts). */
export function standAt(id: string): boolean {
  const site = SITE_BY_ID.get(id)
  if (!site) return false
  const [x, y, z] = site.position, [fx, , fz] = site.faceToward
  const offset = { stele: 2.6, bell: 4.8, altar: 5.4, meditation: 2.2, viewpoint: 0, teleport: 0 }[site.kind]
  const length = Math.hypot(fx - x, fz - z) || 1
  const at: Vec3 = [x + (fx - x) / length * offset, y + 0.3, z + (fz - z) / length * offset]
  const yaw = offset > 0 ? facingYaw(at, site.position) : facingYaw(site.position, site.faceToward)
  return teleportPlayer(at, yaw)
}

export { STELE_LORE }
