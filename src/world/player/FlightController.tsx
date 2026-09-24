import { Vector3 } from 'three'
import { insideMainCollider, LAYOUT } from '../worldLayout'
import { insideAnyCollider } from '../surfaces'

const blocked = (x: number, y: number, z: number) => insideMainCollider(x, y, z) || insideAnyCollider(x, y, z)
const forward = new Vector3(), right = new Vector3(), desired = new Vector3()

export function stepFlight(
  position: Vector3, velocity: Vector3, input: Vector3,
  yaw: number, pitch: number, boosting: boolean, delta: number, braking = false,
) {
  forward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  right.set(Math.cos(yaw), 0, Math.sin(yaw))
  desired.copy(forward).multiplyScalar(-input.z).addScaledVector(right, input.x)
  desired.y += input.y
  if (desired.lengthSq() > 1) desired.normalize()
  desired.multiplyScalar(braking ? 0 : boosting ? LAYOUT.player.flightBoostSpeed : LAYOUT.player.flightSpeed)
  const slowing = desired.lengthSq() < velocity.lengthSq() || desired.dot(velocity) < 0
  const response = braking ? 12 : input.lengthSq() === 0 ? 5.5 : slowing ? 4.5 : boosting ? 1.8 : 3.2
  const blend = 1 - Math.exp(-response * delta)
  velocity.lerp(desired, blend)
  if (desired.lengthSq() === 0 && velocity.lengthSq() < 0.0025) velocity.set(0, 0, 0)
  const nextX = position.x + velocity.x * delta
  const nextY = position.y + velocity.y * delta
  const nextZ = position.z + velocity.z * delta
  if (!blocked(nextX, position.y, position.z)) position.x = nextX
  else velocity.x = 0
  if (!blocked(position.x, position.y, nextZ)) position.z = nextZ
  else velocity.z = 0
  if (!blocked(position.x, nextY, position.z)) position.y = nextY
  else velocity.y = 0
  position.x = Math.max(-LAYOUT.worldLimit, Math.min(LAYOUT.worldLimit, position.x))
  position.y = Math.max(-50, Math.min(1100, position.y))
  position.z = Math.max(-LAYOUT.worldLimit, Math.min(LAYOUT.worldLimit, position.z))
}
