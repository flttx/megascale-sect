import type { Material, Mesh, Object3D, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import {
  BLACK_MIST_SURFACE_COLOR,
  BLACK_MIST_SURFACE_EMISSIVE,
  BLACK_MIST_SURFACE_HEAD,
  BLACK_MIST_UNIFORMS,
} from '../blackMist/materials'

/**
 * Wet and snowy surfaces for any MeshStandardMaterial: rain darkens albedo, drops roughness toward a
 * sheen that reflects the sky, pools puddles with ripples on flat ground; snow settles on upward faces.
 * Every patched shader shares these uniform objects, so WeatherSystem updates them once per frame.
 */
export const SURFACE_WEATHER_UNIFORMS = {
  uWxWetness: { value: 0 },
  uWxSnow: { value: 0 },
  uWxRain: { value: 0 },
  uWxTime: { value: 0 },
  uWxDebug: { value: 0 },
}

const VERTEX_HEAD = /* glsl */ `varying vec3 vWxPosition; varying vec3 vWxNormal;\n`
const VERTEX_BODY = /* glsl */ `
  {
    vec4 wxP = vec4(transformed, 1.0);
    vec3 wxN = objectNormal;
    #ifdef USE_INSTANCING
      wxP = instanceMatrix * wxP;
      wxN = mat3(instanceMatrix) * wxN;
    #endif
    vWxPosition = (modelMatrix * wxP).xyz;
    vWxNormal = normalize(mat3(modelMatrix) * wxN);
  }
`
/** Value noise and raindrop rings, also used by the pool water (environment materials). */
export const WX_NOISE_GLSL = /* glsl */ `
float wxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wxNoise(vec2 p) {
  vec2 a = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wxHash(a), wxHash(a + vec2(1, 0)), f.x), mix(wxHash(a + vec2(0, 1)), wxHash(a + vec2(1, 1)), f.x), f.y);
}
// One expanding ring per cell with a random centre and phase: raindrops landing in a puddle.
float wxRipple(vec2 p, float t) {
  vec2 cell = floor(p), f = fract(p) - 0.5;
  float seed = wxHash(cell);
  vec2 centre = (vec2(wxHash(cell + 7.13), wxHash(cell + 3.71)) - 0.5) * 0.5;
  float phase = fract(t * (0.9 + seed * 0.6) + seed);
  float ring = length(f - centre) - phase * 0.42;
  return sin(ring * 70.0) * exp(-ring * ring * 500.0) * (1.0 - phase);
}
`
const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vWxPosition; varying vec3 vWxNormal;
uniform float uWxWetness; uniform float uWxSnow; uniform float uWxRain; uniform float uWxTime; uniform float uWxDebug;
${WX_NOISE_GLSL}
${BLACK_MIST_SURFACE_HEAD}`
const FRAGMENT_COLOR = /* glsl */ `
  vec3 wxN = normalize(vWxNormal);
  float wxFlat = smoothstep(0.82, 0.97, wxN.y);
  float wxBroad = wxNoise(vWxPosition.xz * 0.23), wxFine = wxNoise(vWxPosition.xz * 1.9 + 4.7);
  // Snow settles on faces that look up, creeping outward from the flattest spots as it accumulates.
  float wxCover = smoothstep(0.35, 0.75, wxN.y + (wxBroad - 0.5) * 0.45 + (wxFine - 0.5) * 0.12);
  float wxSnowAmt = uWxSnow > 0.001 ? wxCover * smoothstep(0.0, 0.35, uWxSnow * 1.35 - (1.0 - wxBroad) * 0.35 - (1.0 - wxN.y) * 0.3) : 0.0;
  // Puddles gather in low-frequency hollows on flat ground; they spread as the ground soaks.
  float wxWet = uWxWetness * mix(0.6, 1.0, wxFlat) * (1.0 - wxSnowAmt);
  float wxPuddle = wxFlat * smoothstep(0.62, 0.72, wxBroad * 0.8 + wxFine * 0.2 + (uWxWetness - 1.0) * 0.25) * uWxWetness * (1.0 - wxSnowAmt);
  diffuseColor.rgb *= mix(1.0, 0.6, wxWet) * mix(1.0, 0.82, wxPuddle);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.95) * (0.92 + wxFine * 0.08), wxSnowAmt);
  if (uWxDebug > 0.5) diffuseColor.rgb = vec3(wxPuddle, wxWet * 0.5, wxFlat * 0.3);
${BLACK_MIST_SURFACE_COLOR}
`
const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, mix(0.34, 0.05, wxPuddle), wxWet);
  roughnessFactor = mix(roughnessFactor, 0.78, wxSnowAmt);
`
// The scene-wide IBL is kept dim for matte stone; wet ground and puddles mirror a little more of the sky.
const FRAGMENT_SHEEN = /* glsl */ `
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * (wxWet * 0.3 + wxPuddle * 0.5);
  #endif
`
const FRAGMENT_METALNESS = /* glsl */ `
  metalnessFactor *= 1.0 - wxSnowAmt;
`
const FRAGMENT_NORMAL = /* glsl */ `
  {
    // Snow and standing water smooth out the surface relief.
    #ifdef FLAT_SHADED
      vec3 wxGeom = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    #else
      vec3 wxGeom = normalize(vNormal);
      #ifdef DOUBLE_SIDED
        wxGeom *= faceDirection;
      #endif
    #endif
    normal = normalize(mix(normal, wxGeom, max(wxSnowAmt * 0.75, wxPuddle * 0.9)));
    // Ripples in puddles while it rains, faded out where a pixel spans several rings.
    float wxAlias = 1.0 - smoothstep(0.05, 0.25, length(fwidth(vWxPosition.xz)));
    if (uWxRain > 0.01 && wxPuddle * wxAlias > 0.01) {
      float h = (wxRipple(vWxPosition.xz * 2.3, uWxTime) + wxRipple(vWxPosition.xz * 3.1 + 17.0, uWxTime * 1.1)) * 0.012 * uWxRain * wxPuddle * wxAlias;
      vec3 dpX = dFdx(-vViewPosition), dpY = dFdy(-vViewPosition);
      vec3 r1 = cross(dpY, normal), r2 = cross(normal, dpX);
      float det = dot(dpX, r1);
      // Degenerate derivatives (grazing or sub-pixel) give a zero vector; normalize() of it is NaN.
      vec3 wxBumped = abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
      if (dot(wxBumped, wxBumped) > 1e-12) normal = normalize(wxBumped);
    }
  }
`

/** Applies the weather patch to a MeshStandardMaterial shader inside `onBeforeCompile`. */
export function patchSurfaceWeather(shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, SURFACE_WEATHER_UNIFORMS)
  Object.assign(shader.uniforms, BLACK_MIST_UNIFORMS)
  shader.vertexShader =
    VERTEX_HEAD + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${VERTEX_BODY}`)
  // Inserted *before* the following chunks so they run after every other patch that appends to
  // color/roughness/normal chunks (e.g. the stylised environment materials).
  shader.fragmentShader =
    FRAGMENT_HEAD +
    shader.fragmentShader
      .replace(
        '#include <normal_fragment_begin>',
        `${FRAGMENT_COLOR}${FRAGMENT_ROUGHNESS}${FRAGMENT_METALNESS}
#include <normal_fragment_begin>`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `${FRAGMENT_NORMAL}
#include <emissivemap_fragment>
${BLACK_MIST_SURFACE_EMISSIVE}`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
${FRAGMENT_SHEEN}`,
      )
}

const patched = new WeakSet<Material>()
/**
 * Adds surface weather to a loaded (e.g. GLB) standard material, chaining any existing shader hook.
 * Must run before the mesh first renders so the cascaded-shadow hook chains onto it.
 */
export function withSurfaceWeather(material: Material) {
  if (patched.has(material) || !('isMeshStandardMaterial' in material)) return material
  patched.add(material)
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null
  const key = material.customProgramCacheKey.bind(material)
  // The default key is onBeforeCompile's source, which becomes this shared wrapper; keep the own hook's source in it.
  const ownKey = own?.toString() ?? ''
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    own?.call(material, shader, renderer)
    patchSurfaceWeather(shader)
  }
  material.customProgramCacheKey = () => `${key()}|${ownKey}|wx2`
  material.needsUpdate = true
  return material
}

/** Patches every material under a (shared, cached) GLB scene; call before its first render. */
export function withSceneWeather<T extends Object3D>(root: T) {
  root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(withSurfaceWeather)
  })
  return root
}
