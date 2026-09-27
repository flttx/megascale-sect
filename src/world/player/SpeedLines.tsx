import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending, Color, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Quaternion,
  Scene, ShaderMaterial, Uniform, Vector3,
} from 'three'
import { atmosphere } from '../sky/atmosphere'
import { useWorldStore } from '../store'
import { getPlayerRuntime } from './playerHandle'
import { smooth } from './playerMotion'

const COUNT = 180
/** Camera-local box the streaks wrap in (m); it starts a metre in front of the lens. */
const BOX = new Vector3(26, 16, 90)

const vertexShader = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uOffset; uniform vec3 uBox; uniform vec3 uDir; uniform float uLength; uniform float uOpacity;
varying float vAlpha; varying float vSide;
/** position = (0 head … 1 tail, side −1…1). Streaks are fixed in the air: they flow past opposite the motion. */
void main() {
  vec3 p = mod(aSeed.xyz * uBox + uOffset, uBox) - 0.5 * uBox;
  p.z -= 0.5 * uBox.z + 1.0;
  // Keep the middle of the view (the rider) clear: heads start at least ~17° off the axis.
  float r = length(p.xy);
  p.xy *= (r + 0.3 * max(-p.z, 0.0) + 1.0) / max(r, 1e-3);
  vec3 q = p + uDir * uLength * (0.6 + 0.8 * aSeed.w) * position.x;
  // About a pixel and a half wide at any depth.
  q += normalize(cross(uDir, q)) * position.y * (0.006 + 0.0025 * max(-q.z, 0.0));
  float depth = -p.z;
  // Streaks sweeping across the view (a side orbit) fade out over the rider, since this pass has no depth to hide them.
  float axis = length(q.xy) / max(-q.z, 0.1);
  vAlpha = uOpacity * smoothstep(0.14, 0.32, axis) * (1.0 - position.x) * smoothstep(2.0, 10.0, depth) * (1.0 - smoothstep(55.0, 90.0, depth)) * (0.5 + 0.5 * aSeed.w);
  vSide = position.y;
  gl_Position = projectionMatrix * vec4(q, 1.0);
}`

const fragmentShader = /* glsl */ `
uniform vec3 uColor; varying float vAlpha; varying float vSide;
void main() { gl_FragColor = vec4(uColor, vAlpha * (1.0 - abs(vSide))); }`

function makeStreaks() {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3))
  geometry.setIndex([0, 2, 1, 1, 2, 3])
  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
  geometry.instanceCount = COUNT
  return geometry
}

const local = new Vector3(), inverse = new Quaternion()

/**
 * Wind streaks rushing past the lens at high flight speed (R5). Drawn in their own pass after the post stack, so
 * fog, clouds and bloom never swallow them; with nothing to show they cost no draw call.
 */
export function SpeedLines() {
  const { scene, mesh, uniforms } = useMemo(() => {
    const uniforms = {
      uOffset: new Uniform(new Vector3()), uBox: new Uniform(BOX), uDir: new Uniform(new Vector3(0, 0, -1)),
      uLength: new Uniform(0), uOpacity: new Uniform(0), uColor: new Uniform(new Color()),
    }
    const material = new ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending })
    const mesh = new Mesh(makeStreaks(), material)
    mesh.name = 'SpeedLines'; mesh.frustumCulled = false
    const scene = new Scene()
    scene.add(mesh)
    return { scene, mesh, uniforms }
  }, [])
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose() }, [mesh])

  useFrame(({ gl, camera }, delta) => {
    const player = getPlayerRuntime()
    const speed = player ? player.velocity.length() : 0
    const playerView = useWorldStore.getState().cameraMode === 'player'
    const target = playerView && player?.phase === 'FLIGHT' ? smooth((speed - 55) / 75) * 0.35 : 0
    // A photo or cinematic camera cuts away from the rider at once, and the streaks go with it.
    const opacity = uniforms.uOpacity.value = playerView ? uniforms.uOpacity.value + (target - uniforms.uOpacity.value) * (1 - Math.exp(-5 * delta)) : 0
    if (opacity < 0.01 || !player || speed < 1) return
    camera.getWorldQuaternion(inverse).invert()
    local.copy(player.velocity).applyQuaternion(inverse)
    const offset = uniforms.uOffset.value.addScaledVector(local, -delta)
    offset.set(offset.x % BOX.x, offset.y % BOX.y, offset.z % BOX.z)
    uniforms.uDir.value.copy(local).normalize()
    uniforms.uLength.value = speed * 0.05
    // Pale in daylight, dimmer at night so the streaks never glow brighter than the scene around them.
    uniforms.uColor.value.setRGB(0.85, 0.92, 1).multiplyScalar(0.35 + 0.65 * Math.min(1, atmosphere.sunIntensity / 2.4))
    const clear = gl.autoClear
    gl.setRenderTarget(null)
    gl.autoClear = false
    gl.render(scene, camera)
    gl.autoClear = clear
  }, 2)
  return null
}
