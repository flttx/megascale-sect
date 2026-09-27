import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, ShaderMaterial, Vector3 } from 'three'
import type { PlayerRuntime } from './playerMotion'

const COUNT = 28
export function SwordWake({ runtime, color, active }: { runtime: RefObject<PlayerRuntime>; color: string; active: boolean }) {
  const mesh = useRef<Mesh>(null)
  const history = useMemo(() => Array.from({ length: COUNT }, () => new Vector3()), [])
  const initialized = useRef(false)
  const scratch = useMemo(() => ({ inverse: new Matrix4(), point: new Vector3() }), [])
  const geometry = useMemo(() => {
    const result = new BufferGeometry(), uv = new Float32Array(COUNT * 4), indices: number[] = []
    for (let i = 0; i < COUNT; i++) {
      uv.set([0, i / (COUNT - 1), 1, i / (COUNT - 1)], i * 4)
      if (i < COUNT - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    result.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 6), 3))
    result.setAttribute('uv', new BufferAttribute(uv, 2)); result.setIndex(indices)
    return result
  }, [])
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { tint: { value: new Color(color) }, strength: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 vUv; uniform vec3 tint; uniform float strength; void main(){float edge=pow(max(0.,1.-abs(vUv.x*2.-1.)),2.);float tail=clamp(1.-vUv.y,0.,1.);gl_FragColor=vec4(tint,edge*tail*tail*strength);}',
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  }), [color])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  useFrame(() => {
    if (!mesh.current) return
    const state = runtime.current, speed = state.velocity.length()
    mesh.current.visible = active && state.phase === 'FLIGHT' && speed > 0.8
    if (!mesh.current.visible) { initialized.current = false; return }
    if (!initialized.current || history[0].distanceTo(state.position) > 8) {
      history.forEach((point) => point.copy(state.position).setY(state.position.y - 0.04))
      initialized.current = true
    }
    for (let i = COUNT - 1; i > 0; i--) history[i].copy(history[i - 1])
    history[0].copy(state.position).y -= 0.04
    mesh.current.updateWorldMatrix(true, false)
    scratch.inverse.copy(mesh.current.matrixWorld).invert()
    const positions = geometry.attributes.position as BufferAttribute
    for (let i = 0; i < COUNT; i++) {
      const point = history[i], neighbor = history[Math.min(COUNT - 1, i + 1)]
      const dx = point.x - neighbor.x, dz = point.z - neighbor.z, length = Math.hypot(dx, dz) || 1
      const width = (0.11 + speed * 0.0015) * (1 - i / COUNT)
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1
        scratch.point.set(point.x + dz / length * width * sign, point.y, point.z - dx / length * width * sign).applyMatrix4(scratch.inverse)
        positions.setXYZ(i * 2 + side, scratch.point.x, scratch.point.y, scratch.point.z)
      }
    }
    positions.needsUpdate = true
    material.uniforms.strength.value = Math.min(0.65, speed / 55)
  })
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} name="CurvedSwordWake" />
}
