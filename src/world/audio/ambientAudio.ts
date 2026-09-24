import { atmosphere } from '../sky/atmosphere'
import { weather } from '../weather/weatherMachine'
import { mixer } from './mixer'

/*
 * Synthesized soundscape: looped noise beds for wind, rain and the storm rumble on the ambience bus,
 * distance-delayed thunder per lightning strike, sparse birds by day and crickets by night, and a slow
 * pentatonic pad with guzheng-like plucks on the music bus. Everything is built lazily once the mixer
 * has been unlocked by the entry click, so nothing plays (or allocates) before the player starts.
 */

const SPEED_OF_SOUND = 343
/** D gong mode (D E F♯ A B) across three octaves, as MIDI notes. */
const PENTATONIC = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78]
const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12)
const smooth = (edge0: number, edge1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t) }

type NoiseColor = 'white' | 'pink' | 'brown'

/** A few seconds of looped noise; pink and brown via the usual cheap filters. */
function noiseBuffer(context: AudioContext, color: NoiseColor, seconds = 4) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let b0 = 0, b1 = 0, b2 = 0, last = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      if (color === 'white') data[i] = white
      else if (color === 'pink') {
        b0 = 0.997 * b0 + white * 0.029591; b1 = 0.985 * b1 + white * 0.032534; b2 = 0.95 * b2 + white * 0.048056
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.9
      } else {
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      }
    }
    // Crossfade the loop seam so the bed never clicks.
    const fade = Math.floor(context.sampleRate * 0.05)
    for (let i = 0; i < fade; i++) { const t = i / fade; data[i] = data[i] * t + data[length - fade + i] * (1 - t) }
  }
  return buffer
}

interface Bed { gain: GainNode; filter: BiquadFilterNode }

class AmbientAudio {
  private context: AudioContext | null = null
  private wind: Bed | null = null
  private rain: Bed | null = null
  private rumble: Bed | null = null
  private noise = new Map<NoiseColor, AudioBuffer>()
  private musicOut: GainNode | null = null
  private musicLevel = 0
  private nextChord = 2
  private nextPluck = 5
  private nextCritter = 3
  private lastNotes: number[] = []

  /** Builds the graph on the first frame after unlock; returns false while audio is still locked. */
  private ensure() {
    if (this.context) return true
    const context = mixer.audioContext, ambience = mixer.bus('ambience'), music = mixer.bus('music')
    if (!context || !ambience || !music || context.state !== 'running') return false
    this.context = context
    for (const color of ['white', 'pink', 'brown'] as NoiseColor[]) this.noise.set(color, noiseBuffer(context, color))
    this.wind = this.bed('pink', 'bandpass', 520, 0.6)
    this.rain = this.bed('white', 'highpass', 1400, 0.4)
    this.rumble = this.bed('brown', 'lowpass', 160, 0.7)
    // Rain gets a gentle top-end roll-off so it reads as a soft wash, not hiss.
    const rainTone = context.createBiquadFilter()
    rainTone.type = 'lowpass'; rainTone.frequency.value = 6500
    this.rain.filter.disconnect(); this.rain.filter.connect(rainTone).connect(this.rain.gain)
    const out = this.musicOut = context.createGain()
    out.gain.value = 0
    out.connect(music)
    const send = mixer.reverbSend('music')
    if (send) { const wet = context.createGain(); wet.gain.value = 0.85; out.connect(wet).connect(send) }
    return true
  }

  private bed(color: NoiseColor, type: BiquadFilterType, frequency: number, q: number): Bed {
    const context = this.context!
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain()
    source.buffer = this.noise.get(color)!
    source.loop = true
    // Random loop start per bed so identical buffers never phase against each other.
    source.start(0, Math.random() * 3)
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q
    gain.gain.value = 0
    source.connect(filter).connect(gain).connect(mixer.bus('ambience')!)
    return { gain, filter }
  }

  /** Called every frame; `active` is false before entry or while the game is paused. */
  update(delta: number, active: boolean, altitude: number) {
    if (!this.ensure()) return
    const context = this.context!, now = context.currentTime, b = weather.blend
    const wind = Math.min(1.6, atmosphere.wind.length() / 4.3)
    const heights = smooth(20, 260, altitude)
    const on = active ? 1 : 0
    const set = (param: AudioParam, value: number, tau = 0.8) => param.setTargetAtTime(value * on, now, tau)

    // Wind howls more on the heights and in storms; its band wanders so it breathes instead of droning.
    const gust = 0.5 + 0.5 * Math.sin(now * 0.23) * Math.sin(now * 0.071 + 1.3)
    set(this.wind!.gain.gain, (0.05 + heights * 0.07 + wind * 0.06) * (0.65 + gust * 0.5))
    this.wind!.filter.frequency.setTargetAtTime(380 + gust * 420 + wind * 260, now, 1.5)
    const rain = Math.min(1, b.rain)
    set(this.rain!.gain.gain, rain * 0.2 + b.storm * 0.06, 1.5)
    this.rain!.filter.frequency.setTargetAtTime(1600 - rain * 700, now, 2)
    set(this.rumble!.gain.gain, b.storm * 0.16 + rain * 0.03, 2)

    // Music sits back in heavy weather and drifts in and out slowly.
    const musicTarget = on * (1 - b.storm * 0.65) * (1 - rain * 0.25)
    this.musicLevel += (musicTarget - this.musicLevel) * Math.min(1, delta * 0.4)
    this.musicOut!.gain.setTargetAtTime(this.musicLevel * 0.5, now, 0.5)
    if (!active) return

    const night = atmosphere.night
    this.nextChord -= delta; this.nextPluck -= delta; this.nextCritter -= delta
    if (this.nextChord <= 0) { this.chord(now, night); this.nextChord = (night > 0.5 ? 12 : 9) + Math.random() * 6 }
    if (this.nextPluck <= 0) { this.pluckPhrase(now, night); this.nextPluck = 7 + Math.random() * (night > 0.5 ? 14 : 9) }
    if (this.nextCritter <= 0) {
      const calm = (1 - rain) * (1 - b.snow * 0.8) * (1 - b.storm)
      if (calm > 0.4 && heights < 0.8) {
        if (night > 0.6) this.crickets(now, calm)
        else if (night < 0.3) this.bird(now, calm)
      }
      this.nextCritter = night > 0.6 ? 2.5 + Math.random() * 3 : 4 + Math.random() * 7
    }
  }

  /** Soft pad chord: three pentatonic notes, detuned sine+triangle pairs, slow swell and long release. */
  private chord(now: number, night: number) {
    const context = this.context!, out = this.musicOut!
    const low = night > 0.5 ? 0 : 2
    const root = low + Math.floor(Math.random() * 4)
    const notes = [PENTATONIC[root], PENTATONIC[root + 2], PENTATONIC[Math.min(PENTATONIC.length - 1, root + 4 + Math.floor(Math.random() * 2))]]
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = 700 + (1 - night) * 1300; filter.Q.value = 0.3
    const env = context.createGain()
    const hold = 5 + Math.random() * 3, attack = 2.8, release = 6
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(0.055, now + attack)
    env.gain.setValueAtTime(0.055, now + attack + hold)
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release)
    filter.connect(env).connect(out)
    const end = now + attack + hold + release + 0.1
    for (const note of notes) {
      for (const [type, detune, level] of [['sine', -6, 1], ['triangle', 5, 0.35]] as const) {
        const osc = context.createOscillator(), gain = context.createGain()
        osc.type = type; osc.frequency.value = midiToHz(note); osc.detune.value = detune
        gain.gain.value = level / notes.length
        osc.connect(gain).connect(filter)
        osc.start(now); osc.stop(end)
      }
    }
    this.lastNotes = notes
  }

  /** A short guzheng-like phrase: 2–4 plucked notes near the current chord, each with a bent tail. */
  private pluckPhrase(now: number, night: number) {
    const context = this.context!, out = this.musicOut!
    const count = 2 + Math.floor(Math.random() * 3)
    let index = PENTATONIC.indexOf(this.lastNotes[1] ?? PENTATONIC[5]) + (night > 0.5 ? 0 : 2)
    let t = now + 0.05
    for (let i = 0; i < count; i++) {
      index = Math.min(PENTATONIC.length - 1, Math.max(0, index + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]))
      const frequency = midiToHz(PENTATONIC[index])
      const osc = context.createOscillator(), overtone = context.createOscillator(), filter = context.createBiquadFilter(), env = context.createGain()
      osc.type = 'triangle'; overtone.type = 'sine'
      osc.frequency.setValueAtTime(frequency, t)
      // The player's left hand presses the string after the pluck: a small upward bend.
      if (Math.random() < 0.35) osc.frequency.linearRampToValueAtTime(frequency * 1.06, t + 0.45)
      overtone.frequency.value = frequency * 2.003
      filter.type = 'lowpass'; filter.Q.value = 0.8
      filter.frequency.setValueAtTime(frequency * 7, t)
      filter.frequency.exponentialRampToValueAtTime(frequency * 1.6, t + 0.9)
      const level = 0.07 * (night > 0.5 ? 0.75 : 1)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(level, t + 0.004)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
      const overtoneGain = context.createGain()
      overtoneGain.gain.value = 0.3
      osc.connect(filter); overtone.connect(overtoneGain).connect(filter)
      filter.connect(env).connect(out)
      osc.start(t); overtone.start(t); osc.stop(t + 2.7); overtone.stop(t + 2.7)
      t += 0.28 + Math.random() * 0.5
    }
  }

  /** A distant songbird: a few quick descending sine chirps, panned somewhere around the listener. */
  private bird(now: number, calm: number) {
    const context = this.context!, pan = context.createStereoPanner(), env = context.createGain()
    pan.pan.value = Math.random() * 1.6 - 0.8
    env.gain.value = 0.018 * calm
    env.connect(pan).connect(mixer.reverbSend('ambience') ?? mixer.bus('ambience')!)
    pan.connect(mixer.bus('ambience')!)
    const base = 2600 + Math.random() * 1600, chirps = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < chirps; i++) {
      const t = now + i * (0.09 + Math.random() * 0.05), osc = context.createOscillator(), g = context.createGain()
      osc.frequency.setValueAtTime(base * (1.15 - i * 0.04), t)
      osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.07)
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
      osc.connect(g).connect(env); osc.start(t); osc.stop(t + 0.1)
    }
  }

  /** Crickets: a high carrier amplitude-modulated into pulse trains, a couple of voices at once. */
  private crickets(now: number, calm: number) {
    const context = this.context!
    for (let voice = 0; voice < 2; voice++) {
      const t = now + voice * (0.4 + Math.random() * 0.6), seconds = 1.2 + Math.random() * 1.2
      const carrier = context.createOscillator(), am = context.createOscillator(), amDepth = context.createGain(), env = context.createGain(), pan = context.createStereoPanner()
      carrier.frequency.value = 4300 + Math.random() * 900
      am.type = 'square'; am.frequency.value = 22 + Math.random() * 16
      amDepth.gain.value = 0.5
      env.gain.setValueAtTime(0.5, t)
      am.connect(amDepth).connect(env.gain)
      const level = context.createGain()
      level.gain.setValueAtTime(0, t)
      level.gain.linearRampToValueAtTime(0.009 * calm, t + 0.15)
      level.gain.setValueAtTime(0.009 * calm, t + seconds - 0.2)
      level.gain.linearRampToValueAtTime(0, t + seconds)
      pan.pan.value = Math.random() * 1.8 - 0.9
      carrier.connect(env).connect(level).connect(pan).connect(mixer.bus('ambience')!)
      carrier.start(t); am.start(t); carrier.stop(t + seconds + 0.05); am.stop(t + seconds + 0.05)
    }
  }

  /** Live layer levels for verification (DEV hook `__audioState`). */
  stats() {
    const level = (bed: Bed | null) => Number((bed?.gain.gain.value ?? 0).toFixed(4))
    return { state: this.context?.state ?? 'locked', wind: level(this.wind), rain: level(this.rain), rumble: level(this.rumble), music: Number(this.musicLevel.toFixed(3)) }
  }

  /** Thunder for a strike `distance` metres away: arrives distance/343 s later; far bolts roll, near ones crack. */
  thunder(distance: number) {
    const context = this.context
    const out = mixer.bus('ambience'), send = mixer.reverbSend('ambience')
    if (!context || !out) return
    const start = context.currentTime + distance / SPEED_OF_SOUND
    const near = 1 - smooth(300, 1600, distance)
    const seconds = 4 + (1 - near) * 3
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), env = context.createGain()
    source.buffer = this.noise.get('brown')!
    source.loop = true
    filter.type = 'lowpass'; filter.Q.value = 0.9
    // Air eats the highs over distance: near strikes open bright then close, far ones stay a low roll.
    filter.frequency.setValueAtTime(260 + near * 2400, start)
    filter.frequency.exponentialRampToValueAtTime(90 + near * 60, start + seconds)
    const peak = 0.25 + near * 0.55
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(peak, start + 0.04 + (1 - near) * 0.5)
    // A few rolling swells as the sound arrives from different parts of the bolt.
    for (let i = 1; i <= 3; i++) {
      const t = start + (0.4 + (1 - near) * 0.6) * i + Math.random() * 0.3
      env.gain.linearRampToValueAtTime(peak * (0.45 + Math.random() * 0.35) / i, t)
    }
    env.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    source.connect(filter).connect(env).connect(out)
    if (send) { const wet = context.createGain(); wet.gain.value = 0.6; env.connect(wet).connect(send) }
    source.start(start, Math.random() * 2, seconds + 0.2)
  }
}

export const ambientAudio = new AmbientAudio()
