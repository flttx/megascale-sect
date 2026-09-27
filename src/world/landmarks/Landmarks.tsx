import { useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import { environmentMaterial } from '../environment/t02r/materials'
import { BRIDGES } from '../sites'
import { registerColliders, registerWalkables } from '../surfaces'
import type { Collider, WalkableSurface } from '../surfaces'
import { LAYOUT } from '../worldLayout'
import { Balustrades } from './Balustrades'
import { BANNER_POLES, BANNER_TOP, Banners } from './Banners'
import { Bridges } from './Bridges'
import { chainColliders, Chains } from './Chains'
import { buildRockField } from './rockField'
import { rockSurfaces } from './rockLayout'
import { Waterfalls } from './Waterfalls'

/** Walkable ledges, pads and decks and flight colliders for everything the landmarks build. */
function landmarkSurfaces() {
  const rock = rockSurfaces()
  const walkables: WalkableSurface[] = [...rock.walkables], colliders: Collider[] = [...rock.colliders]
  for (const [x, z] of BANNER_POLES) colliders.push({ kind: 'cylinder', x, z, radius: 0.6, minY: LAYOUT.platform.height, maxY: BANNER_TOP })
  colliders.push(...chainColliders())
  for (const b of BRIDGES) walkables.push({ kind: 'span', from: b.from, to: b.to, halfWidth: b.halfWidth, sag: b.sag })
  return { walkables, colliders }
}

const ROCK_URLS = ['pillars.glb', 'pillars.lod1.glb', 'islands.glb', 'islands.lod1.glb']
  .map((file) => `${import.meta.env.BASE_URL}assets/environment/rocks/${file}`.replace(/\/{2,}/g, '/'))
ROCK_URLS.forEach((url) => useGLTF.preload(url))

/**
 * The Blender karst pillars and floating islands (asset-pipeline/rocks), baked into place per cluster with
 * their reduced level for range, in the scanned stone plus the models' own AO / moss / bedding masks.
 */
function RockField() {
  const gltfs = useGLTF(ROCK_URLS)
  const material = useMemo(() => environmentMaterial('karst'), [])
  const field = useMemo(() => buildRockField(gltfs.map((gltf) => gltf.scene), material), [gltfs, material])
  useEffect(() => () => { field.dispose(); material.dispose() }, [field, material])
  return <>{field.root.map((object) => <primitive key={object.uuid} object={object} />)}</>
}

/** Dev-only: `?nolandmarks` drops the whole layer, `?norocks` just the rock field, to measure their draw-call delta. */
const DISABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has('nolandmarks')
const NO_ROCKS = import.meta.env.DEV && new URLSearchParams(window.location.search).has('norocks')

/** Karst pillars, floating islands, bridges, the chains of 锁云屿, waterfalls, balustrades and banners. */
export function Landmarks() {
  useEffect(() => {
    if (DISABLED) return
    const { walkables, colliders } = landmarkSurfaces()
    const offWalk = registerWalkables(walkables), offCollide = registerColliders(colliders)
    return () => { offWalk(); offCollide() }
  }, [])
  if (DISABLED) return null
  return <>{!NO_ROCKS && <Suspense fallback={null}><RockField /></Suspense>}<Bridges /><Chains /><Balustrades /><Waterfalls /><Banners /></>
}
