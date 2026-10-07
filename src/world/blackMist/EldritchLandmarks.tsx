import { useEffect, useMemo, useRef } from 'react'
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
  Uniform,
  Vector2,
  Vector3,
} from 'three'
import type { Object3D } from 'three'
import type { QualityLevel } from '../quality'
import { useWorldStore } from '../store'
import { ELDRITCH_ASSETS, eldritchAssetUrls } from './eldritchAssets'
import type { EldritchAssetId } from './eldritchAssets'
import { blackMistRuntime } from './runtime'
import {
  bindEyeMotionGeometry,
  createEyeMotionRig,
  eyeMotionSnapshot,
  patchEyeMotionMaterial,
  updateEyeMotion,
} from './eyeMotion'
import {
  bindTentacleMotionGeometry,
  createTentacleMotionRig,
  evaluateTentacleMotionVertex,
  patchTentacleMotionMaterial,
  sampleTentacleMotion,
  setTentacleInstancePhase,
  tentacleContactSourceSections,
  tentacleMotionSnapshot,
  updateTentacleMotion,
} from './tentacleMotion'
import type { TentacleBehaviorPose, TentacleBehaviorSnapshot, TentacleMotionRig } from './tentacleMotion'
import { TENTACLES } from './eldritchLayout'
import { publishBlackMistHazard, queryBlackMistThreat, unregisterBlackMistHazard } from './hazards'
import type { BlackMistThreat } from './hazards'

const EYE_CENTER = new Vector3(0, 550, -430)
const UP = new Vector3(0, 1, 0)
const NEAR: Record<QualityLevel, number> = { low: 0, mid: 800, high: 1100 }
const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

interface ImportedPart {
  geometry: BufferGeometry
  material: MeshStandardMaterial | MeshStandardMaterial[]
  sourceNode: string
}
interface TentacleProbe {
  role: string
  index: number
  rest: Vector3
}

/** Inspect actual imported vertices, including the shaft that used to remain rigid. */
function tentacleSourceProbes(geometry: BufferGeometry, rig: TentacleMotionRig): TentacleProbe[] {
  const regions = [
    { role: 'root', s: 0 },
    { role: 'lower-shaft', s: 0.13 },
    { role: 'middle-shaft', s: 0.24 },
    { role: 'crook', s: 0.52 },
    { role: 'tip', s: 1 },
  ]
  const targets = regions.map(({ s }) =>
    new Vector3().fromArray(sampleTentacleMotion(rig, s).rest).add(new Vector3(s === 0 ? 0 : 0.08, 0, 0)),
  )
  const distances = regions.map(() => Infinity),
    indices = regions.map(() => 0),
    vertex = new Vector3()
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index)
    for (let region = 0; region < regions.length; region++) {
      const distance = region === 0 ? vertex.y : vertex.distanceToSquared(targets[region])
      if (distance < distances[region]) {
        distances[region] = distance
        indices[region] = index
      }
    }
  }
  return regions.map(({ role }, region) => ({
    role,
    index: indices[region],
    rest: new Vector3().fromBufferAttribute(positions, indices[region]),
  }))
}
interface ModelTag {
  id: EldritchAssetId
  lod: number
  sourceUrl: string
  sourceNode: string
  triangles: number
  pbr: { baseColor: boolean; normal: boolean; roughness: boolean; metalness: boolean }
}

/** Decode quantized GLB attributes before baking node transforms; cached loader geometry stays untouched. */
function floatingGeometry(mesh: Mesh, transform: Matrix4) {
  const geometry = mesh.geometry.clone()
  for (const name of ['position', 'normal', 'tangent']) {
    const source = mesh.geometry.getAttribute(name)
    if (!source) continue
    const data = new Float32Array(source.count * source.itemSize)
    for (let vertex = 0; vertex < source.count; vertex++)
      for (let axis = 0; axis < source.itemSize; axis++) {
        data[vertex * source.itemSize + axis] = source.getComponent(vertex, axis)
      }
    geometry.setAttribute(name, new BufferAttribute(data, source.itemSize))
  }
  geometry.applyMatrix4(transform)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function importedParts(scene: Object3D, normalization: Matrix4): ImportedPart[] {
  scene.updateMatrixWorld(true)
  const parts: ImportedPart[] = []
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const cloneMaterial = (material: MeshStandardMaterial) => {
      if (!(material instanceof MeshStandardMaterial)) throw new Error('Eldritch asset needs a PBR material')
      // Keep Tripo's albedo, normal and ORM maps, including their authored roughness and color space.
      return material.clone()
    }
    const source = object.material as MeshStandardMaterial | MeshStandardMaterial[]
    parts.push({
      geometry: floatingGeometry(object, normalization.clone().multiply(object.matrixWorld)),
      material: Array.isArray(source) ? source.map(cloneMaterial) : cloneMaterial(source),
      sourceNode: object.name,
    })
  })
  if (!parts.length) throw new Error('Eldritch asset has no mesh')
  return parts
}

/** Source +X carries the amber iris. Rotate it toward the plaza (+Z), centered at its measured volume. */
function eyeNormalization(scene: Object3D) {
  const box = new Box3().setFromObject(scene),
    size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3())
  return new Matrix4()
    .makeScale(1 / size.z, 1 / size.z, 1 / size.z)
    .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))
}

/** Root origin is the lower six percent of the high-detail source, shared by both LODs. */
function tentacleNormalization(scene: Object3D) {
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene),
    size = box.getSize(new Vector3()),
    base = new Vector3(),
    vertex = new Vector3()
  let count = 0
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld)
      if (vertex.y <= box.min.y + size.y * 0.06) {
        base.add(vertex)
        count++
      }
    }
  })
  if (!count) throw new Error('Eldritch tentacle has no root')
  base.divideScalar(count)
  base.y = box.min.y
  const matrix = new Matrix4()
    .makeScale(1 / size.y, 1 / size.y, 1 / size.y)
    .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z))
  return { matrix, center: box.getCenter(new Vector3()).applyMatrix4(matrix) }
}

function tagModel(mesh: Mesh, part: ImportedPart, id: EldritchAssetId, lod: number) {
  const materials = Array.isArray(part.material) ? part.material : [part.material]
  const tag: ModelTag = {
    id,
    lod,
    sourceUrl: lod ? ELDRITCH_ASSETS[id].lodModel : ELDRITCH_ASSETS[id].model,
    sourceNode: part.sourceNode,
    triangles: (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3,
    pbr: {
      baseColor: materials.every((material) => !!material.map),
      normal: materials.every((material) => !!material.normalMap),
      roughness: materials.every((material) => !!material.roughnessMap),
      metalness: materials.every((material) => !!material.metalnessMap),
    },
  }
  mesh.userData.eldritch = tag
  mesh.userData.sourceAsset = id
  mesh.userData.lod = lod
  mesh.userData.sourceUrl = tag.sourceUrl
  mesh.userData.castShadow = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.name = `EldritchTripo_${id}_LOD${lod}_${part.sourceNode}`
}

function disposeMesh(mesh: Mesh) {
  mesh.geometry.dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  materials.forEach((material) => material.dispose())
  if (mesh instanceof InstancedMesh) mesh.dispose()
}

/** Inspected PBR anatomy with a finite environmental threat gesture, shared across both LODs. */
let liveMotion: (() => unknown) | null = null
export const eldritchMotionSnapshot = () => liveMotion?.() ?? { eye: null, tentacles: [] }

export function EldritchLandmarks() {
  const [eye, eyeLow, tentacle, tentacleLow] = useGLTF(eldritchAssetUrls())
  const quality = useWorldStore((state) => state.quality)
  const eyeGroup = useRef<Group>(null),
    tentacleGroup = useRef<Group>(null)
  const assets = useMemo(() => {
    const time = new Uniform(0)
    const normalizedEye = eyeNormalization(eye.scene),
      normalizedTentacle = tentacleNormalization(tentacle.scene)
    const eyeRig = createEyeMotionRig(31),
      limbRig = createTentacleMotionRig(normalizedTentacle.matrix, time, { interactive: true })
    const eyes = [eye.scene, eyeLow.scene].map((scene, lod) =>
      importedParts(scene, normalizedEye).map((part) => {
        bindEyeMotionGeometry(part.geometry)
        const materials = Array.isArray(part.material) ? part.material : [part.material]
        materials.forEach((material) => patchEyeMotionMaterial(material, eyeRig))
        const mesh = new Mesh(part.geometry, part.material)
        tagModel(mesh, part, 'eye', lod)
        return mesh
      }),
    )
    const limbs = [tentacle.scene, tentacleLow.scene].map((scene, lod) =>
      importedParts(scene, normalizedTentacle.matrix).map((part) => {
        const materials = Array.isArray(part.material) ? part.material : [part.material]
        bindTentacleMotionGeometry(part.geometry, limbRig, TENTACLES.length)
        materials.forEach((material) => patchTentacleMotionMaterial(material, limbRig))
        const mesh = new InstancedMesh(part.geometry, part.material, TENTACLES.length)
        tagModel(mesh, part, 'tentacle', lod)
        mesh.count = 0
        return mesh
      }),
    )
    const limbProbes = limbs.map((parts) => parts.map((mesh) => tentacleSourceProbes(mesh.geometry, limbRig)))
    const contactGeometry = limbs[0][0].geometry,
      contactSections = tentacleContactSourceSections(contactGeometry, limbRig)
    const actors = TENTACLES.map((_, id) => ({
      id: `giant-tentacle-${id}`,
      matrix: new Matrix4(),
      inverse: new Matrix4(),
      origin: new Vector3(),
      target: new Vector3(),
      threat: null as BlackMistThreat | null,
      phase: 'idle' as BlackMistThreat['phase'],
      recovery: undefined as TentacleBehaviorSnapshot | undefined,
      sections: contactSections.map(() => ({
        center: new Vector3(),
        radius: 0,
        points: contactSections[0].indices.map(() => new Vector3()),
      })),
    }))
    const behaviors: TentacleBehaviorPose[] = Array.from({ length: 8 }, (_, id) => ({
      seed: id * 19 + 31,
      phase: 'idle',
      progress: 0,
      sequence: 0,
      localTarget: null,
    }))
    return {
      eyes,
      limbs,
      limbProbes,
      contactGeometry,
      contactSections,
      actors,
      behaviors,
      time,
      eyeRig,
      limbRig,
      buckets: TENTACLES.map(() => ({ lod: 1, index: 0 })),
      limbCenter: normalizedTentacle.center,
      target: new Vector2(),
      eyePosition: new Vector3(),
      toCamera: new Vector3(),
      matrix: new Matrix4(),
      position: new Vector3(),
      center: new Vector3(),
      scale: new Vector3(),
      rotation: new Quaternion(),
    }
  }, [eye.scene, eyeLow.scene, tentacle.scene, tentacleLow.scene])

  useEffect(() => {
    const snapshot = () => {
      const eyeMesh = assets.eyes.flat().find((mesh) => mesh.visible) ?? assets.eyes[1][0]
      const pbr = (mesh: Mesh) => {
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial
        return { baseColor: !!material.map, normal: !!material.normalMap, roughness: !!material.roughnessMap }
      }
      const bindings = (mesh: Mesh, prefix: string) => {
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial
        return {
          attributes: Object.fromEntries(
            Object.entries(mesh.geometry.attributes)
              .filter(([name]) => name.startsWith(prefix))
              .map(([name, attribute]) => [name, { count: attribute.count, itemSize: attribute.itemSize }]),
          ),
          materialPatched:
            prefix === 'aEye'
              ? material.userData.eyeMotion === true
              : material.userData.tentacleMotion?.patched === true,
          geometry: mesh.geometry.userData,
        }
      }
      const pose = eyeMotionSnapshot(assets.eyeRig, eyeMesh.geometry)
      return {
        eye: {
          ...pose,
          modelMatrix: eyeMesh.matrixWorld.toArray(),
          pbr: pbr(eyeMesh),
          bindings: bindings(eyeMesh, 'aEye'),
          samples: [
            { id: 'ocular-core', role: 'eyeball', ...pose.samples.eyeball },
            { id: 'outer-socket', role: 'socket', ...pose.samples.socket },
          ],
          lodAngles: assets.eyes.map((meshes) => eyeMotionSnapshot(assets.eyeRig, meshes[0].geometry)),
        },
        tentacles: TENTACLES.map((_, id) => {
          const actor = assets.actors[id],
            bucket = assets.buckets[id],
            mesh = assets.limbs[bucket.lod][0],
            matrix = actor.matrix
          const sampled = tentacleMotionSnapshot(assets.limbRig, assets.time.value, id)
          const world = (point: number[]) => new Vector3().fromArray(point).applyMatrix4(matrix).toArray()
          const sourceProbes = (lod: number) =>
            assets.limbs[lod].flatMap((part, partIndex) =>
              assets.limbProbes[lod][partIndex].map((probe) => {
                const posed = evaluateTentacleMotionVertex(
                  part.geometry,
                  assets.limbRig,
                  probe.index,
                  new Vector3(),
                  id,
                )
                return {
                  role: probe.role,
                  index: probe.index,
                  mesh: part.name,
                  rest: probe.rest.toArray(),
                  posed: posed.toArray(),
                  world: posed.clone().applyMatrix4(matrix).toArray(),
                }
              }),
            )
          return {
            id,
            hazardId: actor.id,
            lod: bucket.lod,
            ...sampled,
            attack: actor.threat
              ? {
                  state: actor.threat.phase,
                  progress: actor.threat.progress,
                  attackSerial: actor.threat.attackSerial,
                  root: actor.threat.root.toArray(),
                  range: actor.threat.range,
                  target: actor.threat.target?.toArray() ?? null,
                  behavior: assets.limbRig.behavior[id],
                  clock: assets.time.value,
                  contacts: actor.sections.slice(1).map((section, index) => ({
                    id: `${actor.id}:arc-${index}`,
                    a: actor.sections[index].center.toArray(),
                    b: section.center.toArray(),
                    radius: Math.max(section.radius, actor.sections[index].radius),
                    active: actor.threat?.phase === 'strike',
                    sourceIndices: [assets.contactSections[index].indices, assets.contactSections[index + 1].indices],
                  })),
                  sections: actor.sections.map((section, index) => ({
                    s: assets.contactSections[index].s,
                    center: section.center.toArray(),
                    radius: section.radius,
                    sourceIndices: assets.contactSections[index].indices,
                    world: section.points.map((point) => point.toArray()),
                  })),
                }
              : null,
            root: world(sampled.root.posed),
            mid: world(sampled.mid.posed),
            tip: world(sampled.tip.posed),
            modelMatrix: matrix.toArray(),
            shaderPatched: bindings(mesh, 'aTentacle').materialPatched,
            bindings: bindings(mesh, 'aTentacle'),
            lodBindings: assets.limbs.map((parts) => bindings(parts[0], 'aTentacle')),
            uniformTime: assets.time.value,
            pbr: pbr(mesh),
            sourceProbes: sourceProbes(bucket.lod),
            lodSourceProbes: [0, 1].map((lod) => ({ lod, probes: sourceProbes(lod) })),
            samples: [sampled.root, sampled.mid, sampled.tip],
            lodSamples: [0, 1].map(() => ({
              root: world(sampled.root.posed),
              mid: world(sampled.mid.posed),
              tip: world(sampled.tip.posed),
            })),
          }
        }),
      }
    }
    if (import.meta.env.DEV) liveMotion = snapshot
    return () => {
      if (liveMotion === snapshot) liveMotion = null
      assets.actors.forEach((actor) => {
        unregisterBlackMistHazard(actor.id)
        assets.contactSections.slice(1).forEach((_, index) => unregisterBlackMistHazard(`${actor.id}:arc-${index}`))
      })
      ;[...assets.eyes.flat(), ...assets.limbs.flat()].forEach(disposeMesh)
    }
  }, [assets])

  useFrame(({ camera }) => {
    const r = blackMistRuntime,
      eyeReveal = smooth(40, 49, r.elapsed),
      reach = smooth(31, 47.8, r.elapsed)
    assets.time.value = r.motionTime
    if (!r.motionPaused && !r.testMotionHeld) {
      assets.eyePosition.copy(EYE_CENTER)
      assets.eyePosition.y -= (1 - eyeReveal) * 95
      assets.toCamera.copy(camera.position).sub(assets.eyePosition)
      assets.target.set(
        Math.atan2(assets.toCamera.x, Math.max(60, assets.toCamera.z)) * 0.25,
        -Math.atan2(assets.toCamera.y, Math.max(100, Math.hypot(assets.toCamera.x, assets.toCamera.z))) * 0.15,
      )
    }
    updateEyeMotion(assets.eyeRig, r.motionTime, eyeReveal, assets.target)
    if (tentacleGroup.current) tentacleGroup.current.visible = r.active && reach > 0.001
    if (eyeGroup.current) {
      eyeGroup.current.visible = r.active && eyeReveal > 0.001
      eyeGroup.current.position.y = EYE_CENTER.y - (1 - eyeReveal) * 95
    }
    const near = NEAR[quality],
      eyeLod = camera.position.distanceToSquared(EYE_CENTER) < near * near ? 0 : 1
    assets.eyes.forEach((meshes, lod) =>
      meshes.forEach((mesh) => {
        mesh.visible = lod === eyeLod
      }),
    )
    const counts = [0, 0]
    TENTACLES.forEach((placement, id) => {
      const emergence = smooth(31 + placement.delay, 46 + placement.delay, r.elapsed)
      if (emergence < 0.001) return
      assets.position.set(...placement.root)
      assets.position.y -= (1 - emergence) * placement.height
      assets.rotation.setFromAxisAngle(UP, placement.yaw)
      assets.scale.setScalar(placement.height)
      assets.matrix.compose(assets.position, assets.rotation, assets.scale)
      const actor = assets.actors[id]
      actor.matrix.copy(assets.matrix)
      actor.inverse.copy(actor.matrix).invert()
      // The sensing point is a real imported crook vertex from the last drawn pose.
      const sensor = assets.limbProbes[0][0].find((probe) => probe.role === 'crook')!
      evaluateTentacleMotionVertex(assets.contactGeometry, assets.limbRig, sensor.index, actor.origin, id).applyMatrix4(
        actor.matrix,
      )
      const threat = queryBlackMistThreat({
        id: actor.id,
        kind: 'tentacle',
        origin: actor.origin,
        range: placement.height * 0.72,
        windup: 1.7,
        strike: 0.72,
        recover: 1.7,
        cooldown: 3.8,
      })
      if (threat.phase === 'recover' && actor.phase !== 'recover')
        actor.recovery = assets.limbRig.behavior[id] ?? undefined
      if (threat.phase !== 'recover') actor.recovery = undefined
      actor.phase = threat.phase
      actor.threat = threat
      if (threat.target) actor.target.copy(threat.target).applyMatrix4(actor.inverse)
      assets.behaviors[id] = {
        seed: id * 19 + 31,
        phase: threat.phase,
        progress: threat.progress,
        sequence: threat.attackSerial,
        localTarget: threat.target ? [actor.target.x, actor.target.y, actor.target.z] : null,
        recoveryFrom: actor.recovery,
      }
      assets.center.copy(assets.limbCenter).applyMatrix4(assets.matrix)
      const lod = camera.position.distanceToSquared(assets.center) < near * near ? 0 : 1,
        index = counts[lod]++
      assets.buckets[id] = { lod, index }
      assets.limbs[lod].forEach((mesh) => {
        mesh.setMatrixAt(index, assets.matrix)
        setTentacleInstancePhase(mesh.geometry, index, id)
      })
    })
    updateTentacleMotion(assets.limbRig, r.motionTime, reach, assets.behaviors)
    assets.actors.forEach((actor, id) => {
      assets.contactSections.forEach((source, index) => {
        const section = actor.sections[index]
        section.center.set(0, 0, 0)
        source.indices.forEach((vertex, slot) => {
          evaluateTentacleMotionVertex(
            assets.contactGeometry,
            assets.limbRig,
            vertex,
            section.points[slot],
            id,
          ).applyMatrix4(actor.matrix)
          section.center.add(section.points[slot])
        })
        section.center.multiplyScalar(1 / source.indices.length)
        section.radius = Math.max(...section.points.map((point) => point.distanceTo(section.center)))
        if (index)
          publishBlackMistHazard({
            id: `${actor.id}:arc-${index - 1}`,
            kind: 'tentacle',
            a: actor.sections[index - 1].center,
            b: section.center,
            radius: Math.max(section.radius, actor.sections[index - 1].radius),
            active: r.active && reach > 0.99 && actor.threat?.phase === 'strike',
            attackSerial: actor.threat?.attackSerial,
          })
      })
    })
    assets.limbs.forEach((meshes, lod) =>
      meshes.forEach((mesh) => {
        mesh.count = counts[lod]
        mesh.visible = counts[lod] > 0
        if (mesh.count) {
          mesh.instanceMatrix.needsUpdate = true
          mesh.computeBoundingSphere()
        }
      }),
    )
  }, -0.85)

  return (
    <>
      <group ref={tentacleGroup} name="eldritch-tentacles" visible={false} dispose={null}>
        {assets.limbs.flat().map((mesh) => (
          <primitive key={mesh.uuid} object={mesh} />
        ))}
      </group>
      <group
        ref={eyeGroup}
        name="eldritch-eye"
        position={EYE_CENTER}
        scale={ELDRITCH_ASSETS.eye.targetWidthMeters}
        visible={false}
        dispose={null}
      >
        {assets.eyes.flat().map((mesh) => (
          <primitive key={mesh.uuid} object={mesh} />
        ))}
      </group>
    </>
  )
}
