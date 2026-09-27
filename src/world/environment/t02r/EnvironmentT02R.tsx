import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { BoxGeometry, BufferGeometry, Euler, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LAYOUT } from '../../worldLayout'
import { GrandStairs } from '../GrandStairs'
import { Grass } from '../Grass'
import { environmentMaterial } from './materials'
import { FAR_RING_RADII, makeDistantRidge, makeFarRing, makeRoad, makeTerrain, roadSamples } from './terrain'
import { loadSurfaceTextures } from '../terrainTextures'
import { makeScatter, towerFootings } from './scatter'

export const T02R_ROCK_URL = '/assets/environment/t02r/hero-rocks.glb'
useGLTF.preload(T02R_ROCK_URL)
const instanceMatrix = (p: readonly number[], s: readonly number[], r: readonly number[] = [0, 0, 0]) => new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...r as [number, number, number])), new Vector3(...s))

function Rocks() {
  const { scene } = useGLTF(T02R_ROCK_URL)
  const group = useMemo(() => {
    const output = new Group(); output.name = 'Scatter'
    scene.updateMatrixWorld(true)
    const variants: BufferGeometry[] = []
    for (let i = 0; i < 4; i++) {
      const object = scene.getObjectByName(`HeroRock_${i}`) as Mesh
      variants.push(object.geometry.clone().applyMatrix4(object.matrixWorld))
    }
    const rocks = makeScatter(), material = environmentMaterial('rock')
    for (let i = 0; i < 4; i++) {
      const items = rocks.filter(r => r.variant === i)
      const mesh = new InstancedMesh(variants[i], material, items.length); mesh.name = `RockInstances_${i}`
      items.forEach((item, n) => mesh.setMatrixAt(n, instanceMatrix(item.position, item.scale, item.rotation)))
      mesh.computeBoundingSphere(); output.add(mesh)
    }
    output.userData.instances = rocks
    return output
  }, [scene])
  return <primitive object={group} dispose={null} />
}

function Terraces() {
  const paving = useMemo(() => environmentMaterial('paving'), [])
  const masonry = useMemo(() => environmentMaterial('masonry'), [])
  const stones = useMemo(() => {
    const transforms: Matrix4[] = []
    // Restrict retaining walls to the formal front approach.
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++) transforms.push(instanceMatrix([side * (28 + i * 17), 22.7, -65], [16.8, 2.6, 2.4]))
    // Small boundary stones punctuate the forecourt; no continuous perimeter wall.
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) transforms.push(instanceMatrix([side * 188.8, 24.55, -92 - i * 74], [1.8, 1.1, 3.6]))
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), masonry, transforms.length)
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.computeBoundingSphere(); mesh.name = 'LocalRetainingWalls'
    return mesh
  }, [masonry])
  // Platform cap, spawn landing, gate and tower footings merged per material: two draws per pass instead of sixteen.
  const slabs = useMemo(() => {
    const box = (size: [number, number, number], position: readonly number[], rotation: readonly number[] = [0, 0, 0], lift = 0) =>
      new BoxGeometry(...size).translate(0, lift, 0).applyMatrix4(instanceMatrix(position, [1, 1, 1], rotation))
    const merge = (parts: BufferGeometry[]) => { const merged = mergeGeometries(parts); parts.forEach((p) => p.dispose()); return merged }
    return {
      paving: merge([
        box([380, .34, 450], [0, 23.83, -290]), box([30, .28, 24], [0, -.13, 150]),
        ...towerFootings.map(t => box([t.width + .7, .24, t.depth + .7], t.position, t.rotation, -.12)),
      ]),
      masonry: merge([
        ...[-1, 1].map(side => box([14.2, 2, 18], [side * 16.2, -1, 55])),
        ...towerFootings.map(t => box([t.width, 2.8, t.depth], t.position, t.rotation, -1.4)),
      ]),
    }
  }, [])
  useEffect(() => () => { slabs.paving.dispose(); slabs.masonry.dispose() }, [slabs])
  return <group name="Terraces">
    <mesh name="Terrace_Paving" geometry={slabs.paving} material={paving} />
    <mesh name="Terrace_Masonry" geometry={slabs.masonry} material={masonry} />
    <primitive object={stones} dispose={null} />
  </group>
}

function Roads() {
  const stairs = useRef<Group>(null)
  const data = useMemo(() => ({ road: makeRoad(), shoulders: makeRoad(true), stone: environmentMaterial('paving'), debris: environmentMaterial('gravel') }), [])
  useEffect(() => { stairs.current?.traverse(o => { if (o instanceof Mesh) o.material = data.stone }) }, [data])
  return <group name="Roads">
    <mesh name="Curve_MainRoad" geometry={data.road} material={data.stone} />
    <mesh name="Gravel_Shoulders" geometry={data.shoulders} material={data.debris} />
    <group ref={stairs} name="GrandStairs_Preserved"><GrandStairs /></group>
  </group>
}

export function EnvironmentT02R() {
  const geometry = useMemo(makeTerrain, [])
  const material = useMemo(() => environmentMaterial('terrain'), [])
  const distant = useMemo(() => Array.from({ length: 4 }, (_, i) => makeDistantRidge(i)), [])
  const ring = useMemo(() => FAR_RING_RADII.map((_, i) => makeFarRing(i)), [])
  const distantMaterial = useMemo(() => environmentMaterial('distant'), [])
  // The scanned surface maps decode in a worker; until then the materials show flat per-layer tints.
  useEffect(() => { loadSurfaceTextures().catch((error: unknown) => console.warn('[surfaces] texture load failed', error)) }, [])
  return <group name="ENV_T02R">
    <group name="Terrain"><mesh name="Continuous_Main_Terrain" geometry={geometry} material={material} /><Grass terrain={geometry} /></group>
    <Terraces /><Roads />
    <group name="Cliffs" userData={{ strategy: 'Continuous shoulder / cliff face / talus heightfield with authored ridge branches' }} />
    <group name="HeroRocks"><Suspense fallback={null}><Rocks /></Suspense></group>
    <group name="FarMountains">{distant.map((g, i) => <mesh key={i} name={`Mountain_Layer_${i}`} geometry={g} material={distantMaterial} userData={{ castShadow: false }} />)}
      {ring.map((g, i) => <mesh key={i} name={`Horizon_Ring_${i}`} geometry={g} material={distantMaterial} frustumCulled={false} userData={{ castShadow: false }} />)}</group>
    <group name="Materials" /><group name="Debug" />
  </group>
}

// Development-only fixed viewpoints. They override the final camera transform
// after the unchanged player update, allowing identical BEFORE / AFTER captures.
export function EnvironmentReview() {
  const { scene, camera, gl } = useThree()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = window as unknown as Record<string, unknown>
    target.__environmentReview = (eye: number[] | null, look: number[]) => { camera.userData.review = eye ? { eye, look } : null }
    // Names the object under a normalised screen point (−1…1), for diagnosing stray geometry.
    target.__pick = (x: number, y: number) => {
      const ray = new Raycaster(); ray.setFromCamera(new Vector2(x, y), camera)
      const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && !['SkyDome', 'SunProxy'].includes(h.object.name) && !h.object.name.startsWith('Cloud'))
      const chain: string[] = []
      for (let o: Object3D | null = hit?.object ?? null; o; o = o.parent) chain.push(o.name || o.type)
      return hit ? { distance: hit.distance, point: hit.point.toArray().map(Math.round), chain } : null
    }
    target.__environmentStats = () => {
      const root = scene.getObjectByName('ENV_T02R') || scene.getObjectByName('ENV_Graybox')
      let triangles = 0, calls = 0, terrainTriangles = 0, rocks = 0, heroRocks = 0
      root?.traverse(o => {
        if (!(o instanceof Mesh)) return
        const count = o instanceof InstancedMesh ? o.count : 1
        const tris = (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3
        triangles += tris * count; calls++
        if (o.name === 'Continuous_Main_Terrain') terrainTriangles = tris
        if (o.name.startsWith('RockInstances')) rocks += count
        if (o.name === 'RockInstances_0') heroRocks = o.parent!.userData.instances.filter((r: { hero: boolean }) => r.hero).length
      })
      return { triangles, drawCalls: calls, terrainTriangles, rockInstances: rocks, heroRocks, renderer: { ...gl.info.render } }
    }
    target.__environmentExport = () => {
      const meshes: unknown[] = []
      function capture(root: Object3D | undefined, collection: string) {
        root?.updateWorldMatrix(true, true)
        root?.traverse(o => {
          if (!(o instanceof Mesh) || o.name.startsWith('RockInstances')) return
          const g = o.geometry
          const matrices = o instanceof InstancedMesh ? Array.from({ length: o.count }, (_, i) => { const m = new Matrix4(); o.getMatrixAt(i, m); return o.matrixWorld.clone().multiply(m).toArray() }) : [o.matrixWorld.toArray()]
          meshes.push({ collection, name: o.name || o.uuid, position: Array.from(g.getAttribute('position').array), index: g.index ? Array.from(g.index.array) : null, matrices, material: Array.isArray(o.material) ? o.material[0].name : o.material.name })
        })
      }
      capture(scene.getObjectByName('ENV_T02R'), 'ENV_T02R')
      capture(scene.getObjectByName('ENV_Graybox'), 'ENV_Graybox')
      return { meshes, scatter: makeScatter(), road: roadSamples.map(p => p.toArray()), layout: LAYOUT }
    }
    return () => { delete target.__environmentReview; delete target.__pick; delete target.__environmentStats; delete target.__environmentExport }
  }, [camera, gl, scene])
  useFrame(() => {
    const review = camera.userData.review
    if (!review) return
    camera.position.fromArray(review.eye); camera.lookAt(new Vector3().fromArray(review.look)); camera.updateMatrixWorld()
  })
  return null
}
