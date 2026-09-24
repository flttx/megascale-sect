import { PerspectiveCamera, Vector3 } from 'three'
import type { Mode } from '../store'
import { groundHeight, LAYOUT } from '../worldLayout'

const desired = new Vector3()
const lookAt = new Vector3()
const anchor = new Vector3()

function keepCameraOutsideBuilding(position: Vector3, focus: Vector3) {
  const box = LAYOUT.mainCollider, main = LAYOUT.main.position
  const min = [main[0] - box.halfWidth, box.minY - 1, main[2] - box.halfDepth]
  const max = [main[0] + box.halfWidth, box.maxY + 1, main[2] + box.halfDepth]
  let near = 0, far = 1
  for (let axis = 0; axis < 3; axis++) {
    const origin = focus.getComponent(axis), delta = position.getComponent(axis) - origin
    if (Math.abs(delta) < 1e-6) { if (origin < min[axis] || origin > max[axis]) return; continue }
    const a = (min[axis] - origin) / delta, b = (max[axis] - origin) / delta
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b))
    if (near > far) return
  }
  if (near > 0 && near < 1) position.lerpVectors(focus, position, Math.max(0, near - 0.035))
}

export function CameraRig({ camera }: { camera: PerspectiveCamera }) {
  return <group name="cameraRig"><primitive object={camera} name="camera" /></group>
}

export function updateCameraRig(
  camera: PerspectiveCamera, player: Vector3, yaw: number, pitch: number,
  mode: Mode, delta: number, speed = 0, bank = 0, impact = 0, baseFov = 72,
) {
  const forwardX = Math.sin(yaw)
  const forwardZ = -Math.cos(yaw)
  // Follow translation directly, then damp only the relative orbit/zoom offset.
  // Otherwise a 70 m/s player would outrun a conventional lerped chase camera.
  const previous = camera.userData.followPrevious as Vector3 | undefined
  if (previous) camera.position.addScaledVector(player, 1).sub(previous)
  else camera.userData.followPrevious = player.clone()
  ;(camera.userData.followPrevious as Vector3).copy(player)
  const speedMix = mode === 'FLIGHT' ? Math.min(1, speed / 70) : 0
  const distance = mode === 'FLIGHT' ? 5.8 + speedMix * 1.1 : 4.8
  const height = mode === 'FLIGHT' ? 3 : 2.75
  desired.set(player.x - forwardX * distance, player.y + height, player.z - forwardZ * distance)
  desired.y += impact * 0.045
  anchor.copy(player).y += 1.1
  keepCameraOutsideBuilding(desired, anchor)
  const surface = groundHeight(desired.x, desired.z, player.y + 2)
  if (surface !== null) desired.y = Math.max(surface + 0.35, desired.y)
  camera.position.lerp(desired, 1 - Math.exp(-(mode === 'FLIGHT' ? 7 : 11) * delta))
  keepCameraOutsideBuilding(camera.position, anchor)
  const cameraSurface = groundHeight(camera.position.x, camera.position.z, player.y + 2)
  if (cameraSurface !== null) camera.position.y = Math.max(cameraSurface + 0.35, camera.position.y)
  lookAt.set(
    player.x + forwardX * 3,
    player.y + 1.05 + Math.tan(pitch) * 7,
    player.z + forwardZ * 3,
  )
  camera.lookAt(lookAt)
  camera.rotateZ(-bank * 0.075)
  const fov = baseFov + speedMix * 8
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * delta))
  camera.updateProjectionMatrix()
}
