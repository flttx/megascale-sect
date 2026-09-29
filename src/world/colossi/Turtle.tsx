import { Detailed, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CatmullRomCurve3, Vector3 } from 'three'
import type { Group, Material, Mesh, Object3D, WebGLProgramParametersWithUniforms } from 'three'
import { registerWalkables } from '../surfaces'
import { simulationDelta } from '../simulation'
import { withSceneWeather } from '../weather/surfaceWeather'
import { TURTLE, TURTLE_PATH } from './layout'
import { bindTurtleDeck, turtleDeckHit, updateTurtleDeck } from './turtleDeck'

const turtleUrl = (file: string) => `${import.meta.env.BASE_URL}assets/colossi/${file}`.replace(/\/{2,}/g, '/')
const URLS = [turtleUrl('turtle.glb'), turtleUrl('turtle.lod1.glb')]
useGLTF.preload(URLS)

/** Its shadow is only drawn within this range of the camera. */
const SHADOW_RANGE = 700
/** Dev: `?turtleAt=seconds` starts the turtle that far along its loop. */
const START = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('turtleAt')) || 0 : 0

/** Shared clock for the flippers' stroke (seconds). */
const paddle = { value: 0 }
const paddled = new WeakSet<Material>()
/**
 * The flippers row in the vertex shader: each swings about a fore-and-aft axis at the shell rim (asset x ±85,
 * y 35), fading in beyond it and out above the rim, the fore pair wider and ahead of the hind pair. The shell,
 * rocks and pavilion never move, so the deck stays rigid. Chained before the weather patch (asset metres are the
 * mesh's normalised positions scaled by its node).
 */
function withPaddling(root: Object3D) {
  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (paddled.has(material)) continue
      paddled.add(material)
      const scale = mesh.scale.x, offset = mesh.position.clone()
      material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uPaddle = paddle
        shader.uniforms.uPaddleScale = { value: scale }
        shader.uniforms.uPaddleOffset = { value: offset }
        shader.vertexShader = `uniform float uPaddle;
uniform float uPaddleScale;
uniform vec3 uPaddleOffset;
float paddleAngle(vec3 a) {
  float w = smoothstep(85.0, 125.0, abs(a.x)) * (1.0 - smoothstep(48.0, 62.0, a.y));
  float stroke = a.z > 24.0 ? 0.2 * sin(uPaddle * 0.7) : 0.13 * sin(uPaddle * 0.7 + 1.9);
  return sign(a.x) * w * stroke;
}
vec2 paddleTurn(vec2 p, float angle) { float c = cos(angle), s = sin(angle); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
${shader.vertexShader}`
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  objectNormal.xy = paddleTurn(objectNormal.xy, paddleAngle(position * uPaddleScale + uPaddleOffset));`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec3 asset = transformed * uPaddleScale + uPaddleOffset;
    vec2 pivot = vec2(sign(asset.x) * 85.0, 35.0);
    asset.xy = pivot + paddleTurn(asset.xy - pivot, paddleAngle(asset));
    transformed = (asset - uPaddleOffset) / uPaddleScale;
  }`)
      }
      material.needsUpdate = true
    }
  })
  return root
}

/**
 * 巨鳌 (R10e): a mountain-backed turtle swimming its loop round the south-western sea stack, its underside and
 * flippers in the cloud sea, rising and settling on a slow swell. Its back is a moving walkable deck
 * (turtleDeck.ts) that may be boarded at any time; the path drives position and heading.
 */
export function Turtle() {
  const [gltf, lod] = useGLTF(URLS)
  const root = useRef<Group>(null)
  const curve = useMemo(() => {
    const c = new CatmullRomCurve3(TURTLE_PATH.map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal')
    c.arcLengthDivisions = 1000
    return c
  }, [])
  const length = useMemo(() => curve.getLength(), [curve])
  // One turtle, so the loaded scenes are used as they are. Paddling first, so the weather patch chains onto it.
  const { scene, lodScene, meshes } = useMemo(() => {
    const scene = withSceneWeather(withPaddling(gltf.scene)), lodScene = withSceneWeather(withPaddling(lod.scene))
    const meshes: Mesh[] = []
    for (const s of [scene, lodScene]) s.traverse((object) => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
    return { scene, lodScene, meshes }
  }, [gltf.scene, lod.scene])
  useEffect(() => {
    const unbind = bindTurtleDeck(scene)
    const unregister = registerWalkables([{ kind: 'moving', hitAt: turtleDeckHit }])
    return () => { unregister(); unbind() }
  }, [scene])

  const state = useMemo(() => ({ distance: START * TURTLE.speed, time: 0, casting: true, position: new Vector3(), tangent: new Vector3() }), [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __turtle?: () => unknown; __turtleSetTime?: (t: number) => void }
    w.__turtleSetTime = (t) => { state.distance = t * TURTLE.speed }
    w.__turtle = () => ({ position: state.position.toArray().map(Math.round), time: +(state.distance / TURTLE.speed).toFixed(1), period: +(length / TURTLE.speed).toFixed(1) })
    return () => { delete w.__turtle; delete w.__turtleSetTime }
  }, [state, length])

  useFrame(({ camera }, delta) => {
    const group = root.current
    if (!group) return
    const dt = simulationDelta(delta)
    state.time += dt
    state.distance += TURTLE.speed * dt
    paddle.value = state.time
    const u = ((state.distance / length) % 1 + 1) % 1
    curve.getPointAt(u, state.position)
    curve.getTangentAt(u, state.tangent)
    state.position.y = TURTLE.baseY + Math.sin(state.time * Math.PI * 2 / TURTLE.bobPeriod) * TURTLE.bob
    const heading = Math.atan2(state.tangent.x, state.tangent.z)
    group.position.copy(state.position)
    group.rotation.set(0, heading, 0)
    group.updateMatrixWorld(true)
    const casting = Math.hypot(camera.position.x - state.position.x, camera.position.z - state.position.z) < SHADOW_RANGE
    if (casting !== state.casting) { state.casting = casting; meshes.forEach((mesh) => { mesh.userData.castShadow = casting }) }
    updateTurtleDeck(state.position, heading)
  }, -2)

  return (
    <group ref={root} name="Colossus_turtle">
      <group position={[0, 0, -TURTLE.centerZ * TURTLE.scale]} scale={TURTLE.scale}>
        <Detailed distances={[0, TURTLE.lodDistance]} hysteresis={0.08}>
          <group name="Colossus_turtle_LOD0"><primitive object={scene} /></group>
          <group name="Colossus_turtle_LOD1"><primitive object={lodScene} /></group>
        </Detailed>
      </group>
    </group>
  )
}
