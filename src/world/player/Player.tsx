import { Suspense, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import { LAYOUT } from '../worldLayout'
import { useWorldStore } from '../store'
import { CameraRig, resetCameraRig, updateCameraRig } from './CameraRig'
import { SpeedLines } from './SpeedLines'
import { CharacterVisual } from './CharacterVisual'
import { carryPlayer, createPlayerRuntime, isAirborne, JUMP_BUFFER, requestFlightToggle, stepPlayer, updatePlayerSupport } from './playerMotion'
import { simulationDelta } from '../simulation'
import { type CharacterId } from './characterAssets'
import { playerAudio } from './playerAudio'
import { bindPlayerRuntime } from './playerHandle'
import { isUiInput } from '../../ui/gameKeys'
import { useUiStore } from '../../ui/uiStore'

export function Player() {
  const avatar = useRef<Group>(null)
  const runtime = useRef(createPlayerRuntime())
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const character = useWorldStore((state) => state.character)
  const ready = useWorldStore((state) => state.characterReady)
  const visibleCharacter = useRef<CharacterId>('male')
  if (ready[character]) visibleCharacter.current = character
  const keys = useRef(new Set<string>())
  const input = useRef(new Vector3())
  const elapsed = useRef(0)
  const frames = useRef(0)
  const viewYaw = useRef(0)
  const viewPitch = useRef(0.1)
  const freeLook = useRef(false)

  useEffect(() => {
    camera.position.set(0, 2.75, LAYOUT.spawn.position[2] + 4.8)
    const unbind = bindPlayerRuntime(runtime.current)
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.code === 'MetaLeft' || event.code === 'MetaRight') { keys.current.clear(); return }
      if (isUiInput(event)) return
      const key = event.code
      const store = useWorldStore.getState()
      if (!store.started || !(store.locked || (import.meta.env.DEV && useUiStore.getState().devInput))) return
      if (event.ctrlKey) { keys.current.clear(); return }
      if (['Space', 'AltLeft', 'AltRight', 'F3', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(key)) event.preventDefault()
      if (event.repeat) return
      if (key === 'F3') store.toggleDebug()
      if (key === 'KeyG') store.toggleHelpers()
      if (key === 'KeyM') store.toggleSound()
      if (key === 'Digit1' || key === 'Digit2') store.selectCharacter(key === 'Digit1' ? 'male' : 'female')
      keys.current.add(key)
      if (key === 'Space' && runtime.current.phase === 'GROUND' && !runtime.current.takeoffTime && runtime.current.ready && store.cameraMode === 'player') runtime.current.jumpBuffer = JUMP_BUFFER
      if (key === 'KeyF' && store.cameraMode === 'player') {
        store.setNotice(requestFlightToggle(runtime.current))
        store.setPhase(runtime.current.phase)
      }
    }
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code); if (event.metaKey || event.code.startsWith('Meta')) keys.current.clear() }
    const mouse = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return
      const { cameraMode, mouseSensitivity } = useWorldStore.getState()
      if (cameraMode !== 'player') return
      const look = mouseSensitivity
      if (event.altKey || keys.current.has('AltLeft') || keys.current.has('AltRight')) {
        freeLook.current = true
        viewYaw.current += event.movementX * 0.0025 * look
        viewPitch.current = Math.max(-0.8, Math.min(1.05, viewPitch.current - event.movementY * 0.0022 * look))
      } else {
        runtime.current.yaw += event.movementX * 0.0025 * look
        runtime.current.pitch = Math.max(-0.8, Math.min(1.05, runtime.current.pitch - event.movementY * 0.0022 * look))
      }
    }
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', mouse)
    window.addEventListener('blur', clear)
    document.addEventListener('pointerlockchange', clear)
    const debugWindow = window as Window & { __playerSnapshot?: (inspectContact?: boolean) => unknown }
    if (import.meta.env.DEV) debugWindow.__playerSnapshot = (inspectContact = false) => ({
      character: useWorldStore.getState().character,
      phase: runtime.current.phase, position: runtime.current.position.toArray(),
      elapsed: runtime.current.elapsed, ready: runtime.current.ready,
      sword: avatar.current?.getObjectByName(`Sword_${useWorldStore.getState().character}`)?.name,
      telemetry: useWorldStore.getState().telemetry,
      fov: camera.fov, bank: runtime.current.bank, velocity: runtime.current.velocity.toArray(),
      stride: avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.userData.clips?.().stride,
      clips: avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.userData.clips?.(),
      cameraDistance: camera.position.distanceTo(runtime.current.position),
      characterReady: useWorldStore.getState().characterReady, audio: playerAudio.snapshot(),
      yaw: runtime.current.yaw, pitch: runtime.current.pitch,
      keys: [...keys.current], inAir: runtime.current.inAir, takeoffTime: runtime.current.takeoffTime,
      aboard: runtime.current.aboard ? { triangle: runtime.current.aboard.triangle, u: runtime.current.aboard.u, v: runtime.current.aboard.v, point: runtime.current.aboard.point.toArray() } : null,
      carrierVelocity: runtime.current.carrierVelocity.toArray(), carrierDelta: runtime.current.carrierDelta.toArray(),
      feet: avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.userData.footPlant?.snapshot(),
      ridingPose: avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.userData.ridingPose?.(),
      ridingContact: inspectContact ? avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.userData.ridingContact?.() : undefined,
      bones: avatar.current?.getObjectByProperty('type', 'SkinnedMesh') ? true : false,
      joints: (() => { const joints: Record<string, number[]> = {}; avatar.current?.getObjectByName(`Character_${useWorldStore.getState().character}`)?.traverse((object) => { if (object.type === 'Bone') joints[object.name] = object.quaternion.toArray() }); return joints })(),
    })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', mouse)
      window.removeEventListener('blur', clear)
      document.removeEventListener('pointerlockchange', clear)
      delete debugWindow.__playerSnapshot
      unbind()
      playerAudio.dispose()
    }
  }, [camera, gl])

  useFrame((_, rawDelta) => {
    const delta = simulationDelta(rawDelta)
    const state = runtime.current
    const store = useWorldStore.getState()
    state.ready = store.characterReady[store.character]
    viewYaw.current -= carryPlayer(state, delta)
    state.braking = keys.current.has('KeyX')
    const current = keys.current
    input.current.set(
      Number(current.has('KeyD')) - Number(current.has('KeyA')),
      Number(current.has('Space')) - Number(current.has('KeyC')),
      Number(current.has('KeyS')) - Number(current.has('KeyW')),
    )
    // Scripted and photo cameras freeze the player in place; the world keeps simulating.
    const controlling = store.started && store.locked && state.ready && store.cameraMode === 'player'
    if (!controlling) input.current.set(0, 0, 0)
    if (store.started && store.locked && state.ready) stepPlayer(state, input.current, current.has('ShiftLeft') || current.has('ShiftRight'), delta)
    else { state.time += delta; if (state.phase === 'GROUND') state.velocity.set(0, 0, 0) }
    updatePlayerSupport(state)
    playerAudio.update(state, store.started && store.locked && state.ready, store.soundEnabled)
    if (store.phase !== state.phase) store.setPhase(state.phase)
    if (avatar.current) {
      avatar.current.position.copy(state.position)
      avatar.current.rotation.y = -state.facing
    }
    const mode = isAirborne(state.phase) || state.phase === 'BOARDING' ? 'FLIGHT' : 'GROUND'
    if (!keys.current.has('AltLeft') && !keys.current.has('AltRight')) {
      if (freeLook.current) {
        const difference = Math.atan2(Math.sin(state.yaw - viewYaw.current), Math.cos(state.yaw - viewYaw.current))
        viewYaw.current += difference * (1 - Math.exp(-7 * delta))
        viewPitch.current += (state.pitch - viewPitch.current) * (1 - Math.exp(-7 * delta))
        if (Math.abs(difference) < 0.002 && Math.abs(state.pitch - viewPitch.current) < 0.002) freeLook.current = false
      } else { viewYaw.current = state.yaw; viewPitch.current = state.pitch }
    }
    if (store.cameraMode === 'player') updateCameraRig(camera, state.position, viewYaw.current, viewPitch.current, mode, delta, mode === 'FLIGHT' ? state.velocity.length() : Math.hypot(state.velocity.x, state.velocity.z), state.bank, state.impact, store.fov, state.landing)
    // Any other camera (photo, cinematic) leaves the follow rig stale: it starts over when the player view returns.
    else resetCameraRig()
    elapsed.current += rawDelta
    frames.current++
    if (elapsed.current >= 0.25) {
      const p = state.position
      const main = LAYOUT.main.position
      store.setTelemetry({
        fps: frames.current / elapsed.current, position: [p.x, p.y, p.z], mode,
        speed: state.velocity.length(), distance: Math.hypot(p.x - main[0], p.y - main[1], p.z - main[2]),
        altitude: p.y, drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: gl.getPixelRatio(),
      })
      elapsed.current = 0
      frames.current = 0
    }
  }, -1)

  return <>
    <group ref={avatar} name="playerRoot">
      {(['male', 'female'] as CharacterId[]).map((id) => <Suspense key={id} fallback={null}>
        <CharacterVisual runtime={runtime} character={id} active={visibleCharacter.current === id} />
      </Suspense>)}
    </group>
    <CameraRig camera={camera} />
    <SpeedLines />
  </>
}
