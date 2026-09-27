import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  DataTexture, DoubleSide, Float32BufferAttribute, FloatType, InstancedBufferAttribute, InstancedBufferGeometry,
  MeshStandardMaterial, NearestFilter, RGBAFormat, ShaderChunk, Uniform, Vector2, Vector3, Vector4,
} from 'three'
import type { BufferGeometry, Mesh } from 'three'
import { siteClearance } from '../sites'
import { atmosphere } from '../sky/atmosphere'
import { useWorldStore } from '../store'
import { getPlayerRuntime } from '../player/playerHandle'
import { SURFACE_WEATHER_UNIFORMS } from '../weather/surfaceWeather'
import { ENV_COVER_GLSL } from './t02r/materials'
import { buildingDistance, roadAt, roadDistance } from './t02r/terrain'
import type { TerrainGrid } from './t02r/terrain'
import { SURFACE_SETS, surfaceTextures } from './terrainTextures'

/** Terrain bake around the camera: N×N texels, SPACING metres apart. */
const N = 96, SPACING = 1.5, HALF = N / 2
/** Rebake once the camera is this far from the bake centre, led by up to LEAD frames of its motion; bake at once (teleport) beyond JUMP. */
const REBAKE = 16, JUMP = 48, LEAD = 8
const BAKE_BUDGET_MS = 1.5
/** Tufts per side of the wrapped patch, patch size (m), and the distance band over which blades shrink away. */
const QUALITY = { high: { grid: 300, patch: 80, start: 26, end: 38 }, mid: { grid: 200, patch: 64, start: 20, end: 30 } } as const
const BLADES = 5, BLADE_VERTS = 7

/** Shared wind phases (radians, wrapped), integrated on the CPU like the pines so a change of wind never jumps them. */
const GRASS_WIND = { uGrassGust: new Uniform(0), uGrassFlutter: new Uniform(0), uGrassWind: new Uniform(atmosphere.wind) }

/** Paved, built and interactive ground where no grass may grow, whatever the terrain paint says. */
function grassAllowed(x: number, z: number) {
  if (Math.abs(x) < 191 && z > -517 && z < -64) return false
  if (Math.abs(x) < 16 && Math.abs(z - 150) < 13) return false
  if (roadDistance(x, z) < (z >= 20 ? roadAt(z).width / 2 + 3.5 : 14)) return false
  return buildingDistance(x, z) >= 3 && siteClearance(x, z) > 0
}

/** Index of the grid cell holding v (clamped to the grid). */
function cell(lines: number[], v: number) {
  let lo = 0, hi = lines.length - 2
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid] <= v) lo = mid; else hi = mid - 1 }
  return lo
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Height, normal and ground-cover mask of the rendered terrain triangles, baked into a float texture that
 * follows the camera: R height, G/B normal x/z, A the terrain's collect mask (or −1 where grass is barred).
 * Rows are baked a few per frame into a back buffer and swapped in whole, together with the origin.
 */
class TerrainBake {
  readonly data = new Float32Array(N * N * 4)
  readonly texture = new DataTexture(this.data, N, N, RGBAFormat, FloatType)
  /** World xz of texel (0, 0). */
  readonly origin = new Vector2()
  maxY = -Infinity
  private readonly next = new Float32Array(N * N * 4)
  private readonly cols = new Int32Array(N)
  private readonly colU = new Float32Array(N)
  private readonly centre = new Vector2(Infinity, Infinity)
  private readonly target = new Vector2()
  private readonly last = new Vector2()
  private row = -1
  private nextMaxY = -Infinity
  private readonly xs: number[]
  private readonly zs: number[]
  private readonly position: ArrayLike<number>
  private readonly normal: ArrayLike<number>
  private readonly mask: ArrayLike<number>

  constructor(terrain: BufferGeometry) {
    const grid = terrain.userData.grid as TerrainGrid
    this.xs = grid.xs; this.zs = grid.zs
    this.position = terrain.getAttribute('position').array
    this.normal = terrain.getAttribute('normal').array
    this.mask = terrain.getAttribute('surfaceMask').array
    this.texture.minFilter = this.texture.magFilter = NearestFilter
    this.texture.generateMipmaps = false
  }

  /** Keeps the bake centred near (x, z); returns true when a new bake was swapped in. */
  update(x: number, z: number) {
    const vx = x - this.last.x, vz = z - this.last.y
    this.last.set(x, z)
    const far = Math.hypot(x - this.centre.x, z - this.centre.y)
    if (far > JUMP) { this.start(x, z); while (this.row < N) this.bakeRow(this.row++); this.commit(); return true }
    if (this.row < 0) {
      if (far <= REBAKE) return false
      // Centre the next bake ahead of the camera, so a fast, low pass does not outrun it while it bakes.
      const k = Math.min(LEAD, REBAKE / (Math.hypot(vx, vz) || 1))
      this.start(x + vx * k, z + vz * k)
    }
    const until = performance.now() + BAKE_BUDGET_MS
    while (this.row < N && performance.now() < until) this.bakeRow(this.row++)
    if (this.row < N) return false
    this.commit()
    return true
  }

  private start(x: number, z: number) {
    this.target.set(Math.round(x / SPACING) * SPACING, Math.round(z / SPACING) * SPACING)
    this.row = 0; this.nextMaxY = -Infinity
    const xs = this.xs, x0 = this.target.x - HALF * SPACING
    for (let c = 0; c < N; c++) {
      const wx = x0 + c * SPACING, i = cell(xs, wx)
      this.cols[c] = i; this.colU[c] = clamp01((wx - xs[i]) / (xs[i + 1] - xs[i]))
    }
  }

  private commit() {
    this.data.set(this.next)
    this.texture.needsUpdate = true
    this.centre.copy(this.target)
    this.origin.set(this.target.x - HALF * SPACING, this.target.y - HALF * SPACING)
    this.maxY = this.nextMaxY
    this.row = -1
  }

  private bakeRow(r: number) {
    const { xs, zs, position: P, normal: M, mask: S, next } = this, n = xs.length
    const x0 = this.target.x - HALF * SPACING, wz = this.target.y + (r - HALF) * SPACING
    const j = cell(zs, wz), v = clamp01((wz - zs[j]) / (zs[j + 1] - zs[j]))
    for (let c = 0; c < N; c++) {
      const i = this.cols[c], u = this.colU[c], a = j * n + i
      // The quad's two triangles split along b–c, as heightMesh indexes them: (a, c, b) and (b, c, d).
      let ia: number, ib: number, ic: number, wa: number, wb: number, wc: number
      if (u + v <= 1) { ia = a; ib = a + 1; ic = a + n; wa = 1 - u - v; wb = u; wc = v }
      else { ia = a + 1; ib = a + n; ic = a + n + 1; wa = 1 - v; wb = 1 - u; wc = u + v - 1 }
      const h = P[ia * 3 + 1] * wa + P[ib * 3 + 1] * wb + P[ic * 3 + 1] * wc
      const nx = M[ia * 3] * wa + M[ib * 3] * wb + M[ic * 3] * wc
      const ny = M[ia * 3 + 1] * wa + M[ib * 3 + 1] * wb + M[ic * 3 + 1] * wc
      const nz = M[ia * 3 + 2] * wa + M[ib * 3 + 2] * wb + M[ic * 3 + 2] * wc
      const len = Math.hypot(nx, ny, nz) || 1
      const o = (r * N + c) * 4
      next[o] = h; next[o + 1] = nx / len; next[o + 2] = nz / len
      // Steep faces and the ground under the clouds never carry grass; skip the (costlier) exclusion test there.
      const ok = ny / len >= 0.45 && h >= -150 && grassAllowed(x0 + c * SPACING, wz)
      next[o + 3] = ok ? S[ia * 2] * wa + S[ib * 2] * wb + S[ic * 2] * wc + 0.8 * (S[ia * 2 + 1] * wa + S[ib * 2 + 1] * wb + S[ic * 2 + 1] * wc) : -1
      if (ok && h > this.nextMaxY) this.nextMaxY = h
    }
  }
}

/** One tuft of five blades (7 vertices each: three side pairs up the blade and a tip), instanced over a jittered grid. */
function makeTuftField(grid: number) {
  const position: number[] = [], index: number[] = []
  for (let b = 0; b < BLADES; b++) {
    const o = b * BLADE_VERTS
    for (const t of [0, 0.35, 0.7]) position.push(-1, t, b, 1, t, b)
    position.push(0, 1, b)
    index.push(o, o + 1, o + 3, o, o + 3, o + 2, o + 2, o + 3, o + 5, o + 2, o + 5, o + 4, o + 4, o + 5, o + 6)
  }
  const blade = new Float32Array(grid * grid * 4)
  let seed = 0x9e3779b9
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  for (let j = 0, k = 0; j < grid; j++) for (let i = 0; i < grid; i++, k += 4) {
    blade[k] = (i + random()) / grid; blade[k + 1] = (j + random()) / grid
    blade[k + 2] = random(); blade[k + 3] = random()
  }
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.setAttribute('aBlade', new InstancedBufferAttribute(blade, 4))
  geometry.instanceCount = grid * grid
  return geometry
}

const albedoLayer = (set: (typeof SURFACE_SETS)[number]) => `${SURFACE_SETS.indexOf(set)}.0`

const VERTEX_HEAD = /* glsl */ `
attribute vec4 aBlade;
uniform sampler2D uGrassBake; uniform vec2 uGrassOrigin; uniform vec3 uGrassEye; uniform vec4 uGrassPatch;
uniform float uGrassGust; uniform float uGrassFlutter; uniform vec2 uGrassWind; uniform vec4 uGrassPush;
uniform float uWxSnow; uniform sampler2DArray uSurfAlbedo;
varying vec3 vGrassColor; varying float vGrassT;
${ENV_COVER_GLSL}
/**
 * position = (side −1…1, height fraction t, blade index). aBlade = (home x, home z in the unit patch, two randoms).
 * Each tuft wraps to stay within half a patch of the eye, reads the terrain bake at its root, and grows only where
 * the terrain is painted with grass or moss; blades bend along a circular arc (length kept) in the wind.
 */
void grassBlade(out vec3 pos, out vec3 nrm) {
  float P = uGrassPatch.x, fadeStart = uGrassPatch.y, fadeEnd = uGrassPatch.z;
  vec2 home = aBlade.xy * P;
  vec2 root = home + P * floor((uGrassEye.xz - home) / P + 0.5);
  pos = vec3(root.x, -1e4, root.y); nrm = vec3(0.0, 1.0, 0.0); vGrassColor = vec3(0.0); vGrassT = 0.0;
  if (distance(root, uGrassEye.xz) > fadeEnd) return;
  vec2 f = (root - uGrassOrigin) / ${SPACING.toFixed(1)};
  ivec2 i0 = ivec2(floor(f));
  if (any(lessThan(i0, ivec2(0))) || any(greaterThan(i0, ivec2(${N - 2})))) return;
  vec4 s00 = texelFetch(uGrassBake, i0, 0), s10 = texelFetch(uGrassBake, i0 + ivec2(1, 0), 0);
  vec4 s01 = texelFetch(uGrassBake, i0 + ivec2(0, 1), 0), s11 = texelFetch(uGrassBake, i0 + ivec2(1, 1), 0);
  if (min(min(s00.a, s10.a), min(s01.a, s11.a)) < 0.0) return;
  vec2 t2 = fract(f);
  // Split each texel cell along the same diagonal as the terrain mesh, so roots sit on the rendered triangles.
  vec4 s = t2.x + t2.y <= 1.0 ? s00 + (s10 - s00) * t2.x + (s01 - s00) * t2.y : s11 + (s01 - s11) * (1.0 - t2.x) + (s10 - s11) * (1.0 - t2.y);
  vec3 p = vec3(root.x, s.r, root.y);
  vec3 n = normalize(vec3(s.g, sqrt(max(1.0 - s.g * s.g - s.b * s.b, 0.0)), s.b));
  float d = distance(p, uGrassEye);
  float fade = 1.0 - smoothstep(fadeStart, fadeEnd, d);
  if (fade <= 0.0) return;
  // Tufts outside the view (with a metre of slack for the blades) are dropped before the costly cover tests.
  vec4 clip = projectionMatrix * viewMatrix * vec4(p + vec3(0.0, 0.3, 0.0), 1.0);
  if (clip.w < -1.0 || any(greaterThan(abs(clip.xy), clip.w * 1.1 + vec2(projectionMatrix[0][0], projectionMatrix[1][1])))) return;
  float far = smoothstep(fadeStart * 0.5, fadeEnd, d);
  float r = aBlade.z, h2 = fract(r * 7.13 + aBlade.w * 3.7);
  if (r >= 1.0 - far * 0.5) return;
  float veg, scree;
  envCover(p, n, clamp(s.a, 0.0, 1.0), veg, scree);
  float grassy = envGrassy(p, n);
  // Full tufts wherever the cover is more than a light dusting, thinning only toward bare ground and scree.
  float density = smoothstep(0.06, 0.5, veg * (1.0 - scree)) * mix(0.45, 1.0, grassy);
  // Fewer, wider blades toward the fade edge keep the cover's look while the count drops; a tuft shrinks away
  // as the threshold passes it instead of vanishing at full height.
  float keep = density * (1.0 - far * 0.5);
  if (r >= keep) return;

  float side = position.x, t = position.y, b = position.z;
  // Blades of one tuft differ in height, fan out around it (with jitter) and root a few centimetres apart.
  float hb = fract(h2 * 5.3 + b * 0.618), spread = 0.02 + 0.07 * fract(r * 17.3 + b * 0.41);
  float H = mix(0.22, 0.55, grassy) * (0.65 + 0.7 * h2) * (0.6 + 0.8 * hb) * fade * (1.0 - uWxSnow * 0.75)
    * (1.0 - smoothstep(keep - 0.08, keep, r));
  // Width follows height, so short blades stay slender instead of reading as thorns.
  float W = H * 0.075 * (0.8 + 0.4 * hb) * (1.0 + far * 1.2);
  float yaw = aBlade.w * 6.2832 + b * ${(Math.PI * 2 / BLADES).toFixed(4)} + (fract(r * 31.7 + b * 0.73) - 0.5) * 0.9;
  vec2 dirRest = vec2(cos(yaw), sin(yaw));
  vec3 across = vec3(-dirRest.y, 0.0, dirRest.x);
  // Rest lean outward from the tuft, the gust wave rolling downwind, per-blade flutter, and the player pushing through.
  float w = length(uGrassWind);
  vec2 wd = w > 1e-3 ? uGrassWind / w : vec2(1.0, 0.0);
  float gust = 0.5 + 0.5 * sin(uGrassGust - dot(root, wd) * 0.18 + r * 0.9);
  float bendW = (0.1 + w * 0.05) * (0.3 + 0.7 * gust * gust)
    + sin(uGrassFlutter + aBlade.w * 40.0 + b * 1.7) * 0.06 * (0.5 + w * 0.1);
  vec2 B = dirRest * (0.25 + 0.35 * fract(r * 13.7 + b * 0.37)) + wd * bendW;
  vec2 away = root - uGrassPush.xz;
  float pd = length(away), lift = uGrassPush.y - p.y, R = uGrassPush.w;
  float push = (1.0 - smoothstep(0.35 * R, R, pd)) * (1.0 - smoothstep(0.6, 0.6 + 1.5 * R, lift)) * step(-0.8, lift);
  B += (pd > 1e-3 ? away / pd : dirRest) * push * 1.3;
  float bl = length(B), theta = clamp(bl, 1e-3, 1.3);
  vec3 bend = vec3(B.x, 0.0, B.y) / max(bl, 1e-3);
  float horiz = H * (1.0 - cos(theta * t)) / theta, vert = H * sin(theta * t) / theta;
  float width = W * (1.0 - t * sqrt(t));
  pos = p + vec3(dirRest.x, 0.0, dirRest.y) * spread + across * side * width + bend * horiz + vec3(0.0, vert - 0.04, 0.0);
  vec3 tangent = bend * sin(theta * t) + vec3(0.0, cos(theta * t), 0.0);
  vec3 nb = normalize(cross(across, tangent));
  if (dot(nb, uGrassEye - pos) < 0.0) nb = -nb;
  // Mostly the ground's normal, so the cover shades like the terrain it grows from instead of striping.
  nrm = normalize(mix(n, nb, 0.25));
  vec3 grassA = textureLod(uSurfAlbedo, vec3(root / 2.2, ${albedoLayer('grass')}), 5.0).rgb;
  vec3 mossA = textureLod(uSurfAlbedo, vec3(root / 12.0, ${albedoLayer('moss')}), 3.0).rgb;
  // The scans' deep mips average in the dark gaps between their blades (and AO darkens the blades again), so keep
  // their hue but lift them to a sunlit blade's albedo.
  vec3 base = mix(mossA, grassA, grassy);
  base *= mix(0.12, 0.16, grassy) / max(dot(base, vec3(0.2126, 0.7152, 0.0722)), 0.01);
  vGrassColor = base * (0.85 + envNoise(root * 0.09) * 0.3) * (0.85 + 0.3 * h2);
  vGrassT = t;
}
`

const FRAGMENT_HEAD = /* glsl */ `uniform float uWxSnow; uniform float uWxWetness; varying vec3 vGrassColor; varying float vGrassT;\n`
const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );'

function makeGrassMaterial(uniforms: Record<string, Uniform | { value: unknown }>) {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, side: DoubleSide })
  material.name = 'Grass'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 grassPos, grassNrm; grassBlade(grassPos, grassNrm);\nvec3 objectNormal = grassNrm;')
      .replace('#include <begin_vertex>', 'vec3 transformed = grassPos;')
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    // Dark, occluded roots to sunlit tips that dry toward straw; snow settles on the tips, rain darkens.
    vec3 c = vGrassColor * mix(0.75, 1.3, vGrassT);
    c = mix(c, c * vec3(1.3, 1.2, 0.65), vGrassT * vGrassT * 0.35);
    c = mix(c, vec3(0.85, 0.88, 0.92), uWxSnow * smoothstep(0.3, 1.0, vGrassT) * 0.8);
    diffuseColor.rgb *= c * (1.0 - uWxWetness * 0.3);
  }`)
      // The vertex normal already faces the eye on both sides of the blade.
      .replace('#include <normal_fragment_begin>', ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      // Light through the blades, strongest looking toward the sun, fading to the shaded roots.
      .replace('#include <lights_physical_pars_fragment>', ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE_LINE, `${DIFFUSE_LINE}
  reflectedLight.directDiffuse += directLight.color * ( pow( saturate( dot( - geometryViewDir, directLight.direction ) ), 2.0 ) * 0.8 + 0.3 ) * ( 0.3 + 0.7 * vGrassT ) * BRDF_Lambert( material.diffuseContribution );`))
  }
  material.customProgramCacheKey = () => 'grass-1'
  return material
}

/** GPU grass tufts near the camera, blowing in the wind and parting around the player (R4). Off on low quality. */
export function Grass({ terrain }: { terrain: BufferGeometry }) {
  const quality = useWorldStore((s) => s.quality)
  const settings = quality === 'low' ? null : QUALITY[quality]
  const bake = useMemo(() => new TerrainBake(terrain), [terrain])
  const geometry = useMemo(() => (settings ? makeTuftField(settings.grid) : null), [settings])
  const uniforms = useMemo(() => ({
    ...GRASS_WIND,
    uGrassBake: new Uniform(bake.texture), uGrassOrigin: new Uniform(bake.origin), uGrassEye: new Uniform(new Vector3()),
    uGrassPatch: new Uniform(new Vector4()), uGrassPush: new Uniform(new Vector4(0, -1e4, 0, 1)),
    uSurfAlbedo: surfaceTextures.uSurfAlbedo, uWxSnow: SURFACE_WEATHER_UNIFORMS.uWxSnow, uWxWetness: SURFACE_WEATHER_UNIFORMS.uWxWetness,
  }), [bake])
  const material = useMemo(() => makeGrassMaterial(uniforms), [uniforms])
  useEffect(() => () => bake.texture.dispose(), [bake])
  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  const mesh = useRef<Mesh>(null)
  useFrame(({ camera }, delta) => {
    if (!settings || !mesh.current) return
    const w = atmosphere.wind.length(), TAU = Math.PI * 2
    GRASS_WIND.uGrassGust.value = (GRASS_WIND.uGrassGust.value + delta * (0.9 + w * 0.12)) % TAU
    GRASS_WIND.uGrassFlutter.value = (GRASS_WIND.uGrassFlutter.value + delta * (4 + w * 0.5)) % TAU
    const eye = camera.position
    bake.update(eye.x, eye.z)
    uniforms.uGrassEye.value.copy(eye)
    uniforms.uGrassPatch.value.set(settings.patch, settings.start, settings.end, 0)
    const player = getPlayerRuntime()
    // On foot the blades part around the legs; a low-flying sword's wash flattens a wider ring.
    if (player) uniforms.uGrassPush.value.set(player.position.x, player.position.y, player.position.z, player.phase === 'GROUND' || player.phase === 'SUMMONING' || player.phase === 'DISMOUNTING' ? 0.8 : 3.2)
    mesh.current.visible = eye.y - bake.maxY < settings.end
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __grassStats?: () => unknown }
    w.__grassStats = () => ({ quality, tufts: geometry?.instanceCount ?? 0, visible: mesh.current?.visible ?? false, origin: bake.origin.toArray(), maxY: bake.maxY })
    return () => { delete w.__grassStats }
  }, [bake, geometry, quality])

  if (!geometry) return null
  return <mesh ref={mesh} name="Grass" geometry={geometry} material={material} frustumCulled={false} dispose={null} userData={{ castShadow: false }} raycast={() => {}} />
}
