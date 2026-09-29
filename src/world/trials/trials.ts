import { Vector3 } from 'three'
import { useWorldStore } from '../store'
import { useUiStore } from '../../ui/uiStore'
import { translate } from '../../ui/i18n'
import { playRing, playTrialFinish } from '../interact/sounds'
import type { PlayerRuntime } from '../player/playerMotion'
import { formatTrialTime, ringNormal, TRIAL_COURSES } from './courses'
import type { TrialCourse } from './courses'

/**
 * Trial run state, advanced by the player loop and read by the rings and the HUD. A ring counts when the flier
 * crosses its plane forward, inside its radius (with a little slack). Landing, a relocation, straying too far from the
 * next ring or running out of time abandons the run; flying back through any start ring restarts.
 */
export interface TrialState {
  course: TrialCourse | null
  /** Index of the ring to take next. */
  next: number
  /** Seconds on the clock; it runs while the player simulation does, so pausing stops it and photo mode does not. */
  time: number
  /** Bumped whenever the course or next ring changes, so renderers repaint only then. */
  version: number
}

export const trialState: TrialState = { course: null, next: 0, time: 0, version: 0 }

const SLACK = 1.15, STRAY = 1500, LIMIT = 600, REST = 4
const normals = new Map(TRIAL_COURSES.map((course) => [course, course.rings.map((_, i) => ringNormal(course, i, new Vector3()))]))
const hit = new Vector3()
let rest = 0, relocation = -1

function crosses(course: TrialCourse, i: number, from: Vector3, to: Vector3) {
  const [x, y, z, r] = course.rings[i], n = normals.get(course)![i]
  const a = (from.x - x) * n.x + (from.y - y) * n.y + (from.z - z) * n.z
  const b = (to.x - x) * n.x + (to.y - y) * n.y + (to.z - z) * n.z
  if (!(a < 0 && b >= 0)) return false
  hit.copy(from).lerp(to, a / (a - b))
  return Math.hypot(hit.x - x, hit.y - y, hit.z - z) <= r * SLACK
}

function notice(text: string, course: TrialCourse, values: Record<string, string> = {}) {
  const language = useUiStore.getState().language
  useWorldStore.getState().setNotice(translate(text, language, { name: translate(course.name, language), ...values }))
}

function set(course: TrialCourse | null, next: number) {
  trialState.course = course; trialState.next = next; trialState.version++
}

function abandon() {
  if (trialState.course) notice('{name} · 试炼中断', trialState.course)
  set(null, 0)
  rest = REST
}

/** Called once per player frame after the move from `from` to `runtime.position`. */
export function updateTrial(runtime: PlayerRuntime, from: Vector3, delta: number, running: boolean) {
  rest = Math.max(0, rest - delta)
  const to = runtime.position
  // A teleport or recovery is a jump, not a flight through whatever lies between.
  if (runtime.relocation !== relocation) {
    const first = relocation < 0
    relocation = runtime.relocation
    if (!first && trialState.course) abandon()
    return
  }
  const { course } = trialState
  if (course) {
    if (running) trialState.time += delta
    const [x, y, z] = course.rings[trialState.next]
    if (runtime.phase !== 'FLIGHT' || trialState.time > LIMIT || Math.hypot(to.x - x, to.y - y, to.z - z) > STRAY) { abandon(); return }
    if (crosses(course, trialState.next, from, to)) {
      if (trialState.next === course.rings.length - 1) {
        // Kept to the tenth the clock shows, so a record is always a visibly faster time.
        const time = Math.round(trialState.time * 10) / 10
        const previous = useUiStore.getState().trials[course.id]
        const best = useUiStore.getState().recordTrial(course.id, time)
        if (best) notice('{name} · 用时 {time} · 新纪录', course, { time: formatTrialTime(time) })
        else notice('{name} · 用时 {time}（最佳 {best}）', course, { time: formatTrialTime(time), best: formatTrialTime(previous ?? time) })
        playTrialFinish(best)
        set(null, 0)
        rest = REST
      } else {
        playRing(trialState.next, course.rings.length)
        set(course, trialState.next + 1)
      }
      return
    }
  }
  if (runtime.phase !== 'FLIGHT' || rest > 0) return
  for (const start of TRIAL_COURSES) {
    if (!crosses(start, 0, from, to)) continue
    playRing(0, start.rings.length)
    trialState.time = 0
    set(start, 1)
    notice('{name} · 试炼开始 · 共 {count} 环', start, { count: String(start.rings.length - 1) })
    return
  }
}
