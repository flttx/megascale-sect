import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerObjectColliders } from '../meshColliders'
import { registerWalkables } from '../surfaces'
import type { WalkableSpan } from '../surfaces'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { DRAGON_MESA, worldTerrainHeight } from './regions'
import { hash } from '../environment/t02r/terrain'

/**
 * 栈道: a plank walkway pinned to the dragon mesa's cliff. It leaves the terrace at its south-eastern lip and winds
 * round the face, falling 1 in 8, to a lookout platform hung over the drop short of the dragon spine's flank. Each point sits where the cliff reaches
 * the deck's height, so the inner edge always meets rock. Planks on cantilevered beams, outer posts and a rail
 * rope; the deck is walkable span by span, posts and rope hold the walker on it.
 */
const STEP = 4
const HALF_WIDTH = 1.25
const GRADE = 1 / 8
const ARC = { from: -0.15, to: 1.25 } // radians about the mesa centre, +x toward +z
/** Most the deck's distance from the face may change per station (m). */
const SWING = 1.5

/**
 * Radius of the cliff face at height `y` along `angle`: the outermost point where rock stands above the deck,
 * searched from outside in (the terrace top undulates, so the first drop from the centre is not the face).
 */
function cliffRadius(angle: number, y: number) {
  const { x, z, radius } = DRAGON_MESA
  const above = (r: number) => worldTerrainHeight(x + Math.cos(angle) * r, z + Math.sin(angle) * r) > y
  let r = radius * 1.6
  while (r > radius * 0.6 && !above(r)) r -= 2
  let lo = r,
    hi = r + 2
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (above(mid)) lo = mid
    else hi = mid
  }
  return hi
}

/** Deck centre line from the terrace lip down round the face. */
export function plankwayPath() {
  const stations: { angle: number; y: number; r: number }[] = []
  let y = DRAGON_MESA.top - 0.35,
    angle = ARC.from
  while (angle < ARC.to) {
    // Clear of the rock across the whole board and the chord to the next station, with a little air under it.
    const span = STEP / (DRAGON_MESA.radius * 1.2)
    const face = Math.max(...[-0.5, 0, 0.5, 1].map((f) => cliffRadius(angle + span * f, y + 0.3)))
    const r = face + HALF_WIDTH + 0.4
    // The dragon spine's flank comes round the south side: the walkway ends at its lookout before the ridge.
    const x = DRAGON_MESA.x + Math.cos(angle) * r,
      z = DRAGON_MESA.z + Math.sin(angle) * r
    // The first stations leave the terrace lip itself, level with its ground.
    if (stations.length > 3 && (face > DRAGON_MESA.radius * 1.55 || worldTerrainHeight(x, z) > y - 0.5)) break
    stations.push({ angle, y, r })
    angle += STEP / r
    y -= STEP * GRADE
  }
  // Swing out gradually ahead of a spur (and back after it): the deck never enters rock and never jumps.
  for (let i = 1; i < stations.length; i++) stations[i].r = Math.max(stations[i].r, stations[i - 1].r - SWING)
  for (let i = stations.length - 2; i >= 0; i--) stations[i].r = Math.max(stations[i].r, stations[i + 1].r - SWING)
  return stations.map(
    ({ angle, y, r }) => new Vector3(DRAGON_MESA.x + Math.cos(angle) * r, y, DRAGON_MESA.z + Math.sin(angle) * r),
  )
}

function tinted(geometry: BufferGeometry, color: Color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const count = g.getAttribute('position').count,
    data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) data.set([color.r, color.g, color.b], i * 3)
  g.setAttribute('color', new BufferAttribute(data, 3))
  if (g !== geometry) geometry.dispose()
  return g
}

function buildPlankway() {
  const points = plankwayPath()
  if (points.length < 2) return { meshes: [], walkables: [] }
  const wood = new Color('#5b3f2a'),
    beam = new Color('#3e2b1e'),
    rope = new Color('#8a7356')
  const deck: BufferGeometry[] = [],
    rail: BufferGeometry[] = [],
    walkables: WalkableSpan[] = []
  const up = new Vector3(0, 1, 0),
    q = new Quaternion(),
    along = new Vector3(),
    out = new Vector3(),
    mid = new Vector3()
  const place = (geometry: BufferGeometry, at: Vector3, direction: Vector3) => {
    q.setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize())
    return geometry.applyQuaternion(q).translate(at.x, at.y, at.z)
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1]
    along.subVectors(b, a)
    const length = along.length()
    mid.addVectors(a, b).multiplyScalar(0.5)
    // Outward: horizontal, perpendicular to the run, away from the mesa centre.
    out.set(along.z, 0, -along.x).normalize()
    if (out.x * (mid.x - DRAGON_MESA.x) + out.z * (mid.z - DRAGON_MESA.z) < 0) out.negate()
    // Boards across the run, 0.5 m wide with hairline gaps, each a slightly different plank.
    const boards = Math.max(1, Math.round(length / 0.5))
    for (let k = 0; k < boards; k++) {
      const at = a
        .clone()
        .lerp(b, (k + 0.5) / boards)
        .addScaledVector(up, -0.11)
      const tone = wood.clone().multiplyScalar(0.82 + hash(i, k, 951) * 0.32)
      deck.push(tinted(place(new BoxGeometry(HALF_WIDTH * 2, 0.22, length / boards - 0.04), at, along), tone))
    }
    walkables.push({ kind: 'span', from: a.toArray(), to: b.toArray(), halfWidth: HALF_WIDTH, sag: 0 })
    if (i % 2 === 0) {
      // A beam driven into the rock under the deck, and a strut from the face to its outer end.
      const beamAt = a.clone().addScaledVector(up, -0.4)
      deck.push(
        tinted(
          place(new BoxGeometry(0.28, 0.28, HALF_WIDTH * 2 + 1.6), beamAt.clone().addScaledVector(out, -0.4), out),
          beam,
        ),
      )
      const foot = a
          .clone()
          .addScaledVector(out, -HALF_WIDTH - 0.4)
          .addScaledVector(up, -2.6),
        tip = a.clone().addScaledVector(out, HALF_WIDTH).addScaledVector(up, -0.5)
      const strut = tip.clone().sub(foot)
      deck.push(
        tinted(
          place(new BoxGeometry(0.2, 0.2, strut.length()), foot.clone().add(tip).multiplyScalar(0.5), strut),
          beam,
        ),
      )
    }
    // Outer post and the rope to the next one.
    const post = a.clone().addScaledVector(out, HALF_WIDTH - 0.12)
    rail.push(tinted(new CylinderGeometry(0.09, 0.11, 1.25, 6).translate(post.x, post.y + 0.62, post.z), beam))
    const next = b.clone().addScaledVector(out, HALF_WIDTH - 0.12)
    for (const h of [0.6, 1.1]) {
      const run = next.clone().sub(post)
      rail.push(
        tinted(
          place(
            new CylinderGeometry(0.035, 0.035, run.length(), 4).rotateX(Math.PI / 2),
            post
              .clone()
              .add(next)
              .multiplyScalar(0.5)
              .setY((post.y + next.y) / 2 + h),
            run,
          ),
          rope,
        ),
      )
    }
  }
  // Lookout at the low end: a wider platform on the last point.
  const end = points[points.length - 1]
  deck.push(tinted(new BoxGeometry(6, 0.3, 6).translate(end.x, end.y - 0.15, end.z), wood))
  walkables.push({ kind: 'span', from: [end.x, end.y, end.z - 3], to: [end.x, end.y, end.z + 3], halfWidth: 3, sag: 0 })
  const material = withSurfaceWeather(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }))
  const meshes = [new Mesh(mergeGeometries(deck), material), new Mesh(mergeGeometries(rail), material)]
  for (const parts of [deck, rail]) parts.forEach((g) => g.dispose())
  meshes[0].name = 'Plankway_Deck'
  meshes[1].name = 'Plankway_Rail'
  return { meshes, walkables }
}

export function Plankway() {
  const { meshes, walkables } = useMemo(buildPlankway, [])
  useEffect(() => {
    const off = [registerWalkables(walkables), ...meshes.map(registerObjectColliders)]
    return () => {
      off.forEach((unregister) => unregister())
      meshes.forEach((mesh) => mesh.geometry.dispose())
      ;(meshes[0]?.material as MeshStandardMaterial | undefined)?.dispose()
    }
  }, [meshes, walkables])
  return (
    <group name="Plankway">
      {meshes.map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </group>
  )
}
