import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'

/*
 * Tripo textured the pailou, pavilion and bell frame roofs in a pure cobalt glaze (≈ 20 % of texels with
 * linear (b − max(r, g)) / b of 0.7–1.0); under the noon sun and the grade's contrast it renders royal blue
 * (0, 30–60, 160–230) and reads as plastic. This pulls only those texels toward a slate-indigo glaze, in
 * linear space after the base colour (map × vertex / instance colour) and before the weather patch wets it.
 * The main hall, gate and towers measure ≤ 0.5 and stay untouched.
 */
const GLAZE_FRAGMENT = /* glsl */ `
#include <color_fragment>
{
  vec3 glazeC = diffuseColor.rgb;
  float glazeBlue = (glazeC.b - max(glazeC.r, glazeC.g)) / max(glazeC.b, 1e-4);
  float glazeL = dot(glazeC, vec3(0.2126, 0.7152, 0.0722));
  vec3 glazeSlate = vec3(0.84, 1.0, 1.1) * mix(glazeL, glazeC.b, 0.2);
  diffuseColor.rgb = mix(glazeC, glazeSlate, smoothstep(0.45, 0.75, glazeBlue) * 0.85);
}`

const patched = new WeakSet<Material>()

/** Chains the glaze patch onto a MeshStandardMaterial; set before the first render so later hooks chain on. */
export function withGlazeTamed(material: Material) {
  if (patched.has(material) || !('isMeshStandardMaterial' in material)) return material
  patched.add(material)
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null
  const key = material.customProgramCacheKey.bind(material)
  const ownKey = own?.toString() ?? ''
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    own?.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', GLAZE_FRAGMENT)
  }
  material.customProgramCacheKey = () => `${key()}|${ownKey}|glaze1`
  material.needsUpdate = true
  return material
}
