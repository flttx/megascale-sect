import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Uniform, Vector3 } from 'three'
import { hash } from '../environment/t02r/terrain'
import { atmosphere } from '../sky/atmosphere'
import { useWorldStore } from '../store'
import type { QualityLevel } from '../quality'
import { weather } from './weatherMachine'

/*
 * Rain streaks and snow flakes: one instanced quad draw each. Every particle has a fixed slot in a box
 * that wraps around the camera (world-anchored, so walking or flying through the rain is parallax-correct),
 * and a shared drift accumulated on the CPU moves the whole field. Instance count follows intensity.
 */

const COUNTS: Record<QualityLevel, { rain: number; snow: number }> = {
  low: { rain: 4500, snow: 3000 }, mid: { rain: 9000, snow: 6000 }, high: { rain: 14000, snow: 9000 },
}
/** Drift is wrapped at a multiple of the box so per-particle speed factors only reshuffle once in minutes. */
const DRIFT_PERIOD = 64

const COMMON_VERTEX = /* glsl */ `
attribute vec3 aOffset; attribute float aSeed;
uniform vec3 uBox; uniform vec3 uDrift;
varying vec2 vUv; varying float vFade;
// Slot position wrapped into a box centred on the camera; faded at the rim so wrapping never pops.
vec3 wrapped(float speed, out float fade) {
  vec3 p = mod(aOffset * uBox + uDrift * speed - cameraPosition, uBox) - uBox * 0.5;
  fade = (1.0 - smoothstep(0.7, 1.0, length(p.xz) / (uBox.x * 0.5))) * (1.0 - smoothstep(0.75, 1.0, abs(p.y) / (uBox.y * 0.5)));
  return cameraPosition + p;
}
`

const rainVertex = /* glsl */ `
${COMMON_VERTEX}
uniform vec3 uVelocity; uniform float uLength;
void main() {
  float speed = 0.82 + aSeed * 0.36, fade;
  vec3 world = wrapped(speed, fade);
  vec3 axis = normalize(uVelocity);
  vec3 toCamera = cameraPosition - world;
  float dist = length(toCamera);
  // Looking straight along a streak leaves no side vector; any perpendicular will do (it is sub-pixel then).
  vec3 across = cross(axis, toCamera / max(dist, 1e-3));
  vec3 side = dot(across, across) > 1e-8 ? normalize(across) : vec3(1.0, 0.0, 0.0);
  // Never thinner than ~1px; widened streaks give back their extra coverage as transparency.
  float width = max(0.016, dist * 0.0013);
  world += side * position.x * width - axis * position.y * uLength * speed;
  vUv = vec2(position.x + 0.5, position.y);
  vFade = fade * smoothstep(0.5, 2.0, dist) * (0.016 / width);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`
const rainFragment = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv; varying float vFade;
void main() {
  // Interpolated uvs can overshoot 0..1 by an ulp; pow() of a negative is NaN on D3D and bloom smears NaN across the frame.
  vec2 uv = clamp(vUv, 0.0, 1.0);
  float across = 1.0 - pow(abs(uv.x * 2.0 - 1.0), 2.0);
  float along = smoothstep(0.0, 0.1, uv.y) * pow(1.0 - uv.y, 0.8);
  gl_FragColor = vec4(uColor, clamp(across * along * vFade * uOpacity, 0.0, 1.0));
}`

const snowVertex = /* glsl */ `
${COMMON_VERTEX}
uniform float uTime;
void main() {
  float speed = 0.7 + aSeed * 0.6, fade;
  vec3 world = wrapped(speed, fade);
  // Flakes flutter on their own slow orbits.
  float t = uTime * (0.5 + aSeed * 0.9) + aSeed * 40.0;
  world.xz += vec2(sin(t), cos(t * 0.83)) * (0.25 + aSeed * 0.35);
  float dist = length(cameraPosition - world);
  float size = max(0.035 + aSeed * 0.05, dist * 0.0016);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  world += (right * position.x + up * (position.y - 0.5)) * size;
  vUv = vec2(position.x + 0.5, position.y);
  vFade = fade * smoothstep(0.3, 1.2, dist) * min(1.0, pow((0.035 + aSeed * 0.05) / size, 2.0) * 1.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`
const snowFragment = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv; varying float vFade;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vFade * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`

interface Field { mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; drift: Vector3; box: Vector3 }

function field(name: string, count: number, box: Vector3, vertexShader: string, fragmentShader: string, salt: number): Field {
  const geometry = new InstancedBufferGeometry()
  // Unit quad: x across (-0.5..0.5), y along the streak or flake (0..1).
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  const offsets = new Float32Array(count * 3), seeds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = hash(i, salt, 1); offsets[i * 3 + 1] = hash(i, salt, 2); offsets[i * 3 + 2] = hash(i, salt, 3)
    seeds[i] = hash(i, salt, 4)
  }
  geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3))
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))
  geometry.instanceCount = 0
  const material = new ShaderMaterial({
    // Streaks are oriented per vertex, so their winding flips with view direction.
    name, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: false, side: DoubleSide,
    uniforms: {
      uBox: new Uniform(box), uDrift: new Uniform(new Vector3()), uVelocity: new Uniform(new Vector3(0, -1, 0)),
      uLength: new Uniform(0.7), uTime: new Uniform(0), uColor: new Uniform(new Color()), uOpacity: new Uniform(0),
    },
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = 40
  mesh.userData.castShadow = false
  mesh.visible = false
  return { mesh, drift: material.uniforms.uDrift.value as Vector3, box }
}

const wrapDrift = (drift: Vector3, box: Vector3) => {
  const wrap = (value: number, size: number) => ((value % (size * DRIFT_PERIOD)) + size * DRIFT_PERIOD) % (size * DRIFT_PERIOD)
  drift.set(wrap(drift.x, box.x), wrap(drift.y, box.y), wrap(drift.z, box.z))
}
const light = new Color(), fogPart = new Color(), flashTint = new Color('#dfe6ff')

export function Precipitation() {
  const quality = useWorldStore((state) => state.quality)
  const { rain, snow } = useMemo(() => {
    const counts = COUNTS[quality]
    return {
      rain: field('Rain', counts.rain, new Vector3(52, 32, 52), rainVertex, rainFragment, 211),
      snow: field('Snow', counts.snow, new Vector3(56, 30, 56), snowVertex, snowFragment, 223),
    }
  }, [quality])

  useEffect(() => () => [rain, snow].forEach(({ mesh }) => { mesh.geometry.dispose(); mesh.material.dispose() }), [rain, snow])

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1), a = atmosphere, b = weather.blend
    // Ambient sky light carries the particles; lightning lights them up for a beat.
    light.copy(a.hemiSky).multiplyScalar(a.hemiIntensity * 0.55).add(fogPart.copy(a.fogColor).multiplyScalar(0.35))

    const rainAmount = Math.min(1, b.rain / 1.35)
    const r = rain.mesh, ru = r.material.uniforms
    r.visible = rainAmount > 0.01
    if (r.visible) {
      const velocity = ru.uVelocity.value as Vector3
      velocity.set(a.wind.x * 0.45, -10.5, a.wind.y * 0.45)
      rain.drift.addScaledVector(velocity, delta); wrapDrift(rain.drift, rain.box)
      r.geometry.instanceCount = Math.round(r.geometry.attributes.aSeed.count * rainAmount)
      ru.uLength.value = 0.8 + b.storm * 0.4
      ru.uOpacity.value = 0.85 * Math.min(1, rainAmount * 3)
      ;(ru.uColor.value as Color).copy(light).multiplyScalar(1.7).lerp(flashTint, Math.min(1, weather.flash)).multiplyScalar(1 + weather.flash * 3)
    }

    const s = snow.mesh, su = s.material.uniforms
    s.visible = b.snow > 0.01
    if (s.visible) {
      snow.drift.x += a.wind.x * 0.6 * delta; snow.drift.y -= 1.25 * delta; snow.drift.z += a.wind.y * 0.6 * delta
      wrapDrift(snow.drift, snow.box)
      s.geometry.instanceCount = Math.round(s.geometry.attributes.aSeed.count * Math.min(1, b.snow))
      su.uTime.value = state.clock.elapsedTime % 3000
      su.uOpacity.value = 0.9 * Math.min(1, b.snow * 3)
      ;(su.uColor.value as Color).copy(light).multiplyScalar(1.5).add(fogPart.copy(a.sunColor).multiplyScalar(0.25 * (1 - a.night)))
    }
  })

  return (
    <>
      <primitive object={rain.mesh} />
      <primitive object={snow.mesh} />
    </>
  )
}
