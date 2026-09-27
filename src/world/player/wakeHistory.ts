import { Vector3 } from 'three'

export const WAKE_COUNT = 28
export const WAKE_INTERVAL = 1 / 60
/** Fixed-time samples, interpolated at equal ages for rendering at any refresh rate. */
export class WakeHistory {
  readonly points = Array.from({ length: WAKE_COUNT }, () => new Vector3())
  private samples = Array.from({ length: WAKE_COUNT }, () => new Vector3())
  private previous = new Vector3()
  private phase = 0
  private ready = false
  private relocation = -1

  clear() { this.ready = false }

  update(position: Vector3, speed: number, delta: number, relocation: number) {
    if (!this.ready || relocation !== this.relocation || this.previous.distanceTo(position) > Math.max(8, speed * delta * 2)) {
      this.samples.forEach((p) => p.copy(position))
      this.points.forEach((p) => p.copy(position))
      this.previous.copy(position); this.phase = 0; this.ready = true; this.relocation = relocation
      return
    }
    const first = WAKE_INTERVAL - this.phase
    for (let time = first; time <= delta + 1e-9; time += WAKE_INTERVAL) {
      for (let i = WAKE_COUNT - 1; i > 0; i--) this.samples[i].copy(this.samples[i - 1])
      this.samples[0].lerpVectors(this.previous, position, Math.min(1, time / delta))
    }
    const elapsed = this.phase + delta
    this.phase = Math.max(0, elapsed - Math.floor((elapsed + 1e-9) / WAKE_INTERVAL) * WAKE_INTERVAL)
    const alpha = this.phase / WAKE_INTERVAL
    this.points[0].copy(position)
    for (let i = 1; i < WAKE_COUNT; i++) this.points[i].lerpVectors(this.samples[i], this.samples[i - 1], alpha)
    this.previous.copy(position)
  }
}
