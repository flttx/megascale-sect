import type { BufferGeometry, Mesh, MeshStandardMaterial, Object3D } from 'three'

export interface Source { geometry: BufferGeometry; material: MeshStandardMaterial }

/** Bakes the GLB's node transform into a geometry copy (normalised model units) and clones its material. */
export function extractSource(scene: Object3D): Source {
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse((object) => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
  const mesh = meshes[0]
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingSphere()
  return { geometry, material: (mesh.material as MeshStandardMaterial).clone() }
}

