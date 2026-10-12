import { BufferGeometry } from 'three'

/**
 * All solid bark, including branches and roots; alpha-tested needles never become a canopy wall. Pines collide with
 * this exact mesh and every other prop with its rendered one: a wrapping cylinder left an invisible ring.
 */
export function pineBarkGeometry(source: BufferGeometry) {
  const geometry = new BufferGeometry(),
    bark = source.getAttribute('aPine'),
    index = source.index!
  const indices: number[] = []
  for (let i = 0; i < index.count; i += 3)
    if (bark.getW(index.getX(i)) >= 0.5) indices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
  geometry.setAttribute('position', source.getAttribute('position'))
  geometry.setIndex(indices)
  return geometry
}
