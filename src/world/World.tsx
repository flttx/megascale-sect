import { Suspense } from 'react'
import { Html, useGLTF } from '@react-three/drei'
import { MainBuilding } from './assets/MainBuilding'
import { Gate } from './assets/Gate'
import { SideTower } from './assets/SideTower'
import { MainRoad } from './environment/MainRoad'
import { GrandStairs } from './environment/GrandStairs'
import { MainPlatform } from './environment/MainPlatform'
import { Cliffs } from './environment/Cliffs'
import { Player } from './player/Player'
import { WorldLighting } from './WorldLighting'
import { WorldEnvironment } from './WorldEnvironment'
import { useWorldStore } from './store'
import { ASSETS } from './worldAssets'
import { LAYOUT } from './worldLayout'
import { EnvironmentT02R, EnvironmentReview } from './environment/t02r/EnvironmentT02R'
import { QualityManager } from './quality'

ASSETS.forEach((asset) => useGLTF.preload([asset.url, asset.lodUrl]))

function DebugHelpers() {
  const show = useWorldStore((state) => state.showHelpers)
  if (!show) return null
  return (
    <group>
      <gridHelper args={[1000, 100, '#e3c479', '#8293a2']} position={[0, 0.08, 0]} />
      <mesh position={[0, LAYOUT.stairs.height / 2, (LAYOUT.stairs.startZ + LAYOUT.stairs.endZ) / 2]} rotation={[Math.atan2(LAYOUT.stairs.height, LAYOUT.stairs.startZ - LAYOUT.stairs.endZ), 0, 0]}>
        <boxGeometry args={[LAYOUT.stairs.width, 0.25, Math.hypot(LAYOUT.stairs.startZ - LAYOUT.stairs.endZ, LAYOUT.stairs.height)]} />
        <meshBasicMaterial color="#46e3d0" wireframe depthTest={false} />
      </mesh>
      <mesh position={[LAYOUT.main.position[0], (LAYOUT.mainCollider.minY + LAYOUT.mainCollider.maxY) / 2, LAYOUT.main.position[2]]}>
        <boxGeometry args={[LAYOUT.mainCollider.halfWidth * 2, LAYOUT.mainCollider.maxY - LAYOUT.mainCollider.minY, LAYOUT.mainCollider.halfDepth * 2]} />
        <meshBasicMaterial color="#e0ac7a" wireframe transparent opacity={0.28} depthTest={false} />
      </mesh>
      {[
        ['SPAWN', LAYOUT.spawn.position], ['MG02', LAYOUT.gate.position],
        ['MG01', LAYOUT.main.position],
      ].map(([name, position]) => (
        <Html key={name as string} position={position as [number, number, number]} center distanceFactor={30}>
          <span className="world-label">{name as string}</span>
        </Html>
      ))}
    </group>
  )
}

export function World() {
  return (
    <>
      <QualityManager />
      <WorldEnvironment />
      <WorldLighting />
      <group name="ENV_Graybox" visible={new URLSearchParams(window.location.search).get('env') === 'graybox'}>
        <Cliffs /><MainRoad /><GrandStairs /><MainPlatform />
      </group>
      {new URLSearchParams(window.location.search).get('env') !== 'graybox' && <EnvironmentT02R />}
      <Suspense fallback={null}>
        <Gate />
        <MainBuilding />
        <SideTower />
      </Suspense>
      <Player />
      <DebugHelpers />
      <EnvironmentReview />
    </>
  )
}
