import { Detailed, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AnimationMixer, CatmullRomCurve3, Vector3 } from 'three'
import type { AnimationAction, AnimationClip, Group, Mesh, Object3D, SkinnedMesh } from 'three'
import { registerWalkables } from '../surfaces'
import { simulationDelta } from '../simulation'
import { withSceneWeather } from '../weather/surfaceWeather'
import { TURTLE, TURTLE_PATH } from './layout'
import { bindTurtleDeck, turtleDeckHit, updateTurtleDeck } from './turtleDeck'
import { useWorldStore } from '../store'
import { ColossusMutation, createColossusMutationAnchors } from '../blackMist/ColossusMutation'
import { useEldritchLoadingStore } from '../blackMist/eldritchLoading'

const turtleUrl = (file: string) => `${import.meta.env.BASE_URL}assets/colossi/${file}`.replace(/\/{2,}/g, '/')
const URLS = [turtleUrl('turtle.glb'), turtleUrl('turtle.lod1.glb')]
useGLTF.preload(URLS)

/** Its shadow is only drawn within this range of the camera. */
const SHADOW_RANGE = 700
/** Dev: `?turtleAt=seconds` starts the turtle that far along its loop. */
const START = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('turtleAt')) || 0 : 0

/** Its forward speed swells by this fraction with each downstroke of the fore flippers. */
const SURGE = 0.08
/**
 * Stroke angles (rad past the top of the stroke) where the body rides highest, just after the downstroke ends
 * (~37 % of the stroke), and moves fastest, mid-downstroke.
 */
const HEAVE_PEAK = 2.6,
  SURGE_PEAK = 1.2

/**
 * 巨鳌 (R10e): a mountain-backed turtle swimming its loop round the south-western sea stack, its underside and
 * flippers in the cloud sea. The skinned `swim` clip (R11, build_turtle.py) strokes the flippers and turns the head;
 * the body rises after each downstroke and surges a little with it. Clip, heave and surge all run off one cruise
 * clock, so `?turtleAt` reproduces a moment exactly. Its back is a moving walkable deck (turtleDeck.ts) that may
 * be boarded at any time; the path drives position and heading.
 */
export function Turtle() {
  const [gltf, lod] = useGLTF(URLS)
  const root = useRef<Group>(null)
  const mutated = useWorldStore((state) => state.gameMode === 'black-mist')
  const mutationReady = useEldritchLoadingStore((state) => state.status === 'ready')
  const curve = useMemo(() => {
    const c = new CatmullRomCurve3(
      TURTLE_PATH.map(([x, z]) => new Vector3(x, 0, z)),
      true,
      'centripetal',
    )
    c.arcLengthDivisions = 1000
    return c
  }, [])
  const length = useMemo(() => curve.getLength(), [curve])
  // One turtle, so the loaded scenes are used as they are (a plain clone would lose the skeleton binding).
  const { scene, lodScene, meshes } = useMemo(() => {
    const scene = withSceneWeather(gltf.scene),
      lodScene = withSceneWeather(lod.scene)
    const meshes: Mesh[] = []
    for (const s of [scene, lodScene]) {
      // Skinned bounds come from the posed bones; the strokes reach past the bind pose, so the sphere is a third larger.
      s.updateMatrixWorld(true)
      s.traverse((object) => {
        const mesh = object as SkinnedMesh
        if (!mesh.isMesh) return
        meshes.push(mesh)
        if (mesh.isSkinnedMesh) {
          mesh.computeBoundingSphere()
          mesh.boundingSphere.radius *= 1.3
        }
      })
    }
    return { scene, lodScene, meshes }
  }, [gltf.scene, lod.scene])
  const mutationAnchors = useMemo(() => createColossusMutationAnchors('turtle', scene), [scene])
  useEffect(() => {
    const unbind = bindTurtleDeck(scene)
    const unregister = registerWalkables([{ kind: 'moving', hitAt: turtleDeckHit }])
    return () => {
      unregister()
      unbind()
    }
  }, [scene])

  // One mixer per level; both are posed at the same clip time, so the switch between them never jumps.
  const anim = useMemo(() => {
    const levels: [Object3D, AnimationClip[]][] = [
      [scene, gltf.animations],
      [lodScene, lod.animations],
    ]
    const actions: AnimationAction[] = []
    const mixers = levels.map(([root, clips]) => {
      const mixer = new AnimationMixer(root)
      const clip = clips.find((c) => c.name === 'swim')
      if (clip) actions.push(mixer.clipAction(clip))
      return mixer
    })
    return { mixers, actions, duration: actions[0]?.getClip().duration ?? 0 }
  }, [scene, lodScene, gltf.animations, lod.animations])
  // Played in the effect so a remount (StrictMode, HMR) plays them again after the cleanup stopped them; the actions
  // stay cached (replaying an uncached action throws in three 0.186).
  useEffect(() => {
    anim.actions.forEach((action) => action.play())
    return () => anim.mixers.forEach((mixer) => mixer.stopAllAction())
  }, [anim])

  const state = useMemo(() => ({ clock: START, casting: true, position: new Vector3(), tangent: new Vector3() }), [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __turtle?: () => unknown; __turtleSetTime?: (t: number) => void }
    w.__turtleSetTime = (t) => {
      state.clock = t
    }
    w.__turtle = () => ({
      position: state.position.toArray().map(Math.round),
      time: +state.clock.toFixed(1),
      period: +(length / TURTLE.speed).toFixed(1),
      clip: +(state.clock % (anim.duration || 1)).toFixed(2),
    })
    return () => {
      delete w.__turtle
      delete w.__turtleSetTime
    }
  }, [state, length, anim])

  useFrame(({ camera }, delta) => {
    const group = root.current
    if (!group) return
    state.clock += simulationDelta(delta)
    const stroke = (state.clock / TURTLE.stroke) * Math.PI * 2
    const distance =
      TURTLE.speed * (state.clock + SURGE * (TURTLE.stroke / (Math.PI * 2)) * Math.sin(stroke - SURGE_PEAK))
    const u = (((distance / length) % 1) + 1) % 1
    curve.getPointAt(u, state.position)
    curve.getTangentAt(u, state.tangent)
    state.position.y = TURTLE.baseY + Math.cos(stroke - HEAVE_PEAK) * TURTLE.bob
    const heading = Math.atan2(state.tangent.x, state.tangent.z)
    group.position.copy(state.position)
    group.rotation.set(0, heading, 0)
    if (anim.duration > 0) {
      const time = state.clock % anim.duration
      for (const action of anim.actions) action.time = time
      for (const mixer of anim.mixers) mixer.update(0)
    }
    group.updateMatrixWorld(true)
    const casting =
      Math.hypot(camera.position.x - state.position.x, camera.position.z - state.position.z) < SHADOW_RANGE
    if (casting !== state.casting) {
      state.casting = casting
      meshes.forEach((mesh) => {
        mesh.userData.castShadow = casting
      })
    }
    updateTurtleDeck(state.position, heading)
  }, -2)

  return (
    <group ref={root} name="Colossus_turtle">
      <group position={[0, 0, -TURTLE.centerZ * TURTLE.scale]} scale={TURTLE.scale}>
        <Detailed distances={[0, TURTLE.lodDistance]} hysteresis={0.08}>
          <group name="Colossus_turtle_LOD0">
            <primitive object={scene} />
          </group>
          <group name="Colossus_turtle_LOD1">
            <primitive object={lodScene} />
          </group>
        </Detailed>
        {mutated && mutationReady && <ColossusMutation creature="turtle" anchors={mutationAnchors} />}
      </group>
    </group>
  )
}
