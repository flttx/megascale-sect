import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three'
import type { BufferGeometry, Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerColliders } from '../surfaces'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { ARMILLARY } from './layout'
import { blackMistRuntime } from '../blackMist/runtime'

const R = ARMILLARY.radius,
  CORE = 6.5
/** The polar axis rises 35° above the northern (−z) horizon, as it would over the old capitals. */
const LATITUDE = (35 * Math.PI) / 180,
  ECLIPTIC = (23.4 * Math.PI) / 180
const POLE = new Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE))
/** Seconds per turn: the whole instrument, the 三辰仪 about the pole and the 四游仪 the other way. */
const TURN = 400,
  MIDDLE_TURN = 180,
  INNER_TURN = 75
const registerCore = () =>
  registerColliders([
    {
      kind: 'cylinder',
      x: ARMILLARY.position[0],
      z: ARMILLARY.position[2],
      radius: CORE + 2,
      minY: ARMILLARY.position[1] - CORE - 2,
      maxY: ARMILLARY.position[1] + CORE + 2,
    },
  ])

/**
 * Texture atlas, by v: polished gold (0 … 0.08) for the beads, engraved bronze graduations (0.1 … 0.5) run once
 * round each ring, and the rune band (0.52 … 1), the eight trigrams in gold, a quarter-turn per repeat. The glow
 * canvas has the same layout with only the trigrams lit.
 */
const W = 2048,
  H = 512
const TRIGRAMS = [
  [1, 1, 1],
  [1, 1, 0],
  [1, 0, 1],
  [1, 0, 0],
  [0, 1, 1],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, 0],
]
function atlas() {
  const color = document.createElement('canvas'),
    glow = document.createElement('canvas')
  color.width = glow.width = W
  color.height = glow.height = H
  const c = color.getContext('2d'),
    g = glow.getContext('2d')
  const y = (v: number) => (1 - v) * H
  if (c && g) {
    c.fillStyle = '#8a6434'
    c.fillRect(0, 0, W, H)
    g.fillStyle = '#000000'
    g.fillRect(0, 0, W, H)
    // Verdigris mottling over the bronze.
    for (let i = 0; i < 1600; i++) {
      c.fillStyle = `rgba(${60 + Math.random() * 30}, ${96 + Math.random() * 40}, ${78 + Math.random() * 20}, ${0.08 + Math.random() * 0.16})`
      c.beginPath()
      c.arc(Math.random() * W, y(0.1 + Math.random() * 0.9), 2 + Math.random() * 12, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = '#c9a052'
    c.fillRect(0, y(0.08), W, y(0) - y(0.08))
    // Graduations round the tube: every 5°, heavier every 30°.
    for (let k = 0; k < 72; k++) {
      const major = k % 6 === 0
      c.fillStyle = major ? '#e0bc6c' : 'rgba(214, 178, 104, 0.7)'
      c.fillRect((k / 72) * W - (major ? 4 : 1.5), y(0.5), major ? 8 : 3, y(0.1) - y(0.5))
    }
    // Rune band: gold rims, a trigram in each of eight cells and a lozenge between them.
    for (const ctx of [c, g]) {
      ctx.fillStyle = ctx === c ? '#d4ae62' : '#303030'
      ctx.fillRect(0, y(0.99), W, 10)
      ctx.fillRect(0, y(0.54), W, 10)
    }
    const cell = W / 8,
      top = y(0.92),
      bar = 30,
      gap = 22,
      span = 150
    TRIGRAMS.forEach((lines, k) => {
      const x0 = k * cell + (cell - span) / 2
      lines.forEach((solid, j) => {
        // Bottom line first, as the trigrams are read.
        const by = top + (2 - j) * (bar + gap)
        for (const ctx of [c, g]) {
          ctx.fillStyle = ctx === c ? '#e3c275' : '#ffffff'
          if (solid) ctx.fillRect(x0, by, span, bar)
          else {
            ctx.fillRect(x0, by, span / 2 - 14, bar)
            ctx.fillRect(x0 + span / 2 + 14, by, span / 2 - 14, bar)
          }
        }
      })
      for (const ctx of [c, g]) {
        ctx.fillStyle = ctx === c ? '#d4ae62' : '#7a7a7a'
        const cx = (k + 1) * cell,
          cy = top + 1.5 * bar + gap
        ctx.beginPath()
        ctx.moveTo(cx, cy - 22)
        ctx.lineTo(cx + 12, cy)
        ctx.lineTo(cx, cy + 22)
        ctx.lineTo(cx - 12, cy)
        ctx.fill()
      }
    })
  }
  return [color, glow].map((canvas) => {
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    texture.wrapS = RepeatWrapping
    texture.wrapT = ClampToEdgeWrapping
    return texture
  })
}

/** Maps a part's uv into one atlas region (v0 … v1), repeating u `repeat` times round it. */
function region<T extends BufferGeometry>(geometry: T, v0: number, v1: number, repeat = 1) {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat, v0 + uv.getY(i) * (v1 - v0))
  return geometry
}
const ring = (radius: number, tube: number) => region(new TorusGeometry(radius, tube, 12, 192), 0.1, 0.5)
const bead = (radius: number, at: Vector3) =>
  region(new SphereGeometry(radius, 12, 8), 0.02, 0.06, 0).translate(at.x, at.y, at.z)
/** The inner face of an open surface, so it can be drawn single-sided: rewound, normals and u mirrored. */
function inside<T extends BufferGeometry>(geometry: T) {
  const back = geometry.clone(),
    index = back.getIndex(),
    normal = back.getAttribute('normal'),
    uv = back.getAttribute('uv')
  if (index)
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i)
      index.setX(i, index.getX(i + 2))
      index.setX(i + 2, a)
    }
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i))
  for (let i = 0; i < uv.count; i++) uv.setX(i, -uv.getX(i))
  return back
}
/** A flat rune band (horizontal, about +Y) framed by a rim on each edge. */
function band(radius: number, height: number) {
  const face = region(new CylinderGeometry(radius, radius, height, 192, 1, true), 0.52, 1, 4)
  return [
    face,
    inside(face),
    ring(radius, 0.55)
      .rotateX(Math.PI / 2)
      .translate(0, height / 2, 0),
    ring(radius, 0.55)
      .rotateX(Math.PI / 2)
      .translate(0, -height / 2, 0),
  ]
}
function merged(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  return geometry
}

function buildArmillary() {
  const [map, emissiveMap] = atlas()
  const bronze = withSurfaceWeather(
    new MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new Color('#8fdcff'),
      emissiveIntensity: 2,
      metalness: 0.7,
      roughness: 0.38,
    }),
  ) as MeshStandardMaterial
  const tilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), POLE)

  // 六合仪, fixed: the horizon as the rune band, the meridian (the N–S vertical plane) and the polar axis.
  const axis = new CylinderGeometry(0.9, 0.9, 2 * R + 4, 10)
  region(axis, 0.1, 0.5).applyQuaternion(tilt)
  const outer = merged([
    ...band(R + 1, 6),
    ring(R, 1.6).rotateY(Math.PI / 2),
    axis,
    ...[1, -1].map((s) => bead(3, POLE.clone().multiplyScalar(s * R))),
    ...[
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([x, z]) => bead(2.4, new Vector3(x * (R + 1), 0, z * (R + 1)))),
  ])
  // 三辰仪, turning about the pole (+Y in its frame): the equator, the colure through the poles and the ecliptic band.
  const tipped = band(R - 7, 4).map((part) => part.rotateX(ECLIPTIC))
  const middle = merged([
    ring(R - 7, 1.2).rotateX(Math.PI / 2),
    ring(R - 7, 1.2).rotateY(Math.PI / 2),
    ...tipped,
    ...[
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([x, z]) => bead(2, new Vector3(x * (R - 7), 0, z * (R - 7)))),
  ])
  // 四游仪, turning the other way: a ring through the poles carrying the sighting tube.
  const inner = merged([
    ring(R - 15, 1.1).rotateY(Math.PI / 2),
    region(new CylinderGeometry(1.3, 1.3, 2 * (R - 16), 12), 0.1, 0.5).rotateX(0.62),
    ...[1, -1].map((s) => bead(1.8, new Vector3(0, s * (R - 16) * Math.cos(0.62), s * (R - 16) * Math.sin(0.62)))),
  ])
  const core = new MeshBasicMaterial({ color: new Color(1, 0.84, 0.55).multiplyScalar(6) })
  const meshes = {
    outer: new Mesh(outer, bronze),
    middle: new Mesh(middle, bronze),
    inner: new Mesh(inner, bronze),
    core: new Mesh(new SphereGeometry(CORE, 32, 20), core),
  }
  // The inner ring and the core are small at this height; their shadows would cost a cascade pass each.
  meshes.inner.userData.castShadow = false
  meshes.core.userData.castShadow = false
  const dispose = () => {
    Object.values(meshes).forEach((mesh) => mesh.geometry.dispose())
    map.dispose()
    emissiveMap.dispose()
    bronze.dispose()
    core.dispose()
  }
  return { meshes, bronze, tilt, dispose }
}

/**
 * 浑天仪: a bronze armillary sphere 120 m across floating over the hall roof, turning slowly. The fixed frame
 * carries the horizon as a band of glowing trigrams; inside it the 三辰仪 (equator, colure and ecliptic band)
 * turns about the pole and the 四游仪 with its sighting tube turns the other way round a burning core.
 */
export function Armillary() {
  const parts = useMemo(buildArmillary, [])
  useEffect(() => parts.dispose, [parts])
  const removeCollider = useRef<(() => void) | null>(null)
  useEffect(() => {
    removeCollider.current = registerCore()
    return () => {
      removeCollider.current?.()
      removeCollider.current = null
    }
  }, [])
  const root = useRef<Group>(null),
    middle = useRef<Group>(null),
    inner = useRef<Group>(null)
  const time = useRef(0)
  useFrame((_, delta) => {
    const t = (time.current += Math.min(delta, 0.1))
    if (!root.current || !middle.current || !inner.current) return
    // The mist consumes the old celestial instrument as its place is taken by the living eye.
    const consumed = blackMistRuntime.active ? MathUtils.smoothstep(blackMistRuntime.elapsed, 34, 43) : 0
    root.current.visible = consumed < 0.99
    if (consumed >= 0.99 && removeCollider.current) {
      removeCollider.current()
      removeCollider.current = null
    } else if (consumed < 0.99 && !removeCollider.current) removeCollider.current = registerCore()
    root.current.scale.setScalar(1 - consumed * 0.98)
    root.current.rotation.y = 0.5 + (t / TURN) * Math.PI * 2
    root.current.position.y = ARMILLARY.position[1] + Math.sin((t / 14) * Math.PI * 2) * 1.5
    middle.current.rotation.y = (t / MIDDLE_TURN) * Math.PI * 2
    inner.current.rotation.y = -(t / INNER_TURN) * Math.PI * 2
    parts.bronze.emissiveIntensity = 1.7 + 0.6 * Math.sin((t / 6) * Math.PI * 2)
  })
  const { meshes, tilt } = parts
  return (
    <group ref={root} name="Colossus_armillary" position={ARMILLARY.position}>
      <primitive object={meshes.outer} />
      <group quaternion={tilt}>
        <primitive object={meshes.core} />
        <group ref={middle}>
          <primitive object={meshes.middle} />
        </group>
        <group ref={inner}>
          <primitive object={meshes.inner} />
        </group>
      </group>
    </group>
  )
}
