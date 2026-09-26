import { Effect, EffectAttribute } from 'postprocessing'
import { Color, Matrix4, Uniform, Vector3, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { atmosphere, keyLight } from './atmosphere'
import { CLOUD_SEA_Y } from './CloudSea'
import { createCloudNoise2D, createCloudNoise3D } from './cloudNoise'
import { fogUniforms } from './fog'
import { FOG_GLSL } from './glsl'

/**
 * Full-screen aerial perspective + volumetric cloud sea, reconstructed from scene depth.
 *
 * The cloud sea is a height field (swell, billow mounds and rifts from tileable noise) with 3D Perlin-Worley
 * erosion near its top. Rays skip down to the surface, then integrate density with energy-conserving steps;
 * sunlight uses three taps toward the key light plus a multi-octave scattering approximation, and ambient
 * light comes from the sky-view LUT, so the sea is lit by the same sky it sits under. Scene depth clips each
 * ray, which gives soft intersections where cliffs sink into the clouds.
 */
const fragment = /* glsl */ `
uniform mat4 uProjectionInverse; uniform mat4 uCameraWorld; uniform vec3 uCameraPos;
${FOG_GLSL}
#ifdef CLOUD_STEPS
uniform sampler2D uNoise; uniform sampler3D uErosion;
uniform vec3 uLightDir; uniform vec3 uLightColor;
uniform float uTime; uniform vec2 uWind; uniform float uCover; uniform float uPixelAngle; uniform float uGain;

const float SEA_Y = ${CLOUD_SEA_Y.toFixed(1)};
const float SEA_CEIL = SEA_Y + 100.0;
const float SEA_FLOOR = SEA_Y - 380.0;
const float SIGMA = 0.07;
const float MAX_DIST = 9000.0;

/** Local height of the cloud tops. \`lod\` selects the mip that matches the pixel footprint. */
float seaTop(vec2 xz, float lod) {
  vec2 drift = uWind * uTime;
  vec4 broad = textureLod(uNoise, (xz - drift * 0.5) / 3400.0 + 0.21, max(lod - 1.85, 0.0));
  vec4 mound = textureLod(uNoise, (xz - drift) / 950.0, lod);
  // Heavier weather closes the rifts into a continuous deck.
  float rift = 1.0 - smoothstep(0.0, 0.16, broad.r - mix(0.3, 0.0, smoothstep(0.45, 0.95, uCover)));
  return SEA_Y + (broad.r - 0.47) * 90.0 + (mound.g - 0.4) * 84.0 + (mound.b - 0.5) * 20.0 - rift * 120.0;
}

float cloudDensity(vec3 p, float top, bool detail) {
  float h = top - p.y;
  if (h <= 0.0) return 0.0;
  float d = smoothstep(0.0, 30.0, h);
  if (detail) {
    // Rising, wind-borne erosion carves cauliflower lobes into the upper 50 m.
    float e = textureLod(uErosion, (p - vec3(uWind.x, 0.8, uWind.y) * uTime) / 170.0, 0.0).r;
    float eb = e * (1.0 - smoothstep(0.0, 50.0, h)) * 0.9;
    d = clamp((d - eb) / (1.0 - eb * 0.9), 0.0, 1.0);
  }
  return d * SIGMA;
}

/** Optical depth toward the key light from three taps at 10, 30 and 90 m. */
float lightDepth(vec3 p) {
  float od = 0.0, dist = 10.0;
  for (int i = 0; i < 3; i++) {
    vec3 q = p + uLightDir * dist;
    od += cloudDensity(q, seaTop(q.xz, 1.0 + float(i)), false) * dist * 0.9;
    dist *= 3.0;
  }
  return od;
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

/** Radiance (rgb) and transmittance (a) of the cloud sea along a ray; tMean is the opacity-weighted depth. */
vec4 marchClouds(vec3 ro, vec3 rd, float tScene, bool sky, float jitter, out float tMean) {
  float mu = dot(rd, uLightDir);
  float ph0 = mix(hg(mu, 0.7), hg(mu, -0.2), 0.4);
  float ph1 = mix(hg(mu, 0.35), hg(mu, -0.1), 0.4);
  float ph2 = mix(hg(mu, 0.18), hg(mu, -0.05), 0.4);
  vec3 zenith = skyView(vec3(0.0, 1.0, 0.0));
  vec3 side = 0.5 * (skyView(vec3(uLightDir.x, 0.3, uLightDir.z)) + skyView(vec3(-uLightDir.x, 0.3, -uLightDir.z)));
  vec3 ambTop = (zenith + side * 2.0) / 3.0;
  vec3 ambBottom = ambTop * vec3(0.16, 0.19, 0.25);

  float tEnter = 0.0, tExit = MAX_DIST;
  if (abs(rd.y) > 1e-5) {
    float ta = (SEA_CEIL - ro.y) / rd.y, tb = (SEA_FLOOR - ro.y) / rd.y;
    tEnter = max(min(ta, tb), 0.0); tExit = min(max(ta, tb), MAX_DIST);
  } else if (ro.y > SEA_CEIL || ro.y < SEA_FLOOR) tExit = -1.0;
  tExit = min(tExit, tScene);

  vec3 L = vec3(0.0);
  float T = 1.0, wSum = 0.0, tSum = 0.0;
  float t = tEnter + jitter * (3.0 + tEnter * 0.006);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    if (t >= tExit || T < 0.02) break;
    vec3 p = ro + rd * t;
    float lod = max(0.0, log2(max(t, 1.0) * uPixelAngle / 3.7));
    float top = seaTop(p.xz, lod);
    float above = p.y - top;
    if (above > 0.5) {
      // Outside the sea: jump most of the way to the surface (height-field slopes stay below ~0.6).
      float closing = max(-rd.y, 0.0) + 0.6 * length(rd.xz);
      t += clamp(above / max(closing, 0.05) * 0.8, 1.0 + t * 0.003, 800.0);
      continue;
    }
    float dt = 3.0 + t * 0.006;
    float dens = cloudDensity(p, top, true);
    if (dens > 1e-4) {
      float od = lightDepth(p);
      float sun = exp(-od) * ph0 + 0.5 * exp(-od * 0.35) * ph1 + 0.25 * exp(-od * 0.12) * ph2;
      float powder = 1.0 - 0.55 * exp(-dens * 45.0);
      vec3 amb = mix(ambBottom, ambTop, exp(-(top - p.y) / 35.0));
      vec3 S = uLightColor * (sun * uGain * powder) + amb;
      float st = exp(-dens * dt);
      L += T * S * (1.0 - st);
      float w = T * (1.0 - st);
      wSum += w; tSum += w * t;
      T *= st;
    }
    t += dt;
  }
  // Out of steps (or range) over open sky: the far sea continues to the horizon as a lit, opaque deck.
  if (sky && T > 0.02 && rd.y < 0.0) {
    float tp = max((SEA_Y - ro.y) / rd.y, t);
    float sun = exp(-2.0) * ph0 + 0.5 * exp(-0.7) * ph1 + 0.25 * exp(-0.24) * ph2;
    L += T * (uLightColor * sun * uGain * 0.8 + ambTop);
    wSum += T; tSum += T * tp;
    T = 0.0;
  }
  tMean = wSum > 1e-4 ? tSum / wSum : tExit;
  return vec4(L, T);
}
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 view = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  vec3 ray = world - uCameraPos;
  float dist = length(ray);
  vec3 dir = ray / dist;
  // The sky dome writes no depth and veils its own horizon.
  bool sky = depth >= 0.999999;
  vec3 col = inputColor.rgb;
  if (!sky) {
    float f = heightFog(uCameraPos, dir, dist);
    col = mix(col, fogColorFor(dir), f);
  }
#ifdef CLOUD_STEPS
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float tMean;
  vec4 c = marchClouds(uCameraPos, dir, sky ? 1e9 : dist, sky, jitter, tMean);
  if (c.a < 0.999) {
    float f = heightFog(uCameraPos, dir, tMean);
    vec3 lit = c.rgb * (1.0 - f) + fogColorFor(dir) * f * (1.0 - c.a);
    col = col * c.a + lit;
  }
#endif
  outputColor = vec4(col, inputColor.a);
}`

/** Scales the cloud sea's sun term; calibrated against lit marble in the same frame. */
const CLOUD_GAIN = 2.6

// Generated once (~0.1 s on the CPU) and reused across quality switches; disposal only frees the GPU copy.
let noiseTextures: [Texture, Texture] | null = null
const cloudNoise = () => (noiseTextures ??= [createCloudNoise2D(), createCloudNoise3D()])

export class AtmosphereEffect extends Effect {
  private readonly camera: PerspectiveCamera
  private readonly textures: Texture[] = []
  private height = 1
  private readonly lightDir = new Vector3()

  constructor(camera: PerspectiveCamera, cloudSteps: number) {
    const uniforms = new Map<string, Uniform>([
      ['uProjectionInverse', new Uniform(new Matrix4())], ['uCameraWorld', new Uniform(new Matrix4())], ['uCameraPos', new Uniform(new Vector3())],
      ...Object.entries(fogUniforms),
    ])
    const textures: Texture[] = []
    if (cloudSteps > 0) {
      const [noise, erosion] = cloudNoise()
      textures.push(noise, erosion)
      uniforms.set('uNoise', new Uniform(noise)); uniforms.set('uErosion', new Uniform(erosion))
      uniforms.set('uLightDir', new Uniform(new Vector3(0, 1, 0))); uniforms.set('uLightColor', new Uniform(new Color()))
      uniforms.set('uTime', new Uniform(0)); uniforms.set('uWind', new Uniform(atmosphere.wind)); uniforms.set('uCover', new Uniform(0.5))
      uniforms.set('uPixelAngle', new Uniform(0.001)); uniforms.set('uGain', new Uniform(CLOUD_GAIN))
    }
    super('AtmosphereEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms,
      defines: cloudSteps > 0 ? new Map([['CLOUD_STEPS', String(Math.round(cloudSteps))]]) : new Map(),
    })
    this.camera = camera
    this.textures = textures
  }

  override setSize(_width: number, height: number) {
    this.height = Math.max(height, 1)
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, delta = 0) {
    const u = this.uniforms, camera = this.camera
    u.get('uProjectionInverse')!.value.copy(camera.projectionMatrixInverse)
    u.get('uCameraWorld')!.value.copy(camera.matrixWorld)
    u.get('uCameraPos')!.value.setFromMatrixPosition(camera.matrixWorld)
    const time = u.get('uTime')
    if (!time) return
    time.value += Math.min(delta, 0.1)
    const { color, intensity } = keyLight(this.lightDir)
    u.get('uLightDir')!.value.copy(this.lightDir)
    u.get('uLightColor')!.value.copy(color).multiplyScalar(intensity)
    u.get('uCover')!.value = atmosphere.cloudCover
    u.get('uPixelAngle')!.value = 2 * Math.tan((camera.fov * Math.PI) / 360) / this.height
  }

  override dispose() {
    this.textures.forEach((texture) => texture.dispose())
    super.dispose()
  }
}
