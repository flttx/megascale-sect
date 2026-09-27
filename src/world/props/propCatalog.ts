/**
 * Tripo prop catalogue. Scales are `scaleToHeight` from scripts/tripo/manifest.lock.json (copied: the
 * lock file carries task logs we don't want in the bundle). GLBs are normalised: +Y up, bottom at y = 0,
 * centred in x/z, front facing +X, so world size = scale × bounding box. The pines are Blender models in
 * metres instead (PINE_ASSET), so their scale is a plain multiplier; rock_moss draws the Blender boulders at a
 * unit footprint, and rock_scholar keeps its Tripo shape in the scanned rock (stoneSource).
 */
export type PropId =
  | 'pine_tall' | 'pine_guest' | 'pine_small' | 'bamboo' | 'rock_scholar' | 'rock_moss'
  | 'stone_lantern' | 'lantern_post' | 'stone_lion' | 'pailou' | 'pavilion' | 'spirit_crystal' | 'incense_burner'

/** Warm lamp glow: emissive is masked to a local-space box (normalised model units). */
export interface GlowSpec {
  yMin: number; yMax: number
  /** Optional horizontal limits: radius from the model axis, or a minimum/maximum local z. */
  radius?: number; zMax?: number
  /** Local point where the additive glow sprite sits, and its world size (m) at scale 1. */
  sprite: [number, number, number]; spriteSize: number
  strength: number
}

export interface PropSpec {
  id: PropId
  scale: number
  lod1: boolean
  /** Footprint radius at scale 1 (m), for clearance tests. */
  radius: number
  /** LOD0 inside this camera distance (m); LOD1 until `hide`, then culled. */
  near: number; hide: number
  /** Casts CSM shadows while near (large props only; every caster costs up to 4 draw calls). */
  shadow: boolean
  glow?: GlowSpec
}

const spec = (id: PropId, scale: number, bboxRadius: number, near: number, hide: number, shadow: boolean, glow?: GlowSpec, lod1 = true): PropSpec =>
  ({ id, scale, lod1, radius: bboxRadius * scale, near, hide, shadow, glow })

export const PROPS: Record<PropId, PropSpec> = {
  // 22 m umbrella pine at 18.7 m, 13 m 迎客松 at 17.5 m, 7 m cliff pine at 6 m; radius is the clearance footprint.
  pine_tall: spec('pine_tall', 0.85, 2.8, 85, Infinity, true),
  pine_guest: spec('pine_guest', 1.35, 1.9, 90, Infinity, true),
  pine_small: spec('pine_small', 0.85, 2.8, 75, 900, true),
  bamboo: spec('bamboo', 8, 0.3, 75, 700, true),
  rock_scholar: spec('rock_scholar', 3.5, 0.2, 70, 420, false),
  rock_moss: spec('rock_moss', 4.4, 0.5, 70, 420, false, undefined, false),
  stone_lantern: spec('stone_lantern', 2.4, 0.2, 70, 380, false,
    { yMin: 0.61, yMax: 0.75, radius: 0.105, sprite: [0, 0.68, 0], spriteSize: 1.5, strength: 1 }),
  lantern_post: spec('lantern_post', 4.5, 0.26, 70, 420, false,
    { yMin: 0.46, yMax: 0.73, zMax: -0.02, sprite: [0, 0.6, -0.13], spriteSize: 2.2, strength: 1 }),
  stone_lion: spec('stone_lion', 3.2, 0.29, 90, 600, true),
  pailou: spec('pailou', 21.818, 0.5, 220, Infinity, true),
  pavilion: spec('pavilion', 9, 0.48, 150, 2000, true),
  spirit_crystal: spec('spirit_crystal', 2.5, 0.38, 70, 700, false,
    { yMin: 0.22, yMax: 1.1, sprite: [0, 0.55, 0], spriteSize: 0, strength: 0.35 }),
  incense_burner: spec('incense_burner', 3, 0.43, 160, 700, true,
    { yMin: 0.62, yMax: 0.92, sprite: [0, 0.95, 0], spriteSize: 2.6, strength: 0.55 }, false),
}

export const PROP_IDS = Object.keys(PROPS) as PropId[]
/** Blender pines (public/assets/vegetation): bark + alpha-tested needle cards, merged into one draw by pineSource. */
const PINE_ASSET: Record<string, string | undefined> = { pine_tall: 'pine_2', pine_guest: 'pine_1', pine_small: 'pine_0' }
export const isPine = (id: string) => PINE_ASSET[id] !== undefined
export const propUrl = (id: string, lod1: boolean) => id === 'rock_moss' ? '/assets/environment/rocks/boulders.glb'
  : `/assets/${PINE_ASSET[id] ? `vegetation/${PINE_ASSET[id]}` : `props/${id}`}${lod1 ? '.lod1' : ''}.glb`

/** Crane: wingspan runs along local z (±0.5), body along x; 0.8 m tall at scale 2.694. */
export const CRANE_SCALE = 2.694 * 3.4
