// Retarget Tripo-native (spec=tripo) clips onto the game's mixamo-named rig of the SAME mesh.
// Both rigs come from Tripo rig v1 on the same source model, so joint positions and rest pose
// coincide; only names, bone-axis conventions and hierarchy (twist / pelvis-waist split) differ.
// Per bone: q_tgt_world(t) = (q_src_world(t) * inv(q_src_world_rest)) * q_tgt_world_rest.
import { Quaternion, Vector3, Matrix4 } from 'three'
import { io, skeletonOf, sampleAnimation, worldPose, restPose } from './lib.mjs'

export const PREFIX = 'mixamorig:'
export const MAP = {
  Hips: 'Pelvis', Spine: 'Waist', Spine1: 'Spine01', Spine2: 'Spine02', Neck: 'NeckTwist02', Head: 'Head',
  LeftShoulder: 'L_Clavicle', LeftArm: 'L_Upperarm', LeftForeArm: 'L_Forearm', LeftHand: 'L_Hand',
  RightShoulder: 'R_Clavicle', RightArm: 'R_Upperarm', RightForeArm: 'R_Forearm', RightHand: 'R_Hand',
  LeftUpLeg: 'L_Thigh', LeftLeg: 'L_Calf', LeftFoot: 'L_Foot', LeftToeBase: 'L_ToeBase',
  RightUpLeg: 'R_Thigh', RightLeg: 'R_Calf', RightFoot: 'R_Foot', RightToeBase: 'R_ToeBase',
}
export const BONES = Object.keys(MAP)
const swapLR = (b) => b.startsWith('Left') ? 'Right' + b.slice(4) : b.startsWith('Right') ? 'Left' + b.slice(5) : b
// Reflection across the character's sagittal plane. Forward = glTF +X, up = +Y, lateral = Z.
const mirrorQ = (q) => new Quaternion(-q.x, -q.y, q.z, q.w)

export async function loadTarget(file) {
  const doc = await io.read(file)
  const skel = skeletonOf(doc)
  const restW = worldPose(skel, restPose(skel))
  return { doc, skel, restW }
}

/** Retarget one source clip. Returns frames of { rot: Map(bone → local quat), hips: world Vector3 }. */
export async function retarget(srcFile, target, { mirror = false } = {}) {
  const doc = await io.read(srcFile)
  const skel = skeletonOf(doc)
  const anim = doc.getRoot().listAnimations()[0]
  const s = sampleAnimation(doc, anim, skel)
  const srcRestW = worldPose(skel, restPose(skel))
  const T = target
  const tq = (b) => T.restW.get(PREFIX + b).q
  // Rest-pose sanity: mapped joints must coincide in world space.
  let restDev = 0
  for (const b of BONES) restDev = Math.max(restDev, srcRestW.get(MAP[b]).p.distanceTo(T.restW.get(PREFIX + b).p))
  const mirrorZ = srcRestW.get('Hip').p.z
  const frames = s.local.map((pose) => {
    const W = worldPose(skel, pose)
    const worldQ = new Map()
    const rot = new Map()
    for (const name of T.skel.order) {
      if (!name.startsWith(PREFIX)) continue
      const b = name.slice(PREFIX.length)
      const src = MAP[mirror ? swapLR(b) : b]
      let D = W.get(src).q.clone().multiply(srcRestW.get(src).q.clone().invert())
      if (mirror) D = mirrorQ(D)
      const qW = D.multiply(tq(b))
      worldQ.set(name, qW)
      const parent = T.skel.nodes.get(name).parent
      const parentW = worldQ.get(parent) ?? T.restW.get(parent).q
      rot.set(b, parentW.clone().invert().multiply(qW).normalize())
    }
    const hips = W.get('Hip').p.clone()
    if (mirror) hips.z = 2 * mirrorZ - hips.z
    return { rot, hips }
  })
  return { fps: s.fps, times: s.times, frames, restDev, name: anim.getName(), srcRestW, mirrorZ }
}

/** Hips world position → local translation under the (rest) Root node. */
export function hipsLocal(target, p) {
  const parent = T_parentMatrix(target)
  return p.clone().applyMatrix4(parent)
}
function T_parentMatrix(target) {
  if (!target._invRoot) target._invRoot = target.restW.get(target.skel.nodes.get(PREFIX + 'Hips').parent).m.clone().invert()
  return target._invRoot
}

/** FK of the target for a retargeted frame (world positions of every target bone). */
export function targetWorld(target, frame) {
  const pose = restPose(target.skel)
  for (const b of BONES) pose.get(PREFIX + b).r.copy(frame.rot.get(b))
  pose.get(PREFIX + 'Hips').t.copy(hipsLocal(target, frame.hips))
  return worldPose(target.skel, pose)
}
