import {
  Color,
  DoubleSide,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type { WebGLRenderer } from 'three'

/** DEV-only raw pixel probe: the live veil fragment and uniforms run on the actual game renderer. */
export function sampleBlackMistSky(renderer: WebGLRenderer, scene: Scene, directions: unknown) {
  if (
    !Array.isArray(directions) ||
    directions.length < 1 ||
    directions.length > 128 ||
    !directions.every(
      (direction: unknown) =>
        Array.isArray(direction) &&
        direction.length === 3 &&
        direction.every((value: unknown) => typeof value === 'number' && Number.isFinite(value)) &&
        Number.isFinite(Math.hypot(...(direction as [number, number, number]))) &&
        Math.hypot(...(direction as [number, number, number])) > 0,
    )
  )
    throw new Error('Sky probe requires finite nonzero directions')
  const sky = scene.getObjectByName('BlackMistSky')
  if (!(sky instanceof Mesh) || !(sky.material instanceof ShaderMaterial))
    throw new Error('Live Black Mist sky is unavailable')
  const material = sky.material.clone(),
    direction = new Uniform(new Vector3())
  material.uniforms = { ...sky.material.uniforms, uProbeDirection: direction }
  material.vertexShader =
    'varying vec3 vDir; uniform vec3 uProbeDirection; void main() { vDir = uProbeDirection; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  material.transparent = false
  material.blending = NoBlending
  material.side = DoubleSide
  material.depthTest = false
  material.depthWrite = false
  const geometry = new PlaneGeometry(2, 2),
    probe = new Scene(),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
  probe.add(new Mesh(geometry, material))
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false })
  const previous = renderer.getRenderTarget(),
    viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4())
  const scissorTest = renderer.getScissorTest(),
    clear = renderer.getClearColor(new Color()),
    clearAlpha = renderer.getClearAlpha()
  const pixels = new Uint8Array(4)
  try {
    renderer.setRenderTarget(target)
    renderer.setViewport(0, 0, 1, 1)
    renderer.setScissorTest(false)
    renderer.setClearColor(0, 0)
    return {
      material: sky.material.name,
      time: sky.material.uniforms.uMistTime.value as number,
      corruption: sky.material.uniforms.uMistCorruption.value as number,
      samples: directions.map((input: [number, number, number]) => {
        const length = Math.hypot(...input)
        direction.value.set(input[0] / length, input[1] / length, input[2] / length)
        renderer.clear()
        renderer.render(probe, camera)
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels)
        return { direction: [...input], rgba: Array.from(pixels) }
      }),
    }
  } finally {
    renderer.setRenderTarget(previous)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.setScissorTest(scissorTest)
    renderer.setClearColor(clear, clearAlpha)
    geometry.dispose()
    material.dispose()
    target.dispose()
  }
}
