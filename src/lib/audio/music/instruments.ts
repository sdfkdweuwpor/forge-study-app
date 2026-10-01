/** Soft synth voices for the lofi player. Each plays one note at `time` and frees itself on `onended`. */
import {
  filter,
  gain,
  loopSource,
  pinkLoop,
  brownLoop,
  slowMotion,
  stopAll,
  whiteLoop,
  startScheduler,
  ping,
  type Graph,
} from '../graph'
import { createRng } from '../noise'
import { crackleEvent } from '../schedule'
import type { NoteEvent } from './composer'

type Melodic = Extract<NoteEvent, { midi: number }>
type Drum = Extract<NoteEvent, { drum: string }>
export type Source = AudioScheduledSourceNode

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const rng = createRng(0x10f1)

/** oscs -> lowpass -> envelope -> out. Returns the sources; the nodes disconnect when they end. */
function voice(
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  dur: number,
  oscs: [OscillatorType, number, number?][], // type, Hz, level
  o: { cutoff: number; peak: number; attack: number; release: number; sustain?: boolean },
): Source[] {
  const lp = filter(ctx, 'lowpass', o.cutoff)
  const env = gain(ctx, 0.0001)
  const end = time + dur
  env.gain.setValueAtTime(0.0001, time)
  env.gain.linearRampToValueAtTime(o.peak, time + o.attack)
  if (o.sustain) env.gain.setValueAtTime(o.peak, end)
  env.gain.exponentialRampToValueAtTime(0.0001, end + o.release)
  lp.connect(env).connect(out)
  const sources = oscs.map(([type, f, level = 1]) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = f
    if (level === 1) osc.connect(lp)
    else osc.connect(gain(ctx, level)).connect(lp)
    osc.start(time)
    osc.stop(end + o.release + 0.05)
    return osc
  })
  const last = sources[sources.length - 1]
  if (last)
    last.onended = () => {
      env.disconnect()
      lp.disconnect()
    }
  return sources
}

export function playKeys(ctx: AudioContext, out: AudioNode, time: number, ev: Melodic): Source[] {
  const f = hz(ev.midi)
  return voice(
    ctx,
    out,
    time,
    ev.dur * 0.5,
    [
      ['sine', f],
      ['sine', f * 1.004, 0.6],
      ['triangle', f * 2, 0.15],
    ],
    {
      cutoff: 3200,
      peak: ev.vel * 0.22,
      attack: 0.012,
      release: 0.5,
    },
  )
}

export function playPad(ctx: AudioContext, out: AudioNode, time: number, ev: Melodic): Source[] {
  const f = hz(ev.midi)
  return voice(
    ctx,
    out,
    time,
    ev.dur,
    [
      ['sawtooth', f * 0.997, 0.3],
      ['sawtooth', f * 1.003, 0.3],
      ['triangle', f, 0.6],
    ],
    {
      cutoff: 1800,
      peak: ev.vel * 0.18,
      attack: 0.4,
      release: 0.8,
      sustain: true,
    },
  )
}

export function playBass(ctx: AudioContext, out: AudioNode, time: number, ev: Melodic): Source[] {
  const f = hz(ev.midi)
  return voice(
    ctx,
    out,
    time,
    ev.dur,
    [
      ['sine', f],
      ['triangle', f, 0.25],
    ],
    {
      cutoff: 600,
      peak: ev.vel * 0.5,
      attack: 0.02,
      release: 0.15,
      sustain: true,
    },
  )
}

export function playPluck(ctx: AudioContext, out: AudioNode, time: number, ev: Melodic): Source[] {
  return voice(ctx, out, time, 0.08, [['triangle', hz(ev.midi)]], {
    cutoff: 2800,
    peak: ev.vel * 0.3,
    attack: 0.006,
    release: 0.35,
  })
}

export function playPiano(ctx: AudioContext, out: AudioNode, time: number, ev: Melodic): Source[] {
  const f = hz(ev.midi)
  return voice(
    ctx,
    out,
    time,
    ev.dur * 0.6,
    [
      ['sine', f],
      ['sine', f * 2, 0.35],
      ['sine', f * 3, 0.12],
    ],
    {
      cutoff: 3500,
      peak: ev.vel * 0.25,
      attack: 0.008,
      release: 0.9,
    },
  )
}

/** A noise burst through `type` filter, with an optional tone under it. */
function burst(
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  dur: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
): Source {
  const src = ctx.createBufferSource()
  src.buffer = whiteLoop(ctx)
  src.loop = true
  const env = gain(ctx, 0.0001)
  env.gain.setValueAtTime(0.0001, time)
  env.gain.linearRampToValueAtTime(peak, time + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, time + dur)
  src
    .connect(filter(ctx, type, freq, q))
    .connect(env)
    .connect(out)
  src.start(time, rng() * 3)
  src.stop(time + dur + 0.02)
  src.onended = () => env.disconnect()
  return src
}

export function playKick(ctx: AudioContext, out: AudioNode, time: number, ev: Drum): Source[] {
  const osc = ctx.createOscillator()
  const env = gain(ctx, 0.0001)
  osc.frequency.setValueAtTime(120, time)
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12)
  env.gain.setValueAtTime(0.0001, time)
  env.gain.linearRampToValueAtTime(ev.vel * 0.7, time + 0.004)
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.35)
  osc.connect(env).connect(out)
  osc.start(time)
  osc.stop(time + 0.38)
  osc.onended = () => env.disconnect()
  return [osc]
}

export function playSnare(ctx: AudioContext, out: AudioNode, time: number, ev: Drum): Source[] {
  const [tone] = voice(ctx, out, time, 0.02, [['triangle', 190]], {
    cutoff: 1200,
    peak: ev.vel * 0.2,
    attack: 0.002,
    release: 0.1,
  })
  return [burst(ctx, out, time, 0.18, 'bandpass', 2000, 0.8, ev.vel * 0.3), ...(tone ? [tone] : [])]
}

export function playHat(ctx: AudioContext, out: AudioNode, time: number, ev: Drum): Source[] {
  return [burst(ctx, out, time, 0.05, 'highpass', 7000, 0.7, ev.vel * 0.12)]
}

export function playRim(ctx: AudioContext, out: AudioNode, time: number, ev: Drum): Source[] {
  return [burst(ctx, out, time, 0.03, 'bandpass', 1800, 6, ev.vel * 0.3)]
}

export type TextureKind = 'vinyl' | 'tape' | 'rain' | 'city'

/** A continuous bed under the music. `out` is the style's fade bus (tape wobbles its gain). */
export function startTexture(ctx: AudioContext, out: GainNode, kind: TextureKind): Graph {
  const sources: Source[] = []
  const nodes: AudioNode[] = []
  const stops: (() => void)[] = []
  const bed = (buf: AudioBuffer, type: BiquadFilterType, freq: number, level: number): GainNode => {
    const g = gain(ctx, level)
    const lp = filter(ctx, type, freq)
    sources.push(loopSource(ctx, buf, rng))
    sources[sources.length - 1]!.connect(lp).connect(g).connect(out)
    nodes.push(g)
    return g
  }
  if (kind === 'vinyl') {
    bed(pinkLoop(ctx), 'lowpass', 2500, 0.012)
    const pops = gain(ctx, 1)
    pops.connect(out)
    nodes.push(pops)
    stops.push(
      startScheduler(ctx, rng, 5, 0.05, (t) => {
        const c = crackleEvent(rng)
        ping(ctx, pops, t, c.freq, c.gain * 0.04, c.decay, 1)
      }),
    )
  } else if (kind === 'tape') {
    bed(pinkLoop(ctx), 'lowpass', 5000, 0.01)
    sources.push(slowMotion(ctx, out.gain, 0.35, 0.03))
  } else if (kind === 'rain') {
    bed(pinkLoop(ctx), 'lowpass', 1800, 0.03)
  } else {
    const swell = bed(brownLoop(ctx), 'lowpass', 250, 0.04)
    sources.push(slowMotion(ctx, swell.gain, 0.07, 0.03))
    const hum = ctx.createOscillator()
    hum.frequency.value = 55
    const humGain = gain(ctx, 0.008)
    nodes.push(humGain)
    hum.connect(humGain).connect(out)
    hum.start()
    sources.push(hum)
  }
  return {
    output: out,
    stop() {
      for (const s of stops) s()
      stopAll(sources)
      for (const n of nodes) n.disconnect()
    },
  }
}
