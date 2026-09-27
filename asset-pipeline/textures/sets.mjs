// Chosen source asset per texture set. Shared by download.mjs / build.mjs / meta.mjs / contact.mjs.
// scaleMeters = recommended world-space size of one texture repeat (see meta.mjs for source scan size).
export const SETS = {
  cliff: { source: 'polyhaven', id: 'marble_cliff_05', height: true, scaleMeters: 16 },
  rock_detail: { source: 'polyhaven', id: 'rock_boulder_dry', height: true, scaleMeters: 2 },
  moss: { source: 'polyhaven', id: 'coast_sand_rocks_02', height: false, scaleMeters: 12 },
  grass: { source: 'polyhaven', id: 'forrest_ground_01', height: false, scaleMeters: 2 },
  gravel: { source: 'polyhaven', id: 'rocky_trail', height: false, scaleMeters: 2 },
  paving: { source: 'polyhaven', id: 'large_grey_tiles', height: true, scaleMeters: 3 },
  // Poly Haven has no plain (un-grouted) white marble; ambientCG fallback. No scan size published.
  // Its shipped NormalGL is nearly flat (+-1.6 deg), so the normal is re-derived from its displacement
  // (wrap-around blur radius 1 x2, gradient strength 3 -> mean tilt ~3 deg, p99 ~14 deg).
  marble: { source: 'ambientcg', id: 'Marble019', height: false, scaleMeters: 1, normalFromHeight: { blur: 1, strength: 3 } },
  // Not sampled by any runtime material, so it is built into hi/ only (ship: false).
  roof_tiles: { source: 'polyhaven', id: 'grey_roof_tiles', height: false, scaleMeters: 3, ship: false },
};
