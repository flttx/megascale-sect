import { Suspense, useEffect, useMemo, useRef } from 'react'
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DynamicDrawUsage, Euler,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera,
  PlaneGeometry, Points, Quaternion, SphereGeometry, Uniform, Vector3,
} from 'three'
import { photo, uiBridge, exitPhoto } from '../../ui/bridge'
import { exportPhoto } from '../../ui/photoExport'
import { dismissOverlay, useUiStore } from '../../ui/uiStore'
import { translate } from '../../ui/i18n'
import { environmentMaterial } from '../environment/t02r/materials'
import { terrainHeight } from '../environment/t02r/terrain'
import { getPlayerRuntime, teleportPlayer } from '../player/playerHandle'
import { withGlazeTamed } from '../props/glaze'
import type { InteractKind } from '../sites'
import { yawToward } from '../sites'
import { useWorldStore } from '../store'
import { registerColliders, registerWalkables } from '../surfaces'
import type { Collider, WalkableDisc } from '../surfaces'
import { withSceneWeather } from '../weather/surfaceWeather'
import { compendiumView, noteLightning, resetCompendiumView, surveyPhoto, tickCompendium } from '../compendium/compendium'
import { worldEvents } from '../events'
import { groundHeight } from '../worldLayout'
import { announceArray, chooseWeather, interactPressed, standAt, travel, triggerSite } from './actions'
import { director, endShot, handBack, updateDirector } from './cinematics'
import { bellWave, sparks, stepSparks, emitSparks } from './effects'
import {
  glowMaterial, GLYPH_FRAGMENT, HALO_FRAGMENT, HALO_VERTEX, LOCAL_VERTEX, PILLAR_FRAGMENT, SPARK_FRAGMENT,
  SPARK_VERTEX, syncGlow, WAVE_FRAGMENT,
} from './glow'
import { COLLECT_RADIUS, ORB_GROUP_LABELS, ORBS, orbPosition } from './orbs'
import { nearestSite, SITES, sitesOf, TELEPORT_PAD_RADIUS } from './registry'
import type { SiteSpec } from './registry'
import { playChime, playDiscovery } from './sounds'

/*
 * P6 interactables: Tripo site objects (instanced per model), viewpoint markers, teleport glyphs, the bell
 * shockwave, 60 spirit orbs, spark bursts, the interaction/cinematic loop and the photo-mode camera.
 * Draw calls on high ≈ 22 worst case (shadow casters: steles, bell, altar).
 */

interface ModelSpec { id: string; kind: InteractKind; scale: number; squash: number; cast: boolean; glaze?: boolean }
/** Real size = unit model × `scaleToHeight` (scripts/tripo/manifest.lock.json). Arrays are squashed into a walkable floor disc. */
const MODELS: ModelSpec[] = [
  { id: 'stele_turtle', kind: 'stele', scale: 4.5, squash: 1, cast: true },
  { id: 'bell_frame', kind: 'bell', scale: 6, squash: 1, cast: true, glaze: true },
  { id: 'weather_altar', kind: 'altar', scale: 6.723, squash: 1, cast: true },
  { id: 'meditation_platform', kind: 'meditation', scale: 2.353, squash: 1, cast: false },
  { id: 'teleport_array', kind: 'teleport', scale: 9.2, squash: 0.2, cast: false },
]
const propUrl = (id: string) => `/assets/props/${id}.glb`
MODELS.forEach((model) => useGLTF.preload(propUrl(model.id)))

/** Walkable heights above the site's ground: the squashed array disc and the meditation cushion. */
const ARRAY_TOP = 0.42
const CUSHION_TOP = 0.74

interface Plinth { site: SiteSpec; bottom: number }
/** Road-side steles overhang sloping terrain; they stand on a masonry plinth level with the road. */
function plinthFor(site: SiteSpec): Plinth | null {
  const [x, y, z] = site.position
  // Standing on the road or a slab already; bare natural ground is what the plinth is for.
  const ground = groundHeight(x, z, y + 1)
  if (ground !== null && ground !== terrainHeight(x, z)) return null
  let low = Infinity
  for (const dx of [-2.2, 0, 2.2]) for (const dz of [-2.2, 0, 2.2]) low = Math.min(low, terrainHeight(x + dx, z + dz))
  return low < y - 0.3 && low > y - 8 ? { site, bottom: low - 0.8 } : null
}
const PLINTHS = sitesOf('stele').map(plinthFor).filter((plinth): plinth is Plinth => plinth !== null)
const baseY = (site: SiteSpec) => site.position[1] + (PLINTHS.some((p) => p.site === site) ? 0.12 : -0.04)

const scratch = { a: new Matrix4(), b: new Matrix4(), c: new Matrix4(), v: new Vector3(), q: new Quaternion(), s: new Vector3(), color: new Color() }

function SiteModel({ spec }: { spec: ModelSpec }) {
  const gltf = useGLTF(propUrl(spec.id))
  const mesh = useMemo(() => {
    const scene = withSceneWeather(gltf.scene)
    scene.updateMatrixWorld(true)
    const source = scene.getObjectByProperty('isMesh', true)
    if (!(source instanceof Mesh)) { console.warn(`[interact] ${spec.id} has no mesh`); return null }
    if (spec.glaze && !Array.isArray(source.material)) withGlazeTamed(source.material)
    const sites = sitesOf(spec.kind)
    const instanced = new InstancedMesh(source.geometry, source.material, sites.length)
    sites.forEach((site, i) => {
      const [x, , z] = site.position
      scratch.a.makeTranslation(x, baseY(site), z)
        .multiply(scratch.b.makeRotationY(yawToward(site.position, site.faceToward)))
        .multiply(scratch.c.makeScale(spec.scale, spec.scale * spec.squash, spec.scale))
        .multiply(source.matrixWorld)
      instanced.setMatrixAt(i, scratch.a)
    })
    instanced.instanceMatrix.needsUpdate = true
    instanced.computeBoundingSphere()
    instanced.name = `Interact_${spec.kind}`
    if (!spec.cast) instanced.userData.castShadow = false
    return instanced
  }, [gltf.scene, spec])
  useEffect(() => () => mesh?.dispose(), [mesh])
  return mesh ? <primitive object={mesh} /> : null
}

function Plinths() {
  const mesh = useMemo(() => {
    if (!PLINTHS.length) return null
    const instanced = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, -0.5, 0), environmentMaterial('masonry'), PLINTHS.length)
    PLINTHS.forEach(({ site, bottom }, i) => {
      const [x, y, z] = site.position, [fx, , fz] = site.faceToward
      const length = Math.hypot(fx - x, fz - z) || 1
      // Reach toward the road so the plinth reads as a paved stop beside it.
      scratch.v.set(x + (fx - x) / length * 0.9, y + 0.12, z + (fz - z) / length * 0.9)
      scratch.q.setFromAxisAngle(scratch.s.set(0, 1, 0), yawToward(site.position, site.faceToward))
      instanced.setMatrixAt(i, scratch.a.compose(scratch.v, scratch.q, scratch.s.set(4.8, y + 0.12 - bottom, 4.2)))
    })
    instanced.computeBoundingSphere()
    instanced.name = 'Interact_plinths'
    instanced.userData.castShadow = false
    return instanced
  }, [])
  useEffect(() => () => { mesh?.geometry.dispose(); mesh?.material.dispose(); mesh?.dispose() }, [mesh])
  return mesh ? <primitive object={mesh} /> : null
}

/** Floating jade marker plus a faint light shaft over each viewpoint (dimmed once visited). */
function ViewpointMarkers() {
  const sites = useMemo(() => sitesOf('viewpoint'), [])
  const { jade, shaft } = useMemo(() => {
    const jadeMaterial = new MeshStandardMaterial({ color: '#bfeee0', emissive: '#6fe3c6', emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1 })
    const jade = new InstancedMesh(new OctahedronGeometry(0.34, 0).scale(1, 1.6, 1), jadeMaterial, sites.length)
    jade.userData.castShadow = false
    jade.name = 'Interact_viewpointJade'
    jade.frustumCulled = false
    const shaft = new InstancedMesh(new CylinderGeometry(0.22, 0.55, 14, 16, 1, true).translate(0, 7, 0),
      glowMaterial('ViewpointShaft', LOCAL_VERTEX, PILLAR_FRAGMENT, { uColor: new Uniform(new Color(0.55, 1, 0.86)), uHeight: new Uniform(14) }), sites.length)
    shaft.name = 'Interact_viewpointShaft'
    shaft.frustumCulled = false
    sites.forEach((site, i) => {
      const [x, y, z] = site.position
      shaft.setMatrixAt(i, scratch.a.makeTranslation(x, y, z))
      shaft.setColorAt(i, scratch.color.setRGB(1, 1, 1))
      jade.setColorAt(i, scratch.color.setRGB(1, 1, 1))
    })
    return { jade, shaft }
  }, [sites])
  useEffect(() => {
    const paint = (visited: string[]) => {
      sites.forEach((site, i) => {
        const seen = visited.includes(site.id)
        shaft.setColorAt(i, scratch.color.setScalar(seen ? 0.28 : 1))
        jade.setColorAt(i, scratch.color.setScalar(seen ? 0.55 : 1))
      })
      if (shaft.instanceColor) shaft.instanceColor.needsUpdate = true
      if (jade.instanceColor) jade.instanceColor.needsUpdate = true
    }
    paint(useUiStore.getState().viewpoints)
    const unsubscribe = useUiStore.subscribe((s, p) => { if (s.viewpoints !== p.viewpoints) paint(s.viewpoints) })
    return () => { unsubscribe(); jade.geometry.dispose(); jade.material.dispose(); jade.dispose(); shaft.geometry.dispose(); shaft.material.dispose(); shaft.dispose() }
  }, [sites, jade, shaft])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    sites.forEach((site, i) => {
      const [x, y, z] = site.position
      scratch.v.set(x, y + 2.35 + Math.sin(t * 1.1 + i) * 0.14, z)
      scratch.q.setFromAxisAngle(scratch.s.set(0, 1, 0), t * 0.7 + i)
      jade.setMatrixAt(i, scratch.a.compose(scratch.v, scratch.q, scratch.s.set(1, 1, 1)))
    })
    jade.instanceMatrix.needsUpdate = true
    syncGlow(shaft.material, t)
  })
  return <><primitive object={jade} /><primitive object={shaft} /></>
}

/** Rune circles on the teleport discs: pale and slow until attuned, then gold. */
function ArrayGlyphs() {
  const sites = useMemo(() => sitesOf('teleport'), [])
  const mesh = useMemo(() => {
    const instanced = new InstancedMesh(new CircleGeometry(4.35, 96).rotateX(-Math.PI / 2), glowMaterial('ArrayGlyph', LOCAL_VERTEX, GLYPH_FRAGMENT), sites.length)
    sites.forEach((site, i) => {
      const [x, , z] = site.position
      scratch.q.setFromAxisAngle(scratch.s.set(0, 1, 0), yawToward(site.position, site.faceToward))
      instanced.setMatrixAt(i, scratch.a.compose(scratch.v.set(x, baseY(site) + ARRAY_TOP + 0.03, z), scratch.q, scratch.s.set(1, 1, 1)))
      instanced.setColorAt(i, scratch.color.setRGB(0.4, 0.62, 0.7))
    })
    instanced.computeBoundingSphere()
    instanced.frustumCulled = false
    instanced.renderOrder = 4
    instanced.name = 'Interact_arrayGlyphs'
    return instanced
  }, [sites])
  useEffect(() => {
    const paint = (arrays: string[]) => {
      sites.forEach((site, i) => mesh.setColorAt(i, arrays.includes(site.id) ? scratch.color.setRGB(1.25, 0.9, 0.46) : scratch.color.setRGB(0.36, 0.58, 0.68)))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    paint(useUiStore.getState().arrays)
    const unsubscribe = useUiStore.subscribe((s, p) => { if (s.arrays !== p.arrays) paint(s.arrays) })
    return () => { unsubscribe(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose() }
  }, [sites, mesh])
  useFrame((state) => syncGlow(mesh.material, state.clock.elapsedTime))
  return <primitive object={mesh} />
}

const WAVE_SECONDS = 2.6
const WAVE_RADIUS = 70
function BellShockwave() {
  const mesh = useMemo(() => {
    const ring = new Mesh(new CircleGeometry(1, 128).rotateX(-Math.PI / 2), glowMaterial('BellWave', LOCAL_VERTEX, WAVE_FRAGMENT, { uProgress: new Uniform(0) }))
    ring.visible = false
    ring.frustumCulled = false
    ring.renderOrder = 5
    ring.scale.setScalar(WAVE_RADIUS)
    ring.name = 'Interact_bellWave'
    return ring
  }, [])
  useEffect(() => () => { mesh.geometry.dispose(); mesh.material.dispose() }, [mesh])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (bellWave.pending) {
      bellWave.pending = false
      bellWave.start = t
      mesh.position.set(bellWave.position[0], bellWave.position[1] + 0.08, bellWave.position[2])
    }
    const progress = bellWave.start < 0 ? 1 : (t - bellWave.start) / WAVE_SECONDS
    mesh.visible = progress < 1
    if (!mesh.visible) return
    mesh.material.uniforms.uProgress.value = 1 - Math.pow(1 - progress, 2.2)
    syncGlow(mesh.material, t)
  })
  return <primitive object={mesh} />
}

/** Group tints (HDR, so the bloom picks the cores up): warm gold on foot, pale jade for flight targets. */
const ORB_TINT: Record<string, [number, number, number]> = {
  road: [2.6, 2.05, 1.15], platform: [2.6, 2.05, 1.15], bridge: [1.25, 2.4, 2.15],
  island: [1.25, 2.4, 2.15], pillar: [1.9, 1.75, 2.6], roof: [2.7, 2.2, 1.3], sky: [1.9, 1.75, 2.6],
  kun: [1.25, 2.6, 2.35], sage: [2.4, 2.15, 1.6], dragon: [1.25, 2.4, 2.15], tomb: [2.2, 2.3, 2.6], gate: [1.9, 1.75, 2.6],
  turtle: [1.6, 2.6, 1.5],
}

function SpiritOrbs() {
  const collectedAt = useRef<Float32Array>(new Float32Array(ORBS.length).fill(-1))
  const { core, halo } = useMemo(() => {
    const core = new InstancedMesh(new SphereGeometry(0.24, 18, 12), new MeshBasicMaterial({ color: '#ffffff' }), ORBS.length)
    const halo = new InstancedMesh(new PlaneGeometry(1, 1), glowMaterial('OrbHalo', HALO_VERTEX, HALO_FRAGMENT, { uColor: new Uniform(new Color(1, 0.9, 0.7)) }), ORBS.length)
    core.instanceMatrix.setUsage(DynamicDrawUsage); halo.instanceMatrix.setUsage(DynamicDrawUsage)
    ORBS.forEach((orb, i) => {
      const [r, g, b] = ORB_TINT[orb.group]
      core.setColorAt(i, scratch.color.setRGB(r, g, b))
      halo.setColorAt(i, scratch.color.setRGB(r / 2.6, g / 2.6, b / 2.6))
    })
    for (const mesh of [core, halo]) { mesh.frustumCulled = false; mesh.userData.castShadow = false }
    core.name = 'Interact_orbs'; halo.name = 'Interact_orbHalos'
    halo.renderOrder = 3
    return { core, halo }
  }, [])
  useEffect(() => {
    // Orbs collected before this mount (restored save) are simply absent.
    const sync = (ids: string[]) => ORBS.forEach((orb, i) => { if (ids.includes(orb.id) && collectedAt.current[i] < 0) collectedAt.current[i] = -2 })
    sync(useUiStore.getState().orbs)
    const unsubscribe = useUiStore.subscribe((s, p) => {
      if (s.orbs === p.orbs) return
      // A reset (DEV) brings orbs back.
      ORBS.forEach((orb, i) => { if (!s.orbs.includes(orb.id)) collectedAt.current[i] = -1 })
      sync(s.orbs)
    })
    return () => { unsubscribe(); core.geometry.dispose(); core.material.dispose(); core.dispose(); halo.geometry.dispose(); halo.material.dispose(); halo.dispose() }
  }, [core, halo])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const runtime = getPlayerRuntime(), world = useWorldStore.getState()
    const canCollect = world.started && runtime !== null && world.cameraMode !== 'photo'
    const px = runtime?.position.x ?? 0, py = (runtime?.position.y ?? 0) + 1, pz = runtime?.position.z ?? 0
    for (let i = 0; i < ORBS.length; i++) {
      const orb = ORBS[i], point = orbPosition(orb, scratch.v)
      if (!point) {
        core.setMatrixAt(i, scratch.a.makeScale(0, 0, 0)); halo.setMatrixAt(i, scratch.a)
        continue
      }
      const { x, y, z } = point
      const bob = Math.sin(t * 1.35 + i * 1.7) * 0.22
      let taken = collectedAt.current[i], scale = 1 + Math.sin(t * 2.4 + i * 0.9) * 0.12, rise = 0
      if (taken === -1 && canCollect && Math.hypot(px - x, py - y - bob, pz - z) < COLLECT_RADIUS) {
        taken = collectedAt.current[i] = t
        collect(orb.id, [x, y + bob, z], ORB_TINT[orb.group])
      }
      if (taken === -2 || (taken >= 0 && t - taken > 0.5)) scale = 0
      else if (taken >= 0) { const k = (t - taken) / 0.5; rise = k * 1.2; scale *= 1 - k * k }
      scratch.v.set(x, y + bob + rise, z)
      core.setMatrixAt(i, scratch.a.compose(scratch.v, scratch.q.identity(), scratch.s.setScalar(scale)))
      halo.setMatrixAt(i, scratch.a.compose(scratch.v, scratch.q, scratch.s.setScalar(scale > 0 ? 2.3 * (0.9 + 0.1 * scale) * (taken >= 0 ? 1.8 : 1) : 0)))
    }
    core.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    syncGlow(halo.material, t)
  })
  return <><primitive object={core} /><primitive object={halo} /></>
}

function collect(id: string, at: readonly [number, number, number], tint: [number, number, number]) {
  const ui = useUiStore.getState()
  if (!ui.collectOrb(id)) return
  emitSparks(at, 26, [tint[0] / 2.2, tint[1] / 2.2, tint[2] / 2.2], 3.2, 1.2, 1)
  playChime()
  const orb = ORBS.find((o) => o.id === id)
  const collected = new Set(useUiStore.getState().orbs)
  const count = collected.size
  if (count === ORBS.length) useWorldStore.getState().setNotice('诸天灵光尽收 · 云阙诸天为你澄明')
  else if (orb && ORBS.filter((o) => o.group === orb.group).every((o) => collected.has(o.id))) {
    const language = useUiStore.getState().language
    useWorldStore.getState().setNotice(translate('{group} · 灵光尽收', language, { group: translate(ORB_GROUP_LABELS[orb.group], language) }))
  }
}

function Sparks() {
  const points = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(sparks.position, 3).setUsage(DynamicDrawUsage))
    geometry.setAttribute('aLife', new BufferAttribute(sparks.life, 1).setUsage(DynamicDrawUsage))
    geometry.setAttribute('aColor', new BufferAttribute(sparks.color, 3).setUsage(DynamicDrawUsage))
    const cloud = new Points(geometry, glowMaterial('Sparks', SPARK_VERTEX, SPARK_FRAGMENT, { uPixel: new Uniform(1) }))
    cloud.frustumCulled = false
    cloud.visible = false
    cloud.renderOrder = 6
    cloud.name = 'Interact_sparks'
    return cloud
  }, [])
  useEffect(() => () => { points.geometry.dispose(); points.material.dispose() }, [points])
  useFrame((state, delta) => {
    if (!sparks.alive) { points.visible = false; return }
    if (!stepSparks(Math.min(delta, 0.05))) sparks.alive = 0
    for (const name of ['position', 'aLife', 'aColor']) points.geometry.getAttribute(name).needsUpdate = true
    points.material.uniforms.uPixel.value = state.size.height * state.gl.getPixelRatio() / 900
    syncGlow(points.material, state.clock.elapsedTime)
    points.visible = sparks.alive > 0
  })
  return <primitive object={points} />
}

const direction = new Vector3()
const TELEPORTS = sitesOf('teleport')

/** Cinematics, compass heading, the throttled nearest-site search and array attunement. */
function InteractionLoop() {
  const camera = useThree((state) => state.camera)
  const timer = useRef(0)
  useEffect(() => {
    // Losing the mouse (Esc) skips a cinematic and leaves photo mode; the settings menu then takes over.
    const unsubscribe = useWorldStore.subscribe((s, p) => {
      if (!p.locked || s.locked) return
      if (director.shot) endShot()
      if (s.cameraMode === 'photo') exitPhoto()
    })
    return () => { unsubscribe(); useUiStore.getState().setNearby(null) }
  }, [])
  useFrame((_, rawDelta) => {
    if (!(camera instanceof PerspectiveCamera)) return
    const delta = Math.min(rawDelta, 0.05)
    updateDirector(camera, delta)
    // Heading from the last *rendered* camera matrix (no re-compose): anything that moves the camera later
    // in the frame (the rig, dev review shots) is reflected, at most one frame late.
    const e = camera.matrixWorld.elements
    direction.set(-e[8], -e[9], -e[10])
    if (direction.x * direction.x + direction.z * direction.z > 1e-6) uiBridge.heading = Math.atan2(direction.x, -direction.z)
    uiBridge.camera.x = camera.position.x; uiBridge.camera.y = camera.position.y; uiBridge.camera.z = camera.position.z
    timer.current -= rawDelta
    if (timer.current > 0) return
    timer.current = 0.125
    const world = useWorldStore.getState(), ui = useUiStore.getState(), runtime = getPlayerRuntime()
    if (!world.started || !runtime || world.cameraMode !== 'player' || !['GROUND', 'FLIGHT'].includes(runtime.phase)) { ui.setNearby(null); return }
    const p = runtime.position
    const site = nearestSite(p.x, p.y, p.z)
    ui.setNearby(site ? { id: site.id, kind: site.kind, name: site.name, verb: site.verb } : null)
    if (runtime.phase !== 'GROUND') return
    for (const array of TELEPORTS) {
      const [x, y, z] = array.position
      if (Math.hypot(p.x - x, p.z - z) < TELEPORT_PAD_RADIUS && Math.abs(p.y - y) < 1.6 && ui.activateArray(array.id)) announceArray(array)
    }
  })
  return null
}

const euler = new Euler(0, 0, 0, 'YXZ')
const move = new Vector3()
const offset = new Vector3()
/** Records what a shot frames in the photo compendium, with a chime for anything new. */
function recordShot(camera: PerspectiveCamera) {
  const { found, blocked } = surveyPhoto(camera)
  if (useUiStore.getState().recordCompendium(found, blocked).length) playDiscovery()
}

/** Free camera for photo mode (WASD, Q/E down/up, Shift fast, wheel zoom), plus the PNG capture and compendium hooks. */
function PhotoCamera() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const rig = useRef({ active: false, yaw: 0, pitch: 0, fov: 60 })
  // After-effects run once the composer has presented the frame, so the canvas still holds it.
  useEffect(() => addAfterEffect(() => {
    if (!photo.capture) return
    photo.capture = false
    exportPhoto(gl.domElement)
    if (camera instanceof PerspectiveCamera) recordShot(camera)
  }), [gl, camera])
  useEffect(() => worldEvents.on('lightning', noteLightning), [])
  useFrame((_, rawDelta) => {
    if (!(camera instanceof PerspectiveCamera)) return
    const mode = useWorldStore.getState().cameraMode, s = rig.current
    if (mode !== 'photo') { if (s.active) { s.active = false; handBack(camera) } return }
    const delta = Math.min(rawDelta, 0.05)
    if (!s.active) {
      s.active = true
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
      s.yaw = euler.y; s.pitch = euler.x; s.fov = camera.fov
      resetCompendiumView()
    }
    const look = 0.0022 * useWorldStore.getState().mouseSensitivity * (s.fov / 72)
    s.yaw -= photo.dx * look; s.pitch = Math.max(-1.45, Math.min(1.45, s.pitch - photo.dy * look))
    photo.dx = 0; photo.dy = 0
    s.fov = Math.max(18, Math.min(95, s.fov + photo.zoom * 3)); photo.zoom = 0
    const k = photo.keys
    move.set(Number(k.has('KeyD')) - Number(k.has('KeyA')), Number(k.has('KeyE')) - Number(k.has('KeyQ')), Number(k.has('KeyS')) - Number(k.has('KeyW')))
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar((k.has('ShiftLeft') || k.has('ShiftRight') ? 24 : 6) * delta)
      euler.set(s.pitch, s.yaw, 0, 'YXZ')
      const lift = move.y; move.y = 0
      move.applyEuler(euler).y += lift
      camera.position.add(move)
    }
    // Stay near the player and above the ground.
    const runtime = getPlayerRuntime()
    if (runtime) {
      offset.subVectors(camera.position, runtime.position)
      if (offset.length() > 90) camera.position.copy(runtime.position).addScaledVector(offset.normalize(), 90)
    }
    const floor = groundHeight(camera.position.x, camera.position.z, camera.position.y + 1)
    if (floor !== null) camera.position.y = Math.max(camera.position.y, floor + 0.35)
    camera.quaternion.setFromEuler(euler.set(s.pitch, s.yaw, 0, 'YXZ'))
    camera.fov += (s.fov - camera.fov) * (1 - Math.exp(-10 * delta))
    camera.updateProjectionMatrix()
    tickCompendium(camera, delta)
  })
  return null
}

function SiteSurfaces() {
  useEffect(() => {
    const disc = (site: SiteSpec, lift: number, radius: number): WalkableDisc => ({ kind: 'disc', x: site.position[0], z: site.position[2], y: baseY(site) + lift, radius })
    const walkables = [
      ...sitesOf('teleport').map((site) => disc(site, ARRAY_TOP, TELEPORT_PAD_RADIUS)),
      ...sitesOf('meditation').map((site) => disc(site, CUSHION_TOP, 1.05)),
    ]
    const cylinder = (site: SiteSpec, radius: number, height: number): Collider => ({ kind: 'cylinder', x: site.position[0], z: site.position[2], radius, minY: site.position[1] - 1, maxY: site.position[1] + height })
    const colliders = [
      ...sitesOf('stele').map((site) => cylinder(site, 1.6, 4.6)),
      ...sitesOf('bell').map((site) => cylinder(site, 2.6, 6.2)),
      ...sitesOf('altar').map((site) => cylinder(site, 3.3, 4.1)),
    ]
    const offWalkables = registerWalkables(walkables), offColliders = registerColliders(colliders)
    return () => { offWalkables(); offColliders() }
  }, [])
  return null
}

function DevHooks() {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const hooks = window as unknown as Record<string, unknown>
    hooks.__interact = {
      sites: () => SITES.map(({ id, kind, name, position }) => ({ id, kind, name, position })),
      standAt, trigger: triggerSite, press: interactPressed, travel, chooseWeather, dismiss: dismissOverlay,
      nearby: () => useUiStore.getState().nearby,
      orbs: () => ORBS.map((orb) => ({ id: orb.id, position: orbPosition(orb, new Vector3())?.toArray() ?? null, group: orb.group, collected: useUiStore.getState().orbs.includes(orb.id) })),
      /** Stands the player under orb `index` (those reachable on foot are collected by walking in). */
      visitOrb: (index: number | string) => {
        const orb = typeof index === 'string' ? ORBS.find((o) => o.id === index) : ORBS[index]
        const p = orb && orbPosition(orb, new Vector3())
        return p ? teleportPlayer([p.x, p.y - 1, p.z]) : false
      },
      /** Hides every P6 object (draw-call accounting). */
      setVisible: (value: boolean) => { const group = scene.getObjectByName('interactables'); if (group) group.visible = value },
      state: () => ({
        cameraMode: useWorldStore.getState().cameraMode, shot: director.shot?.kind ?? null, overlay: useUiStore.getState().overlay,
        orbs: useUiStore.getState().orbs.length, steles: useUiStore.getState().steles.length,
        viewpoints: useUiStore.getState().viewpoints.length, arrays: useUiStore.getState().arrays,
        photo: photo.last, photos: photo.count,
      }),
      /** What a shot from the current camera would record in the compendium, and the viewfinder's framed entries. */
      survey: () => camera instanceof PerspectiveCamera ? surveyPhoto(camera) : null,
      framed: () => compendiumView.framed,
    }
    return () => { delete hooks.__interact }
  }, [scene, camera])
  return null
}

/** In-world objects, collectibles and interaction systems (P6). */
export function Interactables() {
  return <group name="interactables">
    <Suspense fallback={null}>
      {MODELS.map((spec) => <SiteModel key={spec.id} spec={spec} />)}
    </Suspense>
    <Plinths />
    <ViewpointMarkers />
    <ArrayGlyphs />
    <BellShockwave />
    <SpiritOrbs />
    <Sparks />
    <SiteSurfaces />
    <InteractionLoop />
    <PhotoCamera />
    <DevHooks />
  </group>
}
