import { CatmullRomCurve3, Vector3 } from 'three'
import type { Vec3 } from '../surfaces'

/**
 * 灵风 (R10c): tubes of moving air a flier can ride. A grand loop links the four regions around the core, four
 * spokes carry fliers out from the core's edges, and an updraft coils up the dragon pillar. Each flows one way along
 * its axis; its pull fades over the last fraction of the radius and over the first and last stretch of an open stream.
 */
export interface WindStreamSpec {
  id: string
  points: Vec3[]
  closed: boolean
  /** Flow radius (m) and the axial speed at the centre (m/s). */
  radius: number
  speed: number
}

const coil = (cx: number, cz: number, radius: number, from: number, to: number, y0: number, rise: number, steps: number): Vec3[] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const a = from + ((to - from) * k) / steps
    return [cx + Math.cos(a) * radius, y0 + (rise * k) / steps, cz + Math.sin(a) * radius] as const
  })

export const WIND_STREAMS: WindStreamSpec[] = [
  {
    // Clockwise seen from above: before the sage, past the dragon pillar, over the gate's approach, beside the sword tomb.
    id: 'loop', closed: true, radius: 40, speed: 55,
    points: [
      [-700, 430, -1820], [0, 420, -1760], [750, 440, -1860], [1350, 470, -1600], [1700, 500, -1050], [1720, 500, -420],
      [1650, 460, 250], [1350, 400, 900], [800, 360, 1420], [0, 360, 1600], [-800, 360, 1420], [-1350, 380, 900],
      [-1700, 420, 150], [-1780, 450, -650], [-1550, 440, -1350], [-1150, 430, -1700],
    ],
  },
  // Spokes: from the core's edges out to the loop, and the southern one on down through the sky gate.
  { id: 'north', closed: false, radius: 32, speed: 60, points: [[0, 300, -1150], [0, 350, -1400], [0, 390, -1640]] },
  { id: 'east', closed: false, radius: 32, speed: 60, points: [[1100, 300, -300], [1380, 380, -330], [1600, 450, -380]] },
  {
    id: 'south', closed: false, radius: 32, speed: 60,
    points: [[0, 220, 700], [0, 150, 1100], [0, 60, 1450], [0, 0, 1750], [0, -10, 2000], [0, 40, 2200], [0, 160, 2360]],
  },
  // Low along the longest sword cut, whose trench floor lies 180 m under the mesa.
  {
    id: 'west', closed: false, radius: 18, speed: 50,
    points: [[-1050, 200, 70], [-1300, 180, -45], [-1560, 150, -167], [-1760, 125, -260], [-1990, 60, -368], [-2230, 50, -480], [-2470, 55, -592], [-2700, 110, -700], [-2900, 170, -790]],
  },
  // An updraft round the dragon pillar: west, north, east, south, climbing to over its crown.
  { id: 'dragon', closed: false, radius: 36, speed: 50, points: coil(2204, -418, 290, Math.PI, Math.PI * 3.25, 460, 440, 10) },
]

/** Axis samples (m apart), and the stretch at each end of an open stream over which its pull ramps in and out. */
const STEP = 10, RAMP = 150

export interface WindStream extends WindStreamSpec {
  /** Axis positions, unit tangents and arc length (m) at each sample. */
  position: Float32Array
  tangent: Float32Array
  arc: Float32Array
  length: number
  /** Axis-aligned bounds grown by the radius, to skip far streams. */
  min: Vector3
  max: Vector3
}

function build(spec: WindStreamSpec): WindStream {
  const curve = new CatmullRomCurve3(spec.points.map((p) => new Vector3(...p)), spec.closed, 'centripetal')
  const length = curve.getLength()
  const count = Math.max(2, Math.ceil(length / STEP) + 1)
  const position = new Float32Array(count * 3), tangent = new Float32Array(count * 3), arc = new Float32Array(count)
  const p = new Vector3(), t = new Vector3()
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1)
    curve.getPointAt(u, p); curve.getTangentAt(u, t)
    p.toArray(position, i * 3); t.normalize().toArray(tangent, i * 3)
    arc[i] = u * length
    min.min(p); max.max(p)
  }
  min.subScalar(spec.radius); max.addScalar(spec.radius)
  return { ...spec, position, tangent, arc, length, min, max }
}

export const STREAMS: WindStream[] = WIND_STREAMS.map(build)

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t) }

/** How much of a stream's pull holds at arc length `s` (m): ramped in and out over the ends of an open stream. */
export const streamEnds = (stream: WindStream, s: number) => stream.closed ? 1 : smooth(0, RAMP, s) * (1 - smooth(stream.length - RAMP, stream.length, s))

/** Nearest axis point of one stream to `p`: its sample index, the distance and the offset from the axis. */
function nearest(stream: WindStream, p: Vector3, offset: Vector3) {
  const { position } = stream
  let best = 0, bestD = Infinity
  for (let i = 0, n = stream.arc.length; i < n; i++) {
    const dx = p.x - position[i * 3], dy = p.y - position[i * 3 + 1], dz = p.z - position[i * 3 + 2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestD) { bestD = d; best = i }
  }
  offset.set(p.x - position[best * 3], p.y - position[best * 3 + 1], p.z - position[best * 3 + 2])
  // Drop the along-axis part: the samples are 10 m apart, so this is the distance to the axis itself.
  const tx = stream.tangent[best * 3], ty = stream.tangent[best * 3 + 1], tz = stream.tangent[best * 3 + 2]
  const along = offset.x * tx + offset.y * ty + offset.z * tz
  offset.x -= tx * along; offset.y -= ty * along; offset.z -= tz * along
  return { index: best, distance: offset.length() }
}

/** Centre-line pull (m/s) at most, which keeps a rider in the tube without trapping one steering out of it. */
const PULL = 14
const offset = new Vector3()

/**
 * The air's velocity at `p` (written to `out`, m/s) and its strength 0…1: the axial flow of the strongest stream
 * there plus a gentle pull toward its axis. Zero outside every stream.
 */
export function windAt(p: Vector3, out: Vector3): number {
  out.set(0, 0, 0)
  let strength = 0
  for (const stream of STREAMS) {
    if (p.x < stream.min.x || p.x > stream.max.x || p.y < stream.min.y || p.y > stream.max.y || p.z < stream.min.z || p.z > stream.max.z) continue
    const { index, distance } = nearest(stream, p, offset)
    const r = stream.radius
    if (distance >= r) continue
    const ends = streamEnds(stream, stream.arc[index])
    const flow = (1 - smooth(r * 0.55, r, distance)) * ends
    if (flow <= strength) continue
    strength = flow
    const pull = distance > 1e-3 ? (-PULL * smooth(r * 0.1, r * 0.6, distance) * (1 - smooth(r * 0.85, r, distance)) * ends) / distance : 0
    out.set(stream.tangent[index * 3], stream.tangent[index * 3 + 1], stream.tangent[index * 3 + 2]).multiplyScalar(stream.speed * flow)
      .addScaledVector(offset, pull)
  }
  return strength
}
