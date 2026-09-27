import { Box3, BufferAttribute, BufferGeometry } from 'three'
import type { Mesh, Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { environmentMaterial } from '../environment/t02r/materials'
import type { Source } from './propSource'

/**
 * Each instance keeps one boulder shape, picked from a hash of its position, and collapses the others to a
 * point (degenerate triangles draw nothing); ~7k vertices per instance buys six shapes in one draw.
 */
const PICK = /* glsl */ `#include <begin_vertex>
  #ifdef USE_INSTANCING
  {
    vec3 p3 = fract( instanceMatrix[ 3 ].xzx * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    if ( abs( aBoulder - floor( fract( ( p3.x + p3.y ) * p3.z ) * BOULDER_SHAPES ) ) > 0.5 ) transformed = vec3( 0.0 );
  }
  #endif`

/**
 * The Blender boulders (asset-pipeline/rocks) in the karst stone the pillars wear, their baked AO / moss /
 * bedding colour as its mask. Every shape is scaled to a unit footprint (x and z within ±0.5), ground at y 0.
 */
export function extractBoulders(scene: Object3D): Source {
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse((object) => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
  meshes.sort((a, b) => a.name.localeCompare(b.name))
  const box = new Box3()
  const parts = meshes.map((mesh, shape) => {
    const src = mesh.geometry, geometry = new BufferGeometry()
    // Dequantised copies: the GLB stores normalised int16 positions and normals.
    for (const name of ['position', 'normal'] as const) {
      const a = src.getAttribute(name), out = new Float32Array(a.count * 3)
      for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = a.getComponent(i, k)
      geometry.setAttribute(name, new BufferAttribute(out, 3))
    }
    if (src.index) geometry.setIndex(src.index.clone())
    geometry.applyMatrix4(mesh.matrixWorld)
    box.setFromBufferAttribute(geometry.getAttribute('position') as BufferAttribute)
    const s = 1 / Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    geometry.translate(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2).scale(s, s, s)
    const color = src.getAttribute('color'), count = geometry.getAttribute('position').count
    const mask = new Uint8Array(count * 4).fill(255)
    if (color) for (let i = 0; i < count; i++) for (let k = 0; k < Math.min(4, color.itemSize); k++) mask[i * 4 + k] = Math.round(color.getComponent(i, k) * 255)
    geometry.setAttribute('rockMask', new BufferAttribute(mask, 4, true))
    geometry.setAttribute('aBoulder', new BufferAttribute(new Float32Array(count).fill(shape), 1))
    return geometry
  })
  const geometry = mergeGeometries(parts)
  geometry.computeBoundingSphere()

  const material = environmentMaterial('karst')
  const own = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    own.call(material, shader, renderer)
    shader.defines = { ...shader.defines, BOULDER_SHAPES: `${parts.length}.0` }
    shader.vertexShader = `attribute float aBoulder;\n${shader.vertexShader.replace('#include <begin_vertex>', PICK)}`
  }
  material.customProgramCacheKey = () => 'prop-boulder-1'
  return { geometry, material }
}

/** A Tripo shape in pale scanned limestone instead of its own (blue-cast, speckled) texture. */
export function extractStone(scene: Object3D): Source {
  scene.updateMatrixWorld(true)
  let mesh: Mesh | undefined
  scene.traverse((object) => { if (!mesh && (object as Mesh).isMesh) mesh = object as Mesh })
  if (!mesh) throw new Error('stone GLB has no mesh')
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingSphere()
  return { geometry, material: environmentMaterial('scholar') }
}
