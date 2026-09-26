import { useEffect, useMemo } from 'react'
import { BoxGeometry, CatmullRomCurve3, Color, Euler, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, TubeGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash } from '../environment/t02r/terrain'
import { BRIDGES, ISLANDS } from '../sites'
import type { BridgeSite } from '../sites'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { islandRim } from './rockLayout'
import { LAYOUT } from '../worldLayout'

/**
 * Hanging plank bridges to the bridged islands. Planks, posts, cross-beams and hanger cords are one
 * instanced box (instance colour picks wood or cord); the long ropes are one merged tube mesh.
 * The deck top follows exactly the walkable span curve registered by Landmarks.
 */

interface BoxPart { at: Vector3; yaw: number; pitch: number; roll: number; size: [number, number, number]; color: Color }

const WOOD = [new Color('#766b5e'), new Color('#665b4f'), new Color('#82766a'), new Color('#5a5046')]
const LACQUER = new Color('#6e2a22'), CORD = new Color('#3f3326')

export function deckY(b: BridgeSite, t: number) {
  return b.from[1] + (b.to[1] - b.from[1]) * t - b.sag * 4 * t * (1 - t)
}

function bridgeFrame(b: BridgeSite) {
  const dx = b.to[0] - b.from[0], dz = b.to[2] - b.from[2], len = Math.hypot(dx, dz)
  const isle = ISLANDS.find((i) => i.id === b.island)
  const along = (t: number, side: number, lift: number) => new Vector3(
    b.from[0] + dx * t - (dz / len) * side, deckY(b, t) + lift, b.from[2] + dz * t + (dx / len) * side)
  /** Parameter where the deck crosses a circle of radius `rho` around the island centre. */
  const tAtIsland = (rho: number) => {
    let t = 1
    while (t > 0 && isle && Math.hypot(b.from[0] + dx * t - isle.top[0], b.from[2] + dz * t - isle.top[2]) < rho) t -= 0.0005
    return t
  }
  // Deck leaves the platform at its side edge.
  const edgeX = LAYOUT.platform.width / 2
  const t0 = Math.abs(dx) > 1e-6 ? Math.max(0, (Math.sign(dx) * edgeX - b.from[0]) / dx) : 0
  return { dx, dz, len, isle, along, tAtIsland, t0, yaw: Math.atan2(-dz, dx) }
}

function bridgeParts(b: BridgeSite, k: number) {
  const parts: BoxPart[] = [], ropes: Vector3[][] = []
  const { len, isle, along, tAtIsland, t0, yaw } = bridgeFrame(b)
  const t1 = tAtIsland((isle?.padRadius ?? 0) + 0.6)
  const tRim = isle ? tAtIsland(islandRim(isle, Math.atan2(b.from[2] - isle.top[2], b.from[0] - isle.top[0]), b.halfWidth + 0.3) - 1.4) : 1
  const slope = (t: number) => Math.atan(((b.to[1] - b.from[1]) - b.sag * 4 * (1 - 2 * t)) / len)
  const w = b.halfWidth
  // Planks every 0.52 m with a little yaw / roll / height jitter; every sixth rests on a cross-beam.
  const count = Math.floor((t1 - t0) * len / 0.52)
  for (let i = 0; i <= count; i++) {
    const t = t0 + (t1 - t0) * (i / count), j = (n: number) => hash(i, k * 7 + n, 650) - 0.5
    const worn = hash(i, k, 651) < 0.06
    parts.push({ at: along(t, j(1) * 0.12, -0.05 + j(2) * 0.025), yaw: yaw + j(3) * 0.05, pitch: slope(t), roll: j(4) * 0.035,
      size: [0.4 + j(5) * 0.06, 0.1, 2 * w + 0.3 - (worn ? 0.5 : 0) + j(6) * 0.15], color: WOOD[Math.floor(hash(i, k, 652) * 4)] })
    if (i % 6 === 3) parts.push({ at: along(t, 0, -0.2), yaw, pitch: slope(t), roll: 0, size: [0.22, 0.16, 2 * w + 0.9], color: WOOD[3] })
  }
  // Lacquered anchor posts at both heads; ropes tie off at their tops.
  const posts = [t0 - 0.9 / len, tRim]
  for (const t of posts) for (const side of [-1, 1]) {
    const base = t === posts[0] ? LAYOUT.platform.height : deckY(b, t) - 0.9
    const top = deckY(b, t) + 1.55
    const at = along(t, side * (w + 0.28), 0); at.y = (base + top) / 2
    parts.push({ at, yaw, pitch: 0, roll: 0, size: [0.34, top - base, 0.34], color: LACQUER })
    parts.push({ at: new Vector3(at.x, top + 0.09, at.z), yaw, pitch: 0, roll: 0, size: [0.46, 0.18, 0.46], color: WOOD[3] })
  }
  // Ropes: a handrail and a mid rope each side (sagging a touch more than the deck), plus deck-edge cables.
  const sample = (side: number, lift: (t: number) => number, from: number, to: number) =>
    Array.from({ length: 41 }, (_, n) => { const t = from + (to - from) * n / 40; return along(t, side, lift(t)) })
  for (const side of [-1, 1]) {
    const s = side * (w + 0.28), extra = (t: number) => { const u = (t - posts[0]) / (posts[1] - posts[0]); return -0.35 * 4 * u * (1 - u) }
    ropes.push(sample(s, (t) => 1.45 + extra(t), posts[0], posts[1]))
    ropes.push(sample(s, (t) => 0.75 + extra(t) * 0.6, posts[0], posts[1]))
    ropes.push(sample(side * (w + 0.1), () => -0.14, t0, t1))
    // Hanger cords from the deck edge up to the handrail every ~1.6 m.
    const hangers = Math.floor((posts[1] - posts[0]) * len / 1.6)
    for (let n = 1; n < hangers; n++) {
      const t = posts[0] + (posts[1] - posts[0]) * n / hangers, h = 1.45 + extra(t) + 0.12
      const at = along(t, s, h / 2 - 0.12)
      parts.push({ at, yaw, pitch: 0, roll: 0, size: [0.035, h, 0.035], color: CORD })
    }
  }
  return { parts, ropes }
}

export function Bridges() {
  const { planks, ropes } = useMemo(() => {
    const parts: BoxPart[] = [], ropeLines: Vector3[][] = []
    BRIDGES.forEach((b, k) => { const built = bridgeParts(b, k); parts.push(...built.parts); ropeLines.push(...built.ropes) })
    const plankMaterial = withSurfaceWeather(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.82 }))
    const planks = new InstancedMesh(new BoxGeometry(1, 1, 1), plankMaterial, parts.length)
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(0, 0, 0, 'YZX'), s = new Vector3()
    parts.forEach((part, i) => {
      planks.setMatrixAt(i, m.compose(part.at, q.setFromEuler(e.set(part.roll, part.yaw, part.pitch, 'YZX')), s.set(...part.size)))
      planks.setColorAt(i, part.color)
    })
    planks.computeBoundingSphere()
    const tubes = ropeLines.map((line) => new TubeGeometry(new CatmullRomCurve3(line), 80, 0.045, 5))
    const ropeMaterial = withSurfaceWeather(new MeshStandardMaterial({ color: '#4a3c2c', roughness: 0.95 }))
    const ropes = new Mesh(mergeGeometries(tubes), ropeMaterial)
    tubes.forEach((g) => g.dispose())
    ropes.userData.castShadow = false
    return { planks, ropes }
  }, [])
  useEffect(() => () => {
    for (const mesh of [planks, ropes]) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose() }
    planks.dispose()
  }, [planks, ropes])
  return <><primitive object={planks} /><primitive object={ropes} /></>
}
