/**
 * Ambient beds: brown noise, rain and café, all generated. Each kind is a small graph of looped
 * noise buffers through filters (a handful of nodes, so CPU stays near zero) plus, for rain and
 * café, sparse random events scheduled a couple of seconds ahead. Only one kind plays at a time;
 * switching crossfades.
 */
import { clamp01, fadeStopDelayMs, fadeTimeConstant } from './envelope'
import { createRng, generateLoop, type Rng } from './noise'
import {
  CLINK_OVERTONE,
  clinkEvent,
  dropletEvent,
  nextEventTime,
  type Clink,
  type Droplet,
} from './schedule'
import { ambientOutput, emitAudioChange, getContext, resumeContext, setBusVolume } from './engine'

export type AmbientKind = 'brown' | 'rain' | 'cafe'

const FADE_IN_MS = 900
const CROSSFADE_MS = 500

/** A built sound: connect `output` somewhere, call `stop()` to silence and free everything. */
interface Graph {
  output: AudioNode
  stop(): void
}

interface Instance {
  kind: AmbientKind
  graph: Graph
  fade: GainNode
}

let current: Instance | null = null

// ─── Buffers (built once per sample rate, then reused) ──────────────────────

const buffers = new Map<string, AudioBuffer>()

function noiseBuffer(
  ctx: AudioContext,
  type: 'white' | 'brown',
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

const brownLoop = (ctx: AudioContext) => noiseBuffer(ctx, 'brown', 6, 0x51ed, 0.9)
const whiteLoop = (ctx: AudioContext) => noiseBuffer(ctx, 'white', 4, 0x7a1e, 0.5)

// ─── Small node helpers ─────────────────────────────────────────────────────

/** A looping source that starts at a random point, so several sources of one buffer do not line up. */
function loopSource(ctx: AudioContext, buffer: AudioBuffer, rng: Rng): AudioBufferSourceNode {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.start(0, rng() * buffer.duration)
  return source
}

function filter(
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

function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

/** A slow sine that nudges `target` up and down by `depth` around the value it already has. */
function slowMotion(
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

function stopAll(nodes: readonly AudioScheduledSourceNode[]): void {
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
function startScheduler(
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
function ping(
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

function fireDroplet(ctx: AudioContext, dest: AudioNode, d: Droplet, time: number): void {
  ping(ctx, dest, time, d.freq, d.gain, d.decay, 0.6)
}

function fireClink(ctx: AudioContext, dest: AudioNode, c: Clink, time: number): void {
  ping(ctx, dest, time, c.freq, c.gain, c.decay, 1)
  ping(ctx, dest, time, c.freq * CLINK_OVERTONE, c.gain * 0.5, c.decay * 0.6, 1)
}

// ─── The three beds ─────────────────────────────────────────────────────────

/** Brown noise: a deep, even rumble. Only a high-pass at 35 Hz, to keep speaker cones still. */
function buildBrown(ctx: AudioContext, rng: Rng): Graph {
  const source = loopSource(ctx, brownLoop(ctx), rng)
  const out = gain(ctx, 1)
  source.connect(filter(ctx, 'highpass', 35)).connect(out)
  return { output: out, stop: () => stopAll([source]) }
}

/**
 * Rain: a band-limited hiss for the wash of it, a mid band for the patter, brown noise low-passed
 * for distant rumble, a very slow swell for gusts, and tiny high drops on top.
 */
function buildRain(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 1.15)

  const wash = loopSource(ctx, whiteLoop(ctx), rng)
  const washLevel = gain(ctx, 0.45)
  wash
    .connect(filter(ctx, 'highpass', 700))
    .connect(filter(ctx, 'lowpass', 7200))
    .connect(washLevel)
    .connect(out)

  const patter = loopSource(ctx, whiteLoop(ctx), rng)
  patter
    .connect(filter(ctx, 'bandpass', 2400, 0.6))
    .connect(gain(ctx, 0.35))
    .connect(out)

  const rumble = loopSource(ctx, brownLoop(ctx), rng)
  rumble
    .connect(filter(ctx, 'lowpass', 450))
    .connect(gain(ctx, 0.5))
    .connect(out)

  const gusts = slowMotion(ctx, washLevel.gain, 0.07, 0.12)

  const drops = gain(ctx, 1)
  drops.connect(out)
  const stopDrops = startScheduler(ctx, rng, 7, 0.04, (t) =>
    fireDroplet(ctx, drops, dropletEvent(rng), t),
  )

  return {
    output: out,
    stop: () => {
      stopDrops()
      stopAll([wash, patter, rumble, gusts])
    },
  }
}

/** Voices of the café murmur: where each sits in the spectrum, and how fast it swells and fades. */
const CAFE_VOICES = [
  { freq: 420, q: 0.9, level: 3, lfoHz: 0.09, swell: 0.6 },
  { freq: 850, q: 1.1, level: 4, lfoHz: 0.14, swell: -0.6 },
  { freq: 1500, q: 1.2, level: 3, lfoHz: 0.21, swell: 0.6 },
] as const

/**
 * Café: three bandpassed bands of brown noise, each slowly swelling and fading out of step with the
 * others (a room of people, none of them audible), a low room tone, and an occasional soft clink.
 */
function buildCafe(ctx: AudioContext, rng: Rng): Graph {
  // Trimmed: the three mid bands add up much louder than the same level of brown noise.
  const out = gain(ctx, 0.45)
  const room = filter(ctx, 'lowpass', 3200)
  room.connect(out)
  const sources: AudioScheduledSourceNode[] = []

  for (const v of CAFE_VOICES) {
    const source = loopSource(ctx, brownLoop(ctx), rng)
    const swell = gain(ctx, 1)
    source
      .connect(filter(ctx, 'bandpass', v.freq, v.q))
      .connect(gain(ctx, v.level))
      .connect(swell)
      .connect(room)
    sources.push(source, slowMotion(ctx, swell.gain, v.lfoHz, v.swell))
  }

  const tone = loopSource(ctx, brownLoop(ctx), rng)
  tone
    .connect(filter(ctx, 'lowpass', 180))
    .connect(gain(ctx, 0.25))
    .connect(room)
  sources.push(tone)

  const clinks = gain(ctx, 1)
  clinks.connect(out)
  const stopClinks = startScheduler(ctx, rng, 0.16, 2.5, (t) =>
    fireClink(ctx, clinks, clinkEvent(rng), t),
  )

  return {
    output: out,
    stop: () => {
      stopClinks()
      stopAll(sources)
    },
  }
}

const BUILDERS: Record<AmbientKind, (ctx: AudioContext, rng: Rng) => Graph> = {
  brown: buildBrown,
  rain: buildRain,
  cafe: buildCafe,
}

// ─── Public API ─────────────────────────────────────────────────────────────

function startInstance(ctx: AudioContext, kind: AmbientKind): Instance {
  const rng = createRng(Math.floor(Math.random() * 0xffffffff))
  const graph = BUILDERS[kind](ctx, rng)
  const fade = gain(ctx, 0)
  graph.output.connect(fade).connect(ambientOutput(ctx))
  fade.gain.setTargetAtTime(1, ctx.currentTime, fadeTimeConstant(FADE_IN_MS))
  return { kind, graph, fade }
}

/** Fades an instance out, then tears its graph down. Resolves when it is gone. */
function retire(ctx: AudioContext, instance: Instance, fadeMs: number): Promise<void> {
  const now = ctx.currentTime
  const param = instance.fade.gain
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.setTargetAtTime(0, now, fadeTimeConstant(fadeMs))
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      instance.graph.stop()
      instance.fade.disconnect()
      resolve()
    }, fadeStopDelayMs(fadeMs))
  })
}

/**
 * Starts an ambient bed, fading it in. Switching kinds crossfades; asking for the kind that is
 * already playing just applies `volume`. `volume` is 0..1. Call it from a click or key handler so
 * the browser lets it sound; if it was not, it starts the moment the person next presses anything.
 * Never rejects.
 */
export async function startAmbient(kind: AmbientKind, volume: number): Promise<void> {
  const ctx = getContext()
  if (!ctx) return
  setBusVolume(clamp01(volume))
  if (current?.kind !== kind) {
    if (current) void retire(ctx, current, CROSSFADE_MS)
    current = startInstance(ctx, kind)
    emitAudioChange()
  }
  await resumeContext(ctx)
}

/** Sets the ambient volume (0..1) on whatever is playing, and on the next thing that plays. */
export function setAmbientVolume(v: number): void {
  setBusVolume(clamp01(v))
}

/** Fades the ambient bed out over `fadeMs` and frees it. Resolves when it has stopped. No-op if nothing plays. */
export async function stopAmbient(fadeMs = 600): Promise<void> {
  const instance = current
  if (!instance) return
  current = null
  emitAudioChange()
  const ctx = getContext()
  if (!ctx) {
    instance.graph.stop()
    return
  }
  await retire(ctx, instance, fadeMs)
}

/** True from `startAmbient` until `stopAmbient`, even while the browser is still waiting for a gesture. */
export function isAmbientPlaying(): boolean {
  return current !== null
}

/** The kind that is playing, or `null`. */
export function ambientKind(): AmbientKind | null {
  return current?.kind ?? null
}
