import { MeshStandardMaterial } from 'three'
import { patchSurfaceWeather } from '../../weather/surfaceWeather'
import { SURFACE_SETS, surfaceTextures } from '../terrainTextures'

export type Surface = 'terrain' | 'rock' | 'karst' | 'scholar' | 'paving' | 'gravel' | 'masonry' | 'distant'

const layer = (set: (typeof SURFACE_SETS)[number]) => `${SURFACE_SETS.indexOf(set)}.0`

/**
 * Shared sampling helpers. Every lookup is world-space (triplanar or top-down) with explicit gradients, so
 * layers can sit behind distance and mask branches without breaking mip selection. Normals use the UDN
 * blend in world space; the arrays keep image row 0 at t = 0, so OpenGL green points toward -t.
 */
const HEAD = /* glsl */ `
uniform sampler2DArray uSurfAlbedo; uniform sampler2DArray uSurfDetail;
varying vec3 vEnvPosition; varying vec3 vEnvNormal;
#ifdef SURF_MASK
  varying vec2 vSurfMask;
#endif
#ifdef ROCK_MASK
  varying vec4 vRockMask;
#endif
vec3 surfP, surfDx, surfDy, surfN, surfW;
float envHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float envNoise(vec2 p) {
  vec2 a = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(a), envHash(a + vec2(1, 0)), f.x), mix(envHash(a + vec2(0, 1)), envHash(a + vec2(1, 1)), f.x), f.y);
}
float envFbm(vec2 p) { return envNoise(p) * 0.55 + envNoise(p * 2.07 + 5.3) * 0.3 + envNoise(p * 4.31 + 1.7) * 0.15; }
vec2 surfTangent(vec4 d) { return vec2(d.r * 2.0 - 1.0, 1.0 - d.g * 2.0); }

/** Triplanar sample of one layer tiled every \`scale\` metres; n is the perturbed world normal. */
void surfTri(float layer, float scale, out vec4 albedo, out vec4 detail, out vec3 n) {
  float k = 1.0 / scale;
  vec3 p = surfP * k, dx = surfDx * k, dy = surfDy * k, N = surfN;
  albedo = vec4(0.0); detail = vec4(0.0); n = vec3(0.0);
  if (surfW.x > 0.0) {
    vec4 a = textureGrad(uSurfAlbedo, vec3(p.zy, layer), dx.zy, dy.zy), d = textureGrad(uSurfDetail, vec3(p.zy, layer), dx.zy, dy.zy);
    vec2 t = surfTangent(d);
    albedo += a * surfW.x; detail += d * surfW.x; n += vec3(N.x, t.y + N.y, t.x + N.z) * surfW.x;
  }
  if (surfW.y > 0.0) {
    vec4 a = textureGrad(uSurfAlbedo, vec3(p.xz, layer), dx.xz, dy.xz), d = textureGrad(uSurfDetail, vec3(p.xz, layer), dx.xz, dy.xz);
    vec2 t = surfTangent(d);
    albedo += a * surfW.y; detail += d * surfW.y; n += vec3(t.x + N.x, N.y, t.y + N.z) * surfW.y;
  }
  if (surfW.z > 0.0) {
    vec4 a = textureGrad(uSurfAlbedo, vec3(p.xy, layer), dx.xy, dy.xy), d = textureGrad(uSurfDetail, vec3(p.xy, layer), dx.xy, dy.xy);
    vec2 t = surfTangent(d);
    albedo += a * surfW.z; detail += d * surfW.z; n += vec3(t.x + N.x, t.y + N.y, N.z) * surfW.z;
  }
  n = normalize(n);
}

/** Top-down sample for ground cover; only used where the surface faces up, so the stretch never shows. */
void surfTop(float layer, float scale, out vec4 albedo, out vec4 detail, out vec3 n) {
  float k = 1.0 / scale;
  albedo = textureGrad(uSurfAlbedo, vec3(surfP.xz * k, layer), surfDx.xz * k, surfDy.xz * k);
  detail = textureGrad(uSurfDetail, vec3(surfP.xz * k, layer), surfDx.xz * k, surfDy.xz * k);
  vec2 t = surfTangent(detail);
  n = normalize(vec3(t.x + surfN.x, surfN.y, t.y + surfN.z));
}

/** Height-aware blend weight of B over A: the higher texel wins across a soft band. */
float heightMix(float hA, float hB, float t, float band) {
  // Heights are halved so a fully masked-out layer can never poke through.
  float a = hA * 0.5 + (1.0 - t), b = hB * 0.5 + t;
  float m = max(a, b) - band;
  float wa = max(a - m, 0.0), wb = max(b - m, 0.0);
  return wb / max(wa + wb, 1e-4);
}
`

/** Rock faces shared by terrain cliffs and the karst boulders: cliff scan at two scales plus near grit. */
const ROCK = (scale: number, farScale: number) => /* glsl */ `
  vec4 rA, rD, fA, fD, gA, gD; vec3 rN, fN, gN;
  surfTri(${layer('cliff')}, ${scale.toFixed(1)}, rA, rD, rN);
  // A second, non-integer-ratio tiling breaks the repeat at range and adds macro relief up close.
  surfTri(${layer('cliff')}, ${farScale.toFixed(1)}, fA, fD, fN);
  float farT = smoothstep(50.0, 260.0, sDist);
  surfAlbedo = pow(mix(rA.rgb, fA.rgb, 0.2 + farT * 0.6), vec3(1.35)) * 0.75;
  surfRough = mix(rA.a, fA.a, farT);
  surfNormal = normalize(mix(rN, fN, farT * 0.7) + (fN - surfN) * 0.6 * (1.0 - farT));
  surfAO = mix(rD.b, fD.b, farT);
  surfHeight = mix(rD.a, fD.a, 0.35);
  // The boulder scan resolves millimetres where the cliff maps are soft.
  float nearT = 1.0 - smoothstep(14.0, 40.0, sDist);
  if (nearT > 0.0) {
    surfTri(${layer('rock_detail')}, 2.6, gA, gD, gN);
    surfAlbedo *= mix(1.0, dot(gA.rgb, vec3(0.2126, 0.7152, 0.0722)) * 2.8, 0.45 * nearT);
    surfNormal = normalize(surfNormal + (gN - surfN) * 0.8 * nearT);
    surfAO *= mix(1.0, gD.b, nearT);
  }
  // Karst weathering: rain streaks down the faces, warm/cool bedding bands, and broad tone patches.
  vec2 faceUV = vec2(sp.x + sp.z * 0.61, sp.y);
  float streak = envNoise(vec2(faceUV.x * 0.3, sp.y * 0.012 + envNoise(faceUV * 0.05) * 0.8));
  float bands = envNoise(vec2(faceUV.x * 0.004, sp.y * 0.09));
  float patches = envFbm(faceUV * 0.013);
  float steep = 1.0 - smoothstep(0.55, 0.85, surfN.y);
  surfAlbedo *= mix(1.0, 0.34 + streak * 0.85, steep * 0.9);
  // Black cyanobacteria streaks under the lips and ochre iron stains, the two marks every karst face carries.
  float black = smoothstep(0.58, 0.86, envNoise(vec2(faceUV.x * 0.09, sp.y * 0.0035 + envNoise(faceUV * 0.02))));
  float ochre = smoothstep(0.55, 0.8, envFbm(faceUV * vec2(0.02, 0.006) + 7.0));
  surfAlbedo *= mix(1.0, 0.42, black * steep) * mix(vec3(1.0), vec3(1.2, 0.98, 0.74), ochre * 0.7);
  surfAlbedo *= mix(vec3(0.92, 0.95, 1.0), vec3(1.07, 1.02, 0.93), bands) * (0.7 + patches * 0.55);
`

/**
 * Moss in damp air near the cloud tops, and (for free-standing rock) on its ledges; `extra` is a GLSL
 * expression for more cover (e.g. a baked vegetation mask).
 */
const ROCK_MOSS = (ledges: boolean, extra = '0.0') => /* glsl */ `
  {
    vec4 mA, mD; vec3 mN;
    float ledge = ${ledges ? 'smoothstep(0.52, 0.8, surfN.y + (envFbm(sp.xz * 0.05) - 0.5) * 0.5)' : '0.0'};
    float damp = smoothstep(-40.0, -110.0, sp.y) * (1.0 - smoothstep(-200.0, -280.0, sp.y));
    float cover = max(max(ledge, ${extra}), damp * smoothstep(0.55, 0.75, envFbm(vec2(sp.x + sp.z, sp.y * 0.4) * 0.03)) * 0.8);
    if (cover > 0.01) {
      surfTri(${layer('moss')}, 9.0, mA, mD, mN);
      float w = heightMix(surfHeight, mD.a, cover, 0.25);
      surfAlbedo = mix(surfAlbedo, mA.rgb, w);
      surfRough = mix(surfRough, mA.a, w);
      surfNormal = normalize(mix(surfNormal, mN, w));
      surfAO = mix(surfAO, mD.b, w);
    }
  }
`

const SURFACES: Record<Surface, string> = {
  terrain: /* glsl */ `
    ${ROCK(16, 71.3)}
    // Ground cover on gentle slopes: moss and forest grass above the clouds, scree and gravel where
    // material collects (vSurfMask.r near paths, .g in hollows and at the foot of cliffs).
    float gentle = smoothstep(0.62, 0.86, surfN.y + (envFbm(sp.xz * 0.021) - 0.5) * 0.34);
    float above = smoothstep(-150.0, -60.0, sp.y);
    #ifdef SURF_MASK
      float collect = clamp(vSurfMask.r + vSurfMask.g * 0.8, 0.0, 1.0);
    #else
      float collect = 0.0;
    #endif
    float scree = smoothstep(0.25, 0.75, max(collect, (1.0 - above) * 0.6) + (envFbm(sp.xz * 0.11) - 0.5) * 0.55) * smoothstep(0.35, 0.6, surfN.y);
    float veg = gentle * above * (1.0 - scree * 0.85);
    if (veg + scree > 0.01) {
      vec4 mA, mD, vA, vD; vec3 mN, vN;
      surfTop(${layer('moss')}, 12.0, mA, mD, mN);
      surfTop(${layer('grass')}, 2.2, vA, vD, vN);
      // Grass on the broad, sunny shelves; moss toward edges, shade and the damp lower slopes.
      float grassy = smoothstep(0.35, 0.7, envFbm(sp.xz * 0.013 + 3.1)) * smoothstep(0.84, 0.95, surfN.y) * smoothstep(-40.0, 10.0, sp.y);
      vec3 coverA = mix(mA.rgb, vA.rgb, grassy); float coverR = mix(mA.a, vA.a, grassy);
      vec3 coverN = normalize(mix(mN, vN, grassy)); float coverAO = mix(mD.b, vD.b, grassy), coverH = mix(mD.a, vD.a, grassy);
      if (scree > 0.01) {
        vec4 sA, sD; vec3 sN;
        surfTop(${layer('gravel')}, 2.4, sA, sD, sN);
        float s = heightMix(coverH, sD.a, scree, 0.2);
        coverA = mix(coverA, sA.rgb * vec3(0.92, 0.93, 0.96), s); coverR = mix(coverR, sA.a, s);
        coverN = normalize(mix(coverN, sN, s)); coverAO = mix(coverAO, sD.b, s); coverH = mix(coverH, sD.a, s);
      }
      float w = heightMix(surfHeight, coverH, clamp(veg + scree, 0.0, 1.0), 0.18);
      surfAlbedo = mix(surfAlbedo, coverA * (0.85 + envNoise(sp.xz * 0.09) * 0.3), w);
      surfRough = mix(surfRough, coverR, w); surfNormal = normalize(mix(surfNormal, coverN, w));
      surfAO = mix(surfAO, coverAO, w);
    }
    ${ROCK_MOSS(false)}
    // Below the cloud tops the stone is soaked and dark.
    float soak = (1.0 - smoothstep(-170.0, -90.0, sp.y));
    surfAlbedo *= 1.0 - soak * 0.35; surfRough *= 1.0 - soak * 0.25;
  `,
  rock: /* glsl */ `
    ${ROCK(9, 37.7)}
    ${ROCK_MOSS(true)}
  `,
  // The Blender pillars and islands: baked cavity AO (r), vegetation (g) and bedding bands (b) in rockMask.
  karst: /* glsl */ `
    ${ROCK(11, 43.1)}
    float kAO = smoothstep(0.04, 0.8, vRockMask.r);
    surfAO *= mix(0.3, 1.0, kAO);
    surfAlbedo *= mix(0.62, 1.0, kAO) * mix(vec3(0.88, 0.92, 1.0), vec3(1.1, 1.02, 0.9), vRockMask.b);
    ${ROCK_MOSS(true, 'smoothstep(0.08, 0.5, vRockMask.g)')}
    // Below the cloud tops the stone is soaked and dark.
    float soak = (1.0 - smoothstep(-170.0, -90.0, sp.y));
    surfAlbedo *= 1.0 - soak * 0.35; surfRough *= 1.0 - soak * 0.25;
  `,
  // Garden 景石 (Taihu limestone): water-worn pale grey on a metre scale, darkest in its hollows, no moss.
  scholar: /* glsl */ `
    ${ROCK(4, 17.9)}
    surfAlbedo = mix(surfAlbedo, vec3(dot(surfAlbedo, vec3(0.2126, 0.7152, 0.0722))), 0.55) * vec3(1.85, 1.85, 1.8);
  `,
  distant: /* glsl */ `
    vec4 rA, rD, mA, mD; vec3 rN, mN;
    surfTri(${layer('cliff')}, 96.0, rA, rD, rN);
    surfTop(${layer('moss')}, 60.0, mA, mD, mN);
    float cover = smoothstep(0.7, 0.9, surfN.y + (envFbm(sp.xz * 0.004) - 0.5) * 0.4) * smoothstep(-160.0, 0.0, sp.y);
    float bands = envNoise(vec2((sp.x + sp.z) * 0.0015, sp.y * 0.03));
    surfAlbedo = mix(pow(rA.rgb, vec3(1.35)) * 0.7, mA.rgb, cover) * (0.7 + bands * 0.45) * (0.7 + envFbm(sp.xz * 0.0011) * 0.5);
    surfRough = mix(rA.a, mA.a, cover); surfNormal = normalize(mix(rN, mN, cover));
    surfAO = mix(rD.b, 1.0, 0.5); surfHeight = rD.a;
  `,
  paving: /* glsl */ `
    vec4 pA, pD; vec3 pN;
    surfTri(${layer('paving')}, 3.0, pA, pD, pN);
    // Broad weathering so 450 m of slabs never reads as one tile: soot-dark patches, lichen, and worn lanes.
    float grime = envFbm(sp.xz * 0.018), lichen = smoothstep(0.62, 0.8, envFbm(sp.xz * 0.07 + 9.0));
    surfAlbedo = pA.rgb * (0.72 + grime * 0.45) * mix(vec3(1.0), vec3(0.86, 0.95, 0.78), lichen * 0.5);
    surfRough = clamp(pA.a * (0.9 + grime * 0.2), 0.3, 1.0);
    surfNormal = pN; surfAO = pD.b; surfHeight = pD.a;
  `,
  masonry: /* glsl */ `
    vec4 pA, pD; vec3 pN;
    surfTri(${layer('paving')}, 2.1, pA, pD, pN);
    float grime = envFbm(vec2(sp.x + sp.z, sp.y) * 0.08);
    surfAlbedo = pA.rgb * 1.35 * (0.8 + grime * 0.3);
    surfRough = pA.a; surfNormal = pN; surfAO = pD.b; surfHeight = pD.a;
  `,
  gravel: /* glsl */ `
    vec4 sA, sD; vec3 sN;
    surfTri(${layer('gravel')}, 2.4, sA, sD, sN);
    surfAlbedo = sA.rgb * vec3(0.9, 0.92, 0.96) * (0.85 + envFbm(sp.xz * 0.05) * 0.3);
    surfRough = sA.a; surfNormal = sN; surfAO = sD.b; surfHeight = sD.a;
  `,
}

/**
 * Stone, earth and ground cover from the scanned CC0 texture arrays (terrainTextures.ts). The weather patch
 * runs last so rain and snow sit on top of the finished surface.
 */
export function environmentMaterial(surface: Surface) {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 })
  material.name = `T02R_${surface}`
  const masked = surface === 'terrain', rockMasked = surface === 'karst'
  material.customProgramCacheKey = () => `t02r-${surface}-11`
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceTextures)
    if (masked) shader.defines = { ...shader.defines, SURF_MASK: '' }
    if (rockMasked) shader.defines = { ...shader.defines, ROCK_MASK: '' }
    shader.vertexShader = `varying vec3 vEnvPosition; varying vec3 vEnvNormal;
      #ifdef SURF_MASK
        attribute vec2 surfaceMask; varying vec2 vSurfMask;
      #endif
      #ifdef ROCK_MASK
        attribute vec4 rockMask; varying vec4 vRockMask;
      #endif
      ${shader.vertexShader}`.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 envP = vec4(transformed, 1.0);
      vec3 envN = objectNormal;
      #ifdef USE_INSTANCING
        envP = instanceMatrix * envP;
        envN = mat3(instanceMatrix) * envN;
      #endif
      vEnvPosition = (modelMatrix * envP).xyz;
      vEnvNormal = normalize(mat3(modelMatrix) * envN);
      #ifdef SURF_MASK
        vSurfMask = surfaceMask;
      #endif
      #ifdef ROCK_MASK
        vRockMask = rockMask;
      #endif
    `)
    shader.fragmentShader = `${HEAD}\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 sp = vEnvPosition;
      surfP = sp; surfDx = dFdx(sp); surfDy = dFdy(sp);
      surfN = normalize(vEnvNormal);
      surfW = pow(abs(surfN), vec3(4.0));
      surfW = max(surfW / dot(surfW, vec3(1.0)) - 0.02, 0.0);
      surfW /= dot(surfW, vec3(1.0));
      float sDist = distance(sp, cameraPosition);
      vec3 surfAlbedo, surfNormal; float surfRough, surfAO, surfHeight;
      ${SURFACES[surface]}
      diffuseColor.rgb *= surfAlbedo;
    `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(surfRough, 0.05, 1.0);
    `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize((viewMatrix * vec4(surfNormal, 0.0)).xyz);
    `)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      // Scanned cavity occlusion only dims the sky and bounce light; the sun still reaches into cracks.
      reflectedLight.indirectDiffuse *= surfAO;
      reflectedLight.indirectSpecular *= mix(1.0, surfAO, 0.8);
    `)
    patchSurfaceWeather(shader)
  }
  return material
}
