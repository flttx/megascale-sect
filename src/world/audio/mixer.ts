/**
 * Shared Web Audio graph: one AudioContext, a master gain and three buses (music, ambience, sfx).
 * Every sound source connects to `mixer.bus(...)` (dry) or `mixer.reverbSend(...)` (through that bus's
 * hall reverb), so the settings menu can balance and mute everything in one place.
 * All audio is synthesized locally; nothing is downloaded.
 */
export type Bus = 'music' | 'ambience' | 'sfx'
export type VolumeChannel = Bus | 'master'

const DEFAULT_VOLUMES: Record<VolumeChannel, number> = { master: 0.8, music: 0.55, ambience: 0.8, sfx: 0.9 }

/** Exponentially decaying stereo noise: a cheap, smooth hall impulse. */
function hallImpulse(context: BaseAudioContext, seconds: number, decay: number) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buffer
}

class Mixer {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private buses = new Map<Bus, GainNode>()
  private sends = new Map<Bus, GainNode>()
  private volumes = { ...DEFAULT_VOLUMES }
  private muted = false

  /** Creates (first call) and resumes the context. Must run inside a user gesture the first time. */
  unlock(): AudioContext {
    if (!this.context) {
      const context = this.context = new AudioContext()
      const master = this.master = context.createGain()
      master.connect(context.destination)
      for (const bus of ['music', 'ambience', 'sfx'] as Bus[]) {
        const gain = context.createGain()
        gain.connect(master)
        this.buses.set(bus, gain)
      }
      this.apply()
    }
    void this.context.resume().catch((error: unknown) => console.warn('[mixer] audio resume was blocked', error))
    return this.context
  }

  get audioContext() { return this.context }
  get time() { return this.context?.currentTime ?? 0 }

  /** Dry input of a bus, or null before `unlock()`. */
  bus(bus: Bus): GainNode | null { return this.buses.get(bus) ?? null }

  /** Input that feeds the bus through a shared hall reverb (created on first use). */
  reverbSend(bus: Bus): GainNode | null {
    const context = this.context, target = this.buses.get(bus)
    if (!context || !target) return null
    let send = this.sends.get(bus)
    if (!send) {
      send = context.createGain()
      const convolver = context.createConvolver()
      convolver.buffer = hallImpulse(context, bus === 'music' ? 5 : 3.5, bus === 'music' ? 2.6 : 3.2)
      send.connect(convolver).connect(target)
      this.sends.set(bus, send)
    }
    return send
  }

  setVolume(channel: VolumeChannel, value: number) {
    this.volumes[channel] = Math.min(1, Math.max(0, value))
    this.apply()
  }
  getVolume(channel: VolumeChannel) { return this.volumes[channel] }
  getVolumes() { return { ...this.volumes } }

  setMuted(muted: boolean) {
    this.muted = muted
    this.apply()
  }

  private apply() {
    const context = this.context
    if (!context || !this.master) return
    const now = context.currentTime
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, now, 0.05)
    this.buses.forEach((gain, bus) => gain.gain.setTargetAtTime(this.volumes[bus], now, 0.05))
  }
}

export const mixer = new Mixer()
