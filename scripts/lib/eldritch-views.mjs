// Review cameras use the actually placed models, so layout changes keep asset/motion checks useful.
export function tentacleView(state, index = 0, framing = 'detail') {
  const tentacle = state.motion?.landmarks?.tentacles?.[index]
  if (!tentacle?.modelMatrix || !tentacle.root || !tentacle.mid)
    throw Error('A visible placed tentacle is required for its review camera')
  const matrix = tentacle.modelMatrix,
    height = Math.hypot(matrix[0], matrix[1], matrix[2])
  // The inspected source's muscle centerline follows YZ; its textured suction cups face local +X.
  const front = matrix.slice(0, 3).map((value) => value / height)
  const middleWeight = framing === 'full' ? 0.5 : 0.6
  const aim = tentacle.root.map((value, axis) => value * (1 - middleWeight) + tentacle.mid[axis] * middleWeight)
  const eye = aim.map(
    (value, axis) =>
      value + front[axis] * height * (framing === 'full' ? 1.25 : 0.85) + (axis === 1 ? height * 0.04 : 0),
  )
  return [eye, aim]
}

export function creatureView(creature, framing = 'detail') {
  if (!creature?.position || !Number.isFinite(creature.height) || !Number.isFinite(creature.yaw))
    throw Error('A placed creature is required for its review camera')
  const [x, y, z] = creature.position,
    h = creature.height,
    yaw = creature.yaw
  if ((creature.sourceType ?? creature.id.split('-')[0]) === 'behemoth') {
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw)
    return [
      [x + h * (0.16 * cos + 1.15 * sin), y + h * 1.8, z + h * (1.15 * cos - 0.16 * sin)],
      [x, y + h * 0.68, z],
    ]
  }
  const distance = framing === 'full' ? 1.3 : 0.8
  return [
    [x + Math.sin(yaw) * h * distance, y + h * 0.9, z + Math.cos(yaw) * h * distance],
    [x, y + h * (framing === 'full' ? 0.46 : 0.72), z],
  ]
}

export function anatomySamples(creature) {
  if (Array.isArray(creature.motion?.probes)) return creature.motion.probes
  if (Array.isArray(creature.motion?.samples)) return creature.motion.samples
  return ['root', 'chest'].filter((id) => creature.motion?.[id]).map((id) => ({ id, ...creature.motion[id] }))
}
