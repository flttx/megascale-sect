import { Bone, Object3D, Quaternion, Vector3 } from 'three'
import { groundHeight } from '../worldLayout'
import type { PlayerRuntime } from './playerMotion'
import { deckAnchor, evaluateDeckAnchor, kunDeckHit } from '../colossi/kunDeck'
import type { DeckAnchor } from '../colossi/kunDeck'

type Chain = { hip: Bone; knee: Bone; foot: Bone; anchor: Vector3; locked: boolean; sole: number; offset: number; deck: DeckAnchor | null }
const a = new Vector3(), b = new Vector3(), c = new Vector3(), direction = new Vector3(), bend = new Vector3(), target = new Vector3()
const kneeTarget = new Vector3(), forward = new Vector3(), scale = new Vector3()
const parentQ = new Quaternion(), worldQ = new Quaternion(), turnQ = new Quaternion(), footQ = new Quaternion()

function aim(bone: Bone, endpoint: Bone, point: Vector3) {
  bone.getWorldPosition(a)
  endpoint.getWorldPosition(b)
  b.sub(a).normalize()
  direction.copy(point).sub(a).normalize()
  turnQ.setFromUnitVectors(b, direction)
  bone.getWorldQuaternion(worldQ).premultiply(turnQ)
  bone.parent!.getWorldQuaternion(parentQ).invert()
  bone.quaternion.copy(parentQ.multiply(worldQ))
  bone.updateWorldMatrix(false, true)
}

// Short stance locks reduce sliding without changing the source skin or rest pose.
export class FootPlant {
  private chains: Chain[] = []
  private relocation = -1
  constructor(private scene: Object3D) {
    const bones = new Map<string, Bone>()
    scene.traverse((object) => { if (object instanceof Bone) bones.set(object.name.replace(/^mixamorig[:_]?/, ''), object) })
    for (const [side, offset] of [['Left', 0], ['Right', Math.PI]] as const) {
      const hip = bones.get(`${side}UpLeg`), knee = bones.get(`${side}Leg`), foot = bones.get(`${side}Foot`)
      if (!hip || !knee || !foot) continue
      foot.getWorldPosition(c)
      scene.worldToLocal(c)
      this.chains.push({ hip, knee, foot, anchor: new Vector3(), locked: false, sole: c.y, offset, deck: null })
    }
  }
  /**
   * The clips say when each foot is down: `stride` puts the left mid-stance at π, and a foot plants while
   * cos(stride + side) < −duty, a window that narrows from walk to sprint as the clips spend less time on the ground.
   */
  update(state: PlayerRuntime, stride: number, duty: number) {
    if (state.relocation !== this.relocation) { this.reset(); this.relocation = state.relocation }
    const walking = state.phase === 'GROUND' && !state.inAir && duty < 1 && state.velocity.length() > 0.12
    const standingOnDeck = !!state.aboard && state.phase === 'GROUND' && !state.inAir && state.velocity.length() <= 0.12
    this.scene.getWorldScale(scale)
    for (const chain of this.chains) {
      const stance = standingOnDeck || (walking && Math.cos(stride + chain.offset) < -duty)
      if (!stance) { chain.locked = false; chain.deck = null; continue }
      if (!!chain.deck !== !!state.aboard) chain.locked = false
      if (!chain.locked) {
        chain.foot.getWorldPosition(chain.anchor); chain.locked = true
        const hit = state.aboard ? kunDeckHit(chain.anchor.x, chain.anchor.z, chain.anchor.y + 0.5) : null
        chain.deck = hit ? deckAnchor(hit) : null
      }
      const carried = chain.deck ? evaluateDeckAnchor(chain.deck, chain.anchor) : null
      const surface = carried ? carried.y : groundHeight(chain.anchor.x, chain.anchor.z, chain.anchor.y + 0.5)
      if (surface === null) { chain.locked = false; continue }
      chain.anchor.y = surface + chain.sole * scale.y
      target.copy(chain.anchor)
      chain.hip.getWorldPosition(a)
      chain.knee.getWorldPosition(b)
      chain.foot.getWorldPosition(c)
      const upper = a.distanceTo(b), lower = b.distanceTo(c)
      const reach = upper + lower
      const distance = Math.max(0.001, Math.min(reach * 0.985, a.distanceTo(target)))
      direction.copy(target).sub(a).normalize()
      target.copy(a).addScaledVector(direction, distance)
      // Keep knees pointing in the character's forward anatomical direction.
      forward.set(Math.sin(state.facing), 0, -Math.cos(state.facing))
      bend.copy(forward).addScaledVector(direction, -forward.dot(direction)).normalize()
      const along = (upper * upper + distance * distance - lower * lower) / (2 * distance)
      const lift = Math.sqrt(Math.max(0, upper * upper - along * along))
      kneeTarget.copy(a).addScaledVector(direction, along).addScaledVector(bend, lift)
      chain.foot.getWorldQuaternion(footQ)
      aim(chain.hip, chain.knee, kneeTarget)
      aim(chain.knee, chain.foot, target)
      chain.foot.parent!.getWorldQuaternion(parentQ).invert()
      chain.foot.quaternion.copy(parentQ.multiply(footQ))
      chain.foot.updateWorldMatrix(false, true)
    }
  }
  reset() { this.chains.forEach((chain) => { chain.locked = false; chain.deck = null }) }
  snapshot() {
    return this.chains.map((chain) => ({ name: chain.foot.name, locked: chain.locked,
      position: chain.foot.getWorldPosition(new Vector3()).toArray(), anchor: chain.anchor.toArray(),
      error: chain.foot.getWorldPosition(new Vector3()).distanceTo(chain.anchor),
    }))
  }
}
