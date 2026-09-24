import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Uniform } from 'three'
import { terrainHeight } from '../environment/t02r/terrain'
import { ISLANDS } from '../sites'
import { atmosphere } from '../sky/atmosphere'
import { CLOUD_SEA_Y } from '../sky/CloudSea'
import { FOG_GLSL, NOISE_GLSL } from '../sky/glsl'

/**
 * Waterfalls pouring off island rims into the cloud sea: a curved ribbon with scrolling streak noise
 * and billboard spray at the foot. Transparent and depth-write free, so both fog themselves.
 */

// [island id, rim angle (rad, 0 = +x, π/2 = +z), width m]
const FALLS: [string, number, number][] = [
  ['isle_west', 1.72, 7],
  ['isle_northwest', 0.25, 10],
  ['isle_sky', 1.45, 13],
]

const uniforms = {
  uTime: new Uniform(0), uColor: new Uniform(new Color()), uNight: new Uniform(0),
  fogTint: new Uniform(atmosphere.fogColor), fogSunColor: new Uniform(atmosphere.sunColor), fogSunDir: new Uniform(atmosphere.sunDirection),
  fogDensity: new Uniform(0), fogFalloff: new Uniform(0), fogBase: new Uniform(0),
}

const FOG_APPLY = /* glsl */ `
  vec3 toFrag = vWorld - cameraPosition; float dist = length(toFrag); vec3 dir = toFrag / dist;
  float fog = heightFog(cameraPosition, dir, dist);
`

const fallMaterial = () => new ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, side: DoubleSide, fog: false,
  vertexShader: /* glsl */ `
    attribute vec4 aFall; varying vec4 vFall; varying vec3 vWorld;
    void main() { vFall = aFall; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uColor; uniform float uNight;
    varying vec4 vFall; varying vec3 vWorld;
    ${NOISE_GLSL}
    ${FOG_GLSL}
    void main() {
      float u = vFall.x, m = vFall.y, v = m / vFall.z, seed = vFall.w;
      // Water accelerates as it falls: the streak pattern scrolls faster and stretches further down.
      float t = uTime * (0.9 + v * 1.6);
      float streak = skyNoise(vec2(u * 26.0 + seed, m * 0.045 - t * 1.4)) * 0.6 + skyNoise(vec2(u * 70.0 - seed, m * 0.12 - t * 3.1)) * 0.4;
      float edge = smoothstep(0.0, 0.18 + skyNoise(vec2(m * 0.05, seed)) * 0.12, u) * smoothstep(1.0, 0.82 - skyNoise(vec2(m * 0.05 + 9.0, seed)) * 0.12, u);
      float body = mix(0.28, 1.0, smoothstep(0.38, 0.78, streak));
      // Near the lip it is a glassy sheet; further down it breaks into spray and thins out.
      float alpha = body * edge * smoothstep(0.0, 1.5, m) * (1.0 - smoothstep(0.6, 1.0, v)) * mix(0.9, 0.55, v);
      vec3 col = uColor * (0.82 + streak * 0.3);
      ${FOG_APPLY}
      col = mix(col, fogColorFor(dir), fog);
      gl_FragColor = vec4(col, alpha * (1.0 - fog * 0.35));
    }`,
})

const mistMaterial = () => new ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, fog: false,
  vertexShader: /* glsl */ `
    attribute vec4 aMist; varying vec4 vMist; varying vec3 vWorld;
    void main() {
      // Camera-facing billboard: offsets in aMist.xy along the view's right / up axes.
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 w = position + (right * aMist.x + up * aMist.y) * aMist.z;
      vMist = aMist; vWorld = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uColor; uniform float uNight;
    varying vec4 vMist; varying vec3 vWorld;
    ${NOISE_GLSL}
    ${FOG_GLSL}
    void main() {
      vec2 p = vMist.xy; float r = length(p);
      float puff = skyFbm(p * 1.6 + vec2(vMist.w * 7.0, -uTime * 0.12), 4);
      float alpha = (1.0 - smoothstep(0.35, 1.0, r + (puff - 0.5) * 0.5)) * smoothstep(0.25, 0.6, puff) * 0.55;
      ${FOG_APPLY}
      vec3 col = mix(uColor * 1.05, fogColorFor(dir), fog);
      gl_FragColor = vec4(col, alpha * (1.0 - fog * 0.4));
    }`,
})

function buildFalls() {
  const pos: number[] = [], attr: number[] = [], index: number[] = []
  const mistPos: number[] = [], mistAttr: number[] = [], mistIndex: number[] = []
  const mist = (x: number, y: number, z: number, size: number, seed: number) => {
    const base = mistPos.length / 3
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { mistPos.push(x, y, z); mistAttr.push(cx, cy, size, seed) }
    mistIndex.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  FALLS.forEach(([id, angle, width], k) => {
    const isle = ISLANDS.find((i) => i.id === id)
    if (!isle) return
    const [cx, T, cz] = isle.top, ox = Math.cos(angle), oz = Math.sin(angle), tx = -oz, tz = ox
    const lipR = isle.radius * 1.1, lipY = T - 0.9, base = pos.length / 3
    const bottom = Math.max(CLOUD_SEA_Y + 4, terrainHeight(cx + ox * (lipR + 12), cz + oz * (lipR + 12)) + 3)
    const drop = lipY - bottom, rows = 40, cols = 6
    for (let i = 0; i <= rows; i++) {
      const f = i / rows, m = f * drop
      // Ballistic arc off the lip (outward speed ~4 m/s), spreading as it falls.
      const out = 4 * Math.sqrt((2 * m) / 9.8) * 0.9, half = width * (0.5 + f * 0.45)
      for (let j = 0; j <= cols; j++) {
        const u = j / cols, s = (u - 0.5) * 2 * half, bow = (1 - (u - 0.5) ** 2 * 4) * 0.6
        pos.push(cx + ox * (lipR + out + bow) + tx * s, lipY - m, cz + oz * (lipR + out + bow) + tz * s)
        attr.push(u, m, drop, k * 3.7)
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1
      index.push(a, c, b, b, c, d)
    }
    const footOut = lipR + 4 * Math.sqrt((2 * drop) / 9.8) * 0.9
    for (let n = 0; n < 5; n++) {
      const spread = (n - 2) * width * 0.35
      mist(cx + ox * footOut + tx * spread, bottom + 4 + (n % 2) * 6, cz + oz * footOut + tz * spread, width * (1.6 + (n % 3) * 0.5), k * 5 + n)
    }
    mist(cx + ox * (footOut - 2), bottom + drop * 0.18, cz + oz * (footOut - 2), width * 1.3, k * 5 + 9)
  })
  const falls = new BufferGeometry()
  falls.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  falls.setAttribute('aFall', new BufferAttribute(new Float32Array(attr), 4))
  falls.setIndex(index)
  const spray = new BufferGeometry()
  spray.setAttribute('position', new BufferAttribute(new Float32Array(mistPos), 3))
  spray.setAttribute('aMist', new BufferAttribute(new Float32Array(mistAttr), 4))
  spray.setIndex(mistIndex)
  for (const g of [falls, spray]) g.computeBoundingSphere()
  if (spray.boundingSphere) spray.boundingSphere.radius += 80
  return { falls: new Mesh(falls, fallMaterial()), spray: new Mesh(spray, mistMaterial()) }
}

export function Waterfalls() {
  const { falls, spray } = useMemo(buildFalls, [])
  useEffect(() => () => { for (const mesh of [falls, spray]) { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose() } }, [falls, spray])
  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.1)
    // Lit by the sky: pale by day, warm at dusk, dim silver-blue at night.
    uniforms.uColor.value.copy(atmosphere.fogColor).lerp(atmosphere.sunColor, 0.18).multiplyScalar(1.1 - atmosphere.night * 0.35)
    uniforms.uColor.value.r = Math.min(uniforms.uColor.value.r + 0.08, 1.2)
    uniforms.uColor.value.g = Math.min(uniforms.uColor.value.g + 0.1, 1.2)
    uniforms.uColor.value.b = Math.min(uniforms.uColor.value.b + 0.12, 1.2)
    uniforms.uNight.value = atmosphere.night
    uniforms.fogDensity.value = atmosphere.fogDensity; uniforms.fogFalloff.value = atmosphere.fogFalloff; uniforms.fogBase.value = atmosphere.fogBase
  })
  falls.renderOrder = 2; spray.renderOrder = 3
  return <><primitive object={falls} /><primitive object={spray} /></>
}
