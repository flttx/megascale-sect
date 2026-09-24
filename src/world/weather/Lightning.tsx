import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Uniform, Vector3 } from 'three'
import { worldEvents } from '../events'
import { atmosphere } from '../sky/atmosphere'
import { FOG_GLSL } from '../sky/glsl'

/*
 * One branching bolt per strike, from the storm deck down into the cloud sea. Segments are camera-facing
 * ribbons expanded in the vertex shader; a wide faint copy of the same geometry is the glow halo (bloom
 * adds the rest). The bolt fogs itself because it writes no depth.
 */

const MAX_SEGMENTS = 360
/** Visible seconds per strike; the brightness envelope below has two return strokes. */
const LIFETIME = 0.55

const vertex = /* glsl */ `
attribute vec3 aDir; attribute float aSide; attribute float aWidth; attribute float aBright;
uniform float uWidth;
varying float vBright; varying float vAcross; varying vec3 vWorld;
void main() {
  vec3 toCamera = normalize(cameraPosition - position);
  vec3 side = normalize(cross(aDir, toCamera));
  vec3 world = position + side * aSide * aWidth * uWidth;
  vBright = aBright; vAcross = aSide; vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`
const fragment = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity; uniform float uCore;
varying float vBright; varying float vAcross; varying vec3 vWorld;
${FOG_GLSL}
void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  float fog = heightFog(cameraPosition, toFrag / dist, dist);
  float profile = pow(max(1.0 - abs(vAcross), 0.0), uCore);
  // Fog scatters the bolt into a soft glow instead of hiding it outright.
  gl_FragColor = vec4(uColor * vBright * profile * uIntensity * (1.0 - fog * 0.7), 1.0);
}`

const lerp3 = (a: Vector3, b: Vector3, t: number) => new Vector3().lerpVectors(a, b, t)

/** Midpoint displacement: recursively kinks a straight channel, jitter shrinking with segment length. */
function channel(from: Vector3, to: Vector3, depth: number, roughness: number, random: () => number): Vector3[] {
  let points = [from, to]
  for (let level = 0; level < depth; level++) {
    const next: Vector3[] = [points[0]]
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = a.distanceTo(b)
      const mid = lerp3(a, b, 0.5 + (random() - 0.5) * 0.2)
      mid.x += (random() - 0.5) * length * roughness; mid.z += (random() - 0.5) * length * roughness
      mid.y += (random() - 0.5) * length * roughness * 0.3
      next.push(mid, b)
    }
    points = next
  }
  return points
}

interface Bolt { mesh: Mesh<BufferGeometry, ShaderMaterial>; halo: Mesh<BufferGeometry, ShaderMaterial>; age: number }

function boltMaterial(name: string, width: number, core: number) {
  return new ShaderMaterial({
    name, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: {
      uWidth: new Uniform(width), uColor: new Uniform(new Color('#cfdcff')), uIntensity: new Uniform(0), uCore: new Uniform(core),
      fogTint: new Uniform(atmosphere.fogColor), fogSunColor: new Uniform(atmosphere.sunColor), fogSunDir: new Uniform(atmosphere.sunDirection),
      fogDensity: new Uniform(0), fogFalloff: new Uniform(0), fogBase: new Uniform(0),
    },
  })
}

function createBolt(): Bolt {
  const geometry = new BufferGeometry()
  const vertices = MAX_SEGMENTS * 4
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3))
  geometry.setAttribute('aDir', new BufferAttribute(new Float32Array(vertices * 3), 3))
  geometry.setAttribute('aSide', new BufferAttribute(new Float32Array(vertices), 1))
  geometry.setAttribute('aWidth', new BufferAttribute(new Float32Array(vertices), 1))
  geometry.setAttribute('aBright', new BufferAttribute(new Float32Array(vertices), 1))
  const index = new Uint16Array(MAX_SEGMENTS * 6)
  for (let s = 0; s < MAX_SEGMENTS; s++) index.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6)
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.setDrawRange(0, 0)
  const make = (name: string, material: ShaderMaterial, order: number) => {
    const mesh = new Mesh(geometry, material)
    mesh.name = name; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = order
    mesh.userData.castShadow = false
    return mesh
  }
  return { mesh: make('LightningBolt', boltMaterial('LightningCore', 1, 0.6), 46), halo: make('LightningHalo', boltMaterial('LightningHalo', 9, 2.2), 45), age: LIFETIME }
}

/** Rebuilds the shared bolt geometry for a strike landing at `ground`. */
function shapeBolt(bolt: Bolt, ground: Vector3, random = Math.random) {
  const top = new Vector3(ground.x + (random() - 0.5) * 160, 520 + random() * 160, ground.z + (random() - 0.5) * 160)
  const strokes: { points: Vector3[]; width: number; bright: number }[] = [{ points: channel(top, ground, 7, 0.34, random), width: 2.6, bright: 1 }]
  const main = strokes[0].points
  const branches = 3 + Math.floor(random() * 3)
  for (let i = 0; i < branches; i++) {
    const start = main[Math.floor((0.1 + random() * 0.55) * main.length)]
    const reach = top.distanceTo(ground) * (0.18 + random() * 0.25)
    const angle = random() * Math.PI * 2
    const end = start.clone().add(new Vector3(Math.cos(angle) * reach * 0.6, -reach * (0.6 + random() * 0.3), Math.sin(angle) * reach * 0.6))
    strokes.push({ points: channel(start, end, 5, 0.42, random), width: 1.1 + random() * 0.6, bright: 0.45 + random() * 0.25 })
  }
  const g = bolt.mesh.geometry
  const position = g.attributes.position.array as Float32Array, dir = g.attributes.aDir.array as Float32Array
  const side = g.attributes.aSide.array as Float32Array, width = g.attributes.aWidth.array as Float32Array, bright = g.attributes.aBright.array as Float32Array
  let segment = 0
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.points.length && segment < MAX_SEGMENTS; i++, segment++) {
      const a = stroke.points[i - 1], b = stroke.points[i], d = new Vector3().subVectors(b, a).normalize()
      // Branches taper toward their tips.
      const taper = 1 - (i / stroke.points.length) * (stroke === strokes[0] ? 0.35 : 0.8)
      for (let v = 0; v < 4; v++) {
        const k = segment * 4 + v, p = v < 2 ? a : b
        position.set([p.x, p.y, p.z], k * 3); dir.set([d.x, d.y, d.z], k * 3)
        side[k] = v % 2 === 0 ? -1 : 1; width[k] = stroke.width * taper; bright[k] = stroke.bright * (0.75 + taper * 0.25)
      }
    }
  }
  for (const name of ['position', 'aDir', 'aSide', 'aWidth', 'aBright']) g.attributes[name].needsUpdate = true
  g.setDrawRange(0, segment * 6)
  bolt.age = 0
}

/** Main stroke, a dim pause, then a return stroke — the flicker of a real strike. */
const envelope = (t: number) => Math.exp(-t * 14) + (t > 0.11 ? 0.85 * Math.exp(-(t - 0.11) * 9) : 0) + (t > 0.26 ? 0.35 * Math.exp(-(t - 0.26) * 12) : 0)

export function Lightning() {
  const bolt = useMemo(createBolt, [])
  useEffect(() => worldEvents.on('lightning', ({ position }) => shapeBolt(bolt, new Vector3(...position))), [bolt])
  useEffect(() => () => { bolt.mesh.geometry.dispose(); bolt.mesh.material.dispose(); bolt.halo.material.dispose() }, [bolt])

  useFrame((_, delta) => {
    if (bolt.age >= LIFETIME) { bolt.mesh.visible = bolt.halo.visible = false; return }
    bolt.age += Math.min(delta, 0.05)
    const intensity = bolt.age < LIFETIME ? envelope(bolt.age) : 0
    bolt.mesh.visible = bolt.halo.visible = intensity > 0.01
    for (const [mesh, gain] of [[bolt.mesh, 14], [bolt.halo, 0.9]] as const) {
      const u = mesh.material.uniforms
      u.uIntensity.value = intensity * gain
      u.fogDensity.value = atmosphere.fogDensity; u.fogFalloff.value = atmosphere.fogFalloff; u.fogBase.value = atmosphere.fogBase
    }
  })

  return (
    <>
      <primitive object={bolt.halo} />
      <primitive object={bolt.mesh} />
    </>
  )
}
