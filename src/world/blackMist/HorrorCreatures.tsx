import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Box3, BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Uniform, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { useWorldStore } from '../store'
import type { QualityLevel } from '../quality'
import { eldritchAssetUrls } from './eldritchAssets'
import { blackMistRuntime } from './runtime'
import { HORROR_LAYOUT, horrorFacing } from './horrorLayout'
import type { HorrorCreatureId, HorrorPlacement, HorrorSourceType } from './horrorLayout'
import {
  bindHorrorGeometry,
  createHorrorRig,
  evaluateHorrorMotionVertex,
  horrorRigSnapshot,
  patchHorrorMotionMaterial,
  sampleHorrorMotion,
  updateHorrorRig,
} from './horrorMotion'
import type { HorrorAttackPose, HorrorMotionSample, HorrorRig } from './horrorMotion'
import {
  blackMistHazardsEnabled,
  publishBlackMistHazard,
  queryBlackMistThreat,
  unregisterBlackMistHazard,
} from './hazards'
import type { BlackMistThreat } from './hazards'

interface PoseProbe {
  id: string
  role: string
  index: number
  rest: Vector3
}
interface HorrorPart {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>
  lod: number
  sourceUrl: string
  probes: PoseProbe[]
}
interface Creature {
  placement: HorrorPlacement
  root: Group
  levels: Group[]
  parts: HorrorPart[]
  restBounds: Box3
  time: Uniform<number>
  reveal: number
  lod: number
  visible: boolean
  normalizedBounds: Box3
  sampleRoot: Vector3
  sampleChest: Vector3
  sampleRootNode: string
  sampleChestNode: string
  rig: HorrorRig
  motion: HorrorMotionSample
  actor: CreatureActor
  threat: BlackMistThreat | null
  attack: HorrorAttackPose | null
  inverse: Matrix4
  sensor: Vector3
  target: Vector3
  contacts: CreatureContact[]
}
type Point = [number, number, number]
interface CreatureActor {
  serial: number
  clock: number
  patrolTime: number
  yaw: number
  phase: BlackMistThreat['phase']
  hand: 0 | 1
  windupFrom?: readonly [Point, Point]
  recoveryFrom?: readonly [Point, Point]
  recoveryAttention: number
  windupHead?: [number, number, number, number]
  recoveryHead?: [number, number, number, number]
}
interface CreatureContact {
  id: string
  hand: number
  indices: number[]
  mesh: HorrorPart['mesh']
  points: Vector3[]
  a: Vector3
  b: Vector3
  radius: number
  active: boolean
}
// Pose clocks survive a canvas/context rebuild; replay or a backward DEV seek resets them.
const actorClocks = new Map<HorrorCreatureId, CreatureActor>()
const NEAR: Record<QualityLevel, number> = { low: 0, mid: 1100, high: 1700 }
const Y_AXIS = new Vector3(0, 1, 0)
const breath = (time: number, phase: number) => 0.008 + 0.009 * Math.sin(time * 0.53 + phase)
const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}
let liveCreatures: Creature[] = []
const shortAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const ease = (value: number) => smooth(0, 1, value)

function actorClock(placement: HorrorPlacement): CreatureActor {
  const runtime = blackMistRuntime
  let actor = actorClocks.get(placement.id)
  const seek = !!actor && import.meta.env.DEV && Math.abs(runtime.motionTime - actor.clock) > 0.2
  if (!actor || actor.serial !== runtime.serial || runtime.motionTime < actor.clock || !runtime.active || seek) {
    const motion = sampleHorrorMotion(placement, runtime.motionTime)
    actor = {
      serial: runtime.serial,
      clock: runtime.motionTime,
      patrolTime: runtime.motionTime,
      yaw: horrorFacing(placement) + motion.yawOffset,
      phase: 'idle',
      hand: 0,
      recoveryAttention: 0,
    }
    actorClocks.set(placement.id, actor)
  }
  return actor
}

/** Cheap actual-pose bridge for spatial roar audio; no per-vertex telemetry evaluation. */
export function horrorCreatureAudioStates(): readonly {
  id: HorrorCreatureId
  sourceType: HorrorSourceType
  position: Point
  height: number
  motion: Pick<
    HorrorMotionSample,
    'cycle' | 'cycleTime' | 'roarStart' | 'roarEnd' | 'roarEvent' | 'roarEventId' | 'roarStrength'
  >
}[] {
  return liveCreatures.map(({ placement, root, motion }) => ({
    id: placement.id,
    sourceType: placement.sourceType,
    position: [root.position.x, root.position.y, root.position.z],
    height: placement.height,
    motion: {
      cycle: motion.cycle,
      cycleTime: motion.cycleTime,
      roarStart: motion.roarStart,
      roarEnd: motion.roarEnd,
      roarEvent: motion.roarEvent,
      roarEventId: motion.roarEventId,
      roarStrength: motion.roarStrength,
    },
  }))
}

/** A confined chest/mantle expansion preserves the rigid roots, skull and full creature silhouette. */
function patchBreathing(material: MeshStandardMaterial, time: Uniform<number>, phase: number, roar: Uniform<number>) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHorrorLivingTime = time
    shader.uniforms.uHorrorPhase = new Uniform(phase)
    shader.uniforms.uHorrorRoar = roar
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uHorrorLivingTime; uniform float uHorrorPhase; uniform float uHorrorRoar;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float horrorY = clamp((position.y - 0.16) / 0.72, 0.0, 1.0);
        float horrorSine = sin(horrorY * 3.14159265);
        float horrorEnvelope = horrorSine * horrorSine;
        float horrorDerivative = position.y > 0.16 && position.y < 0.88
          ? 2.0 * horrorSine * cos(horrorY * 3.14159265) * 3.14159265 / 0.72 : 0.0;
        float horrorBreath = 0.008 + 0.009 * sin(uHorrorLivingTime * 0.53 + uHorrorPhase) + uHorrorRoar * 0.018;
        float horrorSX = 1.0 + horrorBreath * horrorEnvelope;
        float horrorSZ = 1.0 + horrorBreath * horrorEnvelope * 0.75;
        float horrorDY = 1.0 + horrorBreath * horrorDerivative * 0.035;
        // Inverse-transpose of the actual expansion Jacobian, including the collar transition.
        objectNormal.x /= horrorSX; objectNormal.z /= horrorSZ;
        objectNormal.y = (objectNormal.y - position.x * horrorBreath * horrorDerivative * objectNormal.x
          - position.z * horrorBreath * horrorDerivative * 0.75 * objectNormal.z) / horrorDY;
        #ifdef USE_TANGENT
          objectTangent.x = objectTangent.x * horrorSX + position.x * horrorBreath * horrorDerivative * objectTangent.y;
          objectTangent.z = objectTangent.z * horrorSZ + position.z * horrorBreath * horrorDerivative * 0.75 * objectTangent.y;
          objectTangent.y *= horrorDY;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x *= horrorSX; transformed.z *= horrorSZ;
        transformed.y += horrorBreath * horrorEnvelope * 0.035;`,
      )
  }
  material.customProgramCacheKey = () => 'horror-confined-breathing-pbr-1'
  material.userData.horrorBreathing = { patched: true, version: 1, phase }
}

function poseProbes(geometry: BufferGeometry, rig: HorrorRig): PoseProbe[] {
  const targets = [
    { id: 'root', role: 'root', point: new Vector3(0, 0, 0.1) },
    { id: 'chest', role: 'chest', point: new Vector3(0.2, 0.53, 0.1) },
    { id: 'head', role: 'head', point: new Vector3(0, 0.78, 0.26) },
    ...rig.limbs.map((limb, index) => ({
      id: index ? 'right-wrist' : 'left-wrist',
      role: rig.id === 'watcher' ? 'tendril' : 'wrist',
      point: limb.foot,
    })),
    ...rig.limbs.map((limb, index) => ({
      id: index ? 'right-forearm' : 'left-forearm',
      role: 'forearm',
      point: limb.elbow.clone().lerp(limb.foot, 0.65),
    })),
    { id: 'left-rear', role: rig.id === 'watcher' ? 'tendril' : 'rear-foot', point: new Vector3(-0.13, 0.02, -0.24) },
    { id: 'right-rear', role: rig.id === 'watcher' ? 'tendril' : 'rear-foot', point: new Vector3(0.13, 0.02, -0.24) },
  ]
  const positions = geometry.getAttribute('position'),
    point = new Vector3()
  return targets.map((target) => {
    let index = 0,
      distance = Infinity
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i)
      const candidate = point.distanceToSquared(target.point)
      if (candidate < distance) {
        index = i
        distance = candidate
      }
    }
    return { id: target.id, role: target.role, index, rest: new Vector3().fromBufferAttribute(positions, index) }
  })
}

function floatingGeometry(mesh: Mesh, transform: Matrix4): BufferGeometry {
  const geometry = mesh.geometry.clone()
  for (const name of ['position', 'normal', 'tangent']) {
    const source = mesh.geometry.getAttribute(name)
    if (!source) continue
    const values = new Float32Array(source.count * source.itemSize)
    for (let i = 0; i < source.count; i++)
      for (let axis = 0; axis < source.itemSize; axis++)
        values[i * source.itemSize + axis] = source.getComponent(i, axis)
    geometry.setAttribute(name, new BufferAttribute(values, source.itemSize))
  }
  geometry.applyMatrix4(transform)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.03
  return geometry
}

function makeCreature(
  placement: HorrorPlacement,
  sources: readonly [Object3D, Object3D],
  urls: readonly [string, string],
): Creature {
  sources[0].updateMatrixWorld(true)
  const sourceBounds = new Box3().setFromObject(sources[0]),
    size = sourceBounds.getSize(new Vector3()),
    center = sourceBounds.getCenter(new Vector3())
  const normalization = new Matrix4()
    .makeScale(1 / size.y, 1 / size.y, 1 / size.y)
    .multiply(new Matrix4().makeRotationY(placement.sourceYaw))
    .multiply(new Matrix4().makeTranslation(-center.x, -sourceBounds.min.y, -center.z))
  const rig = createHorrorRig(placement.sourceType, placement.phase),
    time = rig.time
  const motion = sampleHorrorMotion(placement, 0)
  updateHorrorRig(rig, placement, motion)
  const root = new Group(),
    parts: HorrorPart[] = [],
    normalizedBounds = new Box3()
  const sampleRoot = new Vector3(0, Infinity, 0),
    sampleChest = new Vector3(),
    probe = new Vector3(),
    chestTarget = new Vector3(0.2, 0.53, 0.1)
  let chestDistance = Infinity,
    sampleRootNode = '',
    sampleChestNode = ''
  root.name = `HorrorCreature_${placement.id}`
  root.visible = false
  root.position.set(...placement.position)
  root.quaternion.setFromAxisAngle(Y_AXIS, horrorFacing(placement))
  root.scale.setScalar(placement.height)
  const levels = sources.map((scene, lod) => {
    scene.updateMatrixWorld(true)
    const group = new Group()
    group.name = `HorrorCreature_${placement.id}_LOD${lod}`
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const clone = (material: MeshStandardMaterial) => {
        if (
          !(material instanceof MeshStandardMaterial) ||
          !material.map ||
          !material.normalMap ||
          !material.roughnessMap
        ) {
          throw new Error('Horror creature requires its inspected PBR materials')
        }
        const owned = material.clone()
        patchBreathing(owned, time, placement.phase, rig.roar)
        patchHorrorMotionMaterial(owned, rig)
        return owned
      }
      const sourceMaterial = object.material as MeshStandardMaterial | MeshStandardMaterial[]
      const material = Array.isArray(sourceMaterial) ? sourceMaterial.map(clone) : clone(sourceMaterial)
      const geometry = floatingGeometry(object, normalization.clone().multiply(object.matrixWorld))
      bindHorrorGeometry(geometry, rig)
      const mesh = new Mesh(geometry, material)
      mesh.name = `Horror_${placement.id}_LOD${lod}_${parts.length}`
      mesh.userData.castShadow = false
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.userData.horrorCreature = {
        id: placement.id,
        lod,
        sourceUrl: urls[lod],
        breathingPatched: true,
        motionPatched: true,
      }
      group.add(mesh)
      parts.push({ mesh, lod, sourceUrl: urls[lod], probes: poseProbes(geometry, rig) })
      if (!lod && geometry.boundingBox) normalizedBounds.union(geometry.boundingBox)
      if (!lod) {
        const positions = geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          probe.fromBufferAttribute(positions, i)
          if (probe.y < sampleRoot.y) {
            sampleRoot.copy(probe)
            sampleRootNode = mesh.name
          }
          const distance = probe.distanceToSquared(chestTarget)
          if (distance < chestDistance) {
            chestDistance = distance
            sampleChest.copy(probe)
            sampleChestNode = mesh.name
          }
        }
      }
    })
    root.add(group)
    return group
  })
  if (!parts.length) throw new Error('Horror creature has no inspected mesh')
  const contacts: CreatureContact[] = rig.limbs.map((limb, hand) => {
    const part = parts.find((candidate) => candidate.lod === 0)!,
      positions = part.mesh.geometry.getAttribute('position')
    const wrist = part.probes.find((candidate) => candidate.id === (hand ? 'right-wrist' : 'left-wrist'))!
    const forearm = part.probes.find((candidate) => candidate.id === (hand ? 'right-forearm' : 'left-forearm'))!
    const radius = rig.id === 'watcher' ? 0.025 : 0.045
    const targets = [
      wrist.rest.clone().add(new Vector3(radius, 0, 0)),
      wrist.rest.clone().add(new Vector3(-radius, 0, 0)),
      wrist.rest.clone().add(new Vector3(0, 0, radius)),
      wrist.rest.clone().add(new Vector3(0, 0, -radius)),
    ]
    const indices = [
      wrist.index,
      forearm.index,
      ...targets.map((target) => {
        let best = Infinity,
          chosen = wrist.index
        for (let index = 0; index < positions.count; index++) {
          probe.fromBufferAttribute(positions, index)
          // Remain on the same authored forearm/palm, never the adjacent torso.
          if (Math.sign(probe.x) !== limb.side || Math.abs(probe.x) < (rig.id === 'watcher' ? 0.1 : 0.28)) continue
          const distance = probe.distanceToSquared(target)
          if (distance < best) {
            best = distance
            chosen = index
          }
        }
        return chosen
      }),
    ]
    return {
      id: `creature-${placement.id}:wrist-${hand}`,
      hand,
      indices,
      mesh: part.mesh,
      points: indices.map(() => new Vector3()),
      a: new Vector3(),
      b: new Vector3(),
      radius: 1,
      active: false,
    }
  })
  return {
    placement,
    root,
    levels,
    parts,
    restBounds: sourceBounds,
    normalizedBounds,
    time,
    reveal: 0,
    lod: 1,
    visible: false,
    sampleRoot,
    sampleChest,
    sampleRootNode,
    sampleChestNode,
    rig,
    motion,
    actor: actorClock(placement),
    threat: null,
    attack: null,
    inverse: new Matrix4(),
    sensor: new Vector3(),
    target: new Vector3(),
    contacts,
  }
}

/** Actual sources, bounds, PBR maps and local soft-tissue pose for DEV verification. */
export function horrorCreaturesSnapshot() {
  return liveCreatures.map((creature) => ({
    id: creature.placement.id,
    sourceType: creature.placement.sourceType,
    variantId: creature.placement.variantId,
    visible: creature.visible,
    reveal: creature.reveal,
    motionTime: creature.time.value,
    lod: creature.lod,
    position: creature.root.position.toArray(),
    yaw: creature.actor.yaw,
    height: creature.placement.height,
    hazardId: `creature-${creature.placement.id}`,
    attack: creature.threat
      ? {
          id: creature.threat.id,
          state: creature.threat.phase,
          progress: creature.threat.progress,
          clock: creature.time.value,
          patrolTime: creature.actor.patrolTime,
          attackSerial: creature.threat.attackSerial,
          root: creature.threat.root.toArray(),
          range: creature.threat.range,
          target: creature.threat.target?.toArray() ?? null,
          yaw: creature.actor.yaw,
          hand: creature.actor.hand,
          local: creature.attack,
          contacts: creature.contacts.map((contact) => ({
            id: contact.id,
            a: contact.a.toArray(),
            b: contact.b.toArray(),
            radius: contact.radius,
            active: contact.active,
            sourceIndices: contact.indices,
            mesh: contact.mesh.name,
            world: contact.points.map((point) => point.toArray()),
          })),
        }
      : null,
    matrix: creature.root.matrixWorld.toArray(),
    sourceBounds: { min: creature.restBounds.min.toArray(), max: creature.restBounds.max.toArray() },
    normalizedBounds: { min: creature.normalizedBounds.min.toArray(), max: creature.normalizedBounds.max.toArray() },
    motion: {
      kind: 'articulated-creature-gait',
      ...creature.motion,
      amount: breath(creature.time.value, creature.placement.phase) + creature.motion.roarStrength * 0.018,
      roarWindow: {
        start: creature.motion.roarStart,
        peak: creature.motion.roarStart + 1.3,
        end: creature.motion.roarEnd,
      },
      ...horrorRigSnapshot(creature.rig),
      probes: creature.parts
        .filter((part) => part.lod === creature.lod)
        .flatMap((part) =>
          part.probes.map((probe) => ({
            id: probe.id,
            role: probe.role,
            mesh: part.mesh.name,
            index: probe.index,
            rest: probe.rest.toArray(),
            posed: evaluateHorrorMotionVertex(part.mesh.geometry, creature.rig, probe.index, new Vector3()).toArray(),
            world: evaluateHorrorMotionVertex(part.mesh.geometry, creature.rig, probe.index, new Vector3())
              .applyMatrix4(creature.root.matrixWorld)
              .toArray(),
          })),
        ),
      lods: [0, 1].map((lod) => ({
        lod,
        time: creature.rig.time.value,
        phase: creature.motion.phase,
        probes: creature.parts
          .filter((part) => part.lod === lod)
          .flatMap((part) =>
            part.probes.map((probe) => ({
              id: probe.id,
              role: probe.role,
              index: probe.index,
              rest: probe.rest.toArray(),
              posed: evaluateHorrorMotionVertex(part.mesh.geometry, creature.rig, probe.index, new Vector3()).toArray(),
            })),
          ),
      })),
    },
    draws: creature.parts
      .filter((part) => part.lod === creature.lod)
      .map(({ mesh, sourceUrl, lod }) => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        return {
          name: mesh.name,
          sourceUrl,
          lod,
          triangles: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
          pbr: {
            baseColor: materials.every((material) => !!material.map),
            normal: materials.every((material) => !!material.normalMap),
            roughness: materials.every((material) => !!material.roughnessMap),
          },
          breathingPatched: materials.every((material) => material.userData.horrorBreathing?.patched === true),
          motionPatched: materials.every((material) => material.userData.horrorMotion?.patched === true),
          bindings: {
            joints: { count: mesh.geometry.getAttribute('aHorrorJoints').count, itemSize: 4 },
            weights: { count: mesh.geometry.getAttribute('aHorrorWeights').count, itemSize: 4 },
          },
        }
      }),
  }))
}

/** Environmental organisms retain their real PBR bodies and finite, telegraphed hazard gestures. */
export function HorrorCreatures() {
  const urls = eldritchAssetUrls(),
    sources = useGLTF(urls),
    quality = useWorldStore((state) => state.quality)
  const creatures = useMemo(() => {
    // The root wires the approved four new URLs only after both local pipelines finish.
    if (sources.length < 8) return []
    return HORROR_LAYOUT.map((placement) => {
      const first = placement.sourceType === 'watcher' ? 4 : 6
      return makeCreature(placement, [sources[first].scene, sources[first + 1].scene], [urls[first], urls[first + 1]])
    })
  }, [sources])
  useEffect(() => {
    liveCreatures = creatures
    return () => {
      if (liveCreatures === creatures) liveCreatures = []
      creatures.forEach((creature) => {
        unregisterBlackMistHazard(`creature-${creature.placement.id}`)
        creature.contacts.forEach((contact) => unregisterBlackMistHazard(contact.id))
        creature.parts.forEach(({ mesh }) => {
          mesh.geometry.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((material) => material.dispose())
        })
      })
    }
  }, [creatures])
  useFrame(({ camera }) => {
    const runtime = blackMistRuntime
    const threatsRunning = blackMistHazardsEnabled()
    for (const creature of creatures) {
      const placement = creature.placement,
        actor = actorClock(placement)
      creature.actor = actor
      const reveal = smooth(creature.placement.revealStart, creature.placement.revealEnd, runtime.elapsed)
      creature.reveal = reveal
      creature.visible = runtime.active && reveal > 0.001
      creature.root.visible = creature.visible
      const livingDelta = Math.max(0, runtime.motionTime - actor.clock)
      actor.clock = runtime.motionTime
      const delta = actor.phase === 'idle' || threatsRunning ? livingDelta : 0
      const preceding = creature.attack
      const walkScale =
        actor.phase === 'idle'
          ? 1
          : actor.phase === 'windup'
            ? 1 - ease((preceding?.progress ?? 0) / 0.4)
            : actor.phase === 'recover'
              ? ease(((preceding?.progress ?? 0) - 0.5) / 0.5)
              : 0
      actor.patrolTime += delta * walkScale
      creature.motion = sampleHorrorMotion(placement, actor.patrolTime)
      const motion = creature.motion
      motion.time = runtime.motionTime
      creature.root.position.set(...placement.position).add(new Vector3(...motion.offset))
      creature.root.position.y -= (1 - reveal) * creature.placement.height * 0.55
      creature.root.quaternion.setFromAxisAngle(Y_AXIS, actor.yaw)
      creature.root.updateMatrixWorld(true)
      const high = creature.parts.find((part) => part.lod === 0)!,
        chest = high.probes.find((probe) => probe.id === 'chest')!
      evaluateHorrorMotionVertex(high.mesh.geometry, creature.rig, chest.index, creature.sensor).applyMatrix4(
        creature.root.matrixWorld,
      )
      const threat = queryBlackMistThreat({
        id: `creature-${placement.id}`,
        kind: 'creature',
        origin: creature.sensor,
        range: placement.height * 0.74,
        windup: 2,
        strike: 0.75,
        recover: 1.9,
        cooldown: 4.5,
      })
      if (threat.phase === 'windup' && actor.phase !== 'windup') {
        actor.windupFrom = creature.rig.feet.map((foot) => foot.target.toArray()) as [Point, Point]
        actor.windupHead = Array.from(creature.rig.rotations.value.slice(4, 8)) as [number, number, number, number]
        const relative = threat.target
          ? threat.target.clone().sub(creature.root.position).applyAxisAngle(Y_AXIS, -actor.yaw)
          : new Vector3()
        actor.hand = relative.x < 0 ? 0 : 1
      }
      if (threat.phase === 'recover' && actor.phase !== 'recover') {
        actor.recoveryFrom = creature.rig.feet.map((foot) => foot.target.toArray()) as [Point, Point]
        actor.recoveryHead = Array.from(creature.rig.rotations.value.slice(4, 8)) as [number, number, number, number]
        actor.recoveryAttention = actor.phase === 'windup' ? ease(preceding?.progress ?? 0) : 1
      }
      const desiredYaw =
        threat.target && threat.phase !== 'idle' && threat.phase !== 'recover'
          ? Math.atan2(threat.target.x - creature.root.position.x, threat.target.z - creature.root.position.z)
          : horrorFacing(placement) + motion.yawOffset
      // Turn with a bounded angular speed during anticipation, then lock the body's aim.
      const allowTurn =
        threat.phase === 'idle' || threat.phase === 'recover' || (threat.phase === 'windup' && threat.progress < 0.65)
      if (allowTurn) {
        const difference = shortAngle(desiredYaw - actor.yaw),
          rate = threat.phase === 'windup' ? 1.35 : 0.9
        actor.yaw += Math.max(-rate * delta, Math.min(rate * delta, difference))
      }
      creature.root.quaternion.setFromAxisAngle(Y_AXIS, actor.yaw)
      creature.root.updateMatrixWorld(true)
      creature.inverse.copy(creature.root.matrixWorld).invert()
      if (threat.target) creature.target.copy(threat.target).applyMatrix4(creature.inverse)
      const attack: HorrorAttackPose = {
        phase: threat.phase,
        progress: threat.progress,
        sequence: threat.attackSerial,
        localTarget: threat.target ? [creature.target.x, creature.target.y, creature.target.z] : null,
        hand: actor.hand,
        windupFrom: actor.windupFrom,
        recoveryFrom: actor.recoveryFrom,
        recoveryAttention: actor.recoveryAttention,
        windupHead: actor.windupHead,
        recoveryHead: actor.recoveryHead,
      }
      actor.phase = threat.phase
      creature.threat = threat
      creature.attack = attack
      if (threat.phase !== 'idle') {
        motion.stepStrength *= walkScale
        motion.velocity = motion.velocity.map((value) => value * walkScale) as Point
        motion.angularVelocity *= walkScale
        motion.roarEvent = false
        motion.roarStrength = 0
        motion.headLift = 0
      }
      updateHorrorRig(creature.rig, placement, motion, actor.yaw - motion.yawOffset, attack)
      creature.contacts.forEach((contact) => {
        contact.indices.forEach((vertex, index) =>
          evaluateHorrorMotionVertex(contact.mesh.geometry, creature.rig, vertex, contact.points[index]).applyMatrix4(
            creature.root.matrixWorld,
          ),
        )
        contact.a.copy(contact.points[0])
        contact.b.copy(contact.points[1])
        contact.radius = Math.max(
          placement.height * 0.008,
          ...contact.points.slice(2).map((point) => point.distanceTo(contact.a)),
        )
        contact.active = creature.visible && reveal > 0.99 && threat.phase === 'strike' && contact.hand === actor.hand
        publishBlackMistHazard({
          id: contact.id,
          kind: 'creature',
          a: contact.a,
          b: contact.b,
          radius: contact.radius,
          active: contact.active,
          attackSerial: threat.attackSerial,
        })
      })
      const near = NEAR[quality],
        center = creature.root.position
      creature.lod = camera.position.distanceToSquared(center) < near * near ? 0 : 1
      creature.levels.forEach((level, lod) => {
        level.visible = lod === creature.lod
      })
    }
  }, -0.9)
  return (
    <group name="horror-creatures" dispose={null}>
      {creatures.map((creature) => (
        <primitive key={creature.placement.id as HorrorCreatureId} object={creature.root} />
      ))}
    </group>
  )
}
