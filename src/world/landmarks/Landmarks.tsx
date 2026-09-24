import { useEffect, useMemo } from 'react'
import { environmentMaterial } from '../environment/t02r/materials'
import { BRIDGES, ISLANDS, PILLAR_BASE_Y, PILLARS } from '../sites'
import { registerColliders, registerWalkables } from '../surfaces'
import type { Collider, WalkableSurface } from '../surfaces'
import { LAYOUT } from '../worldLayout'
import { Balustrades } from './Balustrades'
import { BANNER_POLES, BANNER_TOP, Banners } from './Banners'
import { Bridges } from './Bridges'
import { buildRockField, pillarTopRadius } from './rockGeometry'
import { Waterfalls } from './Waterfalls'

/** Walkable tops/decks and flight colliders for everything the landmarks build. */
function landmarkSurfaces() {
  const walkables: WalkableSurface[] = [], colliders: Collider[] = []
  for (const p of PILLARS) {
    walkables.push({ kind: 'disc', x: p.x, z: p.z, y: p.topY, radius: pillarTopRadius(p) * 0.7 })
    colliders.push({ kind: 'cylinder', x: p.x, z: p.z, radius: p.radius, minY: PILLAR_BASE_Y, maxY: p.topY - 0.5 })
  }
  for (const isle of ISLANDS) {
    const [x, y, z] = isle.top
    walkables.push({ kind: 'disc', x, z, y, radius: isle.padRadius })
    colliders.push({ kind: 'cylinder', x, z, radius: isle.radius * 0.95, minY: y - isle.depth * 0.35, maxY: y - 0.5 })
    colliders.push({ kind: 'cylinder', x, z, radius: isle.radius * 0.55, minY: y - isle.depth * 0.8, maxY: y - isle.depth * 0.35 })
  }
  for (const [x, z] of BANNER_POLES) colliders.push({ kind: 'cylinder', x, z, radius: 0.6, minY: LAYOUT.platform.height, maxY: BANNER_TOP })
  for (const b of BRIDGES) walkables.push({ kind: 'span', from: b.from, to: b.to, halfWidth: b.halfWidth, sag: b.sag })
  return { walkables, colliders }
}

/** Every pillar and island in one merged mesh: grass settles on the flat tops, karst rock on the faces. */
function RockField() {
  const geometry = useMemo(buildRockField, [])
  const material = useMemo(() => { const m = environmentMaterial('terrain'); m.vertexColors = true; return m }, [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  return <mesh geometry={geometry} material={material} />
}

/** Dev-only: `?nolandmarks` drops the whole layer to measure its draw-call delta. */
const DISABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has('nolandmarks')

/** Karst pillars, floating islands, bridges, waterfalls, balustrades and banners (P3). */
export function Landmarks() {
  useEffect(() => {
    if (DISABLED) return
    const { walkables, colliders } = landmarkSurfaces()
    const offWalk = registerWalkables(walkables), offCollide = registerColliders(colliders)
    return () => { offWalk(); offCollide() }
  }, [])
  if (DISABLED) return null
  return <><RockField /><Bridges /><Balustrades /><Waterfalls /><Banners /></>
}
