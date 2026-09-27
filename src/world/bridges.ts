import type { Vec3 } from './surfaces'

/**
 * The plank bridges, kept apart from sites.ts (which samples the terrain while it loads) so the terrain can cut
 * under their decks without an import cycle. sites.ts re-exports them.
 */

export interface BridgeSite {
  id: string; island: string
  /** Deck endpoints (walking height). `from` overlaps the platform by 4 m, `to` overlaps the island pad by 2 m. */
  from: Vec3; to: Vec3
  halfWidth: number
  /** Mid-span sag of the deck in metres. */
  sag: number
}

export const BRIDGES: BridgeSite[] = [
  { id: 'bridge_west', island: 'isle_west', from: [-186, 24, -102], to: [-284, 30, -102], halfWidth: 2.2, sag: 3 },
  { id: 'bridge_east', island: 'isle_east', from: [186, 24, -85], to: [314, 40, -85], halfWidth: 2.2, sag: 3.5 },
]

/** Span parameter (0 at `from`, 1 at `to`), distance from the centre line and deck height for (x, z). */
export function bridgeDeck(b: BridgeSite, x: number, z: number) {
  const dx = b.to[0] - b.from[0], dz = b.to[2] - b.from[2], len = Math.hypot(dx, dz)
  const t = ((x - b.from[0]) * dx + (z - b.from[2]) * dz) / (len * len)
  const side = Math.abs((x - b.from[0]) * dz - (z - b.from[2]) * dx) / len
  return { t, side, y: b.from[1] + (b.to[1] - b.from[1]) * t - b.sag * 4 * t * (1 - t) }
}
