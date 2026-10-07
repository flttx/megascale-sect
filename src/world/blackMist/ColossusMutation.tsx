import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three'
import type { Object3D } from 'three'
import { useWorldStore } from '../store'
import type { QualityLevel } from '../quality'
import { eldritchAssetUrls, ELDRITCH_ASSETS } from './eldritchAssets'
import { orientFlesh } from './fleshGeometry'
import {
  beginSkinHostFrame,
  bodySkinConformance,
  captureSkinHost,
  createBodySkinTransition,
  evaluateSkinSample,
  updateBodySkinTransition,
} from './bodySkinTransition'
import type { BodySkinTransition, SkinHost, SkinSample } from './bodySkinTransition'
import {
  bindEyeMotionGeometry,
  createEyeMotionRig,
  eyeMotionSnapshot,
  patchEyeMotionMaterial,
  setEyeInstancePhase,
  updateEyeMotion,
} from './eyeMotion'
import {
  bindTentacleMotionGeometry,
  createTentacleMotionRig,
  patchTentacleMotionMaterial,
  setTentacleInstancePhase,
  tentacleMotionSnapshot,
  updateTentacleMotion,
} from './tentacleMotion'
import { blackMistRuntime } from './runtime'

export type MutatedColossus = 'kun' | 'turtle'
type MutationKind = 'eye' | 'tentacle' | 'flesh'
type Point = readonly [number, number, number]
interface SiteSpec {
  id: string
  region: string
  target: Point
  normal: Point
  flesh: readonly [number, number]
  eye?: number
  tentacle?: number
  roll?: number
}

// Small lesions occupy the forehead/temples and two anatomical flanks. The mouth,
// pectoral blades, fluke and both central pavilion decks retain their original silhouette.
const SITES: Record<MutatedColossus, readonly SiteSpec[]> = {
  kun: [
    { id: 'forehead', region: 'head', target: [0, 18, 81], normal: [0, 1, 0.2], flesh: [18, 1.4], eye: 12.5 },
    { id: 'temple-left', region: 'head', target: [18, 14, 73], normal: [1, 0.6, 0.2], flesh: [15, 1.2], eye: 9.5 },
    { id: 'temple-right', region: 'head', target: [-18, 14, 73], normal: [-1, 0.6, 0.2], flesh: [14, 1.2], eye: 9 },
    {
      id: 'flank-left',
      region: 'flank',
      target: [28, -3, 18],
      normal: [1, 0.3, 0],
      flesh: [19, 1.8],
      tentacle: 22,
      roll: 0.6,
    },
    {
      id: 'flank-right',
      region: 'flank',
      target: [-28, -3, 18],
      normal: [-1, 0.3, 0],
      flesh: [18, 1.7],
      tentacle: 20,
      roll: -0.7,
    },
  ],
  turtle: [
    { id: 'forehead', region: 'head', target: [0, 84, 150], normal: [0, 1, 0.3], flesh: [17, 1.5], eye: 11 },
    { id: 'temple-left', region: 'head', target: [21, 73, 143], normal: [1, 0.5, 0.2], flesh: [14, 1.2], eye: 8.5 },
    { id: 'temple-right', region: 'head', target: [-21, 73, 143], normal: [-1, 0.5, 0.2], flesh: [13, 1.2], eye: 8 },
    {
      id: 'shell-left',
      region: 'shell-rim',
      target: [74, 63, 12],
      normal: [1, 0.4, 0.1],
      flesh: [23, 2],
      tentacle: 24,
      roll: 0.5,
    },
    {
      id: 'shell-right',
      region: 'shell-rim',
      target: [-74, 63, 12],
      normal: [-1, 0.4, 0.1],
      flesh: [21, 1.8],
      tentacle: 22,
      roll: -0.8,
    },
  ],
}

export interface ColossusMutationAnchor {
  spec: SiteSpec
  mesh: SkinnedMesh
  host: SkinHost
  triangle: readonly [number, number, number]
  boneNames: string[]
  restCenter: Vector3
  restNormal: Vector3
  restFrameInverse: Matrix4
  eyeOrientation: Quaternion
  tentacleOrientation: Quaternion
}

/** Capture the native bind skin before the carrier mixer starts; mode entry never reselects a posed skin. */
export function createColossusMutationAnchors(creature: MutatedColossus, scene: Object3D): ColossusMutationAnchor[] {
  scene.updateMatrixWorld(true)
  const toAsset = new Matrix4().copy(scene.matrixWorld).invert(),
    sources: SkinHost[] = []
  scene.traverse((object) => {
    if (object instanceof SkinnedMesh)
      sources.push(captureSkinHost(object, toAsset.clone().multiply(object.matrixWorld)))
  })
  const a = new Vector3(),
    b = new Vector3(),
    normal = new Vector3(),
    center = new Vector3(),
    tangent = new Vector3(),
    up = new Vector3()
  return SITES[creature].flatMap((spec) => {
    const target = new Vector3(...spec.target),
      preferred = new Vector3(...spec.normal).normalize()
    let best: {
      host: SkinHost
      triangle: [number, number, number]
      center: Vector3
      normal: Vector3
      tangent: Vector3
    } | null = null
    let score = Infinity
    for (const host of sources) {
      const index = host.mesh.geometry.index,
        vertices = host.restPositions
      if (!index) continue
      for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t),
          i1 = index.getX(t + 1),
          i2 = index.getX(t + 2)
        const p0 = vertices[i0],
          p1 = vertices[i1],
          p2 = vertices[i2]
        normal.crossVectors(a.subVectors(p1, p0), b.subVectors(p2, p0))
        if (normal.lengthSq() < 1e-10) continue
        normal.normalize()
        const alignment = normal.dot(preferred)
        if (alignment < 0.45) continue
        center
          .copy(p0)
          .add(p1)
          .add(p2)
          .multiplyScalar(1 / 3)
        const value = center.distanceToSquared(target) + (1 - alignment) * 24
        if (value < score) {
          score = value
          best = {
            host,
            triangle: [i0, i1, i2],
            center: center.clone(),
            normal: normal.clone(),
            tangent: a.clone().normalize(),
          }
        }
      }
    }
    if (!best) return []
    const selected = best as {
      host: SkinHost
      triangle: [number, number, number]
      center: Vector3
      normal: Vector3
      tangent: Vector3
    }
    const mesh = selected.host.mesh,
      names = new Set<string>(),
      weights = mesh.geometry.getAttribute('skinWeight'),
      indices = mesh.geometry.getAttribute('skinIndex')
    selected.triangle.forEach((vertex) => {
      for (let k = 0; k < 4; k++)
        if (weights.getComponent(vertex, k) > 0.04) names.add(mesh.skeleton.bones[indices.getComponent(vertex, k)].name)
    })
    tangent.copy(selected.tangent)
    up.crossVectors(selected.normal, tangent).normalize()
    const restFrameInverse = new Matrix4().makeBasis(tangent, up, selected.normal).invert()
    const eyeOrientation = orientFlesh(selected.normal, spec.roll ?? 0)
    const tentacleOrientation = new Quaternion()
      .setFromUnitVectors(new Vector3(0, 1, 0), selected.normal)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.roll ?? 0))
    return [
      {
        spec,
        mesh,
        host: selected.host,
        triangle: selected.triangle,
        boneNames: [...names],
        restCenter: selected.center,
        restNormal: selected.normal,
        restFrameInverse,
        eyeOrientation,
        tentacleOrientation,
      },
    ]
  })
}

interface Source {
  geometry: BufferGeometry
  material: MeshStandardMaterial
}
function pbrSource(scene: Object3D, normalization: Matrix4): Source {
  scene.updateMatrixWorld(true)
  const mesh = scene.getObjectByProperty('isMesh', true) as Mesh | undefined
  if (!mesh || !(mesh.material instanceof MeshStandardMaterial))
    throw new Error('Mutation needs its inspected PBR source')
  const geometry = mesh.geometry.clone()
  for (const name of ['position', 'normal', 'tangent']) {
    const attribute = mesh.geometry.getAttribute(name)
    if (!attribute) continue
    const array = new Float32Array(attribute.count * attribute.itemSize)
    for (let i = 0; i < attribute.count; i++)
      for (let k = 0; k < attribute.itemSize; k++) array[i * attribute.itemSize + k] = attribute.getComponent(i, k)
    geometry.setAttribute(name, new BufferAttribute(array, attribute.itemSize))
  }
  geometry.applyMatrix4(normalization.clone().multiply(mesh.matrixWorld))
  geometry.computeBoundingSphere()
  return { geometry, material: mesh.material.clone() }
}

function normalizeSources(eye: Object3D, tentacle: Object3D) {
  const box = new Box3().setFromObject(eye),
    size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3())
  const eyeMatrix = new Matrix4()
    .makeScale(1 / size.z, 1 / size.z, 1 / size.z)
    .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))
  box.setFromObject(tentacle)
  box.getSize(size)
  const point = new Vector3(),
    base = new Vector3()
  let count = 0
  tentacle.updateMatrixWorld(true)
  tentacle.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld)
      if (point.y < box.min.y + size.y * 0.06) {
        base.add(point)
        count++
      }
    }
  })
  if (!count) throw new Error('Mutation tentacle has no root')
  base.divideScalar(count)
  const tentacleMatrix = new Matrix4()
    .makeScale(1 / size.y, 1 / size.y, 1 / size.y)
    .multiply(new Matrix4().makeTranslation(-base.x, -box.min.y, -base.z))
  return { eyeMatrix, tentacleMatrix }
}

type PbrMesh = Mesh<BufferGeometry, MeshStandardMaterial>
interface AttachmentState {
  anchor: ColossusMutationAnchor
  kind: 'eye' | 'tentacle'
  slot: number
  lod: number
  instance: number
  renderedPosition: Vector3
  matrixWorld: Matrix4
  embedMeters: number
}
interface MutationModel {
  mesh: PbrMesh
  kind: MutationKind
  lod: number
  sourceUrl: string
  body?: BodySkinTransition
}
interface MutationState {
  visible: boolean
  growth: number
  motionTime: number
  anchors: AttachmentState[]
  models: MutationModel[]
  eyeRig: ReturnType<typeof createEyeMotionRig>
  limbRig: ReturnType<typeof createTentacleMotionRig>
}
const mutations: Partial<Record<MutatedColossus, MutationState>> = {}
const barycenter = new Vector3(1 / 3, 1 / 3, 1 / 3)
const nativePoint = new Vector3(),
  nativeReference = new Vector3()

/** Real skin references, instance matrices and membrane edges are inspected independently in DEV. */
export function colossusMutationSnapshot() {
  return Object.fromEntries(
    (['kun', 'turtle'] as const).map((id) => {
      const state = mutations[id]
      if (!state) return [id, { visible: false, growth: 0, draws: 0, anchors: [], models: [], conformance: [] }]
      return [
        id,
        {
          visible: state.visible,
          growth: state.growth,
          motionTime: state.motionTime,
          draws: state.visible ? state.models.filter(({ mesh }) => mesh.visible).length : 0,
          anchors: state.anchors.map((record) => {
            const anchor = record.anchor
            nativeReference.set(0, 0, 0)
            anchor.triangle.forEach((vertex) => {
              anchor.mesh.getVertexPosition(vertex, nativePoint).applyMatrix4(anchor.mesh.matrixWorld)
              nativeReference.addScaledVector(nativePoint, 1 / 3)
            })
            const model = state.models.find(
              (candidate) => candidate.kind === record.kind && candidate.lod === record.lod,
            )
            return {
              id: anchor.spec.id,
              kind: record.kind,
              region: anchor.spec.region,
              boneNames: anchor.boneNames,
              triangle: anchor.triangle,
              skinned: true,
              referencePosition: nativeReference.toArray(),
              renderedPosition: record.renderedPosition.toArray(),
              embedMeters: record.embedMeters,
              phaseSlot: record.slot,
              matrixWorld: record.matrixWorld.toArray(),
              motion: model
                ? record.kind === 'eye'
                  ? eyeMotionSnapshot(state.eyeRig, model.mesh.geometry, record.slot)
                  : tentacleMotionSnapshot(state.limbRig, state.motionTime, record.slot)
                : null,
            }
          }),
          models: state.models
            .filter(({ mesh }) => state.visible && mesh.visible)
            .map(({ mesh, kind, lod, sourceUrl, body }) => ({
              kind,
              lod,
              sourceUrl,
              instances: mesh instanceof InstancedMesh ? mesh.count : (body?.sites ?? 1),
              triangles: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
              parts:
                kind === 'eye'
                  ? ['native-ocular-core', 'buried-stationary-socket']
                  : kind === 'tentacle'
                    ? ['native-muscle-centerline']
                    : ['host-skinned-membrane'],
              pbr: {
                baseColor: !!mesh.material.map,
                normal: !!mesh.material.normalMap,
                roughness: !!mesh.material.roughnessMap,
                metalness: !!mesh.material.metalnessMap,
              },
            })),
          conformance: state.models
            .filter(({ mesh, body }) => state.visible && mesh.visible && body)
            .map(({ mesh, body }) => bodySkinConformance(body!, mesh.matrixWorld)),
        },
      ]
    }),
  )
}

class MutationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
interface MutationProps {
  creature: MutatedColossus
  anchors: ColossusMutationAnchor[]
  scale?: number
}
const NEAR: Record<QualityLevel, number> = { low: 0, mid: 430, high: 650 }
const ramp = (value: number) => {
  const t = Math.max(0, Math.min(1, (value - 0.055) / 0.7))
  return t * t * (3 - 2 * t)
}

function MutationVisual({ creature, anchors, scale = 1 }: MutationProps) {
  const [eye, eyeLow, limb, limbLow] = useGLTF(eldritchAssetUrls())
  const quality = useWorldStore((state) => state.quality),
    group = useRef<Group>(null)
  const assets = useMemo(() => {
    const { eyeMatrix, tentacleMatrix } = normalizeSources(eye.scene, limb.scene)
    const eyeRig = createEyeMotionRig(creature === 'kun' ? 19 : 47),
      limbRig = createTentacleMotionRig(tentacleMatrix)
    const models = [0, 1].flatMap((lod): MutationModel[] => {
      const eyes = pbrSource(lod ? eyeLow.scene : eye.scene, eyeMatrix),
        limbs = pbrSource(lod ? limbLow.scene : limb.scene, tentacleMatrix)
      bindEyeMotionGeometry(eyes.geometry)
      patchEyeMotionMaterial(eyes.material, eyeRig)
      bindTentacleMotionGeometry(limbs.geometry, limbRig)
      patchTentacleMotionMaterial(limbs.material, limbRig)
      const body = createBodySkinTransition(
        anchors.map((anchor) => ({
          id: anchor.spec.id,
          host: anchor.host,
          center: anchor.restCenter,
          normal: anchor.restNormal,
          orientation: anchor.eyeOrientation,
          width: anchor.spec.flesh[0],
          depth: anchor.spec.flesh[1],
        })),
        lod ? limbLow.scene : limb.scene,
        lod ? 'far' : 'near',
        creature === 'kun' ? 19 : 47,
      )
      const nearEye = new InstancedMesh(eyes.geometry, eyes.material, anchors.length),
        nearLimb = new InstancedMesh(limbs.geometry, limbs.material, anchors.length)
      nearEye.count = 0
      nearLimb.count = 0
      return (
        [
          ['eye', nearEye],
          ['tentacle', nearLimb],
          ['flesh', new Mesh(body.geometry, body.material)],
        ] as const
      ).map(([kind, mesh]) => {
        const sourceUrl =
          kind === 'eye'
            ? lod
              ? ELDRITCH_ASSETS.eye.lodModel
              : ELDRITCH_ASSETS.eye.model
            : lod
              ? ELDRITCH_ASSETS.tentacle.lodModel
              : ELDRITCH_ASSETS.tentacle.model
        mesh.userData.castShadow = false
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.visible = false
        mesh.name = `ColossusMutation_${creature}_${kind}_LOD${lod}`
        mesh.userData.colossusMutation = {
          creature,
          kind,
          lod,
          sourceUrl,
          attached: true,
          anatomy:
            kind === 'eye'
              ? 'native-ocular-core-in-host-skin'
              : kind === 'tentacle'
                ? 'native-centerline-muscle'
                : 'host-skinned-tissue-transition',
        }
        return { mesh, kind, lod, sourceUrl, ...(kind === 'flesh' ? { body } : {}) }
      })
    })
    const records = anchors.flatMap((anchor, slot) =>
      (anchor.spec.eye ? (['eye'] as const) : (['tentacle'] as const)).map((kind): AttachmentState => ({
        anchor,
        kind,
        slot,
        lod: 0,
        instance: 0,
        renderedPosition: new Vector3(),
        matrixWorld: new Matrix4(),
        embedMeters: 0,
      })),
    )
    const state: MutationState = { visible: false, growth: 0, motionTime: 0, anchors: records, models, eyeRig, limbRig }
    const hosts = [...new Set(anchors.map((anchor) => anchor.host))]
    return {
      state,
      hosts,
      frameId: Math.max(0, ...hosts.map((host) => host.frame)),
      inverse: new Matrix4(),
      frame: new Matrix4(),
      rotation: new Matrix4(),
      instance: new Matrix4(),
      orientation: new Quaternion(),
      a: new Vector3(),
      b: new Vector3(),
      c: new Vector3(),
      center: new Vector3(),
      tangent: new Vector3(),
      up: new Vector3(),
      normal: new Vector3(),
      position: new Vector3(),
      size: new Vector3(),
    }
  }, [eye.scene, eyeLow.scene, limb.scene, limbLow.scene, anchors, creature])

  useEffect(() => {
    if (import.meta.env.DEV) mutations[creature] = assets.state
    return () => {
      if (mutations[creature] === assets.state) delete mutations[creature]
      assets.state.models.forEach(({ mesh }) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
        if (mesh instanceof InstancedMesh) mesh.dispose()
      })
    }
  }, [assets, creature])

  useFrame(({ camera }) => {
    const root = group.current,
      runtime = blackMistRuntime
    if (!root) return
    const growth = runtime.active ? ramp(runtime.corruption) : 0
    assets.state.growth = growth
    assets.state.visible = growth > 0.001
    root.visible = assets.state.visible
    if (!root.visible) return
    assets.state.motionTime = runtime.motionTime
    updateEyeMotion(assets.state.eyeRig, runtime.motionTime, growth)
    updateTentacleMotion(assets.state.limbRig, runtime.motionTime, growth)
    root.updateWorldMatrix(true, false)
    assets.inverse.copy(root.matrixWorld).invert()
    assets.frameId++
    assets.hosts.forEach((host) => beginSkinHostFrame(host, assets.frameId))
    const counts = Array.from({ length: assets.state.models.length }, () => 0),
      near = NEAR[quality]
    let bodyDistance = Infinity
    for (const record of assets.state.anchors) {
      const { anchor, kind, slot } = record,
        { mesh, triangle, spec } = anchor
      const sample: SkinSample = { host: anchor.host, triangle, barycentric: barycenter }
      evaluateSkinSample(sample, assets.center)
      bodyDistance = Math.min(bodyDistance, camera.position.distanceToSquared(assets.center))
      const lod = camera.position.distanceToSquared(assets.center) < near * near ? 0 : 1
      mesh.getVertexPosition(triangle[0], assets.a).applyMatrix4(mesh.matrixWorld).applyMatrix4(assets.inverse)
      mesh.getVertexPosition(triangle[1], assets.b).applyMatrix4(mesh.matrixWorld).applyMatrix4(assets.inverse)
      mesh.getVertexPosition(triangle[2], assets.c).applyMatrix4(mesh.matrixWorld).applyMatrix4(assets.inverse)
      assets.tangent.subVectors(assets.b, assets.a).normalize()
      assets.normal.crossVectors(assets.tangent, assets.up.subVectors(assets.c, assets.a)).normalize()
      assets.up.crossVectors(assets.normal, assets.tangent).normalize()
      assets.frame.makeBasis(assets.tangent, assets.up, assets.normal).multiply(anchor.restFrameInverse)
      assets.position.copy(assets.center).applyMatrix4(assets.inverse)
      const dimension = kind === 'eye' ? (spec.eye ?? 1) : (spec.tentacle ?? 1)
      const embed = kind === 'eye' ? dimension * 0.245 : dimension * 0.06
      assets.position.addScaledVector(assets.normal, -embed * growth)
      assets.size.setScalar(dimension * growth)
      assets.rotation
        .makeRotationFromQuaternion(kind === 'tentacle' ? anchor.tentacleOrientation : anchor.eyeOrientation)
        .premultiply(assets.frame)
      assets.orientation.setFromRotationMatrix(assets.rotation)
      assets.instance.compose(assets.position, assets.orientation, assets.size)
      const modelIndex = assets.state.models.findIndex((model) => model.kind === kind && model.lod === lod)
      const model = assets.state.models[modelIndex],
        instance = counts[modelIndex]++,
        instanceMesh = model.mesh as InstancedMesh<BufferGeometry, MeshStandardMaterial>
      instanceMesh.setMatrixAt(instance, assets.instance)
      if (kind === 'eye') setEyeInstancePhase(instanceMesh.geometry, instance, slot)
      else setTentacleInstancePhase(instanceMesh.geometry, instance, slot)
      instanceMesh.getMatrixAt(instance, assets.instance)
      record.matrixWorld.multiplyMatrices(root.matrixWorld, assets.instance)
      record.renderedPosition.setFromMatrixPosition(record.matrixWorld)
      record.embedMeters = assets.center.distanceTo(record.renderedPosition)
      record.lod = lod
      record.instance = instance
    }
    const bodyLod = bodyDistance < near * near ? 0 : 1
    assets.state.models.forEach(({ mesh, body, lod }, i) => {
      if (body) {
        mesh.visible = lod === bodyLod
        if (mesh.visible) updateBodySkinTransition(body, assets.inverse, growth)
      } else {
        const instanced = mesh as InstancedMesh<BufferGeometry, MeshStandardMaterial>
        instanced.count = counts[i]
        mesh.visible = instanced.count > 0
        if (instanced.count) {
          instanced.instanceMatrix.needsUpdate = true
          instanced.computeBoundingSphere()
        }
      }
    })
  }, -1.8)

  return (
    <group ref={group} name={`ColossusMutation_${creature}`} scale={scale} visible={false} dispose={null}>
      {assets.state.models.map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

/** Optional tissue loading or a malformed source cannot discard the original animated carrier. */
export function ColossusMutation(props: MutationProps) {
  return (
    <MutationBoundary>
      <Suspense fallback={null}>
        <MutationVisual {...props} />
      </Suspense>
    </MutationBoundary>
  )
}
