import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  Box3,
  BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Uniform,
  Vector3,
} from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { INTERACT_SITES } from '../sites'
import { groundHit, groundHeight } from '../worldLayout'
import { useWorldStore } from '../store'
import type { QualityLevel } from '../quality'
import { blackMistRuntime } from './runtime'
import { ELDRITCH_ASSETS, HORROR_ASSETS, eldritchAssetUrls } from './eldritchAssets'
import { createFleshGeometry, createFleshMaterial, orientFlesh } from './fleshGeometry'
import {
  bindEyeMotionGeometry,
  createEyeMotionRig,
  patchEyeMotionMaterial,
  setEyeInstancePhase,
  updateEyeMotion,
} from './eyeMotion'
import {
  bindTentacleMotionGeometry,
  createTentacleMotionRig,
  evaluateTentacleMotionVertex,
  patchTentacleMotionMaterial,
  setTentacleInstancePhase,
  updateTentacleMotion,
} from './tentacleMotion'
import { publishBlackMistHazard, queryBlackMistThreat, unregisterBlackMistHazard } from './hazards'
import type { BlackMistThreat } from './hazards'
import { clawNormalization, createTissueClaws } from './tissueClawGeometry'

export interface LivingBuildingSite {
  id: string
  buildingId: string
  position: Vector3
  normal: Vector3
  sourceTriangle?: readonly [Vector3, Vector3, Vector3]
  barycentric?: Vector3
}
type Kind = 'claw' | 'tendril'
type PartKind = Kind | 'eye' | 'membrane'
interface Site {
  id: string
  surface: 'ground' | 'building'
  buildingId?: string
  kind: Kind
  root: Vector3
  normal: Vector3
  height: number
  phaseSlot: number
  seed: number
  approachPoint: Vector3
  hasEye: boolean
  matrix: Matrix4
  growth: number
  visible: boolean
  lod: number
  threat: BlackMistThreat | null
  probes: { name: string; index: number; sourceIndex?: number; position: Vector3 }[]
  sweeps: { id: string; a: Vector3; b: Vector3; radius: number; active: boolean }[]
  surfaceReference?: { triangle: readonly [Vector3, Vector3, Vector3]; barycentric: Vector3 }
}
interface Part {
  mesh: InstancedMesh
  kind: PartKind
  lod: number
  phase: InstancedBufferAttribute
  alert: InstancedBufferAttribute
  probes: { name: string; index: number; sourceIndex?: number }[]
}
const CAPACITY = 32,
  UP = new Vector3(0, 1, 0)
const NEAR: Record<QualityLevel, number> = { low: 0, mid: 100, high: 170 }
const groundLayout = [
  [-65, -95, 'claw', 3.4],
  [70, -91, 'claw', 3.8],
  [-165, -135, 'tendril', 4.1],
  [161, -140, 'claw', 3.3],
  [-161, -235, 'claw', 3.6],
  [159, -365, 'tendril', 4.3],
  [-160, -475, 'claw', 3.7],
  [145, -494, 'tendril', 3.9],
] as const
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
let liveSnapshot: (() => unknown) | null = null
export const livingTissueSnapshot = () => liveSnapshot?.() ?? { visible: false, growth: 0, sites: [], draws: [] }

function safeRoot(root: Vector3) {
  if (Math.hypot(root.x, root.z + 116) < 35 || Math.hypot(root.x, root.z - 150) < 35) return false
  return INTERACT_SITES.every(
    (site) => site.kind !== 'teleport' || Math.hypot(root.x - site.position[0], root.z - site.position[2]) >= 45,
  )
}

function makeSites(buildings: readonly LivingBuildingSite[]): Site[] {
  const sites: Site[] = []
  const add = (
    id: string,
    surface: Site['surface'],
    kind: Kind,
    root: Vector3,
    normal: Vector3,
    height: number,
    approachPoint: Vector3,
    buildingId?: string,
  ) => {
    if (!safeRoot(root)) return
    const index = sites.length
    sites.push({
      id,
      surface,
      kind,
      root,
      normal,
      height,
      phaseSlot: index % 8,
      seed: 913 + index * 169,
      approachPoint,
      buildingId,
      hasEye: index === 1 || index === 5 || (surface === 'building' && index === 8),
      matrix: new Matrix4(),
      growth: 0,
      visible: false,
      lod: 1,
      threat: null,
      probes: [],
      sweeps: [],
    })
  }
  for (const [x, z, kind, height] of groundLayout) {
    const hit = groundHit(x, z)
    if (!hit || hit.normalY < 0.98) continue
    const approachZ = z + 8,
      approachY = groundHeight(x, approachZ, hit.y + 3)
    if (approachY === null || Math.abs(approachY - hit.y) > 0.5) continue
    add(
      `ground-organ-${sites.length}`,
      'ground',
      kind,
      new Vector3(x, hit.y, z),
      UP.clone(),
      height,
      new Vector3(x, approachY, approachZ),
    )
  }
  const perBuilding = new Set<string>()
  for (const candidate of buildings) {
    if (sites.filter((site) => site.surface === 'building').length >= 4) break
    if (perBuilding.has(candidate.buildingId) || Math.abs(candidate.normal.y) > 0.22) continue
    const approach = candidate.position.clone().addScaledVector(candidate.normal, 5)
    const hit = groundHit(approach.x, approach.z, candidate.position.y + 1)
    const difference = hit ? candidate.position.y - hit.y : Infinity
    if (!hit || hit.normalY < 0.96 || difference < 1.5 || difference > 2.4) continue
    if (!safeRoot(candidate.position) || Math.abs(approach.x) < 14) continue
    approach.y = hit.y
    const kind: Kind = perBuilding.size % 2 ? 'claw' : 'tendril'
    add(
      `wall-organ-${candidate.buildingId}`,
      'building',
      kind,
      candidate.position.clone(),
      candidate.normal.clone(),
      (kind === 'tendril' ? 3.9 : 3.2) + perBuilding.size * 0.08,
      approach,
      candidate.buildingId,
    )
    perBuilding.add(candidate.buildingId)
    if (candidate.sourceTriangle && candidate.barycentric)
      sites[sites.length - 1].surfaceReference = {
        triangle: candidate.sourceTriangle,
        barycentric: candidate.barycentric,
      }
  }
  return sites
}

function normalizedParts(
  scene: Object3D,
  normalization: Matrix4,
): { geometry: BufferGeometry; material: MeshStandardMaterial }[] {
  scene.updateMatrixWorld(true)
  const parts: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = []
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material
    if (!(sourceMaterial instanceof MeshStandardMaterial)) return
    const geometry = object.geometry.clone()
    for (const name of ['position', 'normal', 'tangent']) {
      const attribute = geometry.getAttribute(name)
      if (!attribute) continue
      const values = new Float32Array(attribute.count * attribute.itemSize)
      for (let vertex = 0; vertex < attribute.count; vertex++)
        for (let component = 0; component < attribute.itemSize; component++) {
          values[vertex * attribute.itemSize + component] = attribute.getComponent(vertex, component)
        }
      geometry.setAttribute(name, new BufferAttribute(values, attribute.itemSize))
    }
    const transform = normalization.clone().multiply(object.matrixWorld)
    geometry.applyMatrix4(transform)
    geometry.computeBoundingSphere()
    geometry.userData.sourceNormalization = transform.toArray()
    parts.push({ geometry, material: sourceMaterial.clone() })
  })
  return parts
}

function rootNormalization(scene: Object3D) {
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene),
    height = box.max.y - box.min.y,
    base = new Vector3(),
    vertex = new Vector3()
  let count = 0
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index++) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld)
      if (vertex.y <= box.min.y + height * 0.06) {
        base.add(vertex)
        count++
      }
    }
  })
  if (!count) throw new Error('Living tendril requires the inspected source root')
  base.divideScalar(count)
  base.y = box.min.y
  return new Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z))
}

function patchMembrane(material: MeshStandardMaterial, time: Uniform<number>) {
  const original = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer)
    shader.uniforms.uTissueLife = time
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
      uniform float uTissueLife; attribute float aTissuePhase; attribute float aTissueAlert;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float tissueBeat = sin(uTissueLife * (1.6 + aTissueAlert * 4.0) + aTissuePhase);
        float tissueWidth = 1.0 + tissueBeat * (0.025 + aTissueAlert * 0.04);
        float tissueDepth = 1.0 + tissueBeat * (0.11 + aTissueAlert * 0.23) + aTissueAlert * 0.38;
        objectNormal.xy /= tissueWidth; objectNormal.z /= tissueDepth;`,
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.xy *= tissueWidth; transformed.z *= tissueDepth;',
      )
  }
  material.customProgramCacheKey = () => 'living-tissue-pbr-anticipation-1'
}

class TissueBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** A failure in an optional organism never removes the imported buildings or the player's ground. */
export function LivingTissue({ buildingSites }: { buildingSites: readonly LivingBuildingSite[] }) {
  return (
    <TissueBoundary>
      <Suspense fallback={null}>
        <TissueOrganisms buildingSites={buildingSites} />
      </Suspense>
    </TissueBoundary>
  )
}

function TissueOrganisms({ buildingSites }: { buildingSites: readonly LivingBuildingSite[] }) {
  const [eye, eyeLow, tentacle, tentacleLow, , , behemoth, behemothLow] = useGLTF(eldritchAssetUrls())
  const quality = useWorldStore((state) => state.quality),
    group = useRef<Group>(null)
  const sites = useMemo(() => makeSites(buildingSites), [buildingSites])
  const assets = useMemo(() => {
    const time = new Uniform(0),
      tentacleNorm = rootNormalization(tentacle.scene)
    const limbRig = createTentacleMotionRig(tentacleNorm, time),
      eyeRig = createEyeMotionRig(197)
    const eyeBox = new Box3().setFromObject(eye.scene),
      eyeSize = eyeBox.getSize(new Vector3()),
      center = eyeBox.getCenter(new Vector3())
    const eyeNorm = new Matrix4()
      .makeScale(1 / eyeSize.z, 1 / eyeSize.z, 1 / eyeSize.z)
      .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
      .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    const clawNorm = clawNormalization(behemoth.scene),
      parts: Part[] = []
    const append = (
      kind: PartKind,
      lod: number,
      geometry: BufferGeometry,
      material: MeshStandardMaterial,
      probes: Part['probes'] = [],
    ) => {
      const mesh = new InstancedMesh(geometry, material, CAPACITY)
      const phase = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1)
      const alert = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1)
      geometry.setAttribute('aTissuePhase', phase)
      geometry.setAttribute('aTissueAlert', alert)
      mesh.name = `LivingTissue_${kind}_LOD${lod}`
      mesh.count = 0
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.userData.castShadow = false
      mesh.userData.livingTissue = {
        kind,
        lod,
        sourceUrl:
          kind === 'claw'
            ? lod
              ? HORROR_ASSETS.behemoth.lodModel
              : HORROR_ASSETS.behemoth.model
            : kind === 'eye'
              ? lod
                ? ELDRITCH_ASSETS.eye.lodModel
                : ELDRITCH_ASSETS.eye.model
              : lod
                ? ELDRITCH_ASSETS.tentacle.lodModel
                : ELDRITCH_ASSETS.tentacle.model,
        triangles: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3,
        sourceNormalization:
          geometry.userData.sourceAnatomy?.normalization ?? geometry.userData.sourceNormalization ?? null,
        pbr: { baseColor: !!material.map, normal: !!material.normalMap, roughness: !!material.roughnessMap },
      }
      parts.push({ mesh, kind, lod, phase, alert, probes })
    }
    for (const [lod, source] of [behemoth.scene, behemothLow.scene].entries()) {
      createTissueClaws(source, clawNorm).forEach((part) =>
        append('claw', lod, part.geometry, part.material, part.probes),
      )
    }
    for (const [lod, source] of [tentacle.scene, tentacleLow.scene].entries()) {
      for (const part of normalizedParts(source, tentacleNorm)) {
        bindTentacleMotionGeometry(part.geometry, limbRig, CAPACITY)
        patchTentacleMotionMaterial(part.material, limbRig)
        const position = part.geometry.getAttribute('position'),
          probes: Part['probes'] = []
        for (const joint of [3, 4, 5, 6, 7, 9, 10, 11]) {
          let chosen = 0,
            best = Infinity
          for (let index = 0; index < position.count; index++) {
            const distance = new Vector3().fromBufferAttribute(position, index).distanceToSquared(limbRig.rest[joint])
            if (distance < best) {
              best = distance
              chosen = index
            }
          }
          probes.push({ name: joint === 11 ? 'tip' : `muscle-${joint}`, index: chosen, sourceIndex: chosen })
        }
        append('tendril', lod, part.geometry, part.material, probes)
      }
      const membrane = createFleshGeometry({ seed: 0x50fa, detail: lod ? 'far' : 'near' })
      const material = createFleshMaterial(source, { name: `LivingPulsingMembraneLOD${lod}`, tint: '#af9c92' })
      patchMembrane(material, time)
      append('membrane', lod, membrane, material)
    }
    for (const [lod, source] of [eye.scene, eyeLow.scene].entries())
      for (const part of normalizedParts(source, eyeNorm)) {
        bindEyeMotionGeometry(part.geometry)
        patchEyeMotionMaterial(part.material, eyeRig)
        append('eye', lod, part.geometry, part.material)
      }
    return { parts, time, limbRig, eyeRig, visible: false, growth: 0 }
  }, [eye.scene, eyeLow.scene, tentacle.scene, tentacleLow.scene, behemoth.scene, behemothLow.scene])
  const scratch = useMemo(
    () => ({
      position: new Vector3(),
      scale: new Vector3(),
      rotation: new Quaternion(),
      normalRotation: new Quaternion(),
      outwardX: new Vector3(),
      downwardZ: new Vector3(),
      basis: new Matrix4(),
      yaw: new Quaternion(),
      pitch: new Quaternion(),
      point: new Vector3(),
      target: new Vector3(),
      matrix: new Matrix4(),
      eyeMatrix: new Matrix4(),
    }),
    [],
  )
  useEffect(() => {
    const snapshot = () => ({
      visible: assets.visible,
      growth: assets.growth,
      time: assets.time.value,
      quality: useWorldStore.getState().quality,
      sites: sites.map((site) => ({
        id: site.id,
        surface: site.surface,
        kind: site.kind,
        buildingId: site.buildingId ?? null,
        root: site.root.toArray(),
        position: site.root.toArray(),
        normal: site.normal.toArray(),
        approachPoint: site.approachPoint.toArray(),
        height: site.height,
        phaseSlot: site.phaseSlot,
        visible: site.visible,
        growth: site.growth,
        lod: site.lod,
        phase: site.threat?.phase ?? 'idle',
        progress: site.threat?.progress ?? 0,
        sequence: site.threat?.attackSerial ?? 0,
        renderedMatrix: site.matrix.toArray(),
        sourceUrl:
          site.kind === 'claw'
            ? site.lod
              ? HORROR_ASSETS.behemoth.lodModel
              : HORROR_ASSETS.behemoth.model
            : site.lod
              ? ELDRITCH_ASSETS.tentacle.lodModel
              : ELDRITCH_ASSETS.tentacle.model,
        sourceProbes: site.probes.map((probe) => ({ ...probe, position: probe.position.toArray() })),
        motionPalette:
          site.kind === 'tendril'
            ? {
                phaseSlot: site.phaseSlot,
                rotations: Array.from(
                  assets.limbRig.rotations.value.slice(site.phaseSlot * 48, (site.phaseSlot + 1) * 48),
                ),
                duals: Array.from(assets.limbRig.duals.value.slice(site.phaseSlot * 48, (site.phaseSlot + 1) * 48)),
              }
            : null,
        surfaceReference: site.surfaceReference
          ? {
              triangle: site.surfaceReference.triangle.map((point) => point.toArray()),
              barycentric: site.surfaceReference.barycentric.toArray(),
            }
          : null,
        collision: {
          shape: 'posed-source-capsules',
          sweeps: site.sweeps.map((sweep) => ({ ...sweep, a: sweep.a.toArray(), b: sweep.b.toArray() })),
        },
      })),
      draws: assets.parts.map(({ mesh }) => ({
        name: mesh.name,
        ...mesh.userData.livingTissue,
        instances: mesh.count,
        visible: assets.visible && mesh.visible,
      })),
    })
    liveSnapshot = snapshot
    return () => {
      if (liveSnapshot === snapshot) liveSnapshot = null
      for (const site of sites) {
        unregisterBlackMistHazard(site.id)
        for (let index = 0; index < 8; index++) {
          unregisterBlackMistHazard(`${site.id}/finger-${index}`)
          unregisterBlackMistHazard(`${site.id}/muscle-${index}`)
        }
      }
    }
  }, [assets, sites])
  useEffect(
    () => () => {
      for (const { mesh } of assets.parts) {
        mesh.geometry.dispose()
        ;(mesh.material as MeshStandardMaterial).dispose()
        mesh.dispose()
      }
    },
    [assets],
  )
  useFrame(({ camera }) => {
    const runtime = blackMistRuntime,
      growth = ease((runtime.corruption - 0.3) / 0.7)
    assets.growth = growth
    assets.visible = runtime.active && growth > 0.008
    if (group.current) group.current.visible = assets.visible
    if (!assets.visible) {
      sites.forEach((site) => {
        site.visible = false
        site.probes = []
        site.sweeps = []
      })
      return
    }
    assets.time.value = runtime.motionTime
    updateTentacleMotion(assets.limbRig, runtime.motionTime, 0.72)
    updateEyeMotion(assets.eyeRig, runtime.motionTime, 0.62)
    const counts = new Map(assets.parts.map((part) => [part, 0]))
    for (const site of sites) {
      const threat = queryBlackMistThreat({
        id: site.id,
        kind: site.surface,
        origin: site.root,
        range: 9,
        windup: 1.3,
        strike: 0.8,
        recover: 1.1,
        cooldown: 2.7 + (site.seed % 3) * 0.35,
      })
      site.threat = threat
      site.lod = camera.position.distanceToSquared(site.root) < NEAR[quality] ** 2 ? 0 : 1
      const p = threat.progress,
        attack = threat.phase === 'strike',
        recover = threat.phase === 'recover'
      const rise =
        threat.phase === 'windup'
          ? 0.12 + 0.16 * ease(p)
          : attack
            ? 0.28 + 0.72 * ease(p / 0.36)
            : recover
              ? 1 - 0.88 * ease(p)
              : 0.12 + 0.009 * Math.sin(runtime.motionTime * 1.6 + site.seed)
      site.growth = rise * growth
      site.visible = assets.visible
      const lean = attack ? 0.58 * ease(p / 0.44) : recover ? 0.58 * (1 - ease(p)) : -0.06 * threat.strength
      if (site.surface === 'building') {
        // A wall-grown wrist points out from its real face and hangs its fingers toward the apron.
        // A shortest-arc Y-to-normal rotation would arbitrarily throw the palm upward on one wall.
        scratch.downwardZ.set(0, -1, 0).addScaledVector(site.normal, site.normal.y).normalize()
        scratch.outwardX.crossVectors(site.normal, scratch.downwardZ).normalize()
        scratch.basis.makeBasis(scratch.outwardX, site.normal, scratch.downwardZ)
        scratch.normalRotation.setFromRotationMatrix(scratch.basis)
      } else scratch.normalRotation.setFromUnitVectors(UP, site.normal)
      scratch.target
        .copy(threat.target ?? site.approachPoint)
        .sub(site.root)
        .applyQuaternion(scratch.normalRotation.clone().invert())
      const facing = Math.atan2(scratch.target.x, scratch.target.z)
      scratch.yaw.setFromAxisAngle(UP, facing)
      scratch.pitch.setFromAxisAngle(new Vector3(1, 0, 0), site.surface === 'ground' ? lean : lean * 0.32)
      scratch.rotation.copy(scratch.normalRotation).multiply(scratch.yaw).multiply(scratch.pitch)
      scratch.position.copy(site.root).addScaledVector(site.normal, -site.height * (1 - site.growth) - 0.24)
      site.matrix.compose(scratch.position, scratch.rotation, scratch.scale.setScalar(site.height))
      site.probes = []
      site.sweeps = []
      for (const part of assets.parts) {
        if (
          part.lod !== site.lod ||
          (part.kind !== site.kind && part.kind !== 'membrane' && !(part.kind === 'eye' && site.hasEye))
        )
          continue
        const index = counts.get(part)!,
          mesh = part.mesh
        if (part.kind === 'membrane') {
          scratch.position.copy(site.root).addScaledVector(site.normal, -0.018)
          const radius = site.surface === 'ground' ? 1.7 : 1.4
          scratch.matrix.compose(
            scratch.position,
            orientFlesh(site.normal, site.seed),
            scratch.scale.set(radius, radius * 0.88, 0.16 + 0.31 * growth),
          )
          mesh.setMatrixAt(index, scratch.matrix)
        } else if (part.kind === 'eye') {
          scratch.position.copy(site.root).addScaledVector(site.normal, -0.13)
          scratch.eyeMatrix.compose(scratch.position, orientFlesh(site.normal, 0.13), scratch.scale.setScalar(0.82))
          mesh.setMatrixAt(index, scratch.eyeMatrix)
          setEyeInstancePhase(mesh.geometry, index, site.phaseSlot)
        } else {
          mesh.setMatrixAt(index, site.matrix)
          if (part.kind === 'tendril') setTentacleInstancePhase(mesh.geometry, index, site.phaseSlot)
          for (const probe of part.probes) {
            if (part.kind === 'tendril')
              evaluateTentacleMotionVertex(mesh.geometry, assets.limbRig, probe.index, scratch.point, site.phaseSlot)
            else scratch.point.fromBufferAttribute(mesh.geometry.getAttribute('position'), probe.index)
            site.probes.push({ ...probe, position: scratch.point.clone().applyMatrix4(site.matrix) })
          }
        }
        part.phase.setX(index, site.seed)
        part.alert.setX(index, threat.phase === 'windup' ? threat.strength * 2.5 : 0)
        counts.set(part, index + 1)
      }
      const active = attack && growth > 0.98
      if (site.kind === 'claw' && site.probes.length >= 5) {
        const knuckle = site.probes[4].position
        for (let finger = 0; finger < 4; finger++) {
          const sweep = {
            id: `${site.id}/finger-${finger}`,
            a: knuckle.clone(),
            b: site.probes[finger].position.clone(),
            radius: 0.32,
            active,
          }
          site.sweeps.push(sweep)
          publishBlackMistHazard({ ...sweep, kind: site.surface, attackSerial: threat.attackSerial })
        }
      } else if (site.probes.length >= 8) {
        // Adjacent muscle segments only: never close a collision chord across the source's open curl.
        for (const [a, b, radius] of [
          [6, 7, 0.2],
          [5, 6, 0.25],
          [3, 4, 0.3],
          [2, 3, 0.35],
          [1, 2, 0.4],
          [0, 1, 0.43],
        ] as const) {
          const sweep = {
            id: `${site.id}/muscle-${a}`,
            a: site.probes[a].position.clone(),
            b: site.probes[b].position.clone(),
            radius,
            active,
          }
          site.sweeps.push(sweep)
          publishBlackMistHazard({ ...sweep, kind: site.surface, attackSerial: threat.attackSerial })
        }
      }
    }
    for (const part of assets.parts) {
      part.mesh.count = counts.get(part)!
      part.mesh.visible = part.mesh.count > 0
      if (!part.mesh.count) continue
      part.mesh.instanceMatrix.needsUpdate = true
      part.phase.needsUpdate = true
      part.alert.needsUpdate = true
      part.mesh.computeBoundingSphere()
    }
  }, -0.85)
  return (
    <group ref={group} name="living-tissue-organisms" visible={false} dispose={null}>
      {assets.parts.map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}
