import { mixer } from '../audio/mixer'

/** Routes a voice to the sfx bus and its hall reverb; null before audio is unlocked. */
function output(wet: number) {
  const context = mixer.audioContext, dry = mixer.bus('sfx'), send = mixer.reverbSend('sfx')
  if (!context || !dry) return null
  const gain = context.createGain()
  gain.connect(dry)
  if (send) {
    const wetGain = context.createGain()
    wetGain.gain.value = wet
    gain.connect(wetGain).connect(send)
  }
  return { context, gain }
}

function partial(context: AudioContext, target: AudioNode, frequency: number, level: number, decay: number, start: number, type: OscillatorType = 'sine') {
  const osc = context.createOscillator(), env = context.createGain()
  osc.type = type
  osc.frequency.value = frequency
  env.gain.setValueAtTime(0, start)
  env.gain.linearRampToValueAtTime(level, start + 0.006)
  env.gain.exponentialRampToValueAtTime(0.0001, start + decay)
  osc.connect(env).connect(target)
  osc.start(start)
  osc.stop(start + decay + 0.05)
}

function noiseBurst(context: AudioContext, target: AudioNode, start: number, seconds: number, frequency: number, q: number, level: number) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), env = context.createGain()
  source.buffer = buffer
  filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q
  env.gain.value = level
  source.connect(filter).connect(env).connect(target)
  source.start(start)
}

/**
 * Deep bronze temple bell: inharmonic bell partials (hum, prime, tierce, quint, nominal…) with slow
 * beating pairs for the characteristic "wah" shimmer, plus the wooden ram's thud.
 */
export function playBell() {
  const out = output(0.9)
  if (!out) return
  const { context, gain } = out, now = context.currentTime + 0.02
  gain.gain.value = 0.55
  const base = 82
  const partials: [number, number, number][] = [
    [0.5, 0.5, 14], [1, 0.42, 11], [1.183, 0.28, 8], [1.506, 0.2, 6.5], [2, 0.22, 5.5], [2.514, 0.1, 4], [2.662, 0.09, 3.6], [3.011, 0.07, 3], [4.166, 0.05, 2.2], [5.433, 0.035, 1.4],
  ]
  for (const [ratio, level, decay] of partials) {
    partial(context, gain, base * ratio, level, decay, now)
    // A slightly detuned twin beats against it (0.4–1.2 Hz), like a real cast bell's asymmetry.
    partial(context, gain, base * ratio + 0.4 + ratio * 0.18, level * 0.55, decay * 0.9, now)
  }
  noiseBurst(context, gain, now, 0.12, 420, 1.2, 0.9)
  noiseBurst(context, gain, now, 0.05, 1800, 2, 0.25)
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14]
let chimeStep = 0

/** Soft glassy chime for a collected spirit orb; each pickup climbs the pentatonic scale. */
export function playChime() {
  const out = output(0.7)
  if (!out) return
  const { context, gain } = out, now = context.currentTime + 0.01
  gain.gain.value = 0.22
  const note = 880 * Math.pow(2, PENTATONIC[chimeStep++ % PENTATONIC.length] / 12)
  partial(context, gain, note, 0.5, 1.6, now)
  partial(context, gain, note * 2.76, 0.12, 0.7, now)
  partial(context, gain, note * 1.5, 0.18, 1.1, now + 0.07)
}

/** Rising airy shimmer for a teleport jump. */
export function playTeleport() {
  const out = output(1)
  if (!out) return
  const { context, gain } = out, now = context.currentTime + 0.01
  gain.gain.value = 0.3
  const osc = context.createOscillator(), env = context.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(220, now)
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.55)
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(0.28, now + 0.25)
  env.gain.exponentialRampToValueAtTime(0.0001, now + 1.4)
  osc.connect(env).connect(gain)
  osc.start(now); osc.stop(now + 1.5)
  noiseBurst(context, gain, now + 0.3, 0.9, 3200, 0.7, 0.35)
  partial(context, gain, 1320, 0.2, 2.2, now + 0.4)
  partial(context, gain, 1980, 0.1, 1.8, now + 0.45)
}

/** Quiet low tone when an array is attuned or a page is unlocked. */
export function playAttune() {
  const out = output(0.8)
  if (!out) return
  const { context, gain } = out, now = context.currentTime + 0.01
  gain.gain.value = 0.2
  partial(context, gain, 392, 0.4, 2.4, now)
  partial(context, gain, 587.3, 0.3, 2.2, now + 0.12)
  partial(context, gain, 784, 0.2, 2, now + 0.24)
}
