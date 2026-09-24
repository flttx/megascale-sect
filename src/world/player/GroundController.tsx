import { Vector3 } from 'three'
import { groundHeight, LAYOUT } from '../worldLayout'

export function stepGround(
  position: Vector3, velocity: Vector3, input: Vector3, yaw: number,
  running: boolean, delta: number,
) {
  const speed = running ? LAYOUT.player.runSpeed : LAYOUT.player.walkSpeed
  const forward = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
  const right = new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
  const desired = forward.multiplyScalar(-input.z).add(right.multiplyScalar(input.x))
  if (desired.lengthSq() > 1) desired.normalize()
  desired.multiplyScalar(speed)
  const blend = 1 - Math.exp(-12 * delta)
  velocity.x += (desired.x - velocity.x) * blend
  velocity.z += (desired.z - velocity.z) * blend
  if (desired.lengthSq() === 0 && Math.hypot(velocity.x, velocity.z) < 0.015) { velocity.x = 0; velocity.z = 0 }
  const nextX = position.x + velocity.x * delta
  const nextZ = position.z + velocity.z * delta
  if (groundHeight(nextX, nextZ, position.y) !== null) {
    position.x = nextX
    position.z = nextZ
  } else {
    velocity.x = 0
    velocity.z = 0
  }
  const surface = groundHeight(position.x, position.z, position.y) ?? 0
  if (position.y > surface + 0.04) {
    velocity.y -= LAYOUT.player.gravity * delta
    position.y = Math.max(surface, position.y + velocity.y * delta)
  } else {
    velocity.y = 0
    position.y = surface
  }
}
