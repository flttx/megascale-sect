import { Bone, Object3D, Quaternion, Vector3 } from 'three'
import type { AnimationClip } from 'three'
import { ClipLayer, type ClipTarget, type Gaits } from './characterClips'
import { FLIGHT_SEQUENCE, smooth, type PlayerRuntime } from './playerMotion'
import { FootPlant } from './footPlant'
import { RidingPose, ridingPoseWeight } from './ridingPose'

/** `offset`: the procedural angles about `axes`, eased toward this frame's pose. */
type Joint = ClipTarget & { bone: Bone; axes: [Vector3, Vector3, Vector3]; offset: [number, number, number] }
export type CharacterRig = {
  joints: Map<string, Joint>; scene: Object3D; restFootY: number;
  quaternion: Quaternion; delta: Quaternion; foot: Vector3;
  footPlant: FootPlant;
  ridingPose: RidingPose;
  clips: ClipLayer;
}

export function prepareCharacterRig(scene: Object3D, animations: AnimationClip[], gaits: Gaits): CharacterRig {
  scene.updateMatrixWorld(true)
  const joints = new Map<string, Joint>()
  scene.traverse((object) => {
    if (!(object as Bone).isBone) return
    const bone = object as Bone
    const inverse = bone.getWorldQuaternion(new Quaternion()).invert()
    joints.set(bone.name.replace(/^mixamorig[:_]?/, ''), {
      bone, rest: bone.quaternion.clone(), restPosition: bone.position.clone(), rotation: new Quaternion(), position: new Vector3(),
      rotationWeight: 0, positionWeight: 0, offset: [0, 0, 0],
      axes: [new Vector3(1, 0, 0).applyQuaternion(inverse), new Vector3(0, 1, 0).applyQuaternion(inverse), new Vector3(0, 0, 1).applyQuaternion(inverse)],
    })
  })
  const rig = { scene, joints, restFootY: 0, quaternion: new Quaternion(), delta: new Quaternion(), foot: new Vector3(), footPlant: new FootPlant(scene), ridingPose: new RidingPose(scene), clips: new ClipLayer(joints, animations, gaits) }
  rig.restFootY = lowestFoot(rig)
  return rig
}

const FEET = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']

function lowestFoot(rig: CharacterRig) {
  let min = Infinity
  for (const name of FEET) {
    const bone = rig.joints.get(name)?.bone
    if (bone) {
      bone.getWorldPosition(rig.foot)
      rig.scene.worldToLocal(rig.foot)
      min = Math.min(min, rig.foot.y)
    }
  }
  return Number.isFinite(min) ? min : 0
}

// The baked clips give the base pose; procedural angles on top (summoning, riding, landing crouches) are expressed
// in the source model's anatomical axes, then converted into each bone's frame. This keeps the generated skin weights.
export function updateCharacterPose(rig: CharacterRig, runtime: PlayerRuntime, delta: number): number {
  const speed = Math.hypot(runtime.velocity.x, runtime.velocity.z)
  const moving = runtime.phase === 'GROUND'
  rig.clips.update(runtime, delta)
  // The rest pose's share breathes and sways on its own; the clips carry their own idle.
  const still = 1 - rig.clips.weight
  const summon = runtime.phase === 'SUMMONING' ? Math.sin(Math.PI * Math.min(1, runtime.elapsed / FLIGHT_SEQUENCE.summon)) : 0
  const jumpTime = runtime.elapsed / FLIGHT_SEQUENCE.board
  const riding = runtime.rideMix
  const breathe = Math.sin(runtime.time * 1.8)
  const landing = (runtime.phase === 'DISMOUNTING' ? Math.sin(Math.PI * runtime.elapsed / FLIGHT_SEQUENCE.dismount) : 0) + runtime.impact * 0.7 + (moving ? runtime.landing * 0.8 * (1 - rig.clips.landWeight) : 0)
  // A running jump is a stride, not a hop: the swinging leg reaches forward, the one that pushed off trails, the body
  // leans into it. The legs come back together for the landing.
  const leadL = rig.clips.leap * (rig.clips.leapSide > 0 ? 1 : 0), leadR = rig.clips.leap - leadL
  const pose: Record<string, [number, number, number]> = {
    Spine: [0, 0, (-0.02 - breathe * 0.008) * still - riding * (0.01 + speed * 0.00015) - rig.clips.leap * 0.12],
    Spine1: [riding * runtime.bank * -0.18, 0, -summon * 0.035],
    Spine2: [0, summon * -0.13, breathe * 0.009 * still],
    Neck: [0, 0, riding * 0.045], Head: [0, Math.sin(runtime.time * 0.6) * 0.015 * still, 0],
    RightArm: [riding * (-0.14 + breathe * 0.025), 0, summon * 1.12 + riding * 0.1],
    RightForeArm: [0, 0, summon * 0.85],
    RightHand: [summon * -0.25, 0, summon * -0.1],
    LeftArm: [riding * (0.17 - breathe * 0.025) + summon * -0.12, 0, summon * 0.4 + riding * 0.15],
    LeftForeArm: [0, summon * -0.3, summon * 0.7],
    LeftUpLeg: [0, 0, riding * 0.11 + landing * 0.18 + leadL * 0.55 - leadR * 0.4],
    RightUpLeg: [0, 0, riding * 0.04 + landing * 0.18 + leadR * 0.55 - leadL * 0.4],
    LeftLeg: [0, 0, -riding * 0.14 - landing * 0.36 - leadL * 0.35 - leadR * 0.6],
    RightLeg: [0, 0, -riding * 0.12 - landing * 0.36 - leadR * 0.35 - leadL * 0.6],
    LeftFoot: [0, 0, riding * 0.04],
    RightFoot: [0, 0, riding * 0.06],
  }
  for (const joint of rig.joints.values()) {
    joint.bone.quaternion.copy(joint.rotation)
    joint.bone.position.copy(joint.position)
  }
  // How far the clip itself lifts the feet (a run's flight phase, a tucked fall), which the correction keeps.
  rig.scene.updateMatrixWorld(true)
  const clipFoot = lowestFoot(rig)
  const blend = 1 - Math.exp(-18 * delta)
  for (const [name, joint] of rig.joints) {
    const angles = pose[name], offset = joint.offset
    for (let axis = 0; axis < 3; axis++) offset[axis] += ((angles ? angles[axis] : 0) - offset[axis]) * blend
    if (Math.abs(offset[0]) + Math.abs(offset[1]) + Math.abs(offset[2]) < 1e-5) continue
    rig.quaternion.copy(joint.rotation)
    for (let axis = 0; axis < 3; axis++) {
      rig.delta.setFromAxisAngle(joint.axes[axis], offset[axis])
      rig.quaternion.multiply(rig.delta)
    }
    joint.bone.quaternion.copy(rig.quaternion)
  }
  rig.scene.updateMatrixWorld(true)
  const foot = rig.restFootY + rig.clips.weight * Math.max(0, clipFoot - rig.restFootY)
  const correction = Math.max(-0.18, Math.min(0.18, foot - lowestFoot(rig)))
  const base = runtime.phase === 'BOARDING' && jumpTime > 0.16 ? correction * smooth((jumpTime - 0.68) / 0.14) : correction * (moving ? 1 - runtime.air : 1)
  const ridingWeight = ridingPoseWeight(runtime)
  return base * (1 - ridingWeight) - 0.045 * ridingWeight
}
