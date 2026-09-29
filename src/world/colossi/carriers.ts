import { Vector3 } from 'three'
import type { SurfaceHit } from '../surfaces'
import { deckAnchor, evaluateDeckAnchor, kunBodyBlocked, kunClearance, kunDeckHit, kunDockable, kunState } from './kunDeck'
import type { DeckAnchor } from './kunDeck'
import { evaluateTurtleAnchor, turtleBodyBlocked, turtleClearance, turtleDeckHit, turtleDepth, turtleState } from './turtleDeck'

/**
 * The creatures a player can ride (R10e): the kun, which must be flying level to be boarded, and 巨鳌, which always
 * can be. Player motion, feet, the camera and saves ask here rather than of either deck.
 */
export type CarrierId = 'kun' | 'turtle'
export const isCarrier = (surfaceId: string | undefined): surfaceId is CarrierId => surfaceId === 'kun' || surfaceId === 'turtle'

/** The higher carrier surface under (x, z) at or below `fromY` + 1. */
export function carrierHit(x: number, z: number, fromY = Infinity): SurfaceHit | null {
  const kun = kunDeckHit(x, z, fromY), turtle = turtleDeckHit(x, z, fromY)
  return kun && (!turtle || kun.y > turtle.y) ? kun : turtle
}
export const carrierHeading = (id: string) => id === 'turtle' ? turtleState.heading : kunState.heading
export const carrierDockable = (id: string) => id === 'turtle' ? turtleState.ready : kunDockable()

export function carrierAnchor(hit: SurfaceHit): DeckAnchor | null {
  if (hit.surfaceId === 'kun') return deckAnchor(hit)
  if (hit.surfaceId !== 'turtle' || !hit.anchor) return null
  const point = evaluateTurtleAnchor(hit.anchor, new Vector3())
  return point ? { ...hit.anchor, surfaceId: 'turtle', point, yaw: turtleState.heading } : null
}
export const evaluateCarrierAnchor = (anchor: DeckAnchor, out: Vector3) =>
  anchor.surfaceId === 'turtle' ? evaluateTurtleAnchor(anchor, out) : evaluateDeckAnchor(anchor, out)

export const carrierClearance = (from: Vector3, direction: Vector3, length: number) =>
  Math.min(kunClearance(from, direction, length), turtleClearance(from, direction, length))
export const carrierBodyBlocked = (x: number, y: number, z: number, nx: number, nz: number) =>
  kunBodyBlocked(x, y, z, nx, nz) || turtleBodyBlocked(x, y, z, nx, nz)
/** Depth inside a carrier for a flier: only the rigid turtle counts (a flier may pass through the swimming kun, as before). */
export const carrierDepth = turtleDepth
