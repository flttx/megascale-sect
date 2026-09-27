import { Bone, Object3D, Quaternion, Vector3 } from 'three'
import { FLIGHT_SEQUENCE, smooth, type PlayerRuntime } from './playerMotion'
import { FootPlant } from './footPlant'
import { RidingPose, ridingPoseWeight } from './ridingPose'

type Joint = { bone: Bone; rest: Quaternion; pose: Quaternion; position: Vector3; axes: [Vector3, Vector3, Vector3] }
export type CharacterRig = {
  joints: Map<string, Joint>; scene: Object3D; restFootY: number;
  quaternion: Quaternion; delta: Quaternion; foot: Vector3;
  footPlant: FootPlant;
  ridingPose: RidingPose;
}

export function prepareCharacterRig(scene: Object3D): CharacterRig {
  scene.updateMatrixWorld(true)
  const joints = new Map<string, Joint>()
  scene.traverse((object) => {
    if (!(object as Bone).isBone) return
    const bone = object as Bone
    const inverse = bone.getWorldQuaternion(new Quaternion()).invert()
    joints.set(bone.name.replace(/^mixamorig[:_]?/, ''), {
      bone, rest: bone.quaternion.clone(), pose: bone.quaternion.clone(), position: bone.position.clone(),
      axes: [new Vector3(1, 0, 0).applyQuaternion(inverse), new Vector3(0, 1, 0).applyQuaternion(inverse), new Vector3(0, 0, 1).applyQuaternion(inverse)],
    })
  })
  const rig = { scene, joints, restFootY: 0, quaternion: new Quaternion(), delta: new Quaternion(), foot: new Vector3(), footPlant: new FootPlant(scene), ridingPose: new RidingPose(scene) }
  rig.restFootY = lowestFoot(rig)
  return rig
}

function lowestFoot(rig: CharacterRig) {
  let min = Infinity
  for (const name of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) {
    const bone = rig.joints.get(name)?.bone
    if (bone) {
      bone.getWorldPosition(rig.foot)
      rig.scene.worldToLocal(rig.foot)
      min = Math.min(min, rig.foot.y)
    }
  }
  return Number.isFinite(min) ? min : 0
}

// Joint rotations are expressed in the source model's anatomical axes, then
// converted into each bone's rest frame. This keeps the generated skin weights.
export function updateCharacterPose(rig: CharacterRig, runtime: PlayerRuntime, delta: number): number {
  const speed = Math.hypot(runtime.velocity.x, runtime.velocity.z)
  const moving = runtime.phase === 'GROUND'
  const running = runtime.runMix
  const stride = runtime.stride
  const wave = Math.sin(stride)
  // Sprinting lengthens the leg and arm swing beyond the run cycle.
  const sprint = moving ? smooth((speed - 6) / 4) : 0
  const amplitude = moving ? (0.48 + running * 0.14 + sprint * 0.1) * runtime.gait : 0
  const swing = 0.8 + sprint * 0.25
  const summon = runtime.phase === 'SUMMONING' ? Math.sin(Math.PI * Math.min(1, runtime.elapsed / FLIGHT_SEQUENCE.summon)) : 0
  const jumpTime = runtime.elapsed / FLIGHT_SEQUENCE.board
  const airborneTime = Math.max(0, Math.min(1, (jumpTime - 0.16) / 0.66))
  // A jump on foot draws the knees up while rising and opens out toward the fall.
  const hop = moving ? runtime.air * (0.6 + 0.4 * Math.max(0, Math.min(1, runtime.velocity.y / 8))) : 0
  const tuck = (runtime.phase === 'BOARDING' ? Math.sin(Math.PI * airborneTime) : 0) + hop * 0.7
  const anticipation = runtime.phase === 'BOARDING' && jumpTime < 0.22 ? Math.sin(Math.PI * Math.min(1, jumpTime / 0.22)) : 0
  const riding = runtime.rideMix
  const breathe = Math.sin(runtime.time * 1.8)
  const landing = (runtime.phase === 'DISMOUNTING' ? Math.sin(Math.PI * runtime.elapsed / FLIGHT_SEQUENCE.dismount) : 0) + runtime.impact * 0.7 + anticipation + (moving ? runtime.landing * 0.8 : 0)
  const pose: Record<string, [number, number, number]> = {
    Spine: [0, 0, -0.02 - breathe * 0.008 - riding * (0.01 + speed * 0.00015) - tuck * 0.15 - (moving ? Math.min(speed, 11) * 0.01 * runtime.gait : 0)],
    Spine1: [riding * runtime.bank * -0.18, 0, -summon * 0.035],
    Spine2: [0, summon * -0.13, breathe * 0.009],
    Neck: [0, 0, riding * 0.045], Head: [0, Math.sin(runtime.time * 0.6) * 0.015, 0],
    RightArm: [riding * (-0.14 + breathe * 0.025), 0, -wave * amplitude * swing + summon * 1.12 + tuck * 0.85 + riding * 0.1],
    RightForeArm: [0, 0, summon * 0.85 + (moving ? 0.18 : 0) + tuck * 0.3],
    RightHand: [summon * -0.25, 0, summon * -0.1],
    LeftArm: [riding * (0.17 - breathe * 0.025) + summon * -0.12, 0, wave * amplitude * swing + summon * 0.4 + tuck * 0.75 + riding * 0.15],
    LeftForeArm: [0, summon * -0.3, summon * 0.7 + (moving ? 0.18 : 0) + tuck * 0.35],
    LeftUpLeg: [0, 0, wave * amplitude + tuck * 0.75 + riding * 0.11 + landing * 0.18],
    RightUpLeg: [0, 0, -wave * amplitude + tuck * 0.65 + riding * 0.04 + landing * 0.18],
    LeftLeg: [0, 0, -(moving ? Math.max(0, Math.cos(stride)) * (0.48 + running * 0.24) * runtime.gait : 0) - tuck * 0.9 - riding * 0.14 - landing * 0.36],
    RightLeg: [0, 0, -(moving ? Math.max(0, -Math.cos(stride)) * (0.48 + running * 0.24) * runtime.gait : 0) - tuck * 0.85 - riding * 0.12 - landing * 0.36],
    LeftFoot: [0, 0, tuck * 0.22 + riding * 0.04],
    RightFoot: [0, 0, tuck * 0.22 + riding * 0.06],
  }
  const blend = 1 - Math.exp(-18 * delta)
  for (const [name, joint] of rig.joints) {
    rig.quaternion.copy(joint.rest)
    const angles = pose[name]
    if (angles) for (let axis = 0; axis < 3; axis++) {
      rig.delta.setFromAxisAngle(joint.axes[axis], angles[axis])
      rig.quaternion.multiply(rig.delta)
    }
    joint.pose.slerp(rig.quaternion, blend)
    joint.bone.quaternion.copy(joint.pose)
  }
  rig.scene.updateMatrixWorld(true)
  const correction = Math.max(-0.18, Math.min(0.18, rig.restFootY - lowestFoot(rig)))
  const base = runtime.phase === 'BOARDING' && jumpTime > 0.16 ? correction * smooth((jumpTime - 0.68) / 0.14) : correction * (moving ? 1 - runtime.air : 1)
  const ridingWeight = ridingPoseWeight(runtime)
  return base * (1 - ridingWeight) - 0.045 * ridingWeight
}
