import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Material, Mesh } from 'three'
import { makeRegionTerrain, regionDistance, REGIONS } from './regions'

/**
 * How close (m) the camera must be to a region's box before its ground casts shadows. Each region is a single
 * ~200k-triangle mesh whose bounds overlap most cascades, and from farther away its self-shadowing is lost in the haze.
 */
const SHADOW_RANGE = 500

/** The four outer regions' ground, one height-field mesh each, in the core terrain's material. */
export function RegionTerrain({ material }: { material: Material }) {
  const meshes = useMemo(() => REGIONS.map((r) => ({ id: r.id, geometry: makeRegionTerrain(r.id) })), [])
  const refs = useRef<(Mesh | null)[]>([])
  // Lighting reads userData.castShadow on every frame, so the flag is all it takes to drop a caster.
  useFrame(({ camera }) => {
    meshes.forEach(({ id }, i) => {
      const mesh = refs.current[i]
      if (mesh) mesh.userData.castShadow = regionDistance(id, camera.position.x, camera.position.z) < SHADOW_RANGE
    })
  })
  return <group name="Regions">
    {/* The flag starts off here rather than as a userData prop, which a re-render would reset under useFrame. */}
    {meshes.map(({ id, geometry }, i) => <mesh key={id} name={`Region_Terrain_${id}`} geometry={geometry} material={material}
      ref={(m) => { refs.current[i] = m; if (m && m.userData.castShadow === undefined) m.userData.castShadow = false }} />)}
  </group>
}
