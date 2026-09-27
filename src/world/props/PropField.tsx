import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Color, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import type { Group, Material, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { environmentMaterial } from '../environment/t02r/materials'
import { atmosphere } from '../sky/atmosphere'
import { useWorldStore } from '../store'
import { registerColliders } from '../surfaces'
import type { Collider } from '../surfaces'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { Cranes } from './Cranes'
import { withGlazeTamed } from './glaze'
import { glowQuad, makeGlowSpriteMaterial, syncGlowFog, withGlowMask } from './glow'
import { buildPropLayout } from './placement'
import { advancePines, extractPine } from './pineSource'
import { extractSource } from './propSource'
import type { Source } from './propSource'
import type { Placement } from './placement'
import { extractBoulders, extractStone } from './stoneSource'
import { isPine, PROP_IDS, PROPS, propUrl } from './propCatalog'
import type { PropId, PropSpec } from './propCatalog'

const DENSITY = { low: 0.4, mid: 0.7, high: 1 } as const
/** Bucket membership is recomputed at this cadence (s), or at once after a jump (teleport, review camera). */
const REBUCKET_INTERVAL = 0.25
const REBUCKET_JUMP = 12
const LAMP_COLOR = new Color('#ffab5c')
const CRYSTAL_COLOR = new Color('#6fe3ff')
/** Props drawn in the scanned environment stone, whose material already carries the weather patch. */
const STONE: Partial<Record<PropId, (scene: Object3D) => Source>> = { rock_moss: extractBoulders, rock_scholar: extractStone }
/** Roofs Tripo glazed in pure cobalt (see glaze.ts). */
const GLAZED = new Set<PropId>(['pailou', 'pavilion'])

const URLS = PROP_IDS.flatMap((id) => [propUrl(id, false), ...(PROPS[id].lod1 ? [propUrl(id, true)] : [])])
URLS.forEach((url) => useGLTF.preload(url))

/** One prop type: a near LOD0 and a far LOD1 InstancedMesh sharing a precomputed matrix pool. */
class PropBucket {
  readonly near: InstancedMesh
  readonly far: InstancedMesh | null
  readonly matrices: Float32Array
  readonly positions: Float32Array
  nearCount = 0
  farCount = 0
  constructor(readonly spec: PropSpec, readonly placements: Placement[], lod0: Source, lod1: Source | null, readonly glowMaterials: MeshStandardMaterial[]) {
    const n = placements.length
    this.matrices = new Float32Array(n * 16)
    this.positions = new Float32Array(n * 3)
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), up = new Vector3(0, 1, 0)
    placements.forEach((pl, i) => {
      m.compose(p.set(pl.x, pl.y, pl.z), q.setFromAxisAngle(up, pl.yaw), s.setScalar(pl.scale)).toArray(this.matrices, i * 16)
      this.positions.set([pl.x, pl.y, pl.z], i * 3)
    })
    const make = (source: Source, shadow: boolean, name: string) => {
      const mesh = new InstancedMesh(source.geometry, source.material, n)
      mesh.name = name
      mesh.count = 0
      mesh.visible = false
      mesh.userData.castShadow = shadow
      if (source.depth) mesh.customDepthMaterial = source.depth
      return mesh
    }
    this.near = make(lod0, spec.shadow, `Prop_${spec.id}_lod0`)
    this.far = lod1 ? make(lod1, false, `Prop_${spec.id}_lod1`) : null
  }
  update(camera: Vector3, density: number) {
    const near2 = this.spec.near ** 2, hide2 = this.spec.hide ** 2
    const nearArray = this.near.instanceMatrix.array as Float32Array
    const farArray = this.far?.instanceMatrix.array as Float32Array | undefined
    let nn = 0, nf = 0
    this.placements.forEach((pl, i) => {
      if (pl.rank >= density) return
      const dx = this.positions[i * 3] - camera.x, dy = this.positions[i * 3 + 1] - camera.y, dz = this.positions[i * 3 + 2] - camera.z
      const d2 = dx * dx + dy * dy + dz * dz
      const block = this.matrices.subarray(i * 16, i * 16 + 16)
      // Without a LOD1 the LOD0 mesh carries the prop out to its hide distance.
      if (d2 < near2 || (!farArray && d2 < hide2)) nearArray.set(block, nn++ * 16)
      else if (farArray && d2 < hide2) farArray.set(block, nf++ * 16)
    })
    this.nearCount = nn; this.farCount = nf
    for (const [mesh, count] of [[this.near, nn], [this.far, nf]] as const) {
      if (!mesh) continue
      mesh.count = count
      mesh.visible = count > 0
      if (!count) continue
      mesh.instanceMatrix.needsUpdate = true
      // Tight bounds let the frustum (and each shadow cascade) cull the bucket when it's out of view.
      mesh.computeBoundingSphere()
    }
  }
}

function glowColor(id: PropId) {
  return id === 'spirit_crystal' ? CRYSTAL_COLOR : LAMP_COLOR
}

function PropFieldContent() {
  const gltfs = useGLTF(URLS)
  const quality = useWorldStore((s) => s.quality)
  const layout = useMemo(() => buildPropLayout(), [])

  const buckets = useMemo(() => {
    const byUrl = new Map(URLS.map((url, i) => [url, gltfs[i]]))
    return PROP_IDS.map((id) => {
      const spec = PROPS[id]
      const extract = STONE[id] ?? (isPine(id) ? extractPine : extractSource)
      const lod0 = extract(byUrl.get(propUrl(id, false))!.scene)
      const lod1 = spec.lod1 ? extract(byUrl.get(propUrl(id, true))!.scene) : null
      const glowMaterials: MeshStandardMaterial[] = []
      for (const [source, tag] of [[lod0, 'lod0'], [lod1, 'lod1']] as const) {
        if (!source) continue
        if (spec.glow) glowMaterials.push(withGlowMask(source.material, spec.glow, glowColor(id), `${id}-${tag}`))
        if (GLAZED.has(id)) withGlazeTamed(source.material)
        if (!STONE[id]) withSurfaceWeather(source.material)
      }
      return new PropBucket(spec, layout.props[id], lod0, lod1, glowMaterials)
    })
  }, [gltfs, layout])

  // Glow halos: one billboard per lamp (stone lanterns, lantern posts, the censer's embers).
  const glow = useMemo(() => {
    const list: { x: number; y: number; z: number; size: number }[] = []
    const m = new Matrix4(), q = new Quaternion(), v = new Vector3(), up = new Vector3(0, 1, 0)
    for (const bucket of buckets) {
      const g = bucket.spec.glow
      if (!g || !g.spriteSize) continue
      for (const pl of bucket.placements) {
        m.compose(new Vector3(pl.x, pl.y, pl.z), q.setFromAxisAngle(up, pl.yaw), new Vector3().setScalar(pl.scale))
        v.set(...g.sprite).applyMatrix4(m)
        list.push({ x: v.x, y: v.y, z: v.z, size: g.spriteSize * pl.scale / bucket.spec.scale })
      }
    }
    const mesh = new InstancedMesh(glowQuad, makeGlowSpriteMaterial(), list.length)
    mesh.name = 'Prop_lantern_glow'
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.visible = false
    list.forEach((l, i) => mesh.setMatrixAt(i, m.makeScale(l.size, l.size, l.size).setPosition(l.x, l.y, l.z)))
    return mesh
  }, [buckets])

  // Masonry piers carry the pailou's outer pillars down to where the valley falls away from the road.
  const piers = useMemo(() => {
    if (!layout.piers.length) return null
    const geometry = mergeGeometries(layout.piers.map((p) => new BoxGeometry(...p.size).translate(...p.center)))
    const mesh = new Mesh(geometry, environmentMaterial('masonry'))
    mesh.name = 'Prop_pailou_piers'
    return mesh
  }, [layout])

  // Sources are clones (extractSource) and the glow / pier materials are built here, so they are ours to release;
  // the cached GLTFs stay intact for a remount.
  useEffect(() => () => {
    for (const bucket of buckets) for (const mesh of [bucket.near, bucket.far]) {
      if (!mesh) continue
      mesh.geometry.dispose(); (mesh.material as Material).dispose(); mesh.customDepthMaterial?.dispose(); mesh.dispose()
    }
  }, [buckets])
  useEffect(() => () => { (glow.material as Material).dispose(); glow.dispose() }, [glow])
  useEffect(() => () => { piers?.geometry.dispose(); piers?.material.dispose() }, [piers])

  useEffect(() => {
    // Flight / camera colliders for the large structures (walking passes through the open bays).
    const { x, y, z, scale } = layout.pailou
    const list: Collider[] = []
    for (const lz of [-0.404, -0.186, 0.186, 0.404]) list.push({ kind: 'cylinder', x: x - lz * scale, z, radius: 0.06 * scale, minY: y - 20, maxY: y + 0.36 * scale })
    list.push({ kind: 'box', min: [x - 0.46 * scale, y + 0.2 * scale, z - 0.1 * scale], max: [x + 0.46 * scale, y + 0.55 * scale, z + 0.1 * scale] })
    for (const id of ['incense_burner', 'pavilion'] as const) for (const p of layout.props[id]) {
      list.push({ kind: 'cylinder', x: p.x, z: p.z, radius: PROPS[id].radius * p.scale / PROPS[id].scale, minY: p.y, maxY: p.y + p.scale })
    }
    return registerColliders(list)
  }, [layout])

  const root = useRef<Group>(null)
  const state = useMemo(() => ({ last: new Vector3(Infinity, 0, 0), timer: 0, density: -1 }), [])
  useFrame(({ camera, clock }, delta) => {
    const density = DENSITY[quality]
    advancePines(delta)
    state.timer -= delta
    if (state.timer <= 0 || state.density !== density || state.last.distanceToSquared(camera.position) > REBUCKET_JUMP ** 2) {
      state.timer = REBUCKET_INTERVAL; state.density = density; state.last.copy(camera.position)
      for (const bucket of buckets) bucket.update(camera.position, density)
    }
    // Lamps light at dusk and under heavy overcast; emissive stays > 1 so bloom picks it up.
    const lit = Math.min(1, Math.max(atmosphere.night, atmosphere.overcast * 0.4))
    for (const bucket of buckets) {
      const g = bucket.spec.glow
      if (!g) continue
      const base = bucket.spec.id === 'spirit_crystal' ? 0.25 + lit * 1.6 : lit * 3.2 * g.strength
      for (const material of bucket.glowMaterials) material.emissiveIntensity = base
    }
    glow.visible = lit > 0.03
    if (glow.visible) syncGlowFog(glow.material as ShaderMaterial, clock.elapsedTime, lit * 1.35)
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __propStats?: () => unknown; __propHide?: (hidden: boolean) => void }
    // Review aid: hide the whole field to measure its render cost against the bare scene.
    w.__propHide = (hidden) => { if (root.current) root.current.visible = !hidden }
    w.__propStats = () => {
      const types: Record<string, { near: number; far: number; total: number }> = {}
      let meshes = 0
      for (const b of buckets) {
        types[b.spec.id] = { near: b.nearCount, far: b.farCount, total: b.placements.length }
        meshes += (b.near.visible ? 1 : 0) + (b.far?.visible ? 1 : 0)
      }
      return { types, meshes: meshes + (glow.visible ? 1 : 0) + (piers ? 1 : 0), glowSprites: glow.count, piers: layout.piers.length }
    }
    return () => { delete w.__propStats; delete w.__propHide }
  }, [buckets, glow, piers, layout])

  return (
    <group name="PropField" ref={root}>
      {buckets.map((b) => <group key={b.spec.id}><primitive object={b.near} />{b.far && <primitive object={b.far} />}</group>)}
      <primitive object={glow} />
      {piers && <primitive object={piers} />}
      <Cranes />
    </group>
  )
}

/** Instanced Tripo props and the crane flock (P5). */
export function PropField() {
  return <Suspense fallback={null}><PropFieldContent /></Suspense>
}
