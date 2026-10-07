import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  Box3,
  Color,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Triangle as ThreeTriangle,
  Uniform,
  Vector3,
} from 'three'
import type { Object3D } from 'three'
import { MG01_MAIN_BUILDING, MG02_GATE, MG04_SIDE_TOWER } from '../worldAssets'
import { groundHit, LAYOUT } from '../worldLayout'
import { INTERACT_SITES } from '../sites'
import { useWorldStore } from '../store'
import type { QualityLevel } from '../quality'
import { eldritchAssetUrls } from './eldritchAssets'
import { blackMistRuntime } from './runtime'
import { createFleshGeometry, createFleshMaterial, FLESH_TISSUE_REGION, orientFlesh } from './fleshGeometry'
import { LivingTissue } from './LivingTissue'
import type { LivingBuildingSite } from './LivingTissue'

type BuildingId = 'MG01' | 'MG02' | `MG04_Tower${number}`
type Detail = 'near' | 'far'
interface Triangle {
  a: Vector3
  b: Vector3
  c: Vector3
  normal: Vector3
  end: number
}
interface Surface {
  triangles: Triangle[]
  area: number
}
interface Site {
  id: string
  buildingId: BuildingId
  position: Vector3
  normal: Vector3
  matrix: Matrix4
  color: Color
  variant: number
  delay: number
}
interface Placement {
  id: BuildingId
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  multiplier: number
  surface: Surface
  count: number
  radius: readonly [number, number]
}
interface Bucket {
  mesh: InstancedMesh
  detail: Detail
  variant: number
  delays: InstancedBufferAttribute
}
interface BuildingAssets {
  sites: Site[]
  buckets: Bucket[]
  materials: MeshStandardMaterial[]
  growth: Uniform<number>
  life: Uniform<number>
  visible: boolean
  quality: QualityLevel
  surfaceArea: Record<string, number>
  livingSites: LivingBuildingSite[]
}

const COUNTS = {
  low: { main: 320, gate: 60, tower: 50 },
  mid: { main: 580, gate: 100, tower: 95 },
  high: { main: 900, gate: 150, tower: 160 },
} as const
const NEAR: Record<QualityLevel, number> = { low: 0, mid: 220, high: 330 }
let liveAssets: BuildingAssets | null = null

function randomSequence(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** Face-area sampling uses the same imported node transforms and normalization as WorldAsset. */
function buildingSurface(scene: Object3D, targetHeight: number): Surface {
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene),
    size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3())
  const normalization = new Matrix4()
    .makeScale(targetHeight / size.y, targetHeight / size.y, targetHeight / size.y)
    .multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z))
  const triangles: Triangle[] = []
  let area = 0
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.index
    if (!position) return
    const transform = normalization.clone().multiply(object.matrixWorld)
    const vertex = (i: number) =>
      new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(transform)
    const count = index?.count ?? position.count
    for (let i = 0; i + 2 < count; i += 3) {
      const a = vertex(i),
        b = vertex(i + 1),
        c = vertex(i + 2)
      const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
      const faceArea = normal.length() * 0.5
      if (faceArea < 0.003) continue
      normal.normalize()
      // Roofs, stair treads and all upward walking surfaces remain clear. Eave undersides,
      // columns and walls retain their actual outward face normals.
      if (normal.y > 0.3 || (a.y + b.y + c.y) / 3 < 1.7) continue
      area += faceArea
      triangles.push({ a, b, c, normal, end: area })
    }
  })
  if (!triangles.length) throw new Error('Building tissue needs an imported wall surface')
  return { triangles, area }
}

function sampleTriangle(surface: Surface, random: () => number): Triangle {
  const target = random() * surface.area
  let first = 0,
    last = surface.triangles.length - 1
  while (first < last) {
    const middle = (first + last) >>> 1
    if (surface.triangles[middle].end < target) first = middle + 1
    else last = middle
  }
  return surface.triangles[first]
}

function createSites(placements: Placement[]): Site[] {
  const sites: Site[] = [],
    random = randomSequence(0x79c72a)
  for (const placement of placements) {
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation))
    const transform = new Matrix4().compose(
      new Vector3(...placement.position),
      rotation,
      new Vector3().setScalar(placement.multiplier),
    )
    let accepted = 0
    for (let attempt = 0; accepted < placement.count && attempt < placement.count * 18; attempt++) {
      const triangle = sampleTriangle(placement.surface, random),
        root = Math.sqrt(random()),
        side = random()
      const position = triangle.a
        .clone()
        .multiplyScalar(1 - root)
        .addScaledVector(triangle.b, root * (1 - side))
        .addScaledVector(triangle.c, root * side)
        .applyMatrix4(transform)
      const normal = triangle.normal.clone().applyQuaternion(rotation).normalize()
      if (position.y < placement.position[1] + 2) continue
      // Leave the gate opening and the main hall's central arrival route readable and clear.
      if (placement.id === 'MG02' && Math.abs(position.x) < 12.5 && position.y < 28) continue
      if (placement.id === 'MG01' && Math.abs(position.x) < 17 && position.z > -185 && position.y < 48) continue
      const radius = (placement.radius[0] + random() * placement.radius[1]) * placement.multiplier
      const scale = new Vector3(
        radius * (1 + random() * 0.52),
        radius * (0.72 + random() * 0.62),
        radius * (0.34 + random() * 0.2),
      )
      const matrix = new Matrix4().compose(
        position.clone().addScaledVector(normal, 0.045),
        orientFlesh(normal, random() * Math.PI * 2),
        scale,
      )
      const color = new Color().setRGB(0.94 + random() * 0.14, 0.84 + random() * 0.13, 0.81 + random() * 0.14)
      sites.push({
        id: `${placement.id}_tissue_${accepted}`,
        buildingId: placement.id,
        position,
        normal,
        matrix,
        color,
        variant: accepted % 3,
        delay: random() * 0.16,
      })
      accepted++
    }
  }
  return sites
}

/** Deterministic low-wall cuts, independent of the quality-dependent blister density. */
function livingWallSites(placements: Placement[]): LivingBuildingSite[] {
  const result: LivingBuildingSite[] = []
  for (const placement of placements) {
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation))
    const transform = new Matrix4().compose(
      new Vector3(...placement.position),
      rotation,
      new Vector3().setScalar(placement.multiplier),
    )
    let selected: LivingBuildingSite | null = null,
      best = Infinity
    for (const triangle of placement.surface.triangles) {
      const normal = triangle.normal.clone().applyQuaternion(rotation).normalize()
      if (Math.abs(normal.y) > 0.22) continue
      const points = [triangle.a, triangle.b, triangle.c].map((point) => point.clone().applyMatrix4(transform))
      if (Math.min(...points.map((point) => point.y)) > placement.position[1] + 8) continue
      const center = points[0]
        .clone()
        .add(points[1])
        .add(points[2])
        .multiplyScalar(1 / 3)
      const outside = center.clone().addScaledVector(normal, 5)
      const ground = groundHit(outside.x, outside.z, center.y + 2)
      if (!ground || ground.normalY < 0.96) continue
      const targetY = ground.y + 2.05,
        crossings: Vector3[] = []
      for (let edge = 0; edge < 3; edge++) {
        const a = points[edge],
          b = points[(edge + 1) % 3],
          dy = b.y - a.y
        if (Math.abs(dy) < 1e-7) continue
        const t = (targetY - a.y) / dy
        if (t >= 0.04 && t <= 0.96) crossings.push(a.clone().lerp(b, t))
      }
      if (crossings.length < 2) continue
      const position = crossings[0].clone().add(crossings[1]).multiplyScalar(0.5)
      const approach = position.clone().addScaledVector(normal, 5)
      const support = groundHit(approach.x, approach.z, position.y + 2)
      if (
        !support ||
        support.normalY < 0.96 ||
        Math.abs(position.y - support.y - 2.05) > 0.35 ||
        Math.abs(approach.x) < 14
      )
        continue
      if (Math.hypot(position.x, position.z + 116) < 35 || Math.hypot(position.x, position.z - 150) < 35) continue
      if (
        INTERACT_SITES.some(
          (site) =>
            site.kind === 'teleport' && Math.hypot(position.x - site.position[0], position.z - site.position[2]) < 45,
        )
      )
        continue
      // Prefer substantial wall faces and an open apron; the source point remains barycentric on
      // the actual imported triangle, rather than a guessed building bounding box.
      const area =
        new Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).length() * 0.5
      const score =
        Math.abs(position.z - placement.position[2]) +
        Math.abs(position.x - placement.position[0]) * 0.2 -
        Math.min(area, 20) * 0.05
      if (score >= best) continue
      const barycentric = new Vector3()
      ThreeTriangle.getBarycoord(position, points[0], points[1], points[2], barycentric)
      selected = {
        id: `${placement.id}_living_wall`,
        buildingId: placement.id,
        position,
        normal,
        sourceTriangle: points as [Vector3, Vector3, Vector3],
        barycentric,
      }
      best = score
    }
    if (selected) result.push(selected)
  }
  return result
}

function patchGrowth(material: MeshStandardMaterial, growth: Uniform<number>, life: Uniform<number>) {
  const tissueCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    tissueCompile.call(material, shader, renderer)
    shader.uniforms.uBuildingFleshGrowth = growth
    shader.uniforms.uBuildingFleshLife = life
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uBuildingFleshGrowth; uniform float uBuildingFleshLife;
        attribute float aFleshDelay; varying float vFleshGrowth;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float fleshGrowth = smoothstep(aFleshDelay, aFleshDelay + 0.75, uBuildingFleshGrowth);
        float tissueBeat = sin(uBuildingFleshLife * 1.6 + aFleshDelay * 47.0);
        float fleshSpread = mix(0.22, 1.0, fleshGrowth) * (1.0 + tissueBeat * 0.016);
        float fleshDepth = fleshGrowth * (1.0 + tissueBeat * 0.065);
        objectNormal.xy /= fleshSpread;
        objectNormal.z /= max(fleshDepth, 0.025);
        vFleshGrowth = fleshGrowth;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.xy *= fleshSpread;
        transformed.z *= fleshDepth;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFleshGrowth;')
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (vFleshGrowth < 0.008) discard;',
      )
  }
  material.customProgramCacheKey = () => 'building-lobulated-pbr-living-3'
}

function textureSize(material: MeshStandardMaterial): [number, number] {
  const image = material.map?.image as unknown as { width?: number; height?: number } | undefined
  return [image?.width ?? 0, image?.height ?? 0]
}

/** Stable verification data; no React subscriptions or DOM presentation are needed for growth. */
export function buildingMutationSnapshot() {
  const assets = liveAssets
  return {
    growth: assets?.growth.value ?? 0,
    visible: assets?.visible ?? false,
    quality: assets?.quality ?? null,
    source: FLESH_TISSUE_REGION.source,
    surfaceArea: assets?.surfaceArea ?? {},
    sites:
      assets?.sites.map((site) => ({
        id: site.id,
        buildingId: site.buildingId,
        position: site.position.toArray(),
        normal: site.normal.toArray(),
        delay: site.delay,
      })) ?? [],
    draws:
      assets?.buckets.map(({ mesh, detail }) => {
        const material = mesh.material as MeshStandardMaterial
        return {
          name: mesh.name,
          lod: detail,
          instances: mesh.count,
          triangles: (mesh.geometry.index?.count ?? 0) / 3,
          pbr: { baseColor: !!material.map, normal: !!material.normalMap, roughness: !!material.roughnessMap },
          textureSize: textureSize(material),
          visible: assets.visible && mesh.visible,
        }
      }) ?? [],
  }
}

/** Dense attached tissue on all eight imported buildings, with six shared instanced draws at most. */
export function BuildingCorruption() {
  const [main] = useGLTF([MG01_MAIN_BUILDING.url, MG01_MAIN_BUILDING.lodUrl])
  const [gate] = useGLTF([MG02_GATE.url, MG02_GATE.lodUrl])
  const [tower] = useGLTF([MG04_SIDE_TOWER.url, MG04_SIDE_TOWER.lodUrl])
  const [, , tentacle, tentacleLow] = useGLTF(eldritchAssetUrls())
  const quality = useWorldStore((state) => state.quality)
  const group = useRef<Group>(null)
  const surfaces = useMemo(
    () => ({
      main: buildingSurface(main.scene, MG01_MAIN_BUILDING.targetHeight),
      gate: buildingSurface(gate.scene, MG02_GATE.targetHeight),
      tower: buildingSurface(tower.scene, MG04_SIDE_TOWER.targetHeight),
    }),
    [main.scene, gate.scene, tower.scene],
  )
  const assets = useMemo<BuildingAssets>(() => {
    const counts = COUNTS[quality],
      growth = new Uniform(0),
      life = new Uniform(0)
    const placements: Placement[] = [
      {
        id: 'MG01',
        position: LAYOUT.main.position,
        rotation: LAYOUT.main.rotation,
        multiplier: 1,
        surface: surfaces.main,
        count: counts.main,
        radius: [3.4, 7.6],
      },
      {
        id: 'MG02',
        position: LAYOUT.gate.position,
        rotation: LAYOUT.gate.rotation,
        multiplier: 1,
        surface: surfaces.gate,
        count: counts.gate,
        radius: [1.25, 2.1],
      },
      ...LAYOUT.towers.map((placement, index): Placement => ({
        id: `MG04_Tower${index}`,
        position: placement.position,
        rotation: placement.rotation,
        multiplier: placement.scaleMultiplier,
        surface: surfaces.tower,
        count: counts.tower,
        radius: [2.1, 4.8],
      })),
    ]
    const sites = createSites(placements),
      livingSites = livingWallSites(placements)
    const materials = [
      createFleshMaterial(tentacle.scene, { name: 'BuildingFoldedFleshNear' }),
      createFleshMaterial(tentacleLow.scene, { name: 'BuildingFoldedFleshFar' }),
    ]
    materials.forEach((material) => patchGrowth(material, growth, life))
    const buckets: Bucket[] = []
    for (const [lod, detail] of (['near', 'far'] as const).entries())
      for (let variant = 0; variant < 3; variant++) {
        const geometry = createFleshGeometry({ seed: 0x5334 + variant * 1949, detail })
        const delays = new InstancedBufferAttribute(new Float32Array(sites.length), 1)
        geometry.setAttribute('aFleshDelay', delays)
        const mesh = new InstancedMesh(geometry, materials[lod], sites.length)
        mesh.name = `BuildingFlesh_${detail}_${variant}`
        mesh.count = 0
        mesh.userData.castShadow = false
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.userData.mutation = {
          kind: 'building-flesh',
          source: FLESH_TISSUE_REGION.source,
          lod: detail,
          variant,
          triangles: (geometry.index?.count ?? 0) / 3,
          pbr: { baseColor: true, normal: true, roughness: true },
          textureSize: textureSize(materials[lod]),
        }
        buckets.push({ mesh, detail, variant, delays })
      }
    return {
      sites,
      buckets,
      materials,
      growth,
      life,
      livingSites,
      visible: false,
      quality,
      surfaceArea: { MG01: surfaces.main.area, MG02: surfaces.gate.area, MG04: surfaces.tower.area },
    }
  }, [quality, surfaces, tentacle.scene, tentacleLow.scene])
  const previous = useRef({
    time: -100,
    position: new Vector3(Infinity, Infinity, Infinity),
    assets: null as BuildingAssets | null,
  })
  useEffect(() => {
    liveAssets = assets
    return () => {
      if (liveAssets === assets) liveAssets = null
      assets.buckets.forEach(({ mesh }) => {
        mesh.dispose()
        mesh.geometry.dispose()
      })
      assets.materials.forEach((material) => material.dispose())
    }
  }, [assets])
  useFrame(({ camera, clock }) => {
    const runtime = blackMistRuntime
    const growth = Math.max(0, Math.min(1, (runtime.corruption - 0.18) / 0.82))
    assets.growth.value = growth
    assets.life.value = runtime.motionTime
    assets.visible = runtime.active && growth > 0.008
    if (group.current) group.current.visible = assets.visible
    if (!assets.visible) return
    const prior = previous.current,
      now = clock.elapsedTime
    if (prior.assets === assets && now - prior.time < 0.35 && camera.position.distanceToSquared(prior.position) < 625)
      return
    prior.time = now
    prior.position.copy(camera.position)
    prior.assets = assets
    const counts = [0, 0, 0, 0, 0, 0],
      near = NEAR[quality]
    for (const site of assets.sites) {
      const close = camera.position.distanceToSquared(site.position) < near * near
      const bucketIndex = site.variant + (close ? 0 : 3),
        bucket = assets.buckets[bucketIndex],
        index = counts[bucketIndex]++
      bucket.mesh.setMatrixAt(index, site.matrix)
      bucket.mesh.setColorAt(index, site.color)
      bucket.delays.setX(index, site.delay)
    }
    assets.buckets.forEach(({ mesh, delays }, index) => {
      mesh.count = counts[index]
      mesh.visible = mesh.count > 0
      if (!mesh.count) return
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      delays.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  })
  return (
    <group ref={group} name="building-corruption" visible={false} dispose={null}>
      {assets.buckets.map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <LivingTissue buildingSites={assets.livingSites} />
    </group>
  )
}
