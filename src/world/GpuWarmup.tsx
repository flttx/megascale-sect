import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { create } from 'zustand'
import { HalfFloatType, LOD, Material, Object3D, ShaderMaterial, Texture, WebGLRenderTarget } from 'three'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { useWorldStore } from './store'
import { worldAssetsReady } from './worldAssets'
import { useEldritchLoadingStore, type EldritchLoadingStatus } from './blackMist/eldritchLoading'
import { QUALITY_PRESETS } from './quality'

/** Main-thread budget (ms) per frame for spreading texture uploads. */
const TEXTURE_BUDGET = 8
/** Quiet period (ms) after the last trigger, so late Suspense children are mounted before the pass. */
const SETTLE = 600

interface WarmupStatus {
  /** A pass is scheduled or running. */
  pending: boolean
  /** Completed passes. */
  runs: number
  /** Black Mist asset status when the last completed pass started: 'ready' means its creatures were warmed too. */
  eldritch: EldritchLoadingStatus
}
/** Low-frequency warm-up status for the intro, the Black Mist clock and its HUD. */
export const useGpuWarmupStore = create<WarmupStatus>(() => ({ pending: false, runs: 0, eldritch: 'idle' }))
/** Pass details for the DEV hook. */
const details = { running: false, failed: false, textures: 0, objects: 0 }
let serial = 0

/** True once the Black Mist creatures and mutations have been through a completed pass and none is pending. */
export function blackMistWarm() {
  const warm = useGpuWarmupStore.getState()
  return !warm.pending && warm.eldritch === 'ready' && useEldritchLoadingStore.getState().status === 'ready'
}

/** Scenes drawn outside the main scene straight to the canvas (e.g. speed lines); each pass draws them once too. */
const overlays = new Set<Scene>()
export function registerWarmupOverlay(scene: Scene) {
  overlays.add(scene)
  return () => {
    overlays.delete(scene)
  }
}

function materialsOf(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] }).material
  return material ? (Array.isArray(material) ? material : [material]) : []
}

function sceneTextures(scene: Scene) {
  const textures = new Set<Texture>()
  const add = (value: unknown) => {
    if (value instanceof Texture && !value.isRenderTargetTexture && value.image) textures.add(value)
  }
  scene.traverse((object) => {
    for (const material of materialsOf(object)) {
      for (const value of Object.values(material)) add(value)
      if (material instanceof ShaderMaterial) for (const uniform of Object.values(material.uniforms)) add(uniform.value)
    }
  })
  return [...textures]
}

/**
 * Draws every mesh once into a 1×1 target with culling, LOD switching and shadows off, so geometry buffers and any
 * program variant the compile pass missed are created now, then draws the overlay scenes into the canvas buffer they
 * use. All visibility state and the frame's draw statistics are restored before returning.
 */
function renderEverything(gl: WebGLRenderer, scene: Scene, camera: Camera, samples: number) {
  const hidden: Object3D[] = [],
    culled: Object3D[] = [],
    lods: LOD[] = []
  const visit = (object: Object3D) => {
    // The DEV graybox stand-ins stay hidden; nothing in play ever shows them.
    if (object.name === 'ENV_Graybox') return
    if (!object.visible) {
      hidden.push(object)
      object.visible = true
    }
    if (object.frustumCulled) {
      culled.push(object)
      object.frustumCulled = false
    }
    if (object instanceof LOD && object.autoUpdate) {
      lods.push(object)
      object.autoUpdate = false
    }
    object.children.forEach(visit)
  }
  visit(scene)
  overlays.forEach(visit)
  // Match the composer's scene buffer (half float, MSAA per tier): ANGLE builds its D3D shader variants per output
  // format, so a plain RGBA8 target would leave the real draw path cold.
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples })
  const previous = gl.getRenderTarget(),
    shadows = gl.shadowMap.autoUpdate,
    autoClear = gl.autoClear
  // The frame's draw statistics (HUD, budget checks) must not count this one-off pass.
  const stats = { ...gl.info.render }
  gl.shadowMap.autoUpdate = false
  try {
    gl.setRenderTarget(target)
    gl.render(scene, camera)
    // Overlays add to the canvas without clearing; they hold no opacity until their effect is live.
    gl.setRenderTarget(null)
    gl.autoClear = false
    overlays.forEach((overlay) => gl.render(overlay, camera))
  } finally {
    gl.autoClear = autoClear
    gl.setRenderTarget(previous)
    gl.shadowMap.autoUpdate = shadows
    Object.assign(gl.info.render, stats)
    target.dispose()
    hidden.forEach((object) => {
      object.visible = false
    })
    culled.forEach((object) => {
      object.frustumCulled = true
    })
    lods.forEach((lod) => {
      lod.autoUpdate = true
    })
  }
  return hidden.length + culled.length
}

/**
 * First-sight GPU work (texture upload, buffer upload, program link) used to stall single frames by 100–700 ms when
 * flight brought a region, LOD level, effect or creature into view. Pay it once behind a loading state instead: when
 * the world assets resolve (the intro holds Enter), after a quality change rebuilds materials, and when the Black Mist
 * creatures arrive (the cinematic holds its clock).
 */
export function GpuWarmup() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const ready = useWorldStore((state) => worldAssetsReady(state.assets))
  const quality = useWorldStore((state) => state.quality)
  const eldritch = useEldritchLoadingStore((state) => state.status)
  const loading = useProgress((state) => state.active)

  useEffect(() => {
    if (!ready || loading) return
    const run = ++serial
    let cancelled = false,
      frame = 0
    // Only the latest run owns the flags; a superseded one may still be settling its compile promise.
    const current = () => !cancelled && run === serial
    useGpuWarmupStore.setState({ pending: true })
    const finish = () => {
      if (run !== serial) return
      details.running = false
      const state = useGpuWarmupStore.getState()
      useGpuWarmupStore.setState(cancelled ? { pending: false } : { pending: false, runs: state.runs + 1, eldritch })
    }
    const timer = window.setTimeout(() => {
      details.running = true
      const queue = sceneTextures(scene)
      details.textures = queue.length
      const uploadTextures = () => {
        if (!current()) return finish()
        const end = performance.now() + TEXTURE_BUDGET
        while (queue.length && performance.now() < end) gl.initTexture(queue.pop()!)
        if (queue.length) {
          frame = requestAnimationFrame(uploadTextures)
          return
        }
        // A failed warm-up only means the old first-sight stalls come back; record it, never interrupt the world.
        void Promise.all([
          gl.compileAsync(scene, camera),
          ...[...overlays].map((overlay) => gl.compileAsync(overlay, camera)),
        ])
          .then(() => {
            if (current()) details.objects = renderEverything(gl, scene, camera, QUALITY_PRESETS[quality].msaa)
          })
          .catch(() => {
            details.failed = true
          })
          .finally(finish)
      }
      uploadTextures()
    }, SETTLE)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      finish()
    }
  }, [ready, loading, quality, eldritch, gl, scene, camera])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const hooks = window as unknown as Record<string, unknown>
    hooks.__gpuWarmup = () => ({ ...useGpuWarmupStore.getState(), ...details })
    return () => {
      delete hooks.__gpuWarmup
    }
  }, [])
  return null
}
