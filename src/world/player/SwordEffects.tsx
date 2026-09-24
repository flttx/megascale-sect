import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PointsMaterial, ShaderMaterial, Vector3 } from 'three'
import type { RefObject } from 'react'
import { CHARACTER_ASSETS, type CharacterId } from './characterAssets'
import { FLIGHT_SEQUENCE, isAirborne, smooth, type PlayerRuntime } from './playerMotion'
import { SwordWake } from './SwordWake'

const glowVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const glowFragment = `uniform vec3 tint; uniform float opacity; varying vec2 vUv;
void main(){float d=length((vUv-.5)*2.);float a=pow(max(0.,1.-d),2.7);gl_FragColor=vec4(tint,a*opacity);}`

export function SwordEffects({ runtime, character, active }: { runtime: RefObject<PlayerRuntime>; character: CharacterId; active: boolean }) {
  const root = useRef<Group>(null)
  const circle = useRef<Group>(null)
  const flare = useRef<Mesh>(null)
  const tail = useRef<Group>(null)
  const particleMaterial = useRef<PointsMaterial>(null)
  const ringMaterial = useRef<MeshBasicMaterial>(null)
  const burst = useRef<Mesh>(null)
  const burstMaterial = useRef<MeshBasicMaterial>(null)
  const column = useRef<Group>(null)
  const offset = useMemo(() => new Vector3(), [])
  const colors = CHARACTER_ASSETS[character]
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(72 * 3), 3))
    return g
  }, [])
  const glow = useMemo(() => new ShaderMaterial({
    uniforms: { tint: { value: new Color(colors.color) }, opacity: { value: 0 } },
    vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
  }), [colors.color])
  const trail = useMemo(() => new ShaderMaterial({
    uniforms: { tint: { value: new Color(colors.color) }, opacity: { value: 0 } },
    vertexShader: glowVertex,
    fragmentShader: `uniform vec3 tint; uniform float opacity; varying vec2 vUv;
      void main(){float width=mix(.48,.03,vUv.y);float edge=1.-smoothstep(0.,width,abs(vUv.x-.5));
      gl_FragColor=vec4(tint,edge*pow(1.-vUv.y,1.7)*opacity);}`,
    transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
  }), [colors.color])
  useEffect(() => () => { geometry.dispose(); glow.dispose(); trail.dispose() }, [geometry, glow, trail])

  useFrame(() => {
    if (!active) return
    const state = runtime.current
    if (!root.current || !circle.current || !flare.current || !tail.current) return
    const summoning = state.phase === 'SUMMONING'
    const boarding = state.phase === 'BOARDING'
    const airborne = isAirborne(state.phase)
    root.current.visible = summoning || boarding || airborne || state.impact > 0.02
    if (!root.current.visible) return
    const t = state.elapsed / FLIGHT_SEQUENCE.summon
    const energy = summoning ? Math.sin(Math.PI * Math.min(t, 1)) : boarding ? 0.55 * (1 - state.elapsed / FLIGHT_SEQUENCE.board) + state.impact * 0.6 : state.impact
    const speed = state.velocity.length()
    circle.current.visible = summoning || boarding
    offset.subVectors(state.destination, state.position)
    const c = Math.cos(state.sequenceYaw), s = Math.sin(state.sequenceYaw)
    circle.current.position.set(summoning || boarding ? c * offset.x + s * offset.z : 0, summoning || boarding ? offset.y - 0.23 : 0.015, summoning || boarding ? -s * offset.x + c * offset.z : 0)
    circle.current.rotation.y = state.time * 1.2
    circle.current.scale.setScalar(0.5 + smooth(t) * 0.55)
    if (ringMaterial.current) ringMaterial.current.opacity = Math.max(0, energy) * 0.82
    flare.current.position.copy(circle.current.position)
    flare.current.position.y += 0.25
    flare.current.scale.setScalar(summoning ? 1 + energy : 0.7)
    glow.uniforms.opacity.value = summoning || boarding ? Math.max(0, energy) * 1.05 : 0.2 + state.impact * 0.9
    if (column.current) {
      column.current.visible = summoning
      column.current.position.copy(circle.current.position).y += 0.8
      column.current.scale.set(0.3 + energy * 0.6, 0.4 + energy, 0.3 + energy * 0.6)
    }
    if (burst.current && burstMaterial.current) {
      burst.current.visible = state.impact > 0.025
      burst.current.position.set(0, 0.02, 0)
      burst.current.scale.setScalar(0.5 + (1 - state.impact) * 3)
      burstMaterial.current.opacity = state.impact * 0.85
    }
    const points = geometry.attributes.position as BufferAttribute
    for (let i = 0; i < points.count; i++) {
      const fraction = i / points.count
      const angle = fraction * Math.PI * 10 + state.time * (summoning ? 5 : 2)
      const radius = summoning ? (1.6 - smooth(t) * 1.25) * (0.35 + fraction * 0.65) : 0.35 + fraction * 0.35
      const life = (fraction + state.time * 0.5) % 1
      points.setXYZ(i, Math.cos(angle) * radius, circle.current.position.y + life * (summoning ? 1.4 : 0.3), circle.current.position.z + Math.sin(angle) * radius + (airborne ? fraction * (2 + speed * 0.07) : 0))
    }
    points.needsUpdate = true
    if (particleMaterial.current) particleMaterial.current.opacity = summoning || boarding ? Math.max(0.1, energy) : Math.min(0.7, speed / 35 + 0.15)
    tail.current.visible = state.phase === 'FLIGHT' || state.phase === 'LANDING'
    tail.current.scale.set(1, 1, 0.35 + Math.min(speed, 70) / 12)
    trail.uniforms.opacity.value = Math.min(0.6, 0.12 + speed / 100)
  })

  return (
    <>
    <SwordWake runtime={runtime} color={colors.color} active={active} />
    <group ref={root} name="SwordSummonVFX">
      <mesh ref={burst} rotation={[-Math.PI / 2, 0, 0]} name="SwordContactPulse">
        <ringGeometry args={[0.48, 0.53, 64]} />
        <meshBasicMaterial ref={burstMaterial} color={colors.secondaryColor} transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
      </mesh>
      <group ref={column}>
        {[0, Math.PI / 2].map((angle) => <mesh key={angle} rotation={[0, angle, 0]} material={glow}><planeGeometry args={[1.4, 2.2]} /></mesh>)}
      </group>
      <group ref={circle}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.72, 0.75, 64]} />
          <meshBasicMaterial ref={ringMaterial} color={colors.color} transparent blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 0.915, 64, 1, 0, Math.PI * 1.65]} />
          <meshBasicMaterial color={colors.secondaryColor} transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
        </mesh>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[Math.cos(i * Math.PI / 6) * 0.83, 0, Math.sin(i * Math.PI / 6) * 0.83]} rotation={[-Math.PI / 2, 0, -i * Math.PI / 6]}>
            <planeGeometry args={[0.012, i % 3 === 0 ? 0.17 : 0.065]} />
            <meshBasicMaterial color={colors.secondaryColor} transparent opacity={0.7} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
          </mesh>
        ))}
      </group>
      <mesh ref={flare} rotation={[-Math.PI / 2, 0, 0]} material={glow}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points geometry={geometry} frustumCulled={false}>
        <pointsMaterial ref={particleMaterial} color={colors.color} size={0.035} sizeAttenuation transparent blending={AdditiveBlending} depthWrite={false} />
      </points>
      <group ref={tail} position={[0, -0.12, 0.6]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.7]} material={trail}>
          <planeGeometry args={[0.4, 1.6]} />
        </mesh>
        <mesh position={[0, 0.005, 0.5]} rotation={[-Math.PI / 2, 0, 0]} material={glow} scale={[0.45, 1.6, 1]}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>
    </group>
    </>
  )
}
