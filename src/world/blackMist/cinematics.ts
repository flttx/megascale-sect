import { CatmullRomCurve3, MathUtils, Vector3, type Object3D, type PerspectiveCamera } from 'three'
import { blackMistRuntime } from './runtime'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
interface Shot {
  id: string
  start: number
  end: number
  eye: CatmullRomCurve3
  aim: CatmullRomCurve3
  fov: number
  carrier?: string
}
const shot = (
  id: string,
  start: number,
  end: number,
  eye: Vector3[],
  aim: Vector3[],
  fov: number,
  carrier?: string,
): Shot => ({
  id,
  start,
  end,
  eye: new CatmullRomCurve3(eye, false, 'centripetal'),
  aim: new CatmullRomCurve3(aim, false, 'centripetal'),
  fov,
  carrier,
})
// The creature shots follow the live carrier matrices; their paths, animation and walkable decks stay intact.
const SHOTS = [
  shot(
    'horizon',
    0,
    10,
    [v(-1050, 520, 1050), v(-840, 490, 880), v(-700, 430, 740)],
    [v(500, 380, -300), v(900, 470, -320), v(1400, 550, -300)],
    62,
  ),
  shot(
    'approach',
    10,
    26,
    [v(-480, 150, 550), v(-430, 190, 340), v(-520, 265, 160)],
    [v(800, 400, -220), v(420, 350, -310), v(80, 280, -320)],
    66,
  ),
  shot(
    'impact',
    26,
    34,
    [v(-770, 330, 340), v(-730, 390, 60), v(-630, 410, -150)],
    [v(200, 300, -300), v(30, 380, -350), v(0, 460, -430)],
    70,
  ),
  shot(
    'watcher-apparition',
    34,
    37,
    [v(-0.4, 1.13, 1.55), v(-0.28, 1.1, 1.4), v(-0.16, 1.05, 1.3)],
    [v(0, 0.68, 0.03), v(0, 0.71, 0.03), v(0, 0.73, 0.03)],
    60,
    'HorrorCreature_watcher',
  ),
  shot(
    'behemoth-apparition',
    37,
    40,
    [v(0.4, 1.9, 1.45), v(0.28, 1.85, 1.3), v(0.16, 1.8, 1.15)],
    [v(0, 0.68, 0.03), v(0, 0.71, 0.03), v(0, 0.73, 0.03)],
    60,
    'HorrorCreature_behemoth',
  ),
  shot(
    'kun-mutation',
    40,
    46,
    [v(225, 80, 170), v(185, 55, 145), v(150, 42, 140)],
    [v(0, 8, 20), v(0, 10, 48), v(0, 10, 70)],
    58,
    'Colossus_kun',
  ),
  shot(
    'turtle-mutation',
    46,
    51,
    [v(240, 170, 240), v(205, 145, 185), v(160, 132, 155)],
    [v(0, 80, 25), v(0, 76, 55), v(0, 72, 85)],
    62,
    'Colossus_turtle',
  ),
  shot(
    'eye-reveal',
    51,
    58,
    [v(-620, 410, -60), v(-490, 530, 170), v(-210, 580, 450)],
    [v(0, 440, -390), v(0, 545, -430), v(0, 540, -410)],
    58,
  ),
  shot(
    'altered-sect',
    58,
    68,
    [v(-300, 350, 470), v(-170, 190, 290), v(0, 54, -30)],
    [v(0, 320, -320), v(0, 240, -320), v(0, 95, -290)],
    66,
  ),
]
const eye = new Vector3(),
  aim = new Vector3(),
  frozenPosition = new Vector3()
let lastSerial = -1,
  lastElapsed = -1,
  lastCamera = '',
  shotId = 'horizon'
let frozenFov = 62
export const blackMistCameraSnapshot = () => ({ id: shotId, eye: eye.toArray(), aim: aim.toArray() })
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
function applyFrozenCamera(camera: PerspectiveCamera) {
  camera.position.copy(frozenPosition)
  camera.up.set(0, 1, 0)
  camera.lookAt(aim)
  if (camera.fov !== frozenFov) {
    camera.fov = frozenFov
    camera.updateProjectionMatrix()
  }
}
export function updateBlackMistCamera(camera: PerspectiveCamera, scene: Object3D) {
  const r = blackMistRuntime
  if (!r.active || !r.cinematic) return
  // A settings/loading pause must also freeze a shot following a moving beast.
  if (r.paused && r.serial === lastSerial && r.elapsed === lastElapsed && camera.uuid === lastCamera) {
    // Recovery may still have the player camera active; retain the frozen shot after its frame writes.
    applyFrozenCamera(camera)
    return
  }
  const s = SHOTS.find((candidate) => r.elapsed < candidate.end) ?? SHOTS[SHOTS.length - 1]
  const t = MathUtils.clamp((r.elapsed - s.start) / (s.end - s.start), 0, 1)
  const ease = t * t * (3 - 2 * t)
  s.eye.getPoint(ease, eye)
  s.aim.getPoint(ease, aim)
  if (s.carrier) {
    const carrier = scene.getObjectByName(s.carrier)
    if (carrier && (s.carrier !== 'Colossus_kun' || carrier.position.y > -40)) {
      eye.applyMatrix4(carrier.matrixWorld)
      aim.applyMatrix4(carrier.matrixWorld)
    } else {
      // A replay can meet the Kun during its submerged leg. Keep that reveal above the clouds,
      // without relocating the carrier or breaking the rider's surface anchor.
      eye.set(-490, 530, 170)
      aim.set(0, 510, -430)
    }
  }
  lastSerial = r.serial
  lastElapsed = r.elapsed
  lastCamera = camera.uuid
  shotId = s.id
  const reduced = reducedMotion.matches
  const impact = reduced
    ? 0
    : Math.exp(-Math.abs(r.elapsed - 29) * 1.8) * 1.2 + Math.exp(-Math.abs(r.elapsed - 35) * 2) * 0.5
  frozenPosition.copy(eye)
  frozenPosition.x += Math.sin(r.elapsed * 18) * impact
  frozenPosition.y += Math.cos(r.elapsed * 23) * impact * 0.45
  frozenFov = s.fov
  applyFrozenCamera(camera)
}
