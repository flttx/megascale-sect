import { PropertyBinding, Quaternion, Vector3 } from 'three'
import type { AnimationClip, Interpolant, KeyframeTrack } from 'three'
import { JUMP_SPEED } from './GroundController'
import { FLIGHT_SEQUENCE, smooth, type PlayerRuntime } from './playerMotion'

/** A bone the clips drive: its rest pose, and this frame's blended pose in `rotation` / `position`. */
export interface ClipTarget {
  rest: Quaternion; restPosition: Vector3
  rotation: Quaternion; position: Vector3
  rotationWeight: number; positionWeight: number
}
type Locomotion = 'walk' | 'run' | 'sprint'
/** Native ground speed (m/s) of a locomotion clip and where in it (clip fraction) the left foot is at mid-stance. */
export interface GaitSpec { speed: number; leftStance: number }
export type Gaits = Record<Locomotion, GaitSpec>

interface Channel { target: ClipTarget; values: Interpolant; position: boolean }
/** Installed per track by `setInterpolation` (glTF cubic splines bring their own); three's types leave it out. */
type SampledTrack = KeyframeTrack & { createInterpolant: () => Interpolant }
interface Clip { duration: number; channels: Channel[] }

const LOCOMOTION: Locomotion[] = ['walk', 'run', 'sprint']
/** Gait cycles (a left and a right step) in each clip, and the share of a cycle each foot is planted (both characters). */
const CYCLES: Record<Locomotion, number> = { walk: 2, run: 1, sprint: 1 }
const STANCE: Record<Locomotion, number> = { walk: 0.47, run: 0.24, sprint: 0.11 }
/**
 * Marks in the jump clip (s, asset-pipeline/anim/build.mjs): the crouch bottoms out, the feet leave the ground, the
 * apex, the legs reach for the ground. The crouch plays over the take-off wind-up; in the air the clip follows the
 * vertical speed, so the apex and the reach land on the real apex and touchdown however high the ground is.
 */
const JUMP = { crouch: 0.1, lift: 0.2, apex: 11 / 30, reach: 16 / 30 } as const
/** Boarding the sword: the feet leave the ground at 16 % of the sequence, the legs reach for the blade by 70 %. */
const BOARD = { lift: 0.16, reach: 0.7 } as const
/** Ground speed (m/s) at which the sprint clip has fully taken over from the run. */
const SPRINT_FULL = 8.5
const CLIPS = ['idle', ...LOCOMOTION, 'jump', 'fall', 'land'] as const

function bind(clip: AnimationClip, targets: ReadonlyMap<string, ClipTarget>): Clip {
  const channels: Channel[] = []
  for (const track of clip.tracks) {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name)
    const target = targets.get(nodeName.replace(/^mixamorig[:_]?/, ''))
    if (target && (propertyName === 'quaternion' || propertyName === 'position')) channels.push({ target, values: (track as SampledTrack).createInterpolant(), position: propertyName === 'position' })
  }
  return { duration: clip.duration, channels }
}

/** Adds `weight` of the clip at `time` to its targets; quaternions are flipped onto the rest pose's hemisphere first. */
function sample(clip: Clip, time: number, weight: number) {
  if (weight < 1e-4) return
  for (const { target, values, position } of clip.channels) {
    const v = values.evaluate(time)
    if (position) {
      target.position.x += v[0] * weight; target.position.y += v[1] * weight; target.position.z += v[2] * weight
      target.positionWeight += weight
    } else {
      const r = target.rest, w = v[0] * r.x + v[1] * r.y + v[2] * r.z + v[3] * r.w < 0 ? -weight : weight
      target.rotation.x += v[0] * w; target.rotation.y += v[1] * w; target.rotation.z += v[2] * w; target.rotation.w += v[3] * w
      target.rotationWeight += weight
    }
  }
}

/**
 * Blends the character's baked clips (anim.glb) into a base pose for the procedural layer on top (R5b).
 * Locomotion follows the ground actually covered: idle, walk, run and sprint are weighted by speed and share one
 * gait phase, so their footfalls line up and a player pushing against a wall marks time instead of running in place.
 * A jump crouches, then tracks the vertical speed up to the apex and down, turning into the falling loop past a
 * jump's worth of fall; a hard landing plays the land clip, and all of it gives way to the rest pose as the player
 * boards the sword.
 */
export class ClipLayer {
  private clips = new Map<string, Clip>()
  private targets: ClipTarget[]
  /** Distance covered per gait cycle at each clip's native speed (m). */
  private cycle: Record<Locomotion, number>
  private last = new Vector3(); private placed = false
  private speed = 0; private gait = 0; private idleTime = 0
  private air = 0; private airTime = 0; private jumped = false; private wasInAir = false
  private landTime = Infinity; private landStrength = 0; private land = 0; private fallTime = 0
  private jumpTime: number = JUMP.reach; private toFall = 0
  /** Foot-plant phase (left mid-stance at π) and threshold: a foot plants while cos(stride + side) < −duty; 1 never plants. */
  stride = Math.PI; duty = 1
  /** Share of the pose that comes from the clips (the rest is the rest pose), and the land clip's part of it. */
  weight = 0; landWeight = 0
  /** How much of a running leap to split the legs into (0…1), and which leg leads: 1 left, −1 right. */
  leap = 0; leapSide = 1
  private weights: Record<(typeof CLIPS)[number], number> = { idle: 0, walk: 0, run: 0, sprint: 0, jump: 0, fall: 0, land: 0 }

  constructor(targets: ReadonlyMap<string, ClipTarget>, animations: AnimationClip[], private gaits: Gaits) {
    this.targets = [...targets.values()]
    for (const name of CLIPS) {
      const clip = animations.find((animation) => animation.name === name)
      if (!clip) throw new Error(`Character animation is missing the "${name}" clip`)
      this.clips.set(name, bind(clip, targets))
    }
    this.cycle = { walk: 0, run: 0, sprint: 0 }
    for (const name of LOCOMOTION) {
      this.cycle[name] = gaits[name].speed * this.clip(name).duration / CYCLES[name]
      if (!(this.cycle[name] > 0)) throw new Error(`Character "${name}" clip needs a positive gait speed and duration`)
    }
  }

  private clip(name: (typeof CLIPS)[number]) { return this.clips.get(name)! }

  /** Advances the clocks and writes this frame's blended clip pose into every target. */
  update(runtime: PlayerRuntime, delta: number) {
    const ground = runtime.phase === 'GROUND', boarding = runtime.phase === 'BOARDING'
    const inAir = ground && runtime.inAir, onFoot = ground && !inAir
    const moved = this.placed ? Math.hypot(runtime.position.x - this.last.x, runtime.position.z - this.last.z) : 0
    this.last.copy(runtime.position)
    this.placed = true
    // A jump keeps the speed it left the ground with; anything but a step on foot (a teleport) is not a stride.
    const stepped = onFoot && moved < 3 ? moved : 0
    if (onFoot) this.speed += (stepped / Math.max(delta, 1e-3) - this.speed) * (1 - Math.exp(-10 * delta))
    else if (!ground) this.speed *= Math.exp(-10 * delta)

    // Hat weights over idle 0, walk, run and SPRINT_FULL m/s.
    const { walk, run, sprint } = this.gaits, v = this.speed
    const w = this.weights
    w.idle = w.walk = w.run = w.sprint = 0
    if (v >= SPRINT_FULL) w.sprint = 1
    else if (v >= run.speed) { w.sprint = (v - run.speed) / (SPRINT_FULL - run.speed); w.run = 1 - w.sprint }
    else if (v >= walk.speed) { w.run = (v - walk.speed) / (run.speed - walk.speed); w.walk = 1 - w.run }
    else { w.walk = v / walk.speed; w.idle = 1 - w.walk }
    const moving = w.walk + w.run + w.sprint
    const stance = moving > 1e-3 ? (w.walk * STANCE.walk + w.run * STANCE.run + w.sprint * STANCE.sprint) / moving : STANCE.walk
    // Past its native speed the sprint lengthens its stride as well as its cadence.
    const sprintCycle = this.cycle.sprint * Math.sqrt(Math.max(1, v / sprint.speed))
    const cycle = moving > 1e-3 ? (w.walk * this.cycle.walk + w.run * this.cycle.run + w.sprint * sprintCycle) / moving : this.cycle.walk
    this.gait += stepped / cycle
    this.idleTime += delta
    this.stride = 2 * Math.PI * (this.gait + 0.5)

    if (inAir && !this.wasInAir) {
      this.airTime = 0; this.jumped = runtime.velocity.y > 0
      // The foot on the ground pushes off and trails; the swinging one leads (left mid-stance at stride π).
      this.leapSide = Math.cos(this.stride) < 0 ? -1 : 1
    } else if (inAir) this.airTime += delta
    // Touchdown after more than a hop: the land clip, stronger the longer the fall (about half for a jump on the level,
    // 0.6 s in the air; a full crouch from a second or more).
    if (onFoot && this.wasInAir) { this.landTime = 0; this.landStrength = smooth((this.airTime - 0.2) / 0.7) }
    this.wasInAir = inAir
    this.landTime += delta
    // A sword catching a fall takes over from the falling pose, not from a stand. The take-off crouch is brief, so the
    // jump clip comes in faster for it.
    const takeoff = onFoot && runtime.takeoffTime > 0
    this.air += ((inAir || takeoff || boarding || runtime.phase === 'FLIGHT' ? 1 : 0) - this.air) * (1 - Math.exp(-(takeoff ? 30 : 14) * delta))
    const jump = this.clip('jump'), fall = this.clip('fall'), land = this.clip('land')
    const rise = runtime.velocity.y / JUMP_SPEED, running = smooth((v - walk.speed) / (run.speed - walk.speed))
    // Only the wind-up, the leap and boarding move the jump clock; a landing, or a sword catching the player, holds
    // it (and the share of the falling loop) while the clip fades out.
    if (boarding) {
      const e = runtime.elapsed / FLIGHT_SEQUENCE.board
      this.jumpTime = e < BOARD.lift ? JUMP.lift * e / BOARD.lift : JUMP.lift + (JUMP.reach - JUMP.lift) * Math.min(1, (e - BOARD.lift) / (BOARD.reach - BOARD.lift))
      this.toFall = 0
    } else if (takeoff) {
      // Out of a run the stride has already dipped, so the wind-up starts nearer the bottom of the crouch.
      const from = JUMP.crouch * running
      this.jumpTime = from + (JUMP.lift - from) * Math.min(1, runtime.takeoff / runtime.takeoffTime)
      this.toFall = 0
    } else if (inAir) {
      // Stepping off an edge hangs in the reaching pose; falling faster than a jump comes down turns into the falling loop.
      this.jumpTime = !this.jumped ? JUMP.reach : rise > 0 ? JUMP.lift + (JUMP.apex - JUMP.lift) * (1 - rise) : JUMP.apex + (JUMP.reach - JUMP.apex) * Math.min(1, -rise / 0.9)
      this.toFall = smooth((-rise - 1.1) / 0.6)
    }
    const jumpTime = this.jumpTime, toFall = this.toFall
    this.leap = inAir && this.jumped ? running * (1 - smooth((jumpTime - JUMP.apex) / (JUMP.reach - JUMP.apex))) : 0
    const landTarget = onFoot && !takeoff ? this.landStrength * smooth(this.landTime / 0.06) * (1 - smooth((this.landTime - (land.duration - 0.2)) / 0.2)) * (1 - smooth(v / 3)) : 0
    // Leaving the ground mid-landing (a quick hop, a summon) fades the land clip out, still playing, instead of cutting it.
    this.land = landTarget >= this.land ? landTarget : this.land + (landTarget - this.land) * (1 - Math.exp(-14 * delta))
    const landing = this.land

    const g = this.weight = 1 - runtime.rideMix
    const locomotion = (1 - this.air) * (1 - landing) * g, airborne = this.air * (1 - landing) * g
    this.landWeight = w.land = landing * g
    w.idle *= locomotion; w.walk *= locomotion; w.run *= locomotion; w.sprint *= locomotion
    w.jump = airborne * (1 - toFall); w.fall = airborne * toFall
    // The falling loop keeps its own clock so it runs on while a caught fall fades into the riding pose.
    this.fallTime = w.fall > 1e-4 ? this.fallTime + delta : 0
    this.duty = onFoot && moving > 0.5 && locomotion > 0.5 ? Math.cos(Math.PI * stance) : 1

    for (const target of this.targets) {
      target.rotation.set(0, 0, 0, 0); target.position.set(0, 0, 0)
      target.rotationWeight = 0; target.positionWeight = 0
    }
    const idle = this.clip('idle')
    sample(idle, this.idleTime % idle.duration, w.idle)
    for (const name of LOCOMOTION) {
      const clip = this.clip(name)
      sample(clip, ((this.gait / CYCLES[name] + this.gaits[name].leftStance) % 1) * clip.duration, w[name])
    }
    sample(jump, Math.min(jumpTime, jump.duration), w.jump)
    sample(fall, this.fallTime % fall.duration, w.fall)
    sample(land, Math.min(this.landTime, land.duration), w.land)
    // Whatever the clips leave over is the rest pose.
    for (const target of this.targets) {
      const r = target.rest, rest = Math.max(0, 1 - target.rotationWeight)
      target.rotation.x += r.x * rest; target.rotation.y += r.y * rest; target.rotation.z += r.z * rest; target.rotation.w += r.w * rest
      target.rotation.normalize()
      target.position.addScaledVector(target.restPosition, Math.max(0, 1 - target.positionWeight)).divideScalar(Math.max(1, target.positionWeight))
    }
  }

  /** On (re)activation: the next update measures no stride from wherever the player was last seen as this character. */
  reset() {
    this.placed = false
    this.speed = 0; this.air = 0
    this.wasInAir = false; this.landTime = Infinity; this.land = 0; this.fallTime = 0
    this.jumpTime = JUMP.reach; this.toFall = 0; this.leap = 0
  }

  snapshot() {
    return { stride: this.stride, gait: this.gait, duty: this.duty, speed: this.speed, weight: this.weight, weights: { ...this.weights } }
  }
}
