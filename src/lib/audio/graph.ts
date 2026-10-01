/** Shared Web Audio graph helpers for the generated noise layers (and the old ambient beds). */
import { generateLoop, type Rng } from './noise'
import { nextEventTime } from './schedule'

/** A built sound: connect `output` somewhere, call `stop()` to silence and free everything. */
export interface Graph {
  output: AudioNode
  stop(): void
}

// Buffers (built once per sample rate, then reused) ──────────────────────

const buffers = new Map<string, AudioBuffer>()

export function noiseBuffer(
  ctx: AudioContext,
  type: 'white' | 'pink' | 'brown',
  seconds: number,
  seed: number,
  peak: number,
): AudioBuffer {
  const key = `${type}:${seconds}:${seed}:${ctx.sampleRate}`
  const cached = buffers.get(key)
  if (cached) return cached
  const data = generateLoop({ type, sampleRate: ctx.sampleRate, seconds, seed, peak })
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
  buffer.getChannelData(0).set(data)
  buffers.set(key, buffer)
  return buffer
}

export const pinkLoop = (ctx: AudioContext) => noiseBuffer(ctx, 'pink', 6, 0x9b1d, 0.9)
export const brownLoop = (ctx: AudioContext) => noiseBuffer(ctx, 'brown', 6, 0x51ed, 0.9)
export const whiteLoop = (ctx: AudioContext) => noiseBuffer(ctx, 'white', 4, 0x7a1e, 0.5)

// ─── Small node helpers ─────────────────────────────────────────────────────

/** A looping source that starts at a random point, so several sources of one buffer do not line up. */
export function loopSource(
  ctx: AudioContext,
  buffer: AudioBuffer,
  rng: Rng,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.start(0, rng() * buffer.duration)
  return source
}

export function filter(
  ctx: AudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.707,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = q
  return f
}

export function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

/** A slow sine that nudges `target` up and down by `depth` around the value it already has. */
export function slowMotion(
  ctx: AudioContext,
  target: AudioParam,
  hz: number,
  depth: number,
): OscillatorNode {
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = hz
  lfo.connect(gain(ctx, depth)).connect(target)
  lfo.start()
  return lfo
}

export function stopAll(nodes: readonly AudioScheduledSourceNode[]): void {
  for (const node of nodes) {
    try {
      node.stop()
    } catch {
      /* already stopped */
    }
  }
}

// ─── Random events ──────────────────────────────────────────────────────────

const LOOKAHEAD_S = 2.5
const TICK_MS = 700

/**
 * Calls `fire(time)` for events of a Poisson process, always a few seconds before they are due. If
 * the timer was throttled (a background tab) and time got ahead of it, the missed events are
 * dropped instead of arriving in a burst. Returns the function that stops it.
 */
export function startScheduler(
  ctx: AudioContext,
  rng: Rng,
  ratePerSec: number,
  minGap: number,
  fire: (time: number) => void,
): () => void {
  let next = nextEventTime(rng, ctx.currentTime, ratePerSec, minGap)
  const tick = () => {
    const now = ctx.currentTime
    if (next < now) next = nextEventTime(rng, now, ratePerSec, minGap)
    while (next < now + LOOKAHEAD_S) {
      fire(next)
      next = nextEventTime(rng, next, ratePerSec, minGap)
    }
  }
  tick()
  const id = setInterval(tick, TICK_MS)
  return () => clearInterval(id)
}

/** A short sine with a plucked envelope; the shared shape of a rain drop and a cup clink. */
export function ping(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  peak: number,
  decay: number,
  glide: number,
): void {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, time)
  if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, time + decay)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, time)
  env.gain.linearRampToValueAtTime(peak, time + 0.003)
  env.gain.exponentialRampToValueAtTime(0.0001, time + decay)
  osc.connect(env).connect(dest)
  osc.start(time)
  osc.stop(time + decay + 0.02)
}
