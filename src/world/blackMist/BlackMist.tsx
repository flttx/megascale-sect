import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, PerspectiveCamera, type Object3D } from 'three'
import { hasGameInput } from '../../ui/gameKeys'
import { uiBridge } from '../../ui/bridge'
import { useUiStore } from '../../ui/uiStore'
import { useWorldStore } from '../store'
import {
  blackMistRuntime,
  publishBlackMist,
  resetBlackMist,
  seekBlackMist,
  skipBlackMistCinematic,
  stepBlackMist,
  stepBlackMistMotion,
} from './runtime'
import { blackMistCameraSnapshot, updateBlackMistCamera } from './cinematics'
import { blackMistAudio } from './audio'
import type { CreatureRoarCue, HazardAudioCue } from './audio'
import { BlackMistEffects } from './BlackMistEffects'
import { EldritchLandmarks, eldritchMotionSnapshot } from './EldritchLandmarks'
import { EldritchAssetBoundary } from './EldritchAssetBoundary'
import { useEldritchLoadingStore } from './eldritchLoading'
import { eldritchAssetsSnapshot } from './eldritchAssets'
import { BuildingCorruption, buildingMutationSnapshot } from './BuildingCorruption'
import { colossusMutationSnapshot } from './ColossusMutation'
import { HorrorCreatures, horrorCreaturesSnapshot, horrorCreatureAudioStates } from './HorrorCreatures'
import { HORROR_LAYOUT } from './horrorLayout'
import { sampleBlackMistSky } from './skyProbe'
import { BlackMistHazards } from './BlackMistHazards'
import { blackMistHazardsSnapshot } from './hazards'
import { livingTissueSnapshot } from './LivingTissue'

const REVEAL_END = new Map(HORROR_LAYOUT.map((placement) => [placement.id, placement.revealEnd]))

/** The clock survives graphics recovery, with camera, sound and materials driven by the same timeline. */
export function BlackMist() {
  const mode = useWorldStore((state) => state.gameMode)
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const renderer = useThree((state) => state.gl)
  useFrame((_, delta) => {
    const r = blackMistRuntime,
      world = useWorldStore.getState()
    if (!r.active) return
    const blocked =
      !world.started ||
      uiBridge.graphicsBlocked ||
      document.hidden ||
      !world.characterReady[world.character] ||
      useEldritchLoadingStore.getState().status !== 'ready'
    const ui = useUiStore.getState()
    if (r.cinematic && !uiBridge.graphicsBlocked && world.cameraMode !== 'cinematic') world.setCameraMode('cinematic')
    r.paused =
      blocked ||
      r.manualPaused ||
      !!useUiStore.getState().overlay ||
      (!r.cinematic && world.cameraMode === 'player' && !hasGameInput())
    const settings =
      !r.cinematic &&
      !world.locked &&
      world.cameraMode === 'player' &&
      !r.awaitingExplore &&
      !ui.devInput &&
      !ui.photoUnlocked
    r.motionPaused = blocked || r.manualPaused || !!ui.overlay || settings
    stepBlackMist(delta)
    stepBlackMistMotion(delta)
  }, -2.5)
  useFrame(() => {
    if (camera instanceof PerspectiveCamera) updateBlackMistCamera(camera, scene)
    const r = blackMistRuntime
    let nearest = Math.hypot(camera.position.x, camera.position.y - 550, camera.position.z + 430)
    const creatureRoars: CreatureRoarCue[] = []
    for (const actor of horrorCreatureAudioStates()) {
      const { motion } = actor
      const dx = actor.position[0] - camera.position.x
      const dy = actor.position[1] + actor.height * 0.72 - camera.position.y
      const dz = actor.position[2] - camera.position.z
      const distance = Math.hypot(dx, dy, dz)
      nearest = Math.min(nearest, distance)
      if (r.active && r.elapsed >= (REVEAL_END.get(actor.id) ?? Infinity) && motion.roarEvent) {
        const right = camera.matrixWorld.elements
        creatureRoars.push({
          id: motion.roarEventId,
          creature: actor.id,
          sourceType: actor.sourceType,
          cycle: motion.cycle,
          strength: motion.roarStrength * (0.16 + 0.84 / (1 + Math.pow(distance / 1000, 2))),
          pan: distance > 1 ? (dx * right[0] + dy * right[1] + dz * right[2]) / distance : 0,
          duration: Math.max(0.05, motion.roarEnd - motion.cycleTime),
        })
      }
    }
    const dread = r.corruption * Math.max(r.cinematic ? 0.55 : 0.16, Math.exp(-nearest / 700))
    const hazardState = blackMistHazardsSnapshot(),
      hazardCues: HazardAudioCue[] = []
    if (hazardState.enabled)
      for (const threat of hazardState.actors) {
        if (threat.phase !== 'windup' && threat.phase !== 'strike') continue
        const dx = threat.root[0] - camera.position.x,
          dy = threat.root[1] - camera.position.y,
          dz = threat.root[2] - camera.position.z
        const distance = Math.hypot(dx, dy, dz),
          right = camera.matrixWorld.elements
        hazardCues.push({
          id: threat.id,
          serial: threat.attackSerial,
          phase: threat.phase,
          progress: threat.progress,
          kind: threat.kind,
          pan: Math.max(-1, Math.min(1, distance > 1 ? (dx * right[0] + dy * right[1] + dz * right[2]) / distance : 0)),
          strength: 0.2 + 0.8 / (1 + (distance / 450) ** 2),
        })
      }
    blackMistAudio.update({
      ...r,
      dread,
      creatureRoars,
      hazardCues,
      hazardHitId: hazardState.hits.at(-1)?.id,
      paused: r.motionPaused || !useWorldStore.getState().soundEnabled,
    })
  }, -0.5)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const hooks = window as unknown as Record<string, unknown>
    hooks.__blackMist = {
      reset: resetBlackMist,
      seek: seekBlackMist,
      skip: skipBlackMistCinematic,
      skyProbe: (directions: unknown) => sampleBlackMistSky(renderer, scene, directions),
      hold: (value: boolean) => {
        blackMistRuntime.testHeld = value
        blackMistRuntime.testMotionHeld = value
      },
      motionHold: (value: boolean) => {
        blackMistRuntime.testMotionHeld = value
      },
      seekMotion: (value: number) => {
        if (Number.isFinite(value)) blackMistRuntime.motionTime = Math.max(0, value)
      },
      snapshot: () => {
        publishBlackMist()
        const sceneNames: string[] = []
        const models: Record<string, unknown>[] = []
        scene.traverse((object) => {
          if (!object.name || (!('isMesh' in object) && !('isPoints' in object))) return
          for (let parent: Object3D | null = object; parent; parent = parent.parent) {
            if (!parent.visible) return
          }
          sceneNames.push(object.name)
          if (object instanceof Mesh && object.userData.eldritch) {
            models.push({
              name: object.name,
              ...object.userData.eldritch,
              instances: 'count' in object && typeof object.count === 'number' ? object.count : 1,
            })
          }
        })
        return {
          ...blackMistRuntime,
          audio: blackMistAudio.snapshot(),
          camera: camera.position.toArray(),
          cameraShot: blackMistCameraSnapshot(),
          sceneNames,
          models,
          mutations: { buildings: buildingMutationSnapshot(), carriers: colossusMutationSnapshot() },
          motion: {
            time: blackMistRuntime.motionTime,
            paused: blackMistRuntime.motionPaused || blackMistRuntime.testMotionHeld,
            landmarks: eldritchMotionSnapshot(),
            carriers: colossusMutationSnapshot(),
          },
          creatures: horrorCreaturesSnapshot(),
          hazards: blackMistHazardsSnapshot(),
          tissue: livingTissueSnapshot(),
          assets: { ...eldritchAssetsSnapshot(), ...useEldritchLoadingStore.getState() },
          landmarks: ['eldritch-eye', 'eldritch-tentacles'].map((name) => {
            const object = scene.getObjectByName(name)
            return { name, visible: object?.visible ?? false, scale: object?.scale.toArray() }
          }),
        }
      },
    }
    return () => {
      delete hooks.__blackMist
    }
  }, [camera, scene, renderer])
  useEffect(() => () => blackMistAudio.dispose(), [])
  if (mode !== 'black-mist') return null
  return (
    <group name="black-mist-world">
      <BlackMistEffects />
      <EldritchAssetBoundary>
        <EldritchLandmarks />
        <BuildingCorruption />
        <HorrorCreatures />
      </EldritchAssetBoundary>
      <BlackMistHazards />
    </group>
  )
}
