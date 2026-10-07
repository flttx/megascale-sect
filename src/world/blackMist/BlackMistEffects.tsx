import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import type { QualityLevel } from '../quality'
import { useWorldStore } from '../store'
import { blackMistRuntime } from './runtime'
import {
  BLACK_MIST_UNIFORMS,
  createAshMaterial,
  createMistLightningMaterial,
  createMistSkyMaterial,
  createPlumeMaterial,
  createShockMaterial,
  createStormMaterial,
} from './materials'

const hash = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}
const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

/** Shared with the sound timeline: distant rolls, impact strokes, then a fading aftershock. */
const FLASH_TIMES = [10.8, 18.7, 28.2, 31.7, 35.2, 39.2, 43.2]
function stormFlash(elapsed: number) {
  let result = 0
  for (const at of FLASH_TIMES) {
    const age = elapsed - at
    if (age < 0 || age > 1) continue
    const gain = at < 25 ? 0.38 : at > 43 ? 0.5 : 1
    result = Math.max(result, gain * (Math.exp(-age * 12) + (age > 0.14 ? 0.65 * Math.exp(-(age - 0.14) * 15) : 0)))
  }
  return result
}

function mistCurtains(count: number) {
  return Array.from({ length: count }, (_, layer) => {
    const mesh = new Mesh(new PlaneGeometry(8000, 2450), createStormMaterial(layer))
    mesh.name = `BlackMistFront_${layer}`
    mesh.rotation.y = Math.PI / 2
    mesh.position.set(layer * 220, 790 + layer * 80, -300)
    mesh.renderOrder = 28 - layer
    mesh.frustumCulled = false
    mesh.userData.castShadow = false
    return mesh
  })
}

function mistPlumes(count: number) {
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute(
    'aSeed',
    new InstancedBufferAttribute(
      Float32Array.from({ length: count }, (_, i) => hash(i + 21)),
      1,
    ),
  )
  const mesh = new InstancedMesh(geometry, createPlumeMaterial(), count)
  const matrix = new Matrix4(),
    rotation = new Quaternion()
  for (let i = 0; i < count; i++) {
    const position = new Vector3(-180 - hash(i + 31) * 420, 160 + hash(i + 37) * 1120, -3600 + hash(i + 43) * 6600)
    const scale = new Vector3(450 + hash(i + 53) * 740, 230 + hash(i + 59) * 350, 1)
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
  }
  mesh.name = 'BlackMistLeadingPlumes'
  mesh.frustumCulled = false
  mesh.renderOrder = 30
  mesh.userData.castShadow = false
  return mesh
}

function ashField(count: number) {
  const geometry = new BufferGeometry()
  const position = new Float32Array(count * 3),
    drift = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    position.set([(hash(i + 67) - 0.5) * 440, (hash(i + 71) - 0.5) * 200, (hash(i + 73) - 0.5) * 440], i * 3)
    drift.set([hash(i + 79), hash(i + 83), hash(i + 89), hash(i + 97)], i * 4)
  }
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aDrift', new BufferAttribute(drift, 4))
  const points = new Points(geometry, createAshMaterial())
  points.name = 'BlackMistAsh'
  points.frustumCulled = false
  points.renderOrder = 41
  points.userData.castShadow = false
  return points
}

/** Camera-facing ribbons give the giant channels a soft illuminated core at every camera distance. */
function lightningChannels() {
  const positions: number[] = [],
    directions: number[] = [],
    sides: number[] = [],
    seeds: number[] = [],
    indices: number[] = []
  let segment = 0
  const add = (a: Vector3, b: Vector3, seed: number) => {
    const direction = new Vector3().subVectors(b, a).normalize()
    for (let corner = 0; corner < 4; corner++) {
      const p = corner < 2 ? a : b
      positions.push(p.x, p.y, p.z)
      directions.push(direction.x, direction.y, direction.z)
      sides.push(corner % 2 === 0 ? -1 : 1)
      seeds.push(seed)
    }
    const offset = segment++ * 4
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3)
  }
  for (let bolt = 0; bolt < 7; bolt++) {
    const baseZ = -3000 + bolt * 920
    const knots: Vector3[] = []
    for (let step = 0; step <= 25; step++) {
      const t = step / 25
      knots.push(
        new Vector3(
          (hash(bolt * 101 + step + 107) - 0.5) * 230,
          1600 * (1 - t) + 60,
          baseZ + (hash(bolt * 103 + step + 109) - 0.5) * 250,
        ),
      )
    }
    for (let i = 1; i < knots.length; i++) add(knots[i - 1], knots[i], bolt / 8)
    for (const start of [7, 13, 18]) {
      const from = knots[start],
        side = hash(bolt + start) > 0.5 ? 1 : -1
      let previous = from
      for (let i = 1; i <= 8; i++) {
        const next = new Vector3(
          from.x + i * 18,
          from.y - i * 23,
          from.z + side * i * 35 + (hash(i + bolt * 9) - 0.5) * 65,
        )
        add(previous, next, Math.min(0.95, bolt / 8 + 0.15))
        previous = next
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  geometry.setAttribute('aDir', new BufferAttribute(Float32Array.from(directions), 3))
  geometry.setAttribute('aSide', new BufferAttribute(Float32Array.from(sides), 1))
  geometry.setAttribute('aSeed', new BufferAttribute(Float32Array.from(seeds), 1))
  geometry.setIndex(indices)
  const mesh = new Mesh(geometry, createMistLightningMaterial())
  mesh.name = 'BlackMistLightning'
  mesh.frustumCulled = false
  mesh.renderOrder = 35
  mesh.userData.castShadow = false
  return mesh
}

const COUNTS: Record<QualityLevel, { curtains: number; plumes: number; ash: number }> = {
  low: { curtains: 2, plumes: 12, ash: 220 },
  mid: { curtains: 3, plumes: 20, ash: 420 },
  high: { curtains: 3, plumes: 28, ash: 680 },
}

/** At most eight draws: the storm is a visual event, with no actors or gameplay collision objects. */
export function BlackMistEffects() {
  const quality = useWorldStore((state) => state.quality)
  const group = useRef<Group>(null)
  const visualTime = useRef(0)
  const { curtains, plumes, ash, sky, shock, lightning } = useMemo(() => {
    const counts = COUNTS[quality]
    const sky = new Mesh(new SphereGeometry(1850, 32, 16), createMistSkyMaterial())
    sky.name = 'BlackMistSky'
    sky.frustumCulled = false
    sky.renderOrder = -800
    sky.userData.castShadow = false
    const shock = new Mesh(new PlaneGeometry(2100, 2100), createShockMaterial())
    shock.name = 'BlackMistPressureWave'
    shock.rotation.x = -Math.PI / 2
    shock.position.set(0, 25.2, -320)
    shock.renderOrder = 32
    shock.userData.castShadow = false
    return {
      curtains: mistCurtains(counts.curtains),
      plumes: mistPlumes(counts.plumes),
      ash: ashField(counts.ash),
      sky,
      shock,
      lightning: lightningChannels(),
    }
  }, [quality])

  useEffect(
    () => () => {
      for (const object of [...curtains, plumes, ash, sky, shock, lightning]) {
        object.geometry.dispose()
        object.material.dispose()
      }
    },
    [curtains, plumes, ash, sky, shock, lightning],
  )

  useFrame(({ camera }, delta) => {
    const runtime = blackMistRuntime,
      uniforms = BLACK_MIST_UNIFORMS
    if (group.current) group.current.visible = runtime.active
    if (!runtime.paused) visualTime.current += Math.min(delta, 0.1)
    uniforms.uMistTime.value = visualTime.current % 1000
    uniforms.uMistFront.value = runtime.front
    uniforms.uMistCorruption.value = runtime.active ? runtime.corruption : 0
    uniforms.uMistAmount.value = runtime.active ? smooth(0, 3.5, runtime.elapsed) : 0
    uniforms.uMistApproach.value = runtime.active ? smooth(1, 28, runtime.elapsed) : 0
    uniforms.uMistFlash.value = runtime.active && runtime.cinematic ? stormFlash(runtime.elapsed) : 0
    uniforms.uMistShock.value = runtime.active && runtime.cinematic ? (runtime.elapsed - 28.2) / 5.4 : -1
    // After the front passes, it becomes a distant western bank; the upper veil and ash remain.
    const wallVisible = runtime.active && runtime.elapsed < 52
    curtains.forEach((curtain, layer) => {
      curtain.position.x = runtime.front + layer * 220
      curtain.visible = wallVisible
    })
    plumes.position.x = runtime.front
    plumes.visible = wallVisible
    lightning.visible = uniforms.uMistFlash.value > 0.015
    sky.position.copy(camera.position)
    ash.position.copy(camera.position)
    ash.visible = runtime.active && runtime.elapsed > 7
    shock.visible = runtime.active && uniforms.uMistShock.value > 0 && uniforms.uMistShock.value < 1
  })

  return (
    <group ref={group} name="BlackMistVisuals" visible={false}>
      <primitive object={sky} />
      {curtains.map((curtain) => (
        <primitive key={curtain.uuid} object={curtain} />
      ))}
      <primitive object={plumes} />
      <primitive object={lightning} />
      <primitive object={shock} />
      <primitive object={ash} />
    </group>
  )
}
