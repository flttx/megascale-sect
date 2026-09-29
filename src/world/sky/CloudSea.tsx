import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Uniform, Vector3 } from 'three'
import { atmosphere } from './atmosphere'
import { fogUniforms } from './fog'
import { FOG_GLSL, NOISE_GLSL } from './glsl'
import { hash, terrainHeight } from '../environment/t02r/terrain'
import { useWorldStore } from '../store'
import { QUALITY_PRESETS } from '../quality'

/** Top of the cloud sea; P3 landmarks rise out of it and P4 weather can raise or thin it. */
export const CLOUD_SEA_Y = -84
const LAYER_Y = [CLOUD_SEA_Y - 34, CLOUD_SEA_Y - 17, CLOUD_SEA_Y]

const sharedUniforms = () => ({
  uTime: new Uniform(0), uCover: new Uniform(0.5), uWind: new Uniform(atmosphere.wind),
  uLit: new Uniform(atmosphere.cloudLit), uShade: new Uniform(atmosphere.cloudShade),
  ...fogUniforms,
})

const seaVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`
const seaFragment = /* glsl */ `
varying vec3 vWorld;
uniform float uTime; uniform float uCover; uniform vec2 uWind; uniform float uLayer;
uniform vec3 uLit; uniform vec3 uShade;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 dir = toFrag / dist;
  vec2 p = vWorld.xz * 0.0024 + uWind * uTime * (0.0035 + uLayer * 0.0012) + uLayer * 17.3;
  vec2 warp = vec2(skyFbm(p * 0.6 + 3.1, 3), skyFbm(p * 0.6 - 5.2, 3));
  float n = skyFbm(p + warp * 1.3, 5);
  float cover = mix(0.6, 0.34, uCover) + uLayer * 0.07;
  float alpha = smoothstep(cover, cover + 0.3, n);
  float lit = skyFbm(p + warp * 1.3 + fogSunDir.xz * 0.06, 4);
  float shade = clamp((n - lit) * 3.6 + 0.5 + uLayer * 0.28, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, shade);
  col += fogSunColor * pow(max(dot(dir, fogSunDir), 0.0), 8.0) * 0.45;
  // Toward the horizon the deck closes into a continuous sea and melts into the fog.
  alpha = mix(alpha, 1.0, smoothstep(700.0, 2000.0, dist) * (0.55 + uLayer * 0.4));
  alpha *= smoothstep(18.0, 90.0, dist) * (1.0 - smoothstep(5600.0, 5900.0, dist));
  col = mix(col, fogColorFor(dir), heightFog(cameraPosition, dir, dist) * 0.85);
  gl_FragColor = vec4(col, alpha * (0.72 + uLayer * 0.28));
}`

const puffVertex = /* glsl */ `
attribute float aSeed;
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
void main() {
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center + right * position.x * size.x + up * position.y * size.y;
  vUv = uv; vSeed = aSeed; vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`
const puffFragment = /* glsl */ `
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
uniform float uTime; uniform vec3 uLit; uniform vec3 uShade;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  vec2 q = vUv - 0.5;
  q.y *= 1.35;
  float n = skyFbm(vUv * 3.2 + vSeed * 13.1 + vec2(uTime * 0.006, 0.0), 5);
  float d = length(q) * 2.0 + (n - 0.5) * 0.95;
  float shape = 1.0 - smoothstep(0.3, 0.95, d);
  shape *= smoothstep(0.02, 0.3, vUv.y + n * 0.2);
  if (shape < 0.01) discard;
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 dir = toFrag / dist;
  float shade = clamp(vUv.y * 0.75 + n * 0.55 - 0.1, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, shade);
  col += fogSunColor * pow(max(dot(dir, fogSunDir), 0.0), 6.0) * (1.0 - shape) * 1.2;
  col = mix(col, fogColorFor(dir), heightFog(cameraPosition, dir, dist) * 0.9);
  gl_FragColor = vec4(col, shape * 0.94 * smoothstep(25.0, 140.0, dist));
}`

interface Puff { position: [number, number, number]; size: [number, number] }
/** `banks` false (volumetric sea active) keeps only the far backdrop cumulus. */
function puffs(count: number, banks: boolean): Puff[] {
  const out: Puff[] = []
  // Low banks hugging the mountain's flanks, where the cloud sea meets the cliffs.
  // Candidates whose footprint would cut into the slope are rejected: billboards have no soft depth edge.
  const low = Math.round(count * 0.65)
  for (let i = 0; banks && out.length < low && i < low * 12; i++) {
    const angle = hash(i, 3, 91) * Math.PI * 2, radius = 360 + hash(i, 7, 92) * 560
    const w = 150 + hash(i, 11, 93) * 190, h = w * (0.42 + hash(i, 17, 95) * 0.2)
    const x = Math.cos(angle) * radius * 1.1, z = -290 + Math.sin(angle) * radius, y = CLOUD_SEA_Y - 5 + hash(i, 13, 94) * 60
    const ground = Math.max(...[[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]].map(([u, v]) => terrainHeight(x + u * w, z + v * w)))
    if (ground < y - h * 0.3) out.push({ position: [x, y, z], size: [w, h] })
  }
  // Towering backdrop cumulus beyond the outer regions, in front of the horizon ring; densest behind the main hall.
  const total = banks ? count : count - low
  for (let i = 0; out.length < total; i++) {
    const angle = -Math.PI / 2 + (hash(i, 19, 96) - 0.5) * Math.PI * 1.9, radius = 3900 + hash(i, 23, 97) * 1200
    const w = 900 + hash(i, 29, 98) * 1000
    out.push({ position: [Math.cos(angle) * radius, 260 + hash(i, 31, 99) * 900, -300 + Math.sin(angle) * radius], size: [w, w * (0.5 + hash(i, 37, 100) * 0.25)] })
  }
  return out
}

function syncFog(material: ShaderMaterial, delta: number) {
  const u = material.uniforms
  u.uTime.value += delta
  u.uCover.value = atmosphere.cloudCover
}

export function CloudSea() {
  const quality = useWorldStore((state) => state.quality)
  const { cloudLayers: presetLayers, cloudPuffs, volumetricClouds } = QUALITY_PRESETS[quality]
  // The post-process volumetric sea replaces the planes and flank banks where the preset affords it.
  const cloudLayers = volumetricClouds > 0 ? 0 : presetLayers
  const banks = volumetricClouds === 0
  const layers = useMemo(() => LAYER_Y.slice(LAYER_Y.length - cloudLayers).map((y, i, all) => {
    const material = new ShaderMaterial({
      name: `CloudSea_${i}`, vertexShader: seaVertex, fragmentShader: seaFragment,
      uniforms: { ...sharedUniforms(), uLayer: new Uniform(all.length === 1 ? 1 : i / (all.length - 1)) },
      transparent: true, depthWrite: false, side: DoubleSide, fog: false,
    })
    const mesh = new Mesh(new PlaneGeometry(12000, 12000, 1, 1), material)
    mesh.name = `CloudSeaLayer_${i}`; mesh.rotation.x = -Math.PI / 2; mesh.position.y = y
    mesh.frustumCulled = false; mesh.renderOrder = 10 + i
    mesh.onBeforeRender = (_r, _s, camera) => { mesh.position.x = camera.position.x; mesh.position.z = camera.position.z; mesh.updateMatrixWorld() }
    return mesh
  }), [cloudLayers])

  const bank = useMemo(() => {
    const items = puffs(cloudPuffs, banks)
    const material = new ShaderMaterial({
      name: 'CloudPuffs', vertexShader: puffVertex, fragmentShader: puffFragment, uniforms: sharedUniforms(),
      transparent: true, depthWrite: false, fog: false,
    })
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, items.length)
    const matrix = new Matrix4(), identity = new Quaternion()
    items.forEach((item, i) => mesh.setMatrixAt(i, matrix.compose(new Vector3(...item.position), identity, new Vector3(item.size[0], item.size[1], 1))))
    mesh.geometry.setAttribute('aSeed', new InstancedBufferAttribute(Float32Array.from(items, (_, i) => hash(i, 41, 101)), 1))
    mesh.name = 'CloudPuffs'; mesh.frustumCulled = false; mesh.renderOrder = 20
    return mesh
  }, [cloudPuffs, banks])

  useEffect(() => () => layers.forEach((mesh) => { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose() }), [layers])
  useEffect(() => () => { bank.geometry.dispose(); (bank.material as ShaderMaterial).dispose() }, [bank])

  useFrame((_, delta) => {
    layers.forEach((mesh) => syncFog(mesh.material as ShaderMaterial, delta))
    syncFog(bank.material as ShaderMaterial, delta)
  })

  return (
    <group name="CloudSea">
      {layers.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      <primitive object={bank} />
    </group>
  )
}
