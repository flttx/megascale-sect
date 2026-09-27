import { useEffect, useMemo } from 'react'
import { BufferAttribute, CatmullRomCurve3, Color, CylinderGeometry, Matrix4, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash } from '../environment/t02r/terrain'
import { ISLANDS, PILLARS } from '../sites'
import type { CylinderCollider } from '../surfaces'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { islandLip, PILLAR_PLACEMENTS, pillarColliders } from './rockLayout'

/**
 * The iron chains that moor 锁云屿 (and any isle with `chains`) to the pillars around it: from an iron bollard
 * just inside the isle's lip, nearly taut, down to a collared socket in the face of each pillar a little below
 * its top. Every link, collar and bollard is one merged mesh (vertex colour picks iron or rust).
 */

/** Link: outer length and width and bar radius; consecutive links interlock about one inner length apart. */
const LINK_LENGTH = 6.4, LINK_WIDTH = 3.8, BAR = 0.5, PITCH = LINK_LENGTH - 4 * BAR
/** The pull of the isle keeps them nearly taut: mid-span sag per metre of span. */
const SAG = 0.015
/** A socket is cut where a pillar first spans this many metres below its top; bollards stand this far inside the isle's lip. */
const SOCKET_SPAN = 18, BOLLARD_IN = 4.5, BOLLARD_RADIUS = 1.9, BOLLARD_HEIGHT = 7
const IRON = ['#45403b', '#36322f', '#4d4640', '#6a4430', '#5b3d2b'].map((c) => new Color(c))
const UP = new Vector3(0, 1, 0)

/**
 * Where to cut a pillar's socket: the highest cross-section (its colliders' circles there) at least SOCKET_SPAN
 * across within 60 m of the top, and its centre. The tops lean and taper, so it is rarely over the site's axis.
 */
function socketSection(index: number) {
  const circles = pillarColliders(PILLAR_PLACEMENTS[index], index), top = PILLARS[index].topY
  let found = { y: top, x: PILLARS[index].x, z: PILLARS[index].z, section: [] as CylinderCollider[] }
  for (let y = top - 8; y >= top - 60; y -= 2) {
    const section = circles.filter((c) => y >= c.minY && y <= c.maxY)
    if (!section.length) continue
    const weight = section.reduce((sum, c) => sum + c.radius ** 2, 0)
    const x = section.reduce((sum, c) => sum + c.x * c.radius ** 2, 0) / weight, z = section.reduce((sum, c) => sum + c.z * c.radius ** 2, 0) / weight
    found = { y, x, z, section }
    if (2 * Math.max(...section.map((c) => Math.hypot(c.x - x, c.z - z) + c.radius)) >= SOCKET_SPAN) break
  }
  return found
}

/** How far a cross-section reaches from (x, z) along the unit direction (dx, dz): the farthest circle crossing. */
function reach(section: CylinderCollider[], x: number, z: number, dx: number, dz: number) {
  let out = 0
  for (const c of section) {
    const ox = x - c.x, oz = z - c.z, b = ox * dx + oz * dz, disc = b * b - (ox * ox + oz * oz - c.radius * c.radius)
    if (disc >= 0) out = Math.max(out, -b + Math.sqrt(disc))
  }
  return out
}

interface ChainRun {
  /** Where the chain leaves the bollard and where it ends inside the pillar. */
  from: Vector3; to: Vector3
  sag: number
  /** Foot of the bollard; the collar round the chain where it enters the pillar. */
  bollard: Vector3; collar: Vector3
}

export function chainRuns(): ChainRun[] {
  const out: ChainRun[] = []
  for (const isle of ISLANDS) for (const id of isle.chains ?? []) {
    const index = PILLARS.findIndex((p) => p.id === id)
    if (index < 0) continue
    const s = socketSection(index), [ix, , iz] = isle.top
    const bearing = Math.atan2(s.z - iz, s.x - ix), dx = Math.cos(bearing), dz = Math.sin(bearing)
    const lip = islandLip(isle, bearing, BOLLARD_RADIUS), r = lip.radius - BOLLARD_IN
    const bollard = new Vector3(ix + dx * r, lip.y - 0.6, iz + dz * r)
    const from = new Vector3(bollard.x + dx * BOLLARD_RADIUS, bollard.y + BOLLARD_HEIGHT - 1.6, bollard.z + dz * BOLLARD_RADIUS)
    // The colliders are drawn in 5 % from the rock, so the face stands about a metre past their reach. The chain
    // runs straight through the collar (its sag there is ~0.2 m) and on 3.5 m into the rock.
    const face = reach(s.section, s.x, s.z, -dx, -dz)
    const collar = new Vector3(s.x - dx * (face + 1), s.y, s.z - dz * (face + 1))
    const to = collar.clone().sub(from).multiplyScalar(1 + 3.5 / from.distanceTo(collar)).add(from)
    out.push({ from, to, sag: SAG * from.distanceTo(to), bollard, collar })
  }
  return out
}

const pointAt = (run: ChainRun, t: number, out = new Vector3()) =>
  out.copy(run.from).lerp(run.to, t).addScaledVector(UP, -run.sag * 4 * t * (1 - t))

/** Flight colliders: the bollards, and each chain as a string of short vertical cylinders (open: walking and the camera pass). */
export function chainColliders(): CylinderCollider[] {
  const out: CylinderCollider[] = [], a = new Vector3(), b = new Vector3()
  for (const run of chainRuns()) {
    out.push({ kind: 'cylinder', x: run.bollard.x, z: run.bollard.z, radius: BOLLARD_RADIUS * 1.4, minY: run.bollard.y, maxY: run.bollard.y + BOLLARD_HEIGHT + 1.8 })
    const n = Math.ceil(run.from.distanceTo(run.to) / 8)
    for (let k = 0; k < n; k++) {
      pointAt(run, k / n, a); pointAt(run, (k + 1) / n, b)
      out.push({ kind: 'cylinder', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, radius: Math.hypot(b.x - a.x, b.z - a.z) / 2 + LINK_WIDTH / 2 + 0.3,
        minY: Math.min(a.y, b.y) - LINK_WIDTH / 2, maxY: Math.max(a.y, b.y) + LINK_WIDTH / 2, open: true })
    }
  }
  return out
}

/** One oval link about +Z (its length), lying in the XZ plane. */
function linkGeometry() {
  const bend = LINK_WIDTH / 2 - BAR, straight = LINK_LENGTH / 2 - BAR - bend, points: Vector3[] = []
  for (const end of [1, -1]) {
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI
      points.push(new Vector3(end * bend * Math.cos(a), 0, end * (straight + bend * Math.sin(a))))
    }
  }
  return new TubeGeometry(new CatmullRomCurve3(points, true, 'centripetal'), 26, BAR, 7, true)
}

function painted<T extends BufferGeometry>(geometry: T, color: Color) {
  const count = geometry.getAttribute('position').count, data = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i += 3) { data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b }
  geometry.setAttribute('color', new BufferAttribute(data, 3))
  return geometry
}

function buildChains() {
  const link = linkGeometry(), parts: BufferGeometry[] = []
  const m = new Matrix4(), at = new Vector3(), ahead = new Vector3(), tangent = new Vector3(), width = new Vector3(), normal = new Vector3()
  const place = (geometry: BufferGeometry, color: Color) => parts.push(painted(geometry.applyMatrix4(m), color))
  chainRuns().forEach((run, c) => {
    const span = run.from.distanceTo(run.to), n = Math.max(2, Math.round(span / PITCH))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      pointAt(run, t, at); pointAt(run, Math.min(1, t + 0.002), ahead)
      tangent.subVectors(ahead, at).normalize()
      // Alternate links stand edge-on to their neighbours, each with a slight twist of its own.
      width.crossVectors(tangent, UP).normalize().applyAxisAngle(tangent, (k % 2) * Math.PI / 2 + (hash(k, c, 701) - 0.5) * 0.24)
      normal.crossVectors(tangent, width)
      m.makeBasis(width, normal, tangent).setPosition(at)
      place(link.clone(), IRON[Math.floor(hash(k, c, 702) * IRON.length)])
    }
    // Collar round the chain where it enters the pillar.
    tangent.subVectors(run.to, run.from).normalize()
    width.crossVectors(tangent, UP).normalize(); normal.crossVectors(tangent, width)
    m.makeBasis(width, normal, tangent).setPosition(run.collar)
    place(new TorusGeometry(LINK_WIDTH / 2 + 0.9, 0.9, 10, 28), IRON[1])
    // Bollard: a post flaring to its foot, a cap and knob, and a band where the chain is shackled.
    m.makeTranslation(run.bollard.x, run.bollard.y + BOLLARD_HEIGHT / 2, run.bollard.z)
    place(new CylinderGeometry(BOLLARD_RADIUS, BOLLARD_RADIUS * 1.4, BOLLARD_HEIGHT, 18), IRON[0])
    m.makeTranslation(run.bollard.x, run.bollard.y + BOLLARD_HEIGHT + 0.35, run.bollard.z)
    place(new CylinderGeometry(BOLLARD_RADIUS + 0.55, BOLLARD_RADIUS + 0.2, 0.7, 18), IRON[1])
    m.makeTranslation(run.bollard.x, run.bollard.y + BOLLARD_HEIGHT + 1.1, run.bollard.z)
    place(new SphereGeometry(BOLLARD_RADIUS * 0.7, 16, 10), IRON[2])
    m.makeRotationX(Math.PI / 2).setPosition(run.bollard.x, run.from.y, run.bollard.z)
    place(new TorusGeometry(BOLLARD_RADIUS + 0.1, 0.45, 8, 28), IRON[3])
  })
  link.dispose()
  if (!parts.length) return null
  const geometry = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  const material = withSurfaceWeather(new MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.58 })) as MeshStandardMaterial
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Chains'
  return mesh
}

export function Chains() {
  const mesh = useMemo(buildChains, [])
  useEffect(() => () => { mesh?.geometry.dispose(); (mesh?.material as MeshStandardMaterial | undefined)?.dispose() }, [mesh])
  return mesh && <primitive object={mesh} />
}
