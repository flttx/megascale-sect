import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, BufferAttribute, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, Uniform } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { siteClearance } from '../sites'
import { atmosphere } from '../sky/atmosphere'
import { withSurfaceWeather } from '../weather/surfaceWeather'
import { LAYOUT } from '../worldLayout'

/**
 * Sect banners (幡): indigo silk with gold trim hanging from the arm of a tall lacquered pole at the
 * platform's front corners, flanking the grand stairs and the great censer, and at both bridge heads. The silk ripples in a
 * vertex shader whose speed and reach follow the wind strength.
 */

const Y = LAYOUT.platform.height, POLE = 13, ARM = 2.1, WIDTH = 1.5, DROP = 6.4
// [x, z, arm yaw (rad about +Y; 0 = arm toward +x)]
const SITES: [number, number, number][] = [
  [-183, -70, 0], [183, -70, Math.PI], [-16.5, -68.5, Math.PI], [16.5, -68.5, 0],
  [-186.5, -94.5, -Math.PI / 2], [-186.5, -109.5, Math.PI / 2], [186.5, -77.5, -Math.PI / 2], [186.5, -92.5, Math.PI / 2],
  // Flanking the great censer's dais, arms toward the axis.
  [-24, -160, 0], [24, -160, Math.PI],
]

/** Pole feet that survive the interact-site clearance check (also used for flight colliders). */
export const BANNER_POLES = SITES.filter(([x, z]) => siteClearance(x, z) > 1)
export const BANNER_TOP = Y + POLE + 1

const uniforms = { uBannerTime: new Uniform(0), uBannerWind: new Uniform(atmosphere.wind) }

function silkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 512
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#1c2656'; g.fillRect(0, 0, 128, 512)
    // Swallowtail hem: cut a notch out of the bottom (alpha-tested away).
    g.globalCompositeOperation = 'destination-out'
    g.beginPath(); g.moveTo(0, 512); g.lineTo(64, 452); g.lineTo(128, 512); g.fill()
    g.globalCompositeOperation = 'source-over'
    g.strokeStyle = '#c9a24e'; g.lineWidth = 7; g.strokeRect(6, 6, 116, 430)
    g.lineWidth = 2; g.strokeRect(16, 16, 96, 410)
    g.fillStyle = '#c9a24e'; g.fillRect(0, 0, 128, 22)
    g.font = 'bold 64px "KaiTi", "STKaiti", "SimSun", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = '#d8b560'
    g.fillText('云', 64, 130); g.fillText('阙', 64, 230)
    g.beginPath(); g.arc(64, 330, 22, 0, Math.PI * 2); g.lineWidth = 4; g.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4
  return texture
}

function silkMaterial() {
  const material = new MeshStandardMaterial({ map: silkTexture(), side: DoubleSide, alphaTest: 0.5, roughness: 0.62, metalness: 0.05, color: '#ffffff' })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `attribute vec4 aBanner; uniform float uBannerTime; uniform vec2 uBannerWind;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // aBanner: x across (0..1), y down the drop (0..1), z phase. Pinned along the top edge.
          float w = length(uBannerWind), v = aBanner.y, u = aBanner.x, ph = aBanner.z;
          vec3 windDir = w > 1e-3 ? vec3(uBannerWind.x, 0.0, uBannerWind.y) / w : vec3(1.0, 0.0, 0.0);
          float t = uBannerTime * (1.6 + w * 0.32);
          float reach = pow(v, 1.35);
          float lean = clamp(w * 0.16, 0.05, 2.6) + sin(uBannerTime * 0.7 + ph) * 0.25;
          float ripple = (sin(v * 7.5 - t * 2.2 + u * 2.4 + ph) * (0.1 + w * 0.025) + sin(u * 8.0 - t * 2.9 + v * 3.0) * 0.035) * v;
          transformed += windDir * lean * reach * ${DROP.toFixed(1)} * 0.22 + normal * ripple * ${DROP.toFixed(1)} * 0.18;
          transformed.y += lean * lean * reach * 0.12;
        }`)
  }
  // The default key (onBeforeCompile source) would collide once withSurfaceWeather wraps it.
  material.customProgramCacheKey = () => 'landmark-banner-silk-1'
  return withSurfaceWeather(material)
}

function tinted(geometry: BufferGeometry, color: Color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const count = g.getAttribute('position').count, data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) data.set([color.r, color.g, color.b], i * 3)
  g.setAttribute('color', new BufferAttribute(data, 3))
  if (g !== geometry) geometry.dispose()
  return g
}

function buildBanners() {
  const lacquer = new Color('#5a1f1a'), jade = new Color('#e6e2d6')
  const poleParts: BufferGeometry[] = [], goldParts: BufferGeometry[] = [], silkParts: BufferGeometry[] = []
  BANNER_POLES.forEach(([x, z, yaw], k) => {
    const ax = Math.cos(yaw), az = -Math.sin(yaw)
    poleParts.push(tinted(new BoxGeometry(1.1, 0.5, 1.1).translate(x, Y + 0.25, z), jade))
    poleParts.push(tinted(new BoxGeometry(0.75, 0.35, 0.75).translate(x, Y + 0.67, z), jade))
    poleParts.push(tinted(new CylinderGeometry(0.13, 0.17, POLE, 8).translate(x, Y + POLE / 2, z), lacquer))
    poleParts.push(tinted(new BoxGeometry(ARM + 0.2, 0.14, 0.14).rotateY(yaw).translate(x + ax * ARM / 2, Y + POLE - 0.5, z + az * ARM / 2), lacquer))
    goldParts.push(new ConeGeometry(0.2, 0.9, 8).translate(x, Y + POLE + 0.55, z), new SphereGeometry(0.2, 10, 8).translate(x, Y + POLE + 0.05, z))
    goldParts.push(new SphereGeometry(0.11, 8, 6).translate(x + ax * (ARM + 0.1), Y + POLE - 0.5, z + az * (ARM + 0.1)))
    // Silk: hangs from the arm, its plane containing the arm.
    const silk = new PlaneGeometry(WIDTH, DROP, 6, 24)
    const uv = silk.getAttribute('uv'), banner = new Float32Array(uv.count * 4)
    for (let i = 0; i < uv.count; i++) banner.set([uv.getX(i), 1 - uv.getY(i), k * 1.93, 0], i * 4)
    silk.setAttribute('aBanner', new BufferAttribute(banner, 4))
    silk.rotateY(yaw).translate(x + ax * (0.35 + WIDTH / 2), Y + POLE - 0.58 - DROP / 2, z + az * (0.35 + WIDTH / 2))
    silkParts.push(silk)
  })
  const poleMaterial = withSurfaceWeather(new MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }))
  const goldMaterial = withSurfaceWeather(new MeshStandardMaterial({ color: '#c8a052', roughness: 0.3, metalness: 0.85 }))
  const meshes = [
    new Mesh(mergeGeometries(poleParts), poleMaterial),
    new Mesh(mergeGeometries(goldParts.map((g) => { const n = g.toNonIndexed(); g.dispose(); return n })), goldMaterial),
    new Mesh(mergeGeometries(silkParts), silkMaterial()),
  ]
  for (const parts of [poleParts, goldParts, silkParts]) parts.forEach((g) => g.dispose())
  // Thin and far apart: their shadows would cost a cascade pass each for a few pixels.
  meshes.forEach((mesh) => { mesh.userData.castShadow = false })
  return meshes
}

export function Banners() {
  const meshes = useMemo(buildBanners, [])
  useEffect(() => () => meshes.forEach((mesh) => {
    mesh.geometry.dispose()
    const material = mesh.material as MeshStandardMaterial
    material.map?.dispose(); material.dispose()
  }), [meshes])
  useFrame((_, delta) => { uniforms.uBannerTime.value += Math.min(delta, 0.1) })
  return <>{meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}</>
}
