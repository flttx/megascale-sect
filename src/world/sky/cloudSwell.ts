import { Vector4 } from 'three'

/**
 * A colossus breaking the cloud sea (the kun's breach and dive), read by the cloud-sea shader: x, z where the
 * body pierces the tops, the seconds since it began (below 0 when calm) and how far the displaced cloud heaves
 * up around it (0…1). The heave follows the body while it straddles the sea; a ring spreads from it and fades.
 */
export const cloudSwell = new Vector4(0, 0, -1, 0)
