import type { PlayerPhase, PlayerRuntime } from './playerMotion'
import { mixer } from '../audio/mixer'

// All sound is synthesized locally: no remote audio, downloads, or paid services.
class PlayerAudio {
  private context?: AudioContext
  private master?: GainNode
  private wind?: GainNode
  private filter?: BiquadFilterNode
  private source?: AudioBufferSourceNode
  private analyser?: AnalyserNode
  private samples = new Float32Array(256)
  private phase: PlayerPhase = 'GROUND'
  private previousImpact = 0
  private muted = false
  private windLevel = 0
  private events: string[] = []
  private paused = true

  unlock() {
    if (!this.context) {
      const context = this.context = mixer.unlock()
      const master = this.master = context.createGain()
      master.gain.value = 0
      this.analyser = context.createAnalyser()
      this.analyser.fftSize = 256
      master.connect(this.analyser).connect(mixer.bus('sfx') ?? context.destination)
      const wind = this.wind = context.createGain()
      wind.gain.value = 0
      const filter = this.filter = context.createBiquadFilter()
      filter.type = 'lowpass'; filter.frequency.value = 450; filter.Q.value = 0.5
      const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate)
      const data = buffer.getChannelData(0)
      let brown = 0
      for (let i = 0; i < data.length; i++) { brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025; data[i] = brown * 4 }
      // Smooth the loop boundary to avoid a repeating click.
      for (let i = 0; i < 512; i++) data[data.length - 512 + i] = data[data.length - 512 + i] * (1 - i / 512) + data[i] * (i / 512)
      const source = this.source = context.createBufferSource()
      source.buffer = buffer; source.loop = true
      source.connect(filter).connect(wind).connect(master)
      source.start()
    }
    else mixer.unlock()
  }

  private chime(name: string, startFrequency: number, endFrequency: number, duration: number, volume: number) {
    const context = this.context
    if (!context || !this.master || this.muted) return
    this.events.push(name)
    if (this.events.length > 20) this.events.shift()
    const now = context.currentTime
    for (const harmonic of [1, 2.01, 3.97]) {
      const oscillator = context.createOscillator(), gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(startFrequency * harmonic, now)
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency * harmonic, now + duration * 0.6)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(volume / harmonic, now + 0.035)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      oscillator.connect(gain).connect(this.master)
      oscillator.start(now); oscillator.stop(now + duration + 0.03)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    }
  }

  update(state: PlayerRuntime, active: boolean, enabled: boolean) {
    this.muted = !enabled
    const context = this.context
    if (!context || !this.master || !this.wind || !this.filter) return
    this.paused = !active
    if (!active) {
      this.master.gain.setTargetAtTime(0, context.currentTime, 0.025)
      this.wind.gain.setTargetAtTime(0, context.currentTime, 0.025)
      this.windLevel = 0
      return
    }
    this.master.gain.setTargetAtTime(enabled ? 0.24 : 0, context.currentTime, 0.035)
    const speed = state.velocity.length()
    this.windLevel = (state.phase === 'FLIGHT' ? 0.035 + Math.pow(Math.min(1, speed / 70), 1.3) * 0.55 : state.phase === 'SUMMONING' ? Math.sin(Math.PI * Math.min(1, state.elapsed / 1.2)) * 0.18 : 0)
    this.wind.gain.setTargetAtTime(this.windLevel, context.currentTime, 0.12)
    this.filter.frequency.setTargetAtTime(350 + speed * 24, context.currentTime, 0.18)
    if (state.phase !== this.phase) {
      if (state.phase === 'SUMMONING') this.chime('summon', 280, 840, 1.1, 0.14)
      if (state.phase === 'BOARDING') this.chime('jump', 220, 430, 0.45, 0.07)
      if (state.phase === 'DISMOUNTING') this.chime('recall', 660, 220, 0.6, 0.09)
      if (state.phase === 'GROUND' && this.phase === 'DISMOUNTING') this.chime('land', 140, 70, 0.22, 0.10)
      this.phase = state.phase
    }
    if (state.impact > 0.9 && this.previousImpact < 0.5) this.chime('sword-contact', 1080, 720, 0.65, 0.13)
    this.previousImpact = state.impact
  }

  snapshot() {
    this.analyser?.getFloatTimeDomainData(this.samples)
    const rms = Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length)
    return { state: this.context?.state ?? 'locked', time: this.context?.currentTime ?? 0, paused: this.paused, muted: this.muted, windLevel: this.windLevel, rms, events: [...this.events] }
  }

  dispose() {
    // The context is shared with the rest of the game; only this voice's nodes are torn down.
    this.source?.stop()
    this.source?.disconnect()
    this.master?.disconnect()
    this.context = undefined; this.master = undefined; this.wind = undefined; this.filter = undefined
    this.source = undefined; this.analyser = undefined; this.paused = true; this.phase = 'GROUND'; this.events = []
  }
}

export const playerAudio = new PlayerAudio()
