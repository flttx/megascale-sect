import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Box3, Euler, Group, Matrix4, Mesh, Quaternion, SkinnedMesh, Texture, Vector3 } from 'three'
import { CHARACTER_ASSETS, type CharacterId } from './characterAssets'
import { useWorldStore } from '../store'
import { FLIGHT_SEQUENCE, isAirborne, smooth, type PlayerRuntime } from './playerMotion'
import { prepareCharacterRig, updateCharacterPose } from './characterPose'
import { SwordEffects } from './SwordEffects'

const flyingSword = new Quaternion().setFromEuler(new Euler(Math.PI / 2, Math.PI / 2, 0))
const materializingSword = new Quaternion().setFromEuler(new Euler(0.2, Math.PI / 2, -0.5))
const wornSword = new Quaternion().setFromEuler(new Euler(0.15, Math.PI / 2, -0.32))
const wornPosition = new Vector3(0.28, 1.08, 0.25), wornScale = new Vector3(0.53, 0.53, 0.53)
const worn = new Matrix4(), chestMotion = new Matrix4()

export function CharacterVisual({ runtime, character, active }: { runtime: RefObject<PlayerRuntime>; character: CharacterId; active: boolean }) {
  const config = CHARACTER_ASSETS[character]
  const [model, weapon, motion] = useGLTF([config.model, config.sword, config.anim], false)
  const gl = useThree((state) => state.gl)
  const assembly = useRef<Group>(null)
  const actor = useRef<Group>(null)
  const bodyOffset = useRef<Group>(null)
  const sword = useRef<Group>(null)
  const difference = useMemo(() => new Vector3(), [])
  const ridingSword = useMemo(() => flyingSword.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), config.swordRoll)), [config])
  const data = useMemo(() => {
    const scene = clone(model.scene)
    const rig = prepareCharacterRig(scene, motion.animations, config.gaits)
    const box = new Box3().setFromObject(scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = config.height / size.y
    // The worn sword was fitted to the rest pose; it rides on the chest's motion away from it (the clips' bob and lean).
    const chest = rig.joints.get('Spine2')?.bone ?? null
    const chestRest = new Matrix4()
    if (chest) chestRest.makeRotationY(config.rotationY).scale(new Vector3(scale, scale, scale))
      .multiply(new Matrix4().compose(new Vector3(-center.x, -box.min.y, -center.z), scene.quaternion, scene.scale))
      .multiply(scene.matrixWorld.clone().invert().multiply(chest.matrixWorld))
      .invert()
    const swordScene = weapon.scene.clone(true)
    const swordBox = new Box3().setFromObject(swordScene)
    const swordSize = swordBox.getSize(new Vector3())
    return { scene, rig, center, box, scale, chest, chestRest, swordScene, swordCenter: swordBox.getCenter(new Vector3()), swordScale: config.swordLength / swordSize.y }
  }, [model, weapon, motion, config])

  useEffect(() => {
    if (assembly.current && import.meta.env.DEV) assembly.current.userData.footPlant = data.rig.footPlant
    if (assembly.current && import.meta.env.DEV) assembly.current.userData.ridingPose = () => data.rig.ridingPose.snapshot(assembly.current!)
    if (assembly.current && import.meta.env.DEV) assembly.current.userData.clips = () => data.rig.clips.snapshot()
    if (assembly.current && import.meta.env.DEV) assembly.current.userData.ridingContact = () => data.rig.ridingPose.measureContact(assembly.current!, sword.current!)
    // Upload both small texture sets during loading, before the first switch.
    for (const scene of [data.scene, data.swordScene]) scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) gl.initTexture(value)
      }
    })
    useWorldStore.getState().setCharacterReady(character, true)
    console.info(`[PLAYER ${character}]`, { height: config.height, bones: data.rig.joints.size, scale: data.scale, swordLength: config.swordLength })
  }, [character, config, data, gl])
  useEffect(() => () => { data.scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.dispose() }) }, [data])
  useEffect(() => { data.rig.footPlant.reset(); data.rig.clips.reset() }, [active, data])

  useFrame((_, delta) => {
    if (!active || !assembly.current || !actor.current || !sword.current || !bodyOffset.current) return
    const state = runtime.current
    const airborne = isAirborne(state.phase)
    const speed = state.velocity.length()
    assembly.current.rotation.set(airborne ? state.climb * 0.38 : 0, 0, airborne ? state.bank : 0)
    assembly.current.position.y = airborne ? Math.sin(state.time * 2.5) * 0.025 : 0
    actor.current.rotation.x = state.rideMix * (state.braking ? 0.025 : -Math.min(0.035, speed * 0.0005))
    bodyOffset.current.position.y = updateCharacterPose(data.rig, state, Math.min(delta, 0.05))
    data.scene.updateWorldMatrix(true, true)
    data.rig.footPlant.update(state, data.rig.clips.stride, data.rig.clips.duty)
    data.rig.ridingPose.update(state, assembly.current, data.scale, data.box.min.y)

    if (state.phase === 'GROUND') {
      worn.compose(wornPosition, wornSword, wornScale)
      if (data.chest) worn.premultiply(chestMotion.copy(assembly.current.matrixWorld).invert().multiply(data.chest.matrixWorld).multiply(data.chestRest))
      worn.decompose(sword.current.position, sword.current.quaternion, sword.current.scale)
    } else if (state.phase === 'SUMMONING') {
      const t = Math.min(1, state.elapsed / FLIGHT_SEQUENCE.summon)
      const curve = smooth(t)
      sword.current.position.set(1.35 * (1 - curve), FLIGHT_SEQUENCE.hover + config.swordDeckOffset + (1 - curve) * 1.15 + Math.sin(t * Math.PI) * 0.25, -FLIGHT_SEQUENCE.step - Math.sin(t * Math.PI) * 0.75)
      sword.current.quaternion.slerpQuaternions(materializingSword, ridingSword, curve)
      sword.current.scale.setScalar(smooth(t / 0.45))
    } else if (state.phase === 'BOARDING') {
      difference.subVectors(state.destination, state.position)
      const c = Math.cos(state.sequenceYaw), s = Math.sin(state.sequenceYaw)
      sword.current.position.set(c * difference.x + s * difference.z, difference.y + config.swordDeckOffset, -s * difference.x + c * difference.z)
      sword.current.quaternion.copy(ridingSword)
      sword.current.scale.setScalar(1)
    } else if (state.phase === 'DISMOUNTING') {
      const t = Math.min(1, state.elapsed / FLIGHT_SEQUENCE.dismount)
      sword.current.position.set(0, state.origin.y - state.position.y + config.swordDeckOffset, 0)
      sword.current.quaternion.copy(ridingSword)
      sword.current.scale.setScalar(1 - smooth(t))
    } else {
      sword.current.position.set(0, config.swordDeckOffset, 0)
      sword.current.quaternion.copy(ridingSword)
      // Grows in underfoot when it catches a fall (rideMix is already ~1 after boarding).
      sword.current.scale.setScalar(smooth(state.rideMix * 2.5))
    }
    if (state.phase !== 'GROUND') sword.current.position.x += config.swordLateralOffset
  })

  return (
    <group ref={assembly} name={`Character_${character}`} visible={active}>
      <group ref={actor}>
        <group rotation={[0, config.rotationY, 0]} scale={data.scale}>
          <group ref={bodyOffset}>
            <primitive object={data.scene} position={[-data.center.x, -data.box.min.y, -data.center.z]} dispose={null} />
          </group>
        </group>
      </group>
      <group ref={sword} name={`Sword_${character}`}>
        <group scale={data.swordScale}>
          <primitive object={data.swordScene} position={[-data.swordCenter.x, -data.swordCenter.y, -data.swordCenter.z]} dispose={null} />
        </group>
      </group>
      <SwordEffects runtime={runtime} character={character} active={active} />
    </group>
  )
}
