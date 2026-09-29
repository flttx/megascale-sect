import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import { glowMaterial, syncGlow } from '../interact/glow'
import { STREAMS, streamEnds } from './windStreams'

/** Strands per stream (their share of the radius) and the length (m) of one turn of their spiral. */
const STRANDS = [0.3, 0.5, 0.62, 0.42], TURN = 260

const VERTEX = /* glsl */ `
attribute vec3 aTangent; attribute float aSide; attribute vec3 aFlow;
varying float vSide; varying vec3 vFlow; varying vec3 vWorld; varying float vFar;
void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 view = cameraPosition - world;
  float dist = max(length(view), 1e-3);
  // Face the camera; a strand seen end-on has no width rather than a NaN one.
  vec3 across = cross(aTangent, view / dist);
  float l = length(across);
  across = l > 1e-4 ? across / l : vec3(0.0);
  world += across * aSide * (0.45 + dist * 0.0022);
  vSide = aSide; vFlow = aFlow; vWorld = world;
  vFar = 1.0 - smoothstep(1800.0, 3200.0, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`
// vFlow: arc length along the stream (m, offset per strand), air speed (m/s) and the open ends' fade.
const FRAGMENT = /* glsl */ `
uniform float uTime; uniform float uNight;
varying float vSide; varying vec3 vFlow; varying vec3 vWorld; varying float vFar;
void main() {
  float across = 1.0 - vSide * vSide;
  // Comet dashes riding downstream at the air's speed: bright heads, fading tails.
  float u = fract((vFlow.x - uTime * vFlow.y) / 90.0);
  float dash = u * u * u * (1.0 - smoothstep(0.94, 1.0, u));
  float glow = across * (0.12 + dash) * vFlow.z * vFar;
  vec3 col = vec3(0.7, 0.92, 1.0) * glow * mix(0.3, 0.55, uNight);
  gl_FragColor = vec4(col * glowFade(vWorld), 1.0);
}
`

/** One merged ribbon geometry: spiralling strands of flowing light inside every wind stream (a single draw). */
function buildGeometry() {
  const positions: number[] = [], tangents: number[] = [], sides: number[] = [], flows: number[] = [], index: number[] = []
  const t = new Vector3(), n = new Vector3(), b = new Vector3(), up = new Vector3(0, 1, 0), q = new Vector3(), prev = new Vector3(), next = new Vector3()
  const strand = (stream: typeof STREAMS[number], i: number, share: number, phase: number, twist: number, out: Vector3) => {
    t.fromArray(stream.tangent, i * 3)
    n.crossVectors(t, up).normalize(); b.crossVectors(n, t)
    const a = phase + stream.arc[i] * twist, r = stream.radius * share
    return out.fromArray(stream.position, i * 3).addScaledVector(n, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r)
  }
  for (const stream of STREAMS) {
    const count = stream.arc.length
    // A closed loop winds a whole number of turns so its strands meet themselves.
    const twist = (Math.PI * 2 * Math.max(1, Math.round(stream.length / TURN))) / stream.length
    STRANDS.forEach((share, k) => {
      const phase = (k * Math.PI) / 2 + share
      const base = positions.length / 3
      for (let i = 0; i < count; i++) {
        strand(stream, i, share, phase, twist, q)
        strand(stream, Math.max(0, i - 1), share, phase, twist, prev)
        strand(stream, Math.min(count - 1, i + 1), share, phase, twist, next)
        next.sub(prev).normalize()
        const fade = streamEnds(stream, stream.arc[i])
        for (const side of [-1, 1]) {
          positions.push(q.x, q.y, q.z); tangents.push(next.x, next.y, next.z); sides.push(side)
          flows.push(stream.arc[i] + k * 23, stream.speed, fade)
        }
        if (i > 0) { const a = base + (i - 1) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
      }
    })
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangents), 3))
  geometry.setAttribute('aSide', new BufferAttribute(new Float32Array(sides), 1))
  geometry.setAttribute('aFlow', new BufferAttribute(new Float32Array(flows), 3))
  geometry.setIndex(index)
  return geometry
}

/** 灵风 (R10c): the wind streams drawn as faint flowing light, so a flier can find and follow them. */
export function WindRibbons() {
  const mesh = useMemo(() => {
    const ribbons = new Mesh(buildGeometry(), glowMaterial('WindStreams', VERTEX, FRAGMENT))
    ribbons.name = 'WindStreams'
    ribbons.frustumCulled = false
    ribbons.userData.castShadow = false
    ribbons.renderOrder = 3
    return ribbons
  }, [])
  useEffect(() => () => { mesh.geometry.dispose(); mesh.material.dispose() }, [mesh])
  useFrame((state) => syncGlow(mesh.material, state.clock.elapsedTime))
  return <primitive object={mesh} />
}
