import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { ColorRepresentation, Object3D } from 'three'

export interface FleshGeometryOptions {
  seed: number
  detail: 'near' | 'far'
}
export interface FleshMaterialOptions {
  name?: string
  tint?: ColorRepresentation
}

/** Inspected tissue-only patch of the Tripo tentacle atlas: folded skin, no suction cups. */
export const FLESH_TISSUE_REGION = {
  source: 'tripo-tentacle-tissue',
  atlasSize: 4096,
  left: 620,
  top: 1140,
  width: 390,
  height: 370,
} as const

function randomSequence(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * One connected, asymmetrical sheet of lobulated tissue, rather than intersecting spheres.
 * XY is its attached footprint (about 2 × 1.7 units); +Z is the outward tissue depth.
 * Macro folds are geometry; the inspected Tripo normal/ORM maps supply smaller skin detail.
 */
export function createFleshGeometry({ seed, detail }: FleshGeometryOptions): BufferGeometry {
  const random = randomSequence(seed),
    phase = random() * Math.PI * 2
  const rings = detail === 'near' ? 14 : 7,
    segments = detail === 'near' ? 40 : 22
  const lobes = Array.from({ length: 7 }, (_, index) => {
    const angle = (index / 7) * Math.PI * 2 + random() * 0.7
    const radius = 0.2 + random() * 0.46
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.82,
      width: 0.25 + random() * 0.22,
      height: 0.25 + random() * 0.34,
    }
  })
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [],
    indices: number[] = []
  const tissue = new Color(),
    region = FLESH_TISSUE_REGION
  for (let row = 0; row <= rings; row++) {
    const r = row / rings
    for (let column = 0; column <= segments; column++) {
      const angle = (column / segments) * Math.PI * 2
      const outline = 1 + 0.13 * Math.sin(angle * 3 + phase) + 0.065 * Math.sin(angle * 7 - phase * 0.7)
      const x = Math.cos(angle) * r * outline,
        y = Math.sin(angle) * r * outline * 0.84
      const envelope = Math.pow(Math.max(0, 1 - r * r), 0.76)
      let volume = 0.11 + 0.16 * Math.exp(-(x * x + y * y) * 3.6)
      for (const lobe of lobes) {
        const dx = (x - lobe.x) / lobe.width,
          dy = (y - lobe.y) / (lobe.width * 0.79)
        volume += lobe.height * Math.exp(-(dx * dx + dy * dy) * 1.85)
      }
      // Unequal ridges and narrow creases break the round blister silhouette.
      const foldPhase = x * 24 + Math.sin(y * 7 + phase) * 2.3 + phase
      const folds = 0.031 * Math.sin(foldPhase) + 0.017 * Math.sin(y * 32 + x * 5 + phase * 2)
      const groove = 0.035 * Math.pow(0.5 + 0.5 * Math.sin(foldPhase * 0.63 + y * 5), 8)
      const z = Math.max(0.003, (volume + folds - groove) * envelope) - 0.018
      positions.push(x, y, z)
      // glTF atlases use their authored, unflipped UV coordinates. Keep all maps
      // on this same contiguous skin island; the whole eye or cup atlas is never tiled.
      const u = Math.max(0, Math.min(1, x / 2.45 + 0.5)),
        v = Math.max(0, Math.min(1, y / 2.1 + 0.5))
      uvs.push((region.left + u * region.width) / region.atlasSize, (region.top + v * region.height) / region.atlasSize)
      const vesselA = Math.abs(y - Math.sin(x * 3.9 + phase) * 0.23)
      const vesselB = Math.abs(y + 0.34 - Math.sin(x * 5.2 - phase) * 0.12)
      const vessel = Math.exp(-Math.min(vesselA, vesselB) * 55) * envelope
      const mottling = 0.045 * Math.sin(x * 16 + y * 9 + phase)
      tissue.setRGB(1 + mottling - vessel * 0.08, 0.96 + mottling - vessel * 0.23, 0.93 + mottling - vessel * 0.2)
      colors.push(tissue.r, tissue.g, tissue.b)
      if (row < rings && column < segments) {
        const a = row * (segments + 1) + column,
          b = a + segments + 1
        indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uvs), 2))
  geometry.setAttribute('uv1', new BufferAttribute(Float32Array.from(uvs), 2))
  geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = `LobulatedFlesh_${detail}_${seed}`
  return geometry
}

/** Independent material, shared authored textures. Dispose the material, never its shared maps. */
export function createFleshMaterial(sourceScene: Object3D, options: FleshMaterialOptions = {}): MeshStandardMaterial {
  let source: MeshStandardMaterial | undefined
  sourceScene.traverse((object) => {
    if (source || !(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    source = materials.find(
      (material): material is MeshStandardMaterial =>
        material instanceof MeshStandardMaterial && !!material.map && !!material.normalMap && !!material.roughnessMap,
    )
  })
  if (!source) throw new Error('Flesh tissue needs the inspected Tripo PBR maps')
  const material = source.clone()
  material.name = options.name ?? 'TripoFoldedFlesh'
  material.vertexColors = true
  material.color.set(options.tint ?? '#fff3ed')
  material.metalness = 0
  // The inspected skin island's roughness is about 0.26. Multiplying it by 0.64
  // produced lacquer-like highlights at architectural scale; retain its variation
  // with a soft tissue floor instead of treating the whole patch as a wet mirror.
  material.roughness = 1
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + 0.15, 0.36, 0.72);',
    )
  }
  material.customProgramCacheKey = () => 'lobulated-tissue-pbr-roughness-1'
  material.normalScale.multiplyScalar(1.2)
  material.envMapIntensity = 0.75
  material.userData.fleshSource = FLESH_TISSUE_REGION.source
  return material
}

/** +Z faces outward; roll rotates the irregular attached footprint around that normal. */
export function orientFlesh(normal: Vector3, roll = 0): Quaternion {
  return new Quaternion()
    .setFromUnitVectors(new Vector3(0, 0, 1), normal.clone().normalize())
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll))
}
