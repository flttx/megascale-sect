import { mixer } from '../audio/mixer'
import type { HorrorCreatureId, HorrorSourceType } from './horrorLayout'
import type { BlackMistHazardKind } from './hazards'

export interface CreatureRoarCue {
  id: string
  creature: HorrorCreatureId
  sourceType?: HorrorSourceType
  cycle: number
  strength: number
  pan: number
  duration: number
}

export interface HazardAudioCue {
  id: string
  serial: number
  phase: 'windup' | 'strike'
  progress: number
  kind: BlackMistHazardKind
  pan: number
  strength: number
}

export interface BlackMistAudioFrame {
  active: boolean
  paused: boolean
  elapsed: number
  corruption: number
  phase: string
  cinematic: boolean
  motionTime?: number
  dread?: number
  creatureRoars?: readonly CreatureRoarCue[]
  hazardCues?: readonly HazardAudioCue[]
  hazardHitId?: number
}

type Source = AudioBufferSourceNode | OscillatorNode
type VoiceKind = 'bell' | 'impact' | 'fracture' | 'ring' | 'mutation' | 'roar'
interface Voice {
  kind: VoiceKind
  sources: Set<Source>
  nodes: AudioNode[]
  output: GainNode
  stopping: boolean
}
interface Bed {
  gain: GainNode
  filter: BiquadFilterNode
}
interface Cue {
  id: string
  time: number
  kind: 'bell' | 'silence' | 'impact' | 'fracture' | 'transformation' | 'kun' | 'turtle' | 'watcher' | 'behemoth'
}

const CUES: readonly Cue[] = [
  { id: 'alarm-1', time: 1, kind: 'bell' },
  { id: 'alarm-2', time: 8, kind: 'bell' },
  { id: 'alarm-3', time: 15, kind: 'bell' },
  { id: 'alarm-silence', time: 21, kind: 'silence' },
  { id: 'front-impact', time: 28, kind: 'impact' },
  { id: 'watcher-apparition', time: 34.2, kind: 'watcher' },
  { id: 'sect-impact', time: 35, kind: 'fracture' },
  { id: 'behemoth-apparition', time: 37.2, kind: 'behemoth' },
  { id: 'kun-mutation', time: 40.2, kind: 'kun' },
  { id: 'world-transformation', time: 43, kind: 'transformation' },
  { id: 'turtle-mutation', time: 46.2, kind: 'turtle' },
]

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

/** Stereo noise with a crossfaded seam; all sound is authored locally, without downloaded assets. */
function noiseBuffer(context: AudioContext, brown: boolean) {
  const length = Math.floor(context.sampleRate * 6)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  const seam = Math.floor(context.sampleRate * 0.08)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0,
      mid = 0,
      slow = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = (low + white * 0.025) / 1.025
      mid = mid * 0.98 + white * 0.045
      slow = slow * 0.997 + white * 0.018
      data[i] = brown ? low * 4 : (slow + mid + white * 0.16) * 0.9
    }
    for (let i = 0; i < seam; i++) {
      const t = i / seam
      data[i] = data[length - seam + i] * (1 - t) + data[i] * t
    }
  }
  return buffer
}

/** One private hall sits before the gates, so a paused overlay also silences its lingering tail. */
function hallImpulse(context: AudioContext) {
  const length = Math.floor(context.sampleRate * 5.2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      low = low * 0.62 + (Math.random() * 2 - 1) * 0.38
      data[i] = low * Math.pow(1 - i / length, 2.7)
    }
  }
  return buffer
}

/** A single bounded graph for the horizon, arrival, transformation and explorable aftermath. */
class BlackMistAudio {
  private context: AudioContext | null = null
  private nodes: AudioNode[] = []
  private sources: Source[] = []
  private voices = new Set<Voice>()
  private noise: AudioBuffer | null = null
  private ambienceGate: GainNode | null = null
  private musicGate: GainNode | null = null
  private effectsGate: GainNode | null = null
  private effectsInput: GainNode | null = null
  private reverbInput: GainNode | null = null
  private wind: Bed | null = null
  private edge: Bed | null = null
  private rumble: Bed | null = null
  private breath: Bed | null = null
  private pressure: GainNode | null = null
  private drone: GainNode | null = null
  private heartbeat: GainNode | null = null
  private dread = 0
  private previousElapsed = -1
  private previousActive = false
  private audible = false
  private paused = false
  private cinematic = false
  private phase = 'idle'
  private corruption = 0
  private played = new Set<string>()
  private nextAftermathRing = 0
  private roarCycles = new Map<HorrorCreatureId, number>()
  private roarHistory: {
    cue: CreatureRoarCue
    motionTime: number
    contextTime: number
    voice: Voice
    resumes: number
  }[] = []
  private hazardEvents = new Map<string, string>()
  private hazardHitId = 0
  private hazardHistory: { id: string; phase: string; time: number; pan: number }[] = []

  private ensure() {
    if (this.context) return this.context.state !== 'closed'
    const context = mixer.audioContext
    const ambience = mixer.bus('ambience'),
      music = mixer.bus('music'),
      sfx = mixer.bus('sfx')
    if (!context || !ambience || !music || !sfx || context.state !== 'running') return false
    this.context = context
    this.ambienceGate = context.createGain()
    this.musicGate = context.createGain()
    this.effectsGate = context.createGain()
    for (const [gate, bus] of [
      [this.ambienceGate, ambience],
      [this.musicGate, music],
      [this.effectsGate, sfx],
    ]) {
      gate.gain.value = 0
      gate.connect(bus)
      this.nodes.push(gate)
    }

    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.knee.value = 12
    compressor.ratio.value = 4
    compressor.attack.value = 0.006
    compressor.release.value = 0.6
    this.effectsInput = context.createGain()
    this.effectsInput.connect(compressor).connect(this.effectsGate)
    this.reverbInput = context.createGain()
    const reverb = context.createConvolver(),
      wet = context.createGain()
    reverb.buffer = hallImpulse(context)
    wet.gain.value = 0.4
    this.reverbInput.connect(reverb).connect(wet).connect(this.effectsInput)
    this.nodes.push(compressor, this.effectsInput, this.reverbInput, reverb, wet)

    this.noise = noiseBuffer(context, true)
    const air = noiseBuffer(context, false)
    this.wind = this.bed(air, 'lowpass', 640, 0.5, -0.22)
    this.edge = this.bed(air, 'bandpass', 1100, 0.75, 0.48)
    this.rumble = this.bed(this.noise, 'lowpass', 110, 0.7, 0)
    this.breath = this.bed(air, 'bandpass', 560, 3.8, -0.36)

    this.pressure = context.createGain()
    this.pressure.gain.value = 0
    this.pressure.connect(this.ambienceGate)
    this.nodes.push(this.pressure)
    for (const [hz, level] of [
      [28.5, 0.65],
      [42.8, 0.3],
      [85.6, 0.12],
    ])
      this.continuousTone(hz, level, this.pressure)

    this.drone = context.createGain()
    const tone = context.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 430
    tone.Q.value = 0.4
    this.drone.gain.value = 0
    this.drone.connect(tone).connect(this.musicGate)
    this.nodes.push(this.drone, tone)
    // A slow beating open fifth acquires an uneasy, quiet upper interval as the front closes in.
    for (const [hz, level] of [
      [36.71, 0.5],
      [37.02, 0.18],
      [55.01, 0.28],
      [73.42, 0.12],
      [103.83, 0.055],
    ]) {
      this.continuousTone(hz, level, this.drone)
    }
    this.heartbeat = context.createGain()
    const pulseFilter = context.createBiquadFilter()
    pulseFilter.type = 'lowpass'
    pulseFilter.frequency.value = 145
    pulseFilter.Q.value = 0.9
    this.heartbeat.gain.value = 0
    this.heartbeat.connect(pulseFilter).connect(this.effectsInput)
    this.nodes.push(this.heartbeat, pulseFilter)
    this.continuousTone(43, 0.62, this.heartbeat)
    this.continuousTone(74, 0.18, this.heartbeat)
    return true
  }

  private continuousTone(hz: number, level: number, target: GainNode) {
    const context = this.context!,
      source = context.createOscillator(),
      gain = context.createGain()
    source.type = 'sine'
    source.frequency.value = hz
    gain.gain.value = level
    source.connect(gain).connect(target)
    source.start()
    this.sources.push(source)
    this.nodes.push(source, gain)
  }

  private bed(buffer: AudioBuffer, type: BiquadFilterType, frequency: number, q: number, panValue: number): Bed {
    const context = this.context!,
      source = context.createBufferSource(),
      filter = context.createBiquadFilter()
    const gain = context.createGain(),
      pan = context.createStereoPanner()
    source.buffer = buffer
    source.loop = true
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    gain.gain.value = 0
    pan.pan.value = panValue
    source.connect(filter).connect(gain).connect(pan).connect(this.ambienceGate!)
    source.start(0, Math.random() * 4)
    this.sources.push(source)
    this.nodes.push(source, filter, gain, pan)
    return { gain, filter }
  }

  private voice(kind: VoiceKind, output: GainNode, sources: Source[], nodes: AudioNode[]) {
    const voice: Voice = { kind, sources: new Set(sources), nodes, output, stopping: false }
    this.voices.add(voice)
    for (const source of sources)
      source.onended = () => {
        source.disconnect()
        voice.sources.delete(source)
        if (voice.sources.size === 0) {
          voice.nodes.forEach((node) => node.disconnect())
          this.voices.delete(voice)
        }
      }
    return voice
  }

  private route(output: GainNode, nodes: AudioNode[], panValue: number, wetAmount: number) {
    const context = this.context!,
      pan = context.createStereoPanner(),
      wet = context.createGain()
    pan.pan.value = panValue
    wet.gain.value = wetAmount
    output.connect(pan).connect(this.effectsInput!)
    output.connect(wet).connect(this.reverbInput!)
    nodes.push(output, pan, wet)
  }

  private bell() {
    const context = this.context!,
      now = context.currentTime
    const output = context.createGain(),
      filter = context.createBiquadFilter()
    output.gain.value = 0.7
    filter.type = 'lowpass'
    filter.frequency.value = 1150
    filter.Q.value = 0.4
    filter.connect(output)
    const nodes: AudioNode[] = [filter],
      sources: Source[] = []
    this.route(output, nodes, -0.55, 0.75)
    // Inharmonic bronze partials and narrow beating retain weight without a sharp nearby hammer.
    const partials = [
      [0.5, 0.09, 10],
      [1, 0.075, 9],
      [1.183, 0.048, 7.8],
      [1.506, 0.04, 6.5],
      [2, 0.025, 5.5],
      [2.514, 0.015, 4.2],
    ]
    for (const [ratio, level, decay] of partials) {
      for (const detune of [-0.22, 0.32]) {
        const source = context.createOscillator(),
          envelope = context.createGain()
        source.frequency.value = 88 * ratio + detune
        envelope.gain.setValueAtTime(0.0001, now)
        envelope.gain.exponentialRampToValueAtTime(level * 0.6, now + 0.045)
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay)
        source.connect(envelope).connect(filter)
        sources.push(source)
        nodes.push(source, envelope)
        source.start(now)
        source.stop(now + decay + 0.1)
      }
    }
    this.voice('bell', output, sources, nodes)
  }

  private impact(strength: number) {
    const context = this.context!,
      now = context.currentTime,
      seconds = 6.4
    const source = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      envelope = context.createGain()
    const output = context.createGain()
    output.gain.value = strength
    source.buffer = this.noise
    source.loop = true
    filter.type = 'lowpass'
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(1100, now)
    filter.frequency.exponentialRampToValueAtTime(72, now + seconds)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.52, now + 0.028)
    envelope.gain.exponentialRampToValueAtTime(0.18, now + 0.6)
    envelope.gain.linearRampToValueAtTime(0.25, now + 1.35)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(envelope).connect(output)
    const nodes: AudioNode[] = [source, filter, envelope],
      sources: Source[] = [source]
    this.route(output, nodes, 0.08, 0.8)
    source.start(now, 1.2)
    source.stop(now + seconds + 0.1)
    for (const [hz, level, decay] of [
      [57, 0.18, 3.5],
      [34, 0.1, 4.8],
      [116, 0.08, 1.6],
    ]) {
      const tone = context.createOscillator(),
        gain = context.createGain()
      tone.frequency.setValueAtTime(hz * 1.6, now)
      tone.frequency.exponentialRampToValueAtTime(hz * 0.72, now + decay)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(level, now + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      tone.connect(gain).connect(output)
      sources.push(tone)
      nodes.push(tone, gain)
      tone.start(now)
      tone.stop(now + decay + 0.1)
    }
    this.voice('impact', output, sources, nodes)
  }

  private fracture(strength: number) {
    const context = this.context!,
      now = context.currentTime,
      output = context.createGain()
    output.gain.value = strength
    const nodes: AudioNode[] = [],
      sources: Source[] = []
    this.route(output, nodes, -0.35, 0.6)
    // Irregular multi-scale fractures travel across the hall rather than repeating a single click.
    for (const [delay, hz, level, decay] of [
      [0, 2350, 0.2, 0.32],
      [0.22, 980, 0.15, 0.65],
      [0.68, 1700, 0.12, 0.5],
      [1.26, 560, 0.15, 1.5],
      [2.05, 1250, 0.09, 0.7],
    ]) {
      const t = now + delay,
        source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        envelope = context.createGain()
      source.buffer = this.noise
      source.loop = true
      filter.type = 'bandpass'
      filter.Q.value = 1.2
      filter.frequency.setValueAtTime(hz, t)
      filter.frequency.exponentialRampToValueAtTime(hz * 0.2, t + decay)
      envelope.gain.setValueAtTime(0.0001, t)
      envelope.gain.exponentialRampToValueAtTime(level, t + 0.006)
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      source.connect(filter).connect(envelope).connect(output)
      sources.push(source)
      nodes.push(source, filter, envelope)
      source.start(t, delay)
      source.stop(t + decay + 0.05)
    }
    this.voice('fracture', output, sources, nodes)
  }

  /** A deep creature resonance with close, damp tissue pulses accompanies each beast reveal. */
  private organism(base: number, pan: number) {
    const context = this.context!,
      now = context.currentTime,
      output = context.createGain()
    output.gain.value = 0.8
    const nodes: AudioNode[] = [],
      sources: Source[] = []
    this.route(output, nodes, pan, 0.8)
    for (const [ratio, level] of [
      [1, 0.11],
      [1.012, 0.055],
      [2.41, 0.026],
    ]) {
      const source = context.createOscillator(),
        gain = context.createGain()
      source.type = 'sine'
      source.frequency.setValueAtTime(base * ratio * 1.6, now)
      source.frequency.exponentialRampToValueAtTime(base * ratio * 0.72, now + 4.8)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(level, now + 0.7)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.1)
      source.connect(gain).connect(output)
      sources.push(source)
      nodes.push(source, gain)
      source.start(now)
      source.stop(now + 5.2)
    }
    for (const [delay, hz, level] of [
      [0.1, 380, 0.09],
      [0.82, 570, 0.075],
      [1.73, 310, 0.08],
      [3.1, 450, 0.05],
    ]) {
      const t = now + delay,
        source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain()
      source.buffer = this.noise
      source.loop = true
      filter.type = 'bandpass'
      filter.Q.value = 3.2
      filter.frequency.setValueAtTime(hz, t)
      filter.frequency.exponentialRampToValueAtTime(hz * 0.28, t + 0.85)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(level, t + 0.045)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      source.connect(filter).connect(gain).connect(output)
      sources.push(source)
      nodes.push(source, filter, gain)
      source.start(t, delay)
      source.stop(t + 1.2)
    }
    this.voice('mutation', output, sources, nodes)
  }

  private ring(strength: number) {
    const context = this.context!,
      now = context.currentTime,
      output = context.createGain()
    output.gain.value = strength
    const nodes: AudioNode[] = [],
      sources: Source[] = []
    this.route(output, nodes, 0.6, 1.1)
    for (const [hz, level, decay] of [
      [146.8, 0.055, 11],
      [207.6, 0.025, 9],
      [293.3, 0.018, 8],
      [438.1, 0.01, 6.5],
    ]) {
      const source = context.createOscillator(),
        gain = context.createGain()
      source.frequency.setValueAtTime(hz, now)
      source.frequency.linearRampToValueAtTime(hz * 0.965, now + decay)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(level, now + 0.9)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      source.connect(gain).connect(output)
      sources.push(source)
      nodes.push(source, gain)
      source.start(now)
      source.stop(now + decay + 0.1)
    }
    this.voice('ring', output, sources, nodes)
  }

  /** A rough glottal growl and shifting throat formants follow the creature's held roar pose. */
  private roar(cue: CreatureRoarCue) {
    const context = this.context!,
      now = context.currentTime,
      seconds = Math.max(0.4, Math.min(5.2, cue.duration))
    const output = context.createGain(),
      throat = context.createBiquadFilter(),
      envelope = context.createGain()
    output.gain.value = 0.62 * clamp(cue.strength)
    throat.type = 'lowpass'
    throat.Q.value = 1.2
    throat.frequency.setValueAtTime(680, now)
    throat.frequency.exponentialRampToValueAtTime(180, now + seconds)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.58, now + Math.min(0.22, seconds * 0.25))
    throat.connect(envelope).connect(output)
    const nodes: AudioNode[] = [throat, envelope],
      sources: Source[] = []
    this.route(output, nodes, Math.max(-1, Math.min(1, cue.pan)), 0.85)
    const watcher = (cue.sourceType ?? cue.creature.split('-')[0]) === 'watcher'
    const base = watcher ? 29 : 37
    // Unequal fundamentals and flutter keep the voice from sounding like a steady musical drone.
    const flutter = context.createOscillator(),
      flutterGain = context.createGain()
    flutter.frequency.value = watcher ? 8.7 : 6.4
    flutterGain.gain.value = 2.6
    flutter.connect(flutterGain)
    sources.push(flutter)
    nodes.push(flutter, flutterGain)
    flutter.start(now)
    for (const [ratio, level] of [
      [1, 0.11],
      [1.031, 0.065],
      [2.07, 0.027],
      [3.41, 0.017],
    ]) {
      const source = context.createOscillator(),
        gain = context.createGain()
      source.type = 'sawtooth'
      source.frequency.setValueAtTime(base * ratio * 1.32, now)
      source.frequency.exponentialRampToValueAtTime(base * ratio * 0.69, now + seconds)
      flutterGain.connect(source.frequency)
      gain.gain.value = level
      source.connect(gain).connect(throat)
      sources.push(source)
      nodes.push(source, gain)
      source.start(now)
    }
    for (const [frequency, level, q] of [
      [310, 0.22, 2.4],
      [920, 0.08, 1.9],
    ]) {
      const source = context.createBufferSource(),
        formant = context.createBiquadFilter(),
        gain = context.createGain()
      source.buffer = this.noise
      source.loop = true
      formant.type = 'bandpass'
      formant.Q.value = q
      formant.frequency.setValueAtTime(frequency, now)
      formant.frequency.exponentialRampToValueAtTime(frequency * 0.55, now + seconds)
      gain.gain.value = level
      source.connect(formant).connect(gain).connect(envelope)
      sources.push(source)
      nodes.push(source, formant, gain)
      source.start(now, watcher ? 0.3 : 2.1)
    }
    return this.voice('roar', output, sources, nodes)
  }

  /** A directional wet inhale warns before a short, forceful sweep. */
  private hazard(cue: HazardAudioCue) {
    const context = this.context!,
      now = context.currentTime,
      windup = cue.phase === 'windup'
    const seconds = windup ? 1.1 : 0.48,
      output = context.createGain()
    output.gain.value = cue.strength * (windup ? 0.32 : 0.55)
    const source = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      envelope = context.createGain()
    source.buffer = this.noise
    source.loop = true
    filter.type = 'bandpass'
    filter.Q.value = windup ? 2.8 : 0.7
    filter.frequency.setValueAtTime(windup ? 170 : 980, now)
    filter.frequency.exponentialRampToValueAtTime(windup ? 650 : 95, now + seconds)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(windup ? 0.35 : 0.65, now + (windup ? 0.6 : 0.045))
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(envelope).connect(output)
    const nodes: AudioNode[] = [source, filter, envelope],
      sources: Source[] = [source]
    this.route(output, nodes, cue.pan, 0.28)
    source.start(now, windup ? 0.4 : 1.4)
    source.stop(now + seconds + 0.04)
    this.voice('mutation', output, sources, nodes)
  }

  private stopVoice(voice: Voice) {
    if (voice.stopping || !this.context) return
    voice.stopping = true
    const now = this.context.currentTime
    voice.output.gain.cancelScheduledValues(now)
    voice.output.gain.setTargetAtTime(0, now, 0.015)
    for (const source of voice.sources) source.stop(now + 0.08)
  }

  private gates(audible: boolean) {
    if (!this.context) return
    const now = this.context.currentTime
    for (const gate of [this.ambienceGate, this.musicGate, this.effectsGate]) {
      gate?.gain.setTargetAtTime(audible ? 1 : 0, now, audible ? 0.28 : 0.018)
    }
  }

  update(frame: BlackMistAudioFrame) {
    const elapsed = Math.max(0, Number.isFinite(frame.elapsed) ? frame.elapsed : 0)
    const restarted = frame.active && (!this.previousActive || elapsed < this.previousElapsed - 0.25)
    if (restarted) {
      this.clearGraph()
      this.played.clear()
      this.nextAftermathRing = elapsed + 12
      this.roarCycles.clear()
      this.roarHistory = []
      this.hazardEvents.clear()
      this.hazardHitId = 0
      this.hazardHistory = []
    }
    const previousElapsed = restarted ? elapsed : this.previousElapsed
    const audible = frame.active && !frame.paused && !document.hidden
    this.paused = frame.paused || document.hidden
    this.cinematic = frame.cinematic
    this.phase = frame.phase
    this.corruption = clamp(frame.corruption)
    this.previousElapsed = elapsed
    this.previousActive = frame.active
    const hazardCues = (frame.hazardCues ?? []).filter((cue) => {
      const event = `${cue.serial}:${cue.phase}`,
        changed = this.hazardEvents.get(cue.id) !== event
      this.hazardEvents.set(cue.id, event)
      return changed && cue.progress < 0.25
    })
    const hit = (frame.hazardHitId ?? 0) > this.hazardHitId
    this.hazardHitId = frame.hazardHitId ?? 0
    if (audible && !this.ensure()) {
      this.audible = false
      return
    }
    if (!this.context) {
      this.audible = false
      return
    }
    if (this.audible && !audible) for (const voice of this.voices) this.stopVoice(voice)
    const resumed = !this.audible && audible && this.context.state === 'running'
    this.audible = audible && this.context.state === 'running'
    this.gates(this.audible)
    if (!this.audible) return

    for (const cue of hazardCues) {
      this.hazard(cue)
      this.hazardHistory.push({
        id: `${cue.id}:${cue.serial}`,
        phase: cue.phase,
        time: frame.motionTime ?? elapsed,
        pan: cue.pan,
      })
    }
    if (hit) {
      this.impact(0.45)
      this.hazardHistory.push({
        id: `hit:${this.hazardHitId}`,
        phase: 'hit',
        time: frame.motionTime ?? elapsed,
        pan: 0,
      })
    }
    if (this.hazardHistory.length > 32) this.hazardHistory.splice(0, this.hazardHistory.length - 32)

    const now = this.context.currentTime,
      corruption = this.corruption
    const livingTime = Number.isFinite(frame.motionTime) ? Math.max(0, frame.motionTime!) : elapsed
    this.dread = clamp(frame.dread ?? 0)
    const front = smooth(5, 28, elapsed)
    const climax = smooth(24, 41, elapsed) * (1 - smooth(46, 58, elapsed))
    const gust = 0.5 + Math.sin(livingTime * 0.23) * Math.sin(livingTime * 0.071 + 1.3) * 0.5
    const set = (param: AudioParam, value: number, tau = 0.65) => param.setTargetAtTime(value, now, tau)
    set(
      this.wind!.gain.gain,
      frame.cinematic ? (0.018 + front * 0.12 + climax * 0.065) * (0.7 + gust * 0.35) : 0.025 + corruption * 0.035,
    )
    set(this.wind!.filter.frequency, frame.cinematic ? 420 + front * 620 + climax * 950 : 440 + gust * 230, 1.4)
    set(this.edge!.gain.gain, frame.cinematic ? 0.003 + front * 0.026 + climax * 0.028 : corruption * 0.008)
    set(this.edge!.filter.frequency, 850 + gust * 570 + climax * 800, 1.2)
    set(this.rumble!.gain.gain, frame.cinematic ? 0.014 + front * 0.09 + climax * 0.11 : 0.028 + corruption * 0.022)
    set(this.rumble!.filter.frequency, 90 + climax * 70, 1.1)
    set(this.pressure!.gain, frame.cinematic ? front * 0.024 + climax * 0.037 : corruption * 0.012)
    set(this.breath!.gain.gain, corruption * (frame.cinematic ? 0.019 + climax * 0.02 : 0.017) * (0.6 + gust * 0.4))
    set(this.breath!.filter.frequency, 450 + Math.sin(elapsed * 0.12) * 170 + corruption * 160, 1.4)
    set(this.drone!.gain, frame.cinematic ? 0.012 + front * 0.035 + climax * 0.055 : 0.018 + corruption * 0.01, 1.1)
    const heartPeriod = 1.45 - this.dread * 0.48,
      beat = livingTime % heartPeriod
    const pulse = Math.exp(-Math.pow((beat - 0.045) / 0.06, 2)) + 0.62 * Math.exp(-Math.pow((beat - 0.285) / 0.08, 2))
    set(this.heartbeat!.gain, corruption * (0.008 + this.dread * 0.055) * pulse, 0.035)
    set(
      this.pressure!.gain,
      (frame.cinematic ? front * 0.024 + climax * 0.037 : corruption * 0.012) + corruption * this.dread * 0.016,
    )

    const roars = frame.creatureRoars ?? []
    for (const record of this.roarHistory) {
      if (!record.voice.stopping && this.voices.has(record.voice) && !roars.some((cue) => cue.id === record.cue.id))
        this.stopVoice(record.voice)
    }
    for (const cue of roars) {
      if (cue.strength <= 0) continue
      const previousCycle = this.roarCycles.get(cue.creature)
      if (previousCycle !== undefined && cue.cycle < previousCycle) continue
      if (previousCycle === cue.cycle) {
        const record = this.roarHistory.find((entry) => entry.cue.id === cue.id)
        if (record) {
          if (resumed && record.voice.stopping) {
            record.voice = this.roar(cue)
            record.resumes++
          }
          if (!record.voice.stopping) record.voice.output.gain.setTargetAtTime(0.62 * clamp(cue.strength), now, 0.06)
        }
        continue
      }
      this.roarCycles.set(cue.creature, cue.cycle)
      const voice = this.roar(cue)
      this.roarHistory.push({ cue: { ...cue }, motionTime: livingTime, contextTime: now, voice, resumes: 0 })
      if (this.roarHistory.length > 24) this.roarHistory.shift()
    }

    // Crossing tests avoid replaying stale impacts after pauses, a locked context or an elapsed jump.
    if (frame.cinematic && previousElapsed >= 0 && elapsed - previousElapsed <= 1.25) {
      for (const cue of CUES) {
        if (this.played.has(cue.id) || previousElapsed >= cue.time || elapsed < cue.time) continue
        this.played.add(cue.id)
        if (cue.kind === 'bell') this.bell()
        else if (cue.kind === 'silence') {
          for (const voice of this.voices) if (voice.kind === 'bell') this.stopVoice(voice)
        } else if (cue.kind === 'impact') this.impact(0.85)
        else if (cue.kind === 'fracture') {
          this.impact(1)
          this.fracture(1)
          this.ring(0.6)
        } else if (cue.kind === 'kun') this.organism(49, -0.25)
        else if (cue.kind === 'turtle') this.organism(32, 0.25)
        else if (cue.kind === 'watcher') {
          this.organism(24.5, -0.48)
          this.ring(0.75)
        } else if (cue.kind === 'behemoth') {
          this.organism(31.2, 0.42)
          this.impact(0.5)
        } else {
          this.impact(1.15)
          this.fracture(0.75)
          this.ring(1)
        }
      }
    }
    if (!frame.cinematic && elapsed >= this.nextAftermathRing) {
      this.ring(0.2 + corruption * 0.1)
      this.nextAftermathRing = elapsed + 19 + Math.random() * 11
    }
  }

  snapshot() {
    const value = (param: AudioParam | undefined) => Number((param?.value ?? 0).toFixed(4))
    return {
      state: this.context?.state ?? 'locked',
      active: this.previousActive,
      paused: this.paused,
      audible: this.audible,
      cinematic: this.cinematic,
      phase: this.phase,
      elapsed: this.previousElapsed,
      corruption: this.corruption,
      cues: [...this.played],
      dread: this.dread,
      hazards: this.hazardHistory.map((cue) => ({ ...cue })),
      roars: this.roarHistory.map(({ cue, motionTime, contextTime, voice, resumes }) => ({
        ...cue,
        motionTime,
        contextTime,
        resumes,
        voiceActive: this.voices.has(voice),
        stopping: voice.stopping,
      })),
      voices: this.voices.size,
      sources: this.sources.length + [...this.voices].reduce((n, voice) => n + voice.sources.size, 0),
      nodes: this.nodes.length + [...this.voices].reduce((n, voice) => n + voice.nodes.length, 0),
      gates: {
        ambience: value(this.ambienceGate?.gain),
        music: value(this.musicGate?.gain),
        sfx: value(this.effectsGate?.gain),
      },
      layers: {
        wind: value(this.wind?.gain.gain),
        edge: value(this.edge?.gain.gain),
        rumble: value(this.rumble?.gain.gain),
        breath: value(this.breath?.gain.gain),
        pressure: value(this.pressure?.gain),
        drone: value(this.drone?.gain),
        heartbeat: value(this.heartbeat?.gain),
      },
    }
  }

  private clearGraph() {
    for (const voice of this.voices) {
      for (const source of voice.sources) {
        source.onended = null
        source.stop()
        source.disconnect()
      }
      voice.nodes.forEach((node) => node.disconnect())
    }
    this.voices.clear()
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
    this.nodes.forEach((node) => node.disconnect())
    this.sources = []
    this.nodes = []
    this.context = null
    this.noise = null
    this.ambienceGate = null
    this.musicGate = null
    this.effectsGate = null
    this.effectsInput = null
    this.reverbInput = null
    this.wind = null
    this.edge = null
    this.rumble = null
    this.breath = null
    this.pressure = null
    this.drone = null
    this.heartbeat = null
    this.audible = false
    this.dread = 0
  }

  dispose() {
    this.clearGraph()
    this.played.clear()
    this.previousElapsed = -1
    this.previousActive = false
    this.roarCycles.clear()
    this.roarHistory = []
    this.hazardEvents.clear()
    this.hazardHitId = 0
    this.hazardHistory = []
    this.paused = false
    this.cinematic = false
    this.phase = 'idle'
    this.corruption = 0
    this.nextAftermathRing = 0
  }
}

export const blackMistAudio = new BlackMistAudio()
