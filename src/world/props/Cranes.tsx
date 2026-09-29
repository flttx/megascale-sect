import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CatmullRomCurve3, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import { cranePositions } from '../compendium/compendium'
import { hash } from '../environment/t02r/terrain'
import { worldEvents } from '../events'
import { useWorldStore } from '../store'
import { extractSource } from './propSource'
import { CRANE_SCALE, propUrl } from './propCatalog'

/**
 * Crane flock: 3–4 loose skeins on smooth closed loops around the sect. The GLB is a static glide pose, so
 * wings bend in the vertex shader about the shoulder line (|local z| = wingspan axis) by a per-instance
 * angle. Cranes never cast shadows, and their shader patch is their only onBeforeCompile (no surface weather).
 */
export const CRANE_LOOPS: [number, number, number][][] = [
  // Grand circuit high around the hall and side towers.
  [[0, 205, 70], [235, 215, -40], [320, 235, -300], [230, 225, -590], [0, 245, -650], [-235, 215, -590], [-330, 225, -300], [-240, 195, -40]],
  // Low western circuit over the cloud sea, threading the karst pillars past the west isle.
  [[-250, 70, -10], [-420, 85, 60], [-560, 95, 20], [-700, 110, -160], [-560, 120, -330], [-400, 90, -250], [-330, 75, -170]],
  // Eastern circuit past the moon terrace toward the star terrace.
  [[260, 95, 20], [440, 105, 40], [560, 125, -120], [540, 205, -330], [420, 150, -220], [380, 110, -140], [300, 90, -170]],
  // Front loop over the pilgrimage valley, seen from the spawn plaza.
  [[-110, 95, 215], [10, 85, 300], [150, 100, 235], [190, 115, 110], [90, 130, 10], [-80, 120, 25], [-180, 105, 110]],
]
const COUNT = { low: 8, mid: 11, high: 14 } as const
const NEAR = 170
const SCATTER_SECONDS = 8
const SPEED = 13

interface Bird {
  loop: number; u: number; lateral: number; lift: number; wobble: number
  scatter: Vector3
  flapping: boolean; timer: number; blend: number; phase: number
  bank: number; pos: Vector3; prev: Vector3; forward: Vector3; flap: number
}

const PIVOT_Y = 0.165

function patchWings(material: MeshStandardMaterial, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCranePivot = { value: PIVOT_Y }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlap;\nuniform float uCranePivot;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float craneSpan = abs(position.z);
        float craneSide = position.z < 0.0 ? -1.0 : 1.0;
        float craneReach = max(craneSpan - 0.06, 0.0);
        // Tips lag the stroke: the angle grows along the span, so the wing curves rather than hinging flat.
        float craneAng = aFlap * smoothstep(0.04, 0.14, craneSpan) * (0.7 + 0.6 * clamp(craneReach / 0.44, 0.0, 1.0));
        float craneC = cos(craneAng), craneS = sin(craneAng);
        vec2 craneN = vec2(objectNormal.z * craneSide, objectNormal.y);
        craneN = vec2(craneC * craneN.x - craneS * craneN.y, craneS * craneN.x + craneC * craneN.y);
        objectNormal.z = craneN.x * craneSide; objectNormal.y = craneN.y;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (craneReach > 0.0) {
          vec2 craneR = vec2(craneReach, transformed.y - uCranePivot);
          craneR = vec2(craneC * craneR.x - craneS * craneR.y, craneS * craneR.x + craneC * craneR.y);
          transformed.z = craneSide * (0.06 + craneR.x); transformed.y = uCranePivot + craneR.y;
        }`)
  }
  material.customProgramCacheKey = () => `crane-wings-${key}`
  return material
}

function makeFlock(count: number, curves: CatmullRomCurve3[]): Bird[] {
  return Array.from({ length: count }, (_, i) => {
    const loop = i % curves.length, rankInLoop = Math.floor(i / curves.length)
    const lead = hash(loop, 3)
    // Loose echelon: each follower trails ~22 m back and alternates sides.
    const u = (lead - rankInLoop * 22 / curves[loop].getLength() + 1) % 1
    return {
      loop, u, lateral: (rankInLoop % 2 ? -1 : 1) * Math.ceil(rankInLoop / 2) * 9 + (hash(i, 4) - 0.5) * 4, lift: (hash(i, 5) - 0.5) * 10,
      wobble: hash(i, 6) * 6.28, scatter: new Vector3(hash(i, 7) - 0.5, 0.4 + hash(i, 8) * 0.6, hash(i, 9) - 0.5).normalize(),
      flapping: hash(i, 10) > 0.5, timer: 1 + hash(i, 11) * 4, blend: 0, phase: hash(i, 12) * 6.28,
      bank: 0, pos: new Vector3(), prev: new Vector3(), forward: new Vector3(1, 0, 0), flap: 0,
    }
  })
}

export function Cranes() {
  const [gltf0, gltf1] = useGLTF([propUrl('crane', false), propUrl('crane', true)])
  const quality = useWorldStore((s) => s.quality)
  const count = COUNT[quality]
  const curves = useMemo(() => CRANE_LOOPS.map((pts) => new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), true, 'centripetal')), [])

  const meshes = useMemo(() => {
    const max = COUNT.high
    return [gltf0, gltf1].map((gltf, lod) => {
      const source = extractSource(gltf.scene)
      // Flapping wings leave the static bounds; pad the sphere so culling never clips a wingtip.
      source.geometry.boundingSphere!.radius *= 1.35
      const flap = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage)
      source.geometry.setAttribute('aFlap', flap)
      const mesh = new InstancedMesh(source.geometry, patchWings(source.material, `lod${lod}`), max)
      mesh.name = `Prop_crane_lod${lod}`
      mesh.userData.castShadow = false
      mesh.count = 0
      return { mesh, flap }
    })
  }, [gltf0, gltf1])

  const flock = useMemo(() => makeFlock(count, curves), [count, curves])
  const state = useMemo(() => ({ scatterAt: -Infinity, time: 0, lengths: curves.map((c) => c.getLength()), initialised: false }), [curves])

  useEffect(() => () => meshes.forEach(({ mesh }) => { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose() }), [meshes])
  useEffect(() => worldEvents.on('bell', () => { state.scatterAt = state.time }), [state])
  // Photo compendium: the birds' live positions (updated in place each frame).
  useEffect(() => { cranePositions.splice(0, cranePositions.length, ...flock.map((b) => b.pos)); return () => { cranePositions.length = 0 } }, [flock])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __craneStats?: () => unknown }
    w.__craneStats = () => ({
      count: flock.length, near: meshes[0].mesh.count, far: meshes[1].mesh.count,
      scatter: Math.max(0, SCATTER_SECONDS - (state.time - state.scatterAt)),
      meanY: flock.reduce((a, b) => a + b.pos.y, 0) / flock.length,
      meanFlap: flock.reduce((a, b) => a + Math.abs(b.flap), 0) / flock.length,
    })
    return () => { delete w.__craneStats }
  }, [flock, meshes, state])

  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), roll: new Quaternion(), s: new Vector3(), side: new Vector3(), up: new Vector3(), basis: new Matrix4(), vel: new Vector3(), x: new Vector3(1, 0, 0), world: new Vector3(0, 1, 0), tangent: new Vector3(), fwd: new Vector3(), turn: new Vector3() }), [])

  useFrame(({ camera }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1)
    state.time += dt
    const since = state.time - state.scatterAt
    // Bell: the alarm (speed, hard flapping) hits at once; the flock spreads and climbs over ~3 s, then
    // settles back onto the loops by 8 s.
    const active = since < SCATTER_SECONDS
    const scatter = active ? MathUtils.smoothstep(since, 0, 0.3) * (1 - MathUtils.smoothstep(since, 5, SCATTER_SECONDS)) : 0
    const spread = active ? MathUtils.smoothstep(since, 0, 3) * (1 - MathUtils.smoothstep(since, 4.5, SCATTER_SECONDS)) : 0
    const counts = [0, 0]
    for (let i = 0; i < flock.length; i++) {
      const b = flock[i], curve = curves[b.loop]
      b.u = (b.u + SPEED * (1 + 1.3 * scatter) * dt / state.lengths[b.loop]) % 1
      curve.getPointAt(b.u, b.pos)
      curve.getTangentAt(b.u, tmp.tangent)
      tmp.side.crossVectors(tmp.tangent, tmp.world).normalize()
      const breathe = Math.sin(state.time * 0.23 + b.wobble)
      b.pos.addScaledVector(tmp.side, b.lateral * (1 + 2.5 * spread) + breathe * 3)
      b.pos.y += b.lift + Math.sin(state.time * 0.31 + b.wobble * 2) * 4 + spread * 35
      b.pos.addScaledVector(b.scatter, spread * 40)
      // Glide ↔ flap cycles; climbing and the bell force hard flapping.
      b.timer -= dt
      if (b.timer <= 0) { b.flapping = !b.flapping; b.timer = b.flapping ? 2 + hash(i, state.time) * 2.5 : 4 + hash(state.time, i) * 4 }
      const climbing = b.prev.lengthSq() > 0 && (b.pos.y - b.prev.y) / Math.max(dt, 1e-3) > 1.5
      const target = scatter > 0.05 || climbing || b.flapping ? 1 : 0
      b.blend += (target - b.blend) * Math.min(1, dt * 2.2)
      const freq = 1.7 + scatter * 1.6, amp = 0.55 + scatter * 0.3
      b.phase += dt * freq * Math.PI * 2
      const glide = 0.09 + 0.035 * Math.sin(state.time * 1.2 + b.wobble)
      b.flap = MathUtils.lerp(glide, 0.08 + amp * Math.sin(b.phase), b.blend)
      // Body heaves opposite the downstroke.
      b.pos.y -= Math.sin(b.phase) * 0.35 * b.blend
      // Orientation from the actual motion: forward = velocity, bank into the turn.
      if (!state.initialised || b.prev.lengthSq() === 0) b.prev.copy(b.pos).addScaledVector(tmp.tangent, -SPEED * dt)
      tmp.vel.subVectors(b.pos, b.prev).divideScalar(Math.max(dt, 1e-3))
      if (tmp.vel.lengthSq() > 1) {
        const fwd = tmp.fwd.copy(tmp.vel).normalize()
        const turn = tmp.turn.subVectors(fwd, b.forward).divideScalar(Math.max(dt, 1e-3))
        b.forward.lerp(fwd, Math.min(1, dt * 3)).normalize()
        tmp.side.crossVectors(b.forward, tmp.world).normalize()
        const bankTarget = MathUtils.clamp(Math.atan(turn.dot(tmp.side) * tmp.vel.length() / 9.8), -0.7, 0.7)
        b.bank += (bankTarget - b.bank) * Math.min(1, dt * 2)
      }
      b.prev.copy(b.pos)
      tmp.up.crossVectors(tmp.side, b.forward).normalize()
      tmp.basis.makeBasis(b.forward, tmp.up, tmp.side)
      tmp.q.setFromRotationMatrix(tmp.basis).multiply(tmp.roll.setFromAxisAngle(tmp.x, b.bank))
      tmp.m.compose(b.pos, tmp.q, tmp.s.setScalar(CRANE_SCALE))
      const lod = b.pos.distanceToSquared(camera.position) < NEAR * NEAR ? 0 : 1
      const target2 = meshes[lod], index = counts[lod]++
      target2.mesh.setMatrixAt(index, tmp.m)
      target2.flap.setX(index, b.flap)
    }
    state.initialised = true
    meshes.forEach(({ mesh, flap }, lod) => {
      mesh.count = counts[lod]
      mesh.visible = counts[lod] > 0
      if (!counts[lod]) return
      mesh.instanceMatrix.needsUpdate = true
      flap.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  })

  return <>{meshes.map(({ mesh }) => <primitive key={mesh.name} object={mesh} />)}</>
}
