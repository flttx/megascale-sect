import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Uniform,
  Vector3,
} from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerObjectColliders } from '../meshColliders'
import { atmosphere } from '../sky/atmosphere'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { LAYOUT } from '../worldLayout'

/**
 * Red lanterns hung from the eave corners of the main hall and the six side towers. The corners are found in the
 * loaded models, not authored: sliced by height, the farthest point toward each diagonal peaks where an eave flares
 * past the wall above and below it, and that point is the corner's tip. By night the lanterns glow and trace every
 * roof tier; by day they are a red accent. They sway on their cords with the wind, and collide as drawn.
 */
const SLICES = 120
/** A tier's corners must reach this share of the building's widest diagonal past the walls around them. */
const OVERHANG = 0.04
/** Lantern length (m) per building height: ~6.3 m on the 420 m hall, ~1.9 m on a 120 m tower. */
const SIZE_PER_HEIGHT = 0.012

const uniforms = { uLanternTime: new Uniform(0), uLanternWind: new Uniform(atmosphere.wind) }

/** Corner tips in `frame`'s space, from every mesh under `root`. */
function eaveTips(root: Object3D, frame: Object3D) {
  root.updateWorldMatrix(true, true)
  const inverse = frame.matrixWorld.clone().invert(),
    v = new Vector3(),
    points: Vector3[] = []
  root.traverse((object) => {
    const mesh = object as { isMesh?: boolean; geometry?: BufferGeometry; matrixWorld: Matrix4 }
    if (!mesh.isMesh || !mesh.geometry) return
    const position = mesh.geometry.getAttribute('position')
    const local = mesh.matrixWorld.clone().premultiply(inverse)
    for (let i = 0; i < position.count; i++) points.push(v.fromBufferAttribute(position, i).applyMatrix4(local).clone())
  })
  if (!points.length) return []
  let y0 = Infinity,
    y1 = -Infinity,
    cx = 0,
    cz = 0
  for (const p of points) {
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y)
    cx += p.x / points.length
    cz += p.z / points.length
  }
  const quadrants = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  const reach = Array.from({ length: SLICES }, () => quadrants.map(() => ({ d: -Infinity, p: null as Vector3 | null })))
  for (const p of points) {
    const slice = Math.min(SLICES - 1, Math.floor(((p.y - y0) / (y1 - y0)) * SLICES))
    quadrants.forEach(([sx, sz], q) => {
      const d = sx * (p.x - cx) + sz * (p.z - cz)
      if (d > reach[slice][q].d) reach[slice][q] = { d, p }
    })
  }
  // The weakest of the four diagonals, so a tier only counts where all four corners flare.
  const extent = reach.map((row) => Math.min(...row.map((c) => c.d)))
  const widest = Math.max(...extent),
    tips: Vector3[] = []
  for (let s = 2; s < SLICES - 2; s++) {
    let peak = true,
      low = Infinity
    for (let k = -6; k <= 6; k++) {
      const n = s + k
      if (n < 0 || n >= SLICES) continue
      if (Math.abs(k) <= 4 && k !== 0 && extent[n] > extent[s]) peak = false
      low = Math.min(low, extent[n])
    }
    if (peak && extent[s] - low > OVERHANG * widest) reach[s].forEach((c) => c.p && tips.push(c.p))
  }
  return tips
}

/** One lantern, 1.25 units long, hanging from its pivot at the origin: cord, caps, ribbed body, tassel. */
function lanternGeometry() {
  const body = new SphereGeometry(0.32, 12, 10).scale(1, 1.15, 1).translate(0, -0.62, 0)
  const trim = mergeGeometries([
    new CylinderGeometry(0.02, 0.02, 0.25, 4).translate(0, -0.125, 0),
    new CylinderGeometry(0.18, 0.2, 0.06, 10).translate(0, -0.28, 0),
    new CylinderGeometry(0.17, 0.15, 0.05, 10).translate(0, -0.97, 0),
    new CylinderGeometry(0.035, 0.05, 0.26, 6).translate(0, -1.12, 0),
  ])
  return { body, trim }
}

/** Swing about the pivot (local origin) with the wind; each lantern keeps its own phase. */
function swaying(material: MeshStandardMaterial) {
  const weather = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    weather(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `uniform float uLanternTime; uniform vec2 uLanternWind;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float phase = float(gl_InstanceID) * 2.399;
        float gust = 0.05 + 0.025 * length(uLanternWind);
        vec2 swing = vec2(sin(uLanternTime * 1.3 + phase), cos(uLanternTime * 0.9 + phase * 1.7)) * gust;
        transformed.xz += swing * -transformed.y;
      }`,
    )
  }
  material.customProgramCacheKey = () => `${key()}|eave-lantern-1`
  return material
}

function buildLanterns(scene: Object3D) {
  const hall = scene.getObjectByName('MG01_LOD0'),
    hallRoot = scene.getObjectByName('MG01_AssetRoot'),
    tower = scene.getObjectByName('MG04_Tower0')
  if (!hall || !hallRoot || !tower) return null
  const placements: { at: Vector3; size: number }[] = []
  const hallTips = eaveTips(hall, hallRoot)
  hallRoot.updateWorldMatrix(true, false)
  for (const tip of hallTips)
    placements.push({ at: tip.applyMatrix4(hallRoot.matrixWorld), size: 420 * SIZE_PER_HEIGHT })
  // The towers share one model: find its corners once in tower 0's frame, then place them on every tower.
  const towerTips = eaveTips(tower, tower)
  LAYOUT.towers.forEach((spec, i) => {
    const group = scene.getObjectByName(`MG04_Tower${i}`)
    if (!group) return
    group.updateWorldMatrix(true, false)
    for (const tip of towerTips)
      placements.push({
        at: tip.clone().applyMatrix4(group.matrixWorld),
        size: 120 * spec.scaleMultiplier * SIZE_PER_HEIGHT,
      })
  })
  if (!placements.length) return null
  const { body, trim } = lanternGeometry()
  const bodyMaterial = swaying(
    withSurfaceWeather(
      new MeshStandardMaterial({ color: '#b8231b', emissive: '#ff5a1e', roughness: 0.6 }),
    ) as MeshStandardMaterial,
  )
  const trimMaterial = swaying(
    withSurfaceWeather(
      new MeshStandardMaterial({ color: '#c8a052', roughness: 0.35, metalness: 0.8 }),
    ) as MeshStandardMaterial,
  )
  const meshes = [
    new InstancedMesh(body, bodyMaterial, placements.length),
    new InstancedMesh(trim, trimMaterial, placements.length),
  ]
  const m = new Matrix4(),
    q = new Quaternion(),
    s = new Vector3()
  placements.forEach(({ at, size }, i) =>
    meshes.forEach((mesh) => mesh.setMatrixAt(i, m.compose(at, q, s.setScalar(size)))),
  )
  meshes[0].name = 'Eave_Lanterns'
  meshes[1].name = 'Eave_Lantern_Trim'
  meshes.forEach((mesh) => {
    mesh.computeBoundingSphere()
    mesh.userData.castShadow = false
  })
  return meshes
}

export function EaveLanterns() {
  const scene = useThree((state) => state.scene)
  const [meshes, setMeshes] = useState<InstancedMesh[] | null>(null)
  const tries = useRef(0)
  // The hall and towers stream in; look for them each frame until they are there (or give up after ~10 s).
  useFrame((_, delta) => {
    uniforms.uLanternTime.value += Math.min(delta, 0.1)
    if (meshes) {
      const night = atmosphere.night
      ;(meshes[0].material as MeshStandardMaterial).emissiveIntensity = 0.15 + night * 2.6
      return
    }
    if (tries.current++ > 600) return
    const built = buildLanterns(scene)
    if (built) setMeshes(built)
  })
  useEffect(() => {
    if (!meshes) return
    const off = meshes.map(registerObjectColliders)
    return () => {
      off.forEach((unregister) => unregister())
      meshes.forEach((mesh) => {
        mesh.geometry.dispose()
        ;(mesh.material as MeshStandardMaterial).dispose()
      })
    }
  }, [meshes])
  return meshes ? (
    <group name="EaveLanterns">
      {meshes.map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </group>
  ) : null
}
