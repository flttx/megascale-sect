import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AnimationMixer, CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three'
import type { AnimationAction, Group, Mesh, SkinnedMesh } from 'three'
import { CLOUD_SEA_Y } from '../sky/CloudSea'
import { cloudSwell } from '../sky/cloudSwell'
import { useWorldStore } from '../store'
import { withSceneWeather } from '../weather/surfaceWeather'
import { KUN, KUN_PATH } from './layout'
import { playKunCall } from './kunVoice'
import { bindKunDeck, kunDeckHit, updateKunDeck } from './kunDeck'
import { registerWalkables } from '../surfaces'

const KUN_URL = `${import.meta.env.BASE_URL}assets/colossi/kun.glb`.replace(/\/{2,}/g, '/')
useGLTF.preload(KUN_URL)

/** Head and fluke tips ahead of / behind the model origin, its centre of mass (asset metres, build_report). */
const HEAD = 101, TAIL = 159
/** Seconds the breach clip blends in and out over. */
const BLEND_IN = 1.2, BLEND_OUT = 1.8
const CALL_EVERY = 40
/** Seconds a swell of the cloud sea lasts from when the body breaks the tops (longer if it is still breaking them). */
const SWELL_LIFE = 45
/** Bank per yaw rate (coordinated turn: v / g, a little more for show), capped. */
const BANK_GAIN = (KUN.speed / 9.8) * 1.2, BANK_MAX = 0.45
const UP = new Vector3(0, 1, 0), FORWARD = new Vector3(0, 0, 1)
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** Dev: `?kunAt=seconds` starts the kun that far along its loop (screenshots of the breach, the pass overhead…). */
const START = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('kunAt')) || 0 : 0

/**
 * 鲲: the whale-sized kun on its loop around the sect (KUN_PATH). It waits beneath the cloud sea until the
 * pilgrim sets out, breaches in the front valley 7 s later, passes over the spawn toward the hall and circles
 * the ranges, diving back under the clouds far in front. The path drives position and heading (the clips have
 * no root motion); it banks into turns, `swim` loops and `breach_glide` plays once each time it breaches. It
 * calls as it breaches and every 40 s while above the clouds.
 */
export function Kun() {
  const gltf = useGLTF(KUN_URL)
  const root = useRef<Group>(null)
  const started = useWorldStore((state) => state.started)
  const curve = useMemo(() => {
    const c = new CatmullRomCurve3(KUN_PATH.map((p) => new Vector3(...p)), true, 'centripetal')
    c.arcLengthDivisions = 2000
    return c
  }, [])
  const length = useMemo(() => curve.getLength(), [curve])

  // Only one kun, so its scene is used as loaded (a plain clone would lose the skeleton binding).
  const { scene, meshes } = useMemo(() => {
    const meshes: Mesh[] = []
    // Skinned bounds come from the posed bones (the geometry's own are in bone space, ~1 m across).
    withSceneWeather(gltf.scene).updateMatrixWorld(true)
    gltf.scene.traverse((object) => {
      const mesh = object as SkinnedMesh
      if (!mesh.isMesh) return
      meshes.push(mesh)
      // The swimming body bends out of its bind-pose bounds, so it is culled against a sphere a third larger.
      if (mesh.isSkinnedMesh) { mesh.computeBoundingSphere(); mesh.boundingSphere.radius *= 1.3 }
    })
    return { scene: gltf.scene, meshes }
  }, [gltf.scene])
  useEffect(() => {
    const unbind = bindKunDeck(scene)
    const unregister = registerWalkables([{ kind: 'moving', hitAt: kunDeckHit }])
    return () => { unregister(); unbind() }
  }, [scene])

  const anim = useMemo(() => {
    const mixer = new AnimationMixer(scene)
    const action = (name: string): AnimationAction | null => {
      const clip = gltf.animations.find((a) => a.name === name)
      return clip ? mixer.clipAction(clip) : null
    }
    const swim = action('swim'), breach = action('breach_glide')
    return { mixer, swim, breach, duration: breach?.getClip().duration ?? 0 }
  }, [scene, gltf.animations])
  // Started in the effect so a remount (StrictMode, HMR) plays them again after the cleanup stopped them. Stopping
  // restores the bind pose; the actions stay cached (replaying an uncached action throws in three 0.186).
  useEffect(() => {
    anim.swim?.play()
    // The breach is scrubbed by hand (time and weight set every frame), so it never ends by itself.
    if (anim.breach) { anim.breach.timeScale = 0; anim.breach.setEffectiveWeight(0).play() }
    return () => { anim.mixer.stopAllAction() }
  }, [anim])
  useEffect(() => () => { cloudSwell.z = -1 }, [])

  const state = useMemo(() => ({
    distance: START * KUN.speed, breachAt: -Infinity, time: 0, nextCall: Infinity, headY: -Infinity, heading: 0, bank: 0, placed: false, piercing: false, casting: true,
    position: new Vector3(), tangent: new Vector3(), ahead: new Vector3(), head: new Vector3(), tail: new Vector3(), look: new Matrix4(), target: new Quaternion(), roll: new Quaternion(),
    toKun: new Vector3(), right: new Vector3(),
  }), [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __kun?: () => unknown }
    w.__kun = () => ({ position: state.position.toArray().map(Math.round), time: +(state.distance / KUN.speed).toFixed(1), period: +(length / KUN.speed).toFixed(1), bank: +state.bank.toFixed(3), breaching: state.time - state.breachAt < anim.duration, swimming: anim.swim?.isRunning() ?? false, casting: state.casting, swell: cloudSwell.toArray().map((v) => +v.toFixed(2)) })
    return () => { delete w.__kun }
  }, [state, length, anim])

  useFrame(({ camera }, delta) => {
    const group = root.current
    if (!group) return
    const dt = Math.min(delta, 0.1)
    const moving = started || START > 0
    state.time += dt
    if (moving) state.distance += KUN.speed * dt
    const u = ((state.distance / length) % 1 + 1) % 1
    curve.getPointAt(u, state.position)
    curve.getTangentAt(u, state.tangent)

    // Heading and a coordinated-turn bank from the yaw rate (left turn → left side down, a negative roll).
    const heading = Math.atan2(state.tangent.x, state.tangent.z), turn = heading - state.heading
    const yawRate = state.placed && dt > 0 ? Math.atan2(Math.sin(turn), Math.cos(turn)) / dt : 0
    state.heading = heading
    const bank = Math.max(-BANK_MAX, Math.min(BANK_MAX, -yawRate * BANK_GAIN))
    state.bank += (bank - state.bank) * (1 - Math.exp(-dt * 1.2))

    state.ahead.copy(state.position).add(state.tangent)
    state.look.lookAt(state.ahead, state.position, UP)
    state.target.setFromRotationMatrix(state.look).multiply(state.roll.setFromAxisAngle(FORWARD, state.bank))
    // The heading eases toward the path's (the loop's tight turn under the clouds would otherwise snap it).
    if (state.placed) group.quaternion.slerp(state.target, 1 - Math.exp(-dt * 2.5))
    else group.quaternion.copy(state.target)
    group.position.copy(state.position)
    const first = !state.placed
    state.placed = true

    // Breach once the head clears the cloud tops on the way up (not when first placed above them).
    state.head.set(0, 0, HEAD * KUN.scale).applyQuaternion(group.quaternion).add(state.position)
    const surfaced = !first && moving && state.headY < CLOUD_SEA_Y && state.head.y >= CLOUD_SEA_Y
    state.headY = state.head.y
    // Where the body pierces the cloud tops the displaced cloud heaves up round it, and a ring spreads from there.
    state.tail.set(0, 0, -TAIL * KUN.scale).applyQuaternion(group.quaternion).add(state.position)
    // Deep under the cloud tops its shadow falls on nothing that can be seen.
    const casting = Math.max(state.head.y, state.tail.y, state.position.y) > CLOUD_SEA_Y - 60
    if (casting !== state.casting) { state.casting = casting; meshes.forEach((mesh) => { mesh.userData.castShadow = casting }) }
    const piercing = (state.head.y - CLOUD_SEA_Y) * (state.tail.y - CLOUD_SEA_Y) < 0
    if (piercing) {
      const f = (CLOUD_SEA_Y - state.tail.y) / (state.head.y - state.tail.y)
      if (!state.piercing) cloudSwell.z = 0
      cloudSwell.x = state.tail.x + (state.head.x - state.tail.x) * f
      cloudSwell.y = state.tail.z + (state.head.z - state.tail.z) * f
    }
    state.piercing = piercing
    if (cloudSwell.z >= 0) {
      cloudSwell.z = cloudSwell.z > SWELL_LIFE && !piercing ? -1 : cloudSwell.z + dt
      cloudSwell.w += ((piercing ? 1 : 0) - cloudSwell.w) * (1 - Math.exp(-dt * 0.8))
    }

    let calling = surfaced
    if (surfaced) { state.breachAt = state.time; state.nextCall = state.time + CALL_EVERY }
    else if (state.time >= state.nextCall) {
      state.nextCall = state.time + CALL_EVERY * (0.8 + Math.random() * 0.4)
      calling = state.head.y > CLOUD_SEA_Y
    }
    if (calling) {
      const toKun = state.toKun.copy(state.head).sub(camera.position), right = state.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      playKunCall(toKun.length(), right.dot(toKun) / Math.max(1, toKun.length()), surfaced)
    }

    const { swim, breach, duration } = anim
    const since = state.time - state.breachAt
    const w = since < duration ? smooth(0, BLEND_IN, since) * (1 - smooth(duration - BLEND_OUT, duration, since)) : 0
    if (breach) { breach.time = Math.min(Math.max(since, 0), duration); breach.setEffectiveWeight(w) }
    swim?.setEffectiveWeight(1 - w)
    anim.mixer.update(dt)
    group.updateMatrixWorld(true)
    updateKunDeck(state.position, state.distance / KUN.speed % (length / KUN.speed), state.heading, state.head.y)
  }, -2)

  return (
    <group ref={root} name="Colossus_kun">
      <primitive object={scene} scale={KUN.scale} />
    </group>
  )
}
