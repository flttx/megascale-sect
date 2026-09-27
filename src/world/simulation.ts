/** The carrier and rider must advance through the same amount of simulation time. */
export const simulationDelta = (delta: number) => Math.min(Math.max(0, delta), 0.05)
