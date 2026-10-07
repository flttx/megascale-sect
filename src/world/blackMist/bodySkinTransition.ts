import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Ray,
  ShaderChunk,
  SRGBColorSpace,
  Triangle,
  Vector3,
  Vector4,
} from 'three'
import type { Object3D, SkinnedMesh, Texture } from 'three'
import { createFleshGeometry, createFleshMaterial } from './fleshGeometry'
import { BLACK_MIST_UNIFORMS } from './materials'

interface SkinVertex {
  rest: Vector4
  influences: { matrix: Matrix4; weight: number }[]
  point: Vector3
  frame: number
}
export interface SkinHost {
  mesh: SkinnedMesh
  restPositions: Vector3[]
  palettes: Matrix4[]
  world: Matrix4
  vertices: Map<number, SkinVertex>
  frame: number
}
export interface SkinSample {
  host: SkinHost
  triangle: readonly [number, number, number]
  barycentric: Vector3
}
export interface SkinTransitionSite {
  id: string
  host: SkinHost
  center: Vector3
  normal: Vector3
  orientation: Quaternion
  width: number
  depth: number
}
interface Control {
  sample: SkinSample
  point: Vector3
  normal: Vector3
  edge: boolean
  geometryIndex: number
  site: string
}
interface Stencil {
  controls: readonly [number, number, number, number]
  weights: readonly [number, number, number, number]
  height: number
}
export interface BodySkinTransition {
  geometry: BufferGeometry
  material: MeshStandardMaterial
  controls: Control[]
  stencils: Stencil[]
  sites: number
  detail: 'near' | 'far'
  inverse: Matrix4
  a: Vector3
  b: Vector3
  c: Vector3
  point: Vector3
  normal: Vector3
}

/** Quantized skin coordinates are decoded through the exact bind matrix, before any animation plays. */
export function captureSkinHost(mesh: SkinnedMesh, toAsset: Matrix4): SkinHost {
  const position = mesh.geometry.getAttribute('position')
  return {
    mesh,
    restPositions: Array.from({ length: position.count }, (_, i) =>
      mesh.getVertexPosition(i, new Vector3()).applyMatrix4(toAsset),
    ),
    palettes: mesh.skeleton.bones.map(() => new Matrix4()),
    world: new Matrix4(),
    vertices: new Map(),
    frame: -1,
  }
}

/** A shared palette and sparse vertex cache, rather than a full skin scan on each rendered frame. */
export function beginSkinHostFrame(host: SkinHost, frame: number) {
  if (host.frame === frame) return
  host.frame = frame
  host.palettes.forEach((matrix, i) =>
    matrix.multiplyMatrices(host.mesh.skeleton.bones[i].matrixWorld, host.mesh.skeleton.boneInverses[i]),
  )
  host.world.multiplyMatrices(host.mesh.matrixWorld, host.mesh.bindMatrixInverse)
}

export function skinHostVertex(host: SkinHost, index: number): Vector3 {
  let vertex = host.vertices.get(index)
  if (!vertex) {
    const attributes = host.mesh.geometry.attributes,
      p = attributes.position,
      w = attributes.skinWeight,
      j = attributes.skinIndex
    const rest = new Vector4(p.getX(index), p.getY(index), p.getZ(index), 1).applyMatrix4(host.mesh.bindMatrix)
    const influences = Array.from({ length: 4 }, (_, k) => ({
      matrix: host.palettes[j.getComponent(index, k)],
      weight: w.getComponent(index, k),
    })).filter(({ weight }) => weight > 0)
    vertex = { rest, influences, point: new Vector3(), frame: -1 }
    host.vertices.set(index, vertex)
  }
  if (vertex.frame !== host.frame) {
    const { x, y, z, w } = vertex.rest
    let px = 0,
      py = 0,
      pz = 0
    for (const { matrix, weight } of vertex.influences) {
      const e = matrix.elements
      px += (e[0] * x + e[4] * y + e[8] * z + e[12] * w) * weight
      py += (e[1] * x + e[5] * y + e[9] * z + e[13] * w) * weight
      pz += (e[2] * x + e[6] * y + e[10] * z + e[14] * w) * weight
    }
    vertex.point.set(px, py, pz).applyMatrix4(host.world)
    vertex.frame = host.frame
  }
  return vertex.point
}

const skinEdgeA = new Vector3(),
  skinEdgeB = new Vector3()
export function evaluateSkinSample(sample: SkinSample, point: Vector3, normal?: Vector3) {
  const a = skinHostVertex(sample.host, sample.triangle[0]),
    b = skinHostVertex(sample.host, sample.triangle[1]),
    c = skinHostVertex(sample.host, sample.triangle[2])
  point
    .copy(a)
    .multiplyScalar(sample.barycentric.x)
    .addScaledVector(b, sample.barycentric.y)
    .addScaledVector(c, sample.barycentric.z)
  if (normal) normal.crossVectors(skinEdgeA.subVectors(b, a), skinEdgeB.subVectors(c, a)).normalize()
  return point
}

interface RestFace {
  indices: readonly [number, number, number]
  triangle: Triangle
}
function patchFaces(site: SkinTransitionSite): RestFace[] {
  const index = site.host.mesh.geometry.index,
    positions = site.host.restPositions,
    faces: RestFace[] = []
  if (!index) return faces
  const center = new Vector3(),
    normal = new Vector3(),
    reach = site.width * 1.4
  for (let i = 0; i < index.count; i += 3) {
    const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)] as const
    const triangle = new Triangle(positions[indices[0]], positions[indices[1]], positions[indices[2]])
    triangle.getMidpoint(center)
    triangle.getNormal(normal)
    if (center.distanceToSquared(site.center) < reach * reach && normal.dot(site.normal) > 0.22)
      faces.push({ indices, triangle })
  }
  return faces
}

function surfaceSample(site: SkinTransitionSite, faces: RestFace[], x: number, y: number): SkinSample {
  const target = new Vector3(x, y, 0).applyQuaternion(site.orientation).add(site.center)
  const ray = new Ray(target.clone().addScaledVector(site.normal, site.width), site.normal.clone().negate())
  const hit = new Vector3(),
    closest = new Vector3()
  let selected: RestFace | null = null,
    distance = Infinity
  for (const face of faces) {
    if (!ray.intersectTriangle(face.triangle.a, face.triangle.b, face.triangle.c, true, hit)) continue
    const d = hit.distanceToSquared(target)
    if (d < distance) {
      distance = d
      selected = face
      closest.copy(hit)
    }
  }
  if (!selected) {
    for (const face of faces) {
      face.triangle.closestPointToPoint(target, hit)
      const d = hit.distanceToSquared(target)
      if (d < distance) {
        distance = d
        selected = face
        closest.copy(hit)
      }
    }
  }
  if (!selected) throw new Error('Tissue patch has no host surface')
  const barycentric = selected.triangle.getBarycoord(closest, new Vector3())
  if (!barycentric) throw new Error('Tissue patch has no skin coordinates')
  return { host: site.host, triangle: selected.indices, barycentric }
}

interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
  linear: boolean
}
function texturePixels(texture: Texture | null): Pixels | null {
  if (!texture || typeof OffscreenCanvas === 'undefined') return null
  try {
    const canvas = new OffscreenCanvas(256, 256),
      context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(texture.image as CanvasImageSource, 0, 0, 256, 256)
    return {
      data: context.getImageData(0, 0, 256, 256).data,
      width: 256,
      height: 256,
      linear: texture.colorSpace !== SRGBColorSpace,
    }
  } catch {
    return null
  }
}

function sampleHostColor(sample: SkinSample, pixels: Pixels | null, material: MeshStandardMaterial, out: Color) {
  const uv = sample.host.mesh.geometry.getAttribute('uv'),
    bary = sample.barycentric
  if (!pixels || !uv) return out.copy(material.color)
  const u =
    uv.getX(sample.triangle[0]) * bary.x + uv.getX(sample.triangle[1]) * bary.y + uv.getX(sample.triangle[2]) * bary.z
  const v =
    uv.getY(sample.triangle[0]) * bary.x + uv.getY(sample.triangle[1]) * bary.y + uv.getY(sample.triangle[2]) * bary.z
  const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(u * pixels.width))),
    y = Math.max(0, Math.min(pixels.height - 1, Math.floor(v * pixels.height)))
  const i = (y * pixels.width + x) * 4
  out.setRGB(pixels.data[i] / 255, pixels.data[i + 1] / 255, pixels.data[i + 2] / 255)
  if (!pixels.linear) out.convertSRGBToLinear()
  return out.multiply(material.color)
}

function patchHostBlend(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHostCorruption = BLACK_MIST_UNIFORMS.uMistCorruption
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aHostColor; attribute float aSkinBlend; varying vec3 vHostColor; varying float vSkinBlend;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHostColor = aHostColor; vSkinBlend = aSkinBlend;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vHostColor; varying float vSkinBlend; uniform float uHostCorruption;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float hostLuma = dot(vHostColor, vec3(0.2126, 0.7152, 0.0722));
        vec3 hostSoot = mix(vHostColor, vec3(hostLuma) * vec3(0.82, 0.79, 0.91), 0.64) * 0.66;
        vec3 hostColor = mix(vHostColor, hostSoot, uHostCorruption);
        diffuseColor.rgb = mix(hostColor, diffuseColor.rgb, vSkinBlend);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vSkinBlend;'),
      )
  }
  material.customProgramCacheKey = () => 'host-conforming-tissue-1'
}

/** All patches on one carrier share one owned geometry and one authored tissue PBR material. */
export function createBodySkinTransition(
  sites: SkinTransitionSite[],
  tissueScene: Object3D,
  detail: 'near' | 'far',
  seed: number,
): BodySkinTransition {
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [],
    hostColors: number[] = [],
    blend: number[] = [],
    indices: number[] = []
  const controls: Control[] = [],
    stencils: Stencil[] = [],
    hostColor = new Color(),
    color = new Color()
  const rows = detail === 'near' ? 14 : 7,
    columns = detail === 'near' ? 40 : 22
  const controlRows = detail === 'near' ? 3 : 2,
    controlColumns = columns / 2
  for (const [siteIndex, site] of sites.entries()) {
    const geometry = createFleshGeometry({ seed: seed + siteIndex * 631, detail }),
      p = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv'),
      c = geometry.getAttribute('color')
    const faces = patchFaces(site),
      offset = positions.length / 3,
      controlOffset = controls.length
    const hostMaterial = site.host.mesh.material as MeshStandardMaterial,
      pixels = texturePixels(hostMaterial.map)
    for (let row = 0; row <= controlRows; row++)
      for (let column = 0; column < controlColumns; column++) {
        const outer = rows * (columns + 1) + column * 2,
          fraction = row / controlRows
        const x = ((p.getX(outer) * site.width) / 2.4) * fraction,
          y = ((p.getY(outer) * site.width) / 2) * fraction
        controls.push({
          sample: surfaceSample(site, faces, x, y),
          point: new Vector3(),
          normal: new Vector3(),
          edge: row === controlRows,
          geometryIndex: offset + outer,
          site: site.id,
        })
      }
    for (let row = 0; row <= rows; row++)
      for (let column = 0; column <= columns; column++) {
        const vertex = row * (columns + 1) + column,
          r = row / rows
        const x = (p.getX(vertex) * site.width) / 2.4,
          y = (p.getY(vertex) * site.width) / 2
        const sample = surfaceSample(site, faces, x, y)
        sampleHostColor(sample, pixels, hostMaterial, hostColor)
        const ring = r * controlRows,
          lo = Math.min(controlRows - 1, Math.floor(ring)),
          radial = ring - lo
        const angle = (column / columns) * controlColumns,
          left = Math.floor(angle) % controlColumns,
          right = (left + 1) % controlColumns,
          angular = angle - Math.floor(angle)
        const loLeft = controlOffset + lo * controlColumns + left,
          loRight = controlOffset + lo * controlColumns + right
        stencils.push({
          controls: [loLeft, loRight, loLeft + controlColumns, loRight + controlColumns],
          weights: [(1 - radial) * (1 - angular), (1 - radial) * angular, radial * (1 - angular), radial * angular],
          height: Math.max(0, p.getZ(vertex)) * site.depth - 0.15,
        })
        positions.push(0, 0, 0)
        uvs.push(uv.getX(vertex), uv.getY(vertex))
        color.fromBufferAttribute(c, vertex)
        colors.push(color.r, color.g, color.b)
        hostColors.push(hostColor.r, hostColor.g, hostColor.b)
        const edgeBlend = 1 - Math.max(0, Math.min(1, (r - 0.55) / 0.45))
        blend.push(edgeBlend * edgeBlend * (3 - 2 * edgeBlend) * 0.58)
      }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices.push(offset + geometry.index.getX(i))
    geometry.dispose()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length), 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uvs), 2))
  geometry.setAttribute('uv1', new BufferAttribute(Float32Array.from(uvs), 2))
  geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3))
  geometry.setAttribute('aHostColor', new BufferAttribute(Float32Array.from(hostColors), 3))
  geometry.setAttribute('aSkinBlend', new BufferAttribute(Float32Array.from(blend), 1))
  geometry.setIndex(indices)
  const material = createFleshMaterial(tissueScene, { name: `HostSkinTransition_${detail}` })
  patchHostBlend(material)
  return {
    geometry,
    material,
    controls,
    stencils,
    sites: sites.length,
    detail,
    inverse: new Matrix4(),
    a: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
    point: new Vector3(),
    normal: new Vector3(),
  }
}

/** A sparse set of real skinned samples carries the whole membrane, including every outer edge. */
export function updateBodySkinTransition(body: BodySkinTransition, toLocal: Matrix4, growth: number) {
  for (const control of body.controls) {
    evaluateSkinSample(control.sample, control.point, control.normal)
    control.point.applyMatrix4(toLocal)
    control.normal.transformDirection(toLocal)
  }
  const position = body.geometry.getAttribute('position') as BufferAttribute
  body.stencils.forEach((stencil, index) => {
    body.point.set(0, 0, 0)
    body.normal.set(0, 0, 0)
    stencil.controls.forEach((controlIndex, k) => {
      body.point.addScaledVector(body.controls[controlIndex].point, stencil.weights[k])
      body.normal.addScaledVector(body.controls[controlIndex].normal, stencil.weights[k])
    })
    body.point.addScaledVector(body.normal.normalize(), stencil.height * growth)
    position.setXYZ(index, body.point.x, body.point.y, body.point.z)
  })
  position.needsUpdate = true
  body.geometry.computeVertexNormals()
  body.geometry.computeBoundingSphere()
}

/** Native Three skinning is independent of the palette used for membrane animation. */
export function bodySkinConformance(body: BodySkinTransition, matrixWorld: Matrix4) {
  const point = new Vector3(),
    reference = new Vector3(),
    rendered = new Vector3(),
    cached = new Vector3()
  let maxSkinErrorMeters = 0,
    maxSeamGapMeters = 0
  const edgeSamples = body.controls
    .filter((control) => control.edge)
    .map((control) => {
      const { mesh } = control.sample.host,
        { triangle, barycentric } = control.sample
      reference.set(0, 0, 0)
      triangle.forEach((vertex, k) => {
        mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)
        reference.addScaledVector(point, barycentric.getComponent(k))
      })
      evaluateSkinSample(control.sample, cached)
      maxSkinErrorMeters = Math.max(maxSkinErrorMeters, reference.distanceTo(cached))
      rendered
        .fromBufferAttribute(body.geometry.getAttribute('position'), control.geometryIndex)
        .applyMatrix4(matrixWorld)
      const gap = reference.distanceTo(rendered)
      maxSeamGapMeters = Math.max(maxSeamGapMeters, gap)
      return {
        site: control.site,
        triangle,
        barycentrics: barycentric.toArray(),
        referencePosition: reference.toArray(),
        renderedPosition: rendered.toArray(),
        gapMeters: gap,
      }
    })
  return {
    detail: body.detail,
    samples: body.controls.length,
    sparseSkinVertices: [...new Set(body.controls.map(({ sample }) => sample.host))].reduce(
      (sum, host) => sum + host.vertices.size,
      0,
    ),
    maxSkinErrorMeters,
    maxSeamGapMeters,
    edgeSamples,
  }
}
