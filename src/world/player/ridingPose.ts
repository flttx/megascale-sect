import { Bone, Matrix4, Object3D, Quaternion, Raycaster, SkinnedMesh, Vector3 } from 'three'
import { FLIGHT_SEQUENCE, smooth, type PlayerRuntime } from './playerMotion'

export function ridingPoseWeight(state: PlayerRuntime) {
  if (state.phase === 'BOARDING') return smooth((state.elapsed / FLIGHT_SEQUENCE.board - 0.53) / 0.29)
  if (state.phase === 'FLIGHT' || state.phase === 'LANDING') return 1
  if (state.phase === 'DISMOUNTING') return 1 - smooth(state.elapsed / FLIGHT_SEQUENCE.dismount / 0.45)
  return 0
}

type Limb = {
  upper: Bone; lower: Bone; end: Bone; side: number; restEnd: Vector3;
  restOrientation: Quaternion; restDirection: Vector3;
}

// Targets use the sword assembly's frame for feet and the character's frame for
// hands. Both remain attached while the sword banks, climbs, brakes, or turns.
export class RidingPose {
  private legs: Limb[] = []
  private arms: Limb[] = []
  private hips = new Vector3()
  private sourceUp = new Vector3(0, 1, 0)
  private a = new Vector3(); private b = new Vector3(); private c = new Vector3()
  private direction = new Vector3(); private bend = new Vector3(); private knee = new Vector3()
  private target = new Vector3(); private pole = new Vector3(); private desiredEnd = new Quaternion()
  private parentQ = new Quaternion(); private worldQ = new Quaternion(); private turnQ = new Quaternion()
  private sourceQ = new Quaternion(); private assemblyQ = new Quaternion()
  private oldUpper = new Quaternion(); private oldLower = new Quaternion(); private oldEnd = new Quaternion()
  private rotationY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)

  constructor(private scene: Object3D) {
    const bones = new Map<string, Bone>()
    scene.updateWorldMatrix(true, true)
    scene.traverse((object) => { if (object instanceof Bone) bones.set(object.name.replace(/^mixamorig[:_]?/, ''), object) })
    bones.get('Hips')?.getWorldPosition(this.hips)
    scene.worldToLocal(this.hips)
    for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
      for (const [names, list] of [
        [[`${side}UpLeg`, `${side}Leg`, `${side}Foot`], this.legs],
        [[`${side}Arm`, `${side}ForeArm`, `${side}Hand`], this.arms],
      ] as [string[], Limb[]][]) {
        const upper = bones.get(names[0]), lower = bones.get(names[1]), end = bones.get(names[2])
        if (!upper || !lower || !end) continue
        end.getWorldPosition(this.a); lower.getWorldPosition(this.b)
        scene.worldToLocal(this.a); scene.worldToLocal(this.b)
        const orientation = end.getWorldQuaternion(new Quaternion())
        scene.getWorldQuaternion(this.sourceQ).invert()
        orientation.premultiply(this.sourceQ)
        list.push({ upper, lower, end, side: sign, restEnd: this.a.clone(), restOrientation: orientation, restDirection: this.a.clone().sub(this.b).normalize() })
      }
    }
  }

  private aim(bone: Bone, endpoint: Bone, point: Vector3) {
    bone.getWorldPosition(this.a); endpoint.getWorldPosition(this.b)
    this.b.sub(this.a).normalize()
    this.direction.copy(point).sub(this.a).normalize()
    this.turnQ.setFromUnitVectors(this.b, this.direction)
    bone.getWorldQuaternion(this.worldQ).premultiply(this.turnQ)
    bone.parent!.getWorldQuaternion(this.parentQ).invert()
    bone.quaternion.copy(this.parentQ.multiply(this.worldQ))
    bone.updateWorldMatrix(false, true)
  }

  private solve(limb: Limb, weight: number) {
    this.oldUpper.copy(limb.upper.quaternion); this.oldLower.copy(limb.lower.quaternion); this.oldEnd.copy(limb.end.quaternion)
    limb.upper.getWorldPosition(this.a); limb.lower.getWorldPosition(this.b); limb.end.getWorldPosition(this.c)
    const upperLength = this.a.distanceTo(this.b), lowerLength = this.b.distanceTo(this.c)
    const distance = Math.max(Math.abs(upperLength - lowerLength) + 0.001, Math.min((upperLength + lowerLength) * 0.998, this.a.distanceTo(this.target)))
    this.direction.copy(this.target).sub(this.a).normalize()
    this.target.copy(this.a).addScaledVector(this.direction, distance)
    this.bend.copy(this.pole).sub(this.a)
    this.bend.addScaledVector(this.direction, -this.bend.dot(this.direction)).normalize()
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance)
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along))
    this.knee.copy(this.a).addScaledVector(this.direction, along).addScaledVector(this.bend, height)
    this.aim(limb.upper, limb.lower, this.knee)
    this.aim(limb.lower, limb.end, this.target)
    limb.end.parent!.getWorldQuaternion(this.parentQ).invert()
    limb.end.quaternion.copy(this.parentQ.multiply(this.desiredEnd))
    limb.upper.quaternion.copy(this.oldUpper.slerp(limb.upper.quaternion, weight))
    limb.lower.quaternion.copy(this.oldLower.slerp(limb.lower.quaternion, weight))
    limb.end.quaternion.copy(this.oldEnd.slerp(limb.end.quaternion, weight))
    limb.upper.updateWorldMatrix(false, true)
  }

  update(state: PlayerRuntime, assembly: Object3D, scale: number, floor: number) {
    const weight = ridingPoseWeight(state)
    if (weight === 0) return
    this.scene.updateWorldMatrix(true, true)
    assembly.getWorldQuaternion(this.assemblyQ)
    this.scene.getWorldQuaternion(this.sourceQ)
    for (const limb of this.legs) {
      // Left foot toward the tip, right foot behind; both on the narrow blade.
      this.target.set(limb.side * 0.028, (limb.restEnd.y - floor) * scale, limb.side < 0 ? -0.24 : 0.20)
      assembly.localToWorld(this.target)
      this.pole.set(limb.side * 0.10, 0.65, -0.8)
      assembly.localToWorld(this.pole)
      this.turnQ.setFromAxisAngle(this.sourceUp, limb.side < 0 ? -0.04 : 0.16)
      this.desiredEnd.copy(this.assemblyQ).multiply(this.rotationY).multiply(this.turnQ).multiply(limb.restOrientation)
      this.solve(limb, weight)
    }
    for (const limb of this.arms) {
      // Wrists overlap behind the lower back; elbows angle out and rearward.
      this.target.set(-0.085, this.hips.y + 0.055 + (limb.side < 0 ? 0.006 : -0.006), limb.side * 0.012)
      this.scene.localToWorld(this.target)
      this.pole.set(-0.14, this.hips.y + 0.075, limb.side * 0.18)
      this.scene.localToWorld(this.pole)
      this.direction.set(-0.12, -0.35, -limb.side).normalize()
      this.turnQ.setFromUnitVectors(limb.restDirection, this.direction)
      this.desiredEnd.copy(this.sourceQ).multiply(this.turnQ).multiply(limb.restOrientation)
      this.solve(limb, weight)
    }
  }

  snapshot(assembly: Object3D) {
    return [...this.legs, ...this.arms].map((limb) => ({
      name: limb.end.name,
      local: assembly.worldToLocal(limb.end.getWorldPosition(new Vector3())).toArray(),
    }))
  }

  // Explicit QA readback of posed boot geometry, rather than ankle joints alone.
  measureContact(assembly: Object3D, sword: Object3D) {
    assembly.updateWorldMatrix(true, true)
    const point = new Vector3(), matrix = new Matrix4(), inverse = assembly.matrixWorld.clone().invert()
    const results = this.legs.map((limb) => ({ name: limb.end.name, ankle: assembly.worldToLocal(limb.end.getWorldPosition(new Vector3())), sole: Infinity, deck: -Infinity }))
    this.scene.traverse((object) => {
      if (!(object instanceof SkinnedMesh)) return
      const indices = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight')
      matrix.multiplyMatrices(inverse, object.matrixWorld)
      for (let leg = 0; leg < this.legs.length; leg++) {
        const limb = this.legs[leg], result = results[leg], bones = new Set<number>()
        limb.end.traverse((bone) => { const i = object.skeleton.bones.indexOf(bone as Bone); if (i >= 0) bones.add(i) })
        for (let vertex = 0; vertex < indices.count; vertex++) {
          let influence = 0
          for (let component = 0; component < 4; component++) if (bones.has(indices.getComponent(vertex, component))) influence += weights.getComponent(vertex, component)
          if (influence < 0.55) continue
          object.getVertexPosition(vertex, point).applyMatrix4(matrix)
          if (Math.abs(point.x - result.ankle.x) < 0.18 && Math.abs(point.z - result.ankle.z) < 0.22) result.sole = Math.min(result.sole, point.y)
        }
      }
    })
    const ray = new Raycaster(), down = new Vector3(0, -1, 0).transformDirection(assembly.matrixWorld)
    for (const result of results) {
      point.copy(result.ankle); point.y += 0.5
      ray.set(assembly.localToWorld(point), down)
      const hit = ray.intersectObject(sword, true)[0]
      if (hit) result.deck = assembly.worldToLocal(hit.point).y
    }
    return results.map(({ name, sole, deck }) => ({ name, sole, deck, gap: sole - deck }))
  }
}
