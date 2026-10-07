import { Suspense, useEffect, useMemo } from 'react'
import { PlaneGeometry } from 'three'
import { Html, useGLTF } from '@react-three/drei'
import { MainBuilding } from './assets/MainBuilding'
import { Gate } from './assets/Gate'
import { SideTower } from './assets/SideTower'
import { MainRoad } from './environment/MainRoad'
import { GrandStairs } from './environment/GrandStairs'
import { MainPlatform } from './environment/MainPlatform'
import { Cliffs } from './environment/Cliffs'
import { Player } from './player/Player'
import { SkyDome } from './sky/SkyDome'
import { CloudSea } from './sky/CloudSea'
import { Lighting } from './sky/Lighting'
import { PostFX } from './sky/PostFX'
import { useWorldStore } from './store'
import { ASSETS } from './worldAssets'
import { LAYOUT, mainHallTop } from './worldLayout'
import { EnvironmentT02R, EnvironmentReview } from './environment/t02r/EnvironmentT02R'
import { QualityManager } from './quality'
import { WeatherSystem } from './weather/WeatherSystem'
import { Landmarks } from './landmarks/Landmarks'
import { PropField } from './props/PropField'
import { Interactables } from './interact/Interactables'
import { Colossi } from './colossi/Colossi'
import { WindRibbons } from './wind/WindRibbons'
import { TrialRings } from './trials/TrialRings'
import { BlackMist } from './blackMist/BlackMist'

ASSETS.forEach((asset) => useGLTF.preload([asset.url, asset.lodUrl]))

/** The main hall's flight collider: its roof height field (plus the 1 m clearance) over the footprint, one vertex per 2 m cell centre. */
function MainColliderHelper() {
  const [mx, , mz] = LAYOUT.main.position,
    { halfWidth, halfDepth } = LAYOUT.mainCollider
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(halfWidth * 2 - 2, halfDepth * 2 - 2, halfWidth - 1, halfDepth - 1).rotateX(
      -Math.PI / 2,
    )
    const position = plane.attributes.position
    for (let i = 0; i < position.count; i++)
      position.setY(i, mainHallTop(position.getX(i) + mx, position.getZ(i) + mz) + 1)
    return plane
  }, [mx, mz, halfWidth, halfDepth])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} position={[mx, 0, mz]}>
      <meshBasicMaterial color="#e0ac7a" wireframe transparent opacity={0.28} depthTest={false} />
    </mesh>
  )
}

function DebugHelpers() {
  const show = useWorldStore((state) => state.showHelpers)
  if (!show) return null
  return (
    <group>
      <gridHelper args={[1000, 100, '#e3c479', '#8293a2']} position={[0, 0.08, 0]} />
      <mesh
        position={[0, LAYOUT.stairs.height / 2, (LAYOUT.stairs.startZ + LAYOUT.stairs.endZ) / 2]}
        rotation={[Math.atan2(LAYOUT.stairs.height, LAYOUT.stairs.startZ - LAYOUT.stairs.endZ), 0, 0]}
      >
        <boxGeometry
          args={[
            LAYOUT.stairs.width,
            0.25,
            Math.hypot(LAYOUT.stairs.startZ - LAYOUT.stairs.endZ, LAYOUT.stairs.height),
          ]}
        />
        <meshBasicMaterial color="#46e3d0" wireframe depthTest={false} />
      </mesh>
      <MainColliderHelper />
      {[
        ['SPAWN', LAYOUT.spawn.position],
        ['MG02', LAYOUT.gate.position],
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
      <WeatherSystem />
      <SkyDome />
      <Lighting />
      <CloudSea />
      <group name="ENV_Graybox" visible={new URLSearchParams(window.location.search).get('env') === 'graybox'}>
        <Cliffs />
        <MainRoad />
        <GrandStairs />
        <MainPlatform />
      </group>
      {new URLSearchParams(window.location.search).get('env') !== 'graybox' && <EnvironmentT02R />}
      <Suspense fallback={null}>
        <Gate />
        <MainBuilding />
        <SideTower />
      </Suspense>
      <Landmarks />
      <PropField />
      <Colossi />
      <WindRibbons />
      <TrialRings />
      <Interactables />
      <Player />
      <BlackMist />
      <DebugHelpers />
      <EnvironmentReview />
      <PostFX />
    </>
  )
}
