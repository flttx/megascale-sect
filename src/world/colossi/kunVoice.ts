import { mixer } from '../audio/mixer'

/** Noise buffer shared by every call (created on first use, per context). */
let breathBuffer: AudioBuffer | null = null
function breath(context: AudioContext) {
  if (breathBuffer?.sampleRate === context.sampleRate) return breathBuffer
  const length = context.sampleRate * 2, buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0)
  let brown = 0
  for (let i = 0; i < length; i++) { brown = (brown + (Math.random() * 2 - 1) * 0.02) / 1.02; data[i] = brown * 3.5 }
  return (breathBuffer = buffer)
}

/**
 * The kun's call: a long, low moan that swells, bends up and sinks away, like a whale heard through a hall of
 * air. A sawtooth and its sub-octave glide along one contour with a slow vibrato, shaped by three vocal
 * formants whose lowest opens and closes; a breathy rumble underlays it. Distance dulls it (air absorption)
 * and pushes more of it into the reverb; `pan` (−1 left … 1 right) places it. `rise` makes the breach call,
 * which climbs higher before it falls.
 */
export function playKunCall(distance: number, pan: number, rise = false) {
  const context = mixer.audioContext, dry = mixer.bus('ambience'), send = mixer.reverbSend('ambience')
  // A suspended context has stopped its clock: calls scheduled now would all sound together on resume.
  if (!context || !dry || context.state !== 'running') return
  const now = context.currentTime + 0.05, length = rise ? 7.5 : 6
  const near = 1 / (1 + (distance / 900) ** 2)

  const out = context.createGain(), air = context.createBiquadFilter(), panner = context.createStereoPanner()
  out.gain.value = 0.55 * Math.max(0.15, near)
  air.type = 'lowpass'; air.frequency.value = 320 + 2800 * Math.exp(-distance / 1400); air.Q.value = 0.4
  panner.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8
  out.connect(air).connect(panner).connect(dry)
  if (send) {
    const wet = context.createGain()
    wet.gain.value = 0.7 + 0.9 * (1 - near)
    panner.connect(wet).connect(send)
  }

  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(1, now + 1.1)
  envelope.gain.linearRampToValueAtTime(0.75, now + length * 0.55)
  envelope.gain.linearRampToValueAtTime(0, now + length)
  envelope.connect(out)

  // One pitch contour for every voice: swell up, hold, sink below where it began.
  const base = 58 * (0.92 + Math.random() * 0.16), peak = rise ? 1.7 : 1.35
  const contour = (param: AudioParam, k: number) => {
    param.setValueAtTime(base * k * 0.85, now)
    param.linearRampToValueAtTime(base * k * peak, now + length * 0.3)
    param.linearRampToValueAtTime(base * k * peak * 0.88, now + length * 0.55)
    param.exponentialRampToValueAtTime(base * k * 0.62, now + length)
  }
  const vibrato = context.createOscillator(), depth = context.createGain()
  vibrato.frequency.value = 3.6; depth.gain.value = base * 0.018
  vibrato.connect(depth)

  const formants: [number, number, number][] = [[260, 2.5, 1], [690, 5, 0.55], [1450, 8, 0.16]]
  const voice = context.createGain()
  voice.gain.value = 0.5
  formants.forEach(([frequency, q, level], k) => {
    const band = context.createBiquadFilter(), gain = context.createGain()
    band.type = 'bandpass'; band.Q.value = q; gain.gain.value = level
    band.frequency.setValueAtTime(frequency, now)
    // The lowest formant opens with the swell and closes as the call sinks ("wooo-ooh").
    if (k === 0) { band.frequency.linearRampToValueAtTime(frequency * 1.6, now + length * 0.35); band.frequency.linearRampToValueAtTime(frequency * 0.8, now + length) }
    voice.connect(band).connect(gain).connect(envelope)
  })

  const voices: OscillatorNode[] = [vibrato]
  for (const [type, k, level] of [['sawtooth', 1, 0.6], ['sawtooth', 1.004, 0.4], ['sine', 0.5, 1.4]] as [OscillatorType, number, number][]) {
    const osc = context.createOscillator(), gain = context.createGain()
    osc.type = type; gain.gain.value = level
    contour(osc.frequency, k)
    depth.connect(osc.frequency)
    osc.connect(gain).connect(type === 'sine' ? envelope : voice)
    voices.push(osc)
  }

  const rumble = context.createBufferSource(), low = context.createBiquadFilter(), rumbleGain = context.createGain()
  rumble.buffer = breath(context); rumble.loop = true
  low.type = 'lowpass'; low.frequency.value = 180; rumbleGain.gain.value = 0.5
  rumble.connect(low).connect(rumbleGain).connect(envelope)

  for (const node of [...voices, rumble]) { node.start(now); node.stop(now + length + 0.1) }
}
