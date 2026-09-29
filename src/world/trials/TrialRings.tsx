import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Matrix4, Quaternion, TorusGeometry, Vector3 } from 'three'
import { glowMaterial, syncGlow } from '../interact/glow'
import { ringNormal, TRIAL_COURSES } from './courses'
import { trialState } from './trials'

/** Torus of radius 1 whose tube swells with distance so far rings stay legible. */
const VERTEX = /* glsl */ `
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vTint;
void main() {
  mat4 model = modelMatrix * instanceMatrix;
  vec3 centre = vec3(normalize(position.xy + vec2(1e-5, 0.0)), 0.0);
  float grow = clamp(distance((model * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition) / 320.0, 1.0, 4.0);
  vec4 world = model * vec4(centre + (position - centre) * grow, 1.0);
  vLocal = position; vWorld = world.xyz;
  vNormalW = normalize(mat3(model) * normal);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`
const FRAGMENT = /* glsl */ `
uniform float uTime; uniform float uNight;
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vTint;
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = 0.35 + 0.65 * pow(abs(dot(normalize(vNormalW), view)), 1.2);
  float sweep = 0.72 + 0.28 * sin(atan(vLocal.y, vLocal.x) * 3.0 - uTime * 2.4);
  vec3 col = vTint * facing * sweep * mix(0.75, 1.15, uNight);
  gl_FragColor = vec4(col * glowFade(vWorld), 1.0);
}
`

const START = new Color(1.25, 0.92, 0.46), IDLE = new Color(0.1, 0.15, 0.19), NEXT = new Color(1.3, 1.55, 1.7)
const FINAL = new Color(1.6, 1.25, 0.6), AFTER = new Color(0.42, 0.58, 0.68), LATER = new Color(0.16, 0.23, 0.28)
const RESTART = new Color(0.34, 0.25, 0.12)

/** Every trial ring in one instanced draw, repainted only when a run starts, advances or ends. */
export function TrialRings() {
  const { mesh, poses } = useMemo(() => {
    const poses: Matrix4[] = []
    const q = new Quaternion(), n = new Vector3(), z = new Vector3(0, 0, 1)
    for (const course of TRIAL_COURSES) course.rings.forEach(([x, y, zz, r], i) => {
      q.setFromUnitVectors(z, ringNormal(course, i, n))
      poses.push(new Matrix4().compose(new Vector3(x, y, zz), q, new Vector3(r, r, r)))
    })
    const rings = new InstancedMesh(new TorusGeometry(1, 0.05, 10, 72), glowMaterial('TrialRings', VERTEX, FRAGMENT), poses.length)
    poses.forEach((pose, i) => { rings.setMatrixAt(i, pose); rings.setColorAt(i, IDLE) })
    rings.name = 'TrialRings'
    rings.frustumCulled = false
    rings.userData.castShadow = false
    rings.renderOrder = 4
    return { mesh: rings, poses }
  }, [])
  useEffect(() => () => { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose() }, [mesh])
  const painted = useMemo(() => ({ version: -1 }), [])
  useFrame((state) => {
    syncGlow(mesh.material, state.clock.elapsedTime)
    if (painted.version === trialState.version) return
    painted.version = trialState.version
    const run = trialState.course, hidden = new Matrix4().makeScale(0, 0, 0)
    let slot = 0
    for (const course of TRIAL_COURSES) course.rings.forEach((_, i) => {
      const k = slot++
      let color: Color | null
      if (!run) color = i === 0 ? START : IDLE
      else if (course !== run) color = i === 0 ? RESTART : null
      else if (i < trialState.next) color = i === 0 ? RESTART : null
      else if (i === trialState.next) color = i === course.rings.length - 1 ? FINAL : NEXT
      else color = i === trialState.next + 1 ? AFTER : LATER
      mesh.setMatrixAt(k, color ? poses[k] : hidden)
      if (color) mesh.setColorAt(k, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return <primitive object={mesh} />
}
