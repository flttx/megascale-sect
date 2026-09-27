import { BufferAttribute, BufferGeometry, MeshDepthMaterial, ShaderChunk, Uniform } from 'three'
import type { InterleavedBufferAttribute, Mesh, MeshStandardMaterial, Object3D, WebGLProgramParametersWithUniforms } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { atmosphere } from '../sky/atmosphere'
import type { Source } from './propSource'

/** Shared by every pine shader: gust and flutter phases (radians, wrapped) and the wind vector. */
const PINE_UNIFORMS = { uPineGust: new Uniform(0), uPineFlutter: new Uniform(0), uPineWind: new Uniform(atmosphere.wind) }

/**
 * Advances the sway phases at the wind-dependent rates. Integrated here rather than scaling absolute time in the
 * shader, so a change of wind retunes the sway instead of jumping its phase (a weather blend made the crowns flicker).
 */
export function advancePines(dt: number) {
  const w = atmosphere.wind.length(), TAU = Math.PI * 2
  PINE_UNIFORMS.uPineGust.value = (PINE_UNIFORMS.uPineGust.value + dt * (0.5 + w * 0.05)) % TAU
  PINE_UNIFORMS.uPineFlutter.value = (PINE_UNIFORMS.uPineFlutter.value + dt * (1.8 + w * 0.2)) % TAU
}

const VERTEX_HEAD = /* glsl */ `attribute vec4 aPine; uniform float uPineGust; uniform float uPineFlutter; uniform vec2 uPineWind; varying float vPineAO; varying float vPineBark;\n`
// aPine: x AO, y height ratio, z per-cluster phase (the GLB's COLOR_0), w 1 on bark. The whole tree leans
// downwind with the gusts, more toward the top; needle clusters flutter on their own phase.
const VERTEX_SWAY = /* glsl */ `#include <begin_vertex>
  vPineAO = aPine.x; vPineBark = aPine.w;
  {
    float w = length( uPineWind );
    vec3 wind = w > 1e-3 ? vec3( uPineWind.x, 0.0, uPineWind.y ) / w : vec3( 1.0, 0.0, 0.0 );
    vec3 seat = vec3( 0.0 );
    #ifdef USE_INSTANCING
      // Into the instance's frame (yaw and uniform scale): downwind whichever way the tree faces.
      wind = normalize( transpose( mat3( instanceMatrix ) ) * wind );
      seat = instanceMatrix[ 3 ].xyz;
    #endif
    float gust = 0.65 + 0.35 * sin( uPineGust + dot( seat.xz, vec2( 0.031, 0.047 ) ) );
    float lean = aPine.y * aPine.y * transformed.y * 0.006 * w * gust;
    float flutter = ( 1.0 - aPine.w ) * aPine.y * sin( uPineFlutter + aPine.z * 6.2832 + seat.x * 0.13 ) * ( 0.03 + w * 0.012 );
    transformed += wind * ( lean + flutter );
  }`

// Light through the needle cards (already shadowed): the unlit side of a card glows faintly, and a crown seen
// against the sun turns green-gold instead of black. The baked AO keeps the crown's interior dark.
const TRANSMIT = /* glsl */ `
vec3 pineTransmit( const in vec3 n, const in vec3 v, const in IncidentLight light ) {
  if ( vPineBark > 0.5 ) return vec3( 0.0 );
  float back = saturate( -dot( n, light.direction ) );
  float forward = pow( saturate( dot( -v, light.direction ) ), 4.0 );
  return light.color * ( back * 0.45 + forward * 0.8 ) * vPineAO;
}
`
const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );'

function patchVertex(shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, PINE_UNIFORMS)
  shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_SWAY)
}

/** Dequantised float copy (the GLB stores normalised int16 positions; merging needs matching array types). */
function toFloat(attribute: BufferAttribute | InterleavedBufferAttribute) {
  const { count, itemSize } = attribute, out = new Float32Array(count * itemSize)
  for (let i = 0; i < count; i++) for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attribute.getComponent(i, k)
  return new BufferAttribute(out, itemSize)
}

function part(mesh: Mesh, bark: boolean) {
  const src = mesh.geometry, geometry = new BufferGeometry()
  for (const name of ['position', 'normal', 'uv'] as const) geometry.setAttribute(name, toFloat(src.getAttribute(name)))
  if (src.index) geometry.setIndex(src.index.clone())
  geometry.applyMatrix4(mesh.matrixWorld)
  const color = src.getAttribute('color'), count = geometry.getAttribute('position').count, pine = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    pine.set(color ? [color.getComponent(i, 0), color.getComponent(i, 1), color.getComponent(i, 2)] : [1, 0, 0], i * 4)
    pine[i * 4 + 3] = bark ? 1 : 0
  }
  geometry.setAttribute('aPine', new BufferAttribute(pine, 4))
  return geometry
}

/**
 * A Blender pine (bark + alpha-tested needle cards, two materials) as one geometry and one material, so each
 * LOD stays a single instanced draw: the shader picks the bark or needle textures per triangle, applies the
 * baked AO and sways in the wind. The depth material carries the same sway and keeps bark solid in shadows.
 */
export function extractPine(scene: Object3D): Source {
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse((object) => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
  const isNeedles = (mesh: Mesh) => (mesh.material as MeshStandardMaterial).alphaTest > 0
  const needles = meshes.find(isNeedles), bark = meshes.find((mesh) => !isNeedles(mesh))
  if (!needles || !bark) throw new Error('pine GLB needs a bark and a needles primitive')
  const barkMaterial = bark.material as MeshStandardMaterial
  const geometry = mergeGeometries([part(bark, true), part(needles, false)])
  geometry.computeBoundingSphere()

  const material = (needles.material as MeshStandardMaterial).clone()
  material.vertexColors = false
  // Without a normal map of its own the bark stays flat rather than borrowing the needle cards' normals.
  const barkNormal = barkMaterial.normalMap
  const barkUniforms = { uBarkMap: new Uniform(barkMaterial.map), uBarkNormal: new Uniform(barkNormal), uBarkRoughness: new Uniform(barkMaterial.roughness) }
  material.onBeforeCompile = (shader) => {
    patchVertex(shader)
    Object.assign(shader.uniforms, barkUniforms)
    // A triangle is all bark or all needles, so the choice is uniform across each pixel quad (mip selection holds).
    const pick = (own: string, barkMap: string, uv: string) => `( vPineBark > 0.5 ? texture2D( ${barkMap}, ${uv} ) : texture2D( ${own}, ${uv} ) )`
    const pickNormal = barkNormal ? pick('normalMap', 'uBarkNormal', 'vNormalMapUv') : '( vPineBark > 0.5 ? vec4( 0.5, 0.5, 1.0, 1.0 ) : texture2D( normalMap, vNormalMapUv ) )'
    shader.fragmentShader = `uniform sampler2D uBarkMap; ${barkNormal ? 'uniform sampler2D uBarkNormal; ' : ''}uniform float uBarkRoughness; varying float vPineAO; varying float vPineBark;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  diffuseColor *= ${pick('map', 'uBarkMap', 'vMapUv')};
#endif
  // Bark is opaque; the baked AO darkens crevices and the crown's shaded interior.
  diffuseColor.a = max( diffuseColor.a, vPineBark );
  // The scanned needle albedo is ~3 % (a dark conifer, but black once shaded); lift it, and the bark a little.
  diffuseColor.rgb *= mix( vec3( 2.1, 2.0, 1.6 ), vec3( 1.3 ), vPineBark ) * mix( 0.5, 1.0, vPineAO );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, uBarkRoughness, vPineBark );`)
      .replace('#include <lights_physical_pars_fragment>', `${TRANSMIT}${ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE_LINE, `${DIFFUSE_LINE}
  reflectedLight.directDiffuse += pineTransmit( geometryNormal, geometryViewDir, directLight ) * BRDF_Lambert( material.diffuseContribution );`)}`)
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', pickNormal))
  }
  // Set before withSurfaceWeather wraps the hook (the default key is the hook's source).
  material.customProgramCacheKey = () => `prop-pine-${barkNormal ? 'bark-normal' : 'bark-flat'}-2`

  const depth = new MeshDepthMaterial()
  depth.onBeforeCompile = (shader) => {
    patchVertex(shader)
    shader.fragmentShader = `varying float vPineBark;\n${shader.fragmentShader}`
      .replace('#include <alphatest_fragment>', `diffuseColor.a = max( diffuseColor.a, vPineBark );
#include <alphatest_fragment>`)
  }
  depth.customProgramCacheKey = () => 'prop-pine-depth-1'
  return { geometry, material, depth }
}
