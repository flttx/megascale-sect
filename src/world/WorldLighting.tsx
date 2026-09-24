import { ACESFilmicToneMapping } from 'three'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

export function WorldLighting() {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping
    gl.toneMappingExposure = 1.13
  }, [gl])
  return (
    <>
      <ambientLight intensity={0.85} color="#e9f1ff" />
      <hemisphereLight args={['#edf4ff', '#536470', 1.45]} />
      <directionalLight position={[185, 310, 120]} intensity={2.25} color="#fff3dc" />
      <directionalLight position={[-110, 110, -330]} intensity={0.65} color="#b6c7e0" />
    </>
  )
}
