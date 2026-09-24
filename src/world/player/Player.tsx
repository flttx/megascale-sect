import { Suspense, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import { LAYOUT } from '../worldLayout'
import { useWorldStore } from '../store'
import { CameraRig, updateCameraRig } from './CameraRig'
import { CharacterVisual } from './CharacterVisual'
import { createPlayerRuntime, isAirborne, requestFlightToggle, stepPlayer } from './playerMotion'
import { type CharacterId } from './characterAssets'
import { playerAudio } from './playerAudio'

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
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ([' ', 'alt', 'f3', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault()
      if (event.repeat) return
      const store = useWorldStore.getState()
      if (key === 'f3') store.toggleDebug()
      if (key === 'g') store.toggleHelpers()
      if (key === 'm') store.toggleSound()
      if (key === '1' || key === '2') store.selectCharacter(key === '1' ? 'male' : 'female')
      if (!store.started || !store.locked) return
      if (['w', 'a', 's', 'd', 'control'].includes(key)) event.preventDefault()
      keys.current.add(key)
      if (key === 'f') {
        store.setNotice(requestFlightToggle(runtime.current))
        store.setPhase(runtime.current.phase)
      }
    }
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const mouse = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return
      if (event.altKey || keys.current.has('alt')) {
        freeLook.current = true
        viewYaw.current += event.movementX * 0.0025
        viewPitch.current = Math.max(-0.8, Math.min(1.05, viewPitch.current - event.movementY * 0.0022))
      } else {
        runtime.current.yaw += event.movementX * 0.0025
        runtime.current.pitch = Math.max(-0.8, Math.min(1.05, runtime.current.pitch - event.movementY * 0.0022))
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
      fov: camera.fov, bank: runtime.current.bank, velocity: runtime.current.velocity.toArray(), stride: runtime.current.stride,
      cameraDistance: camera.position.distanceTo(runtime.current.position),
      characterReady: useWorldStore.getState().characterReady, audio: playerAudio.snapshot(),
      yaw: runtime.current.yaw, pitch: runtime.current.pitch,
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
      playerAudio.dispose()
    }
  }, [camera, gl])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const state = runtime.current
    const store = useWorldStore.getState()
    state.ready = store.characterReady[store.character]
    state.braking = keys.current.has('x')
    const current = keys.current
    input.current.set(
      Number(current.has('d')) - Number(current.has('a')),
      Number(current.has(' ')) - Number(current.has('control') || current.has('c')),
      Number(current.has('s')) - Number(current.has('w')),
    )
    if (!store.started || !store.locked || !state.ready) input.current.set(0, 0, 0)
    if (store.started && store.locked && state.ready) stepPlayer(state, input.current, current.has('shift'), delta)
    else { state.time += delta; state.velocity.set(0, 0, 0); state.gait *= Math.exp(-14 * delta) }
    playerAudio.update(state, store.started && store.locked && state.ready, store.soundEnabled)
    if (store.phase !== state.phase) store.setPhase(state.phase)
    if (avatar.current) {
      avatar.current.position.copy(state.position)
      avatar.current.rotation.y = -state.facing
    }
    const mode = isAirborne(state.phase) || state.phase === 'BOARDING' ? 'FLIGHT' : 'GROUND'
    if (!keys.current.has('alt')) {
      if (freeLook.current) {
        const difference = Math.atan2(Math.sin(state.yaw - viewYaw.current), Math.cos(state.yaw - viewYaw.current))
        viewYaw.current += difference * (1 - Math.exp(-7 * delta))
        viewPitch.current += (state.pitch - viewPitch.current) * (1 - Math.exp(-7 * delta))
        if (Math.abs(difference) < 0.002 && Math.abs(state.pitch - viewPitch.current) < 0.002) freeLook.current = false
      } else { viewYaw.current = state.yaw; viewPitch.current = state.pitch }
    }
    updateCameraRig(camera, state.position, viewYaw.current, viewPitch.current, mode, delta, state.velocity.length(), state.bank, state.impact)
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
  </>
}
