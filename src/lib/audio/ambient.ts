/**
 * Ambient beds: brown noise, rain and café, all generated. Each kind is a small graph of looped
 * noise buffers through filters (a handful of nodes, so CPU stays near zero) plus, for rain and
 * café, sparse random events scheduled a couple of seconds ahead. Only one kind plays at a time;
 * switching crossfades.
 */
import { clamp01, fadeStopDelayMs, fadeTimeConstant } from './envelope'
import { createRng, type Rng } from './noise'
import { gain, type Graph } from './graph'
import { buildCafe } from './noises/cafe'
import { buildNoise } from './noises/noise'
import { buildRain } from './noises/rain'
import { ambientOutput, emitAudioChange, getContext, resumeContext, setBusVolume } from './engine'

export type AmbientKind = 'brown' | 'rain' | 'cafe'

const FADE_IN_MS = 900
const CROSSFADE_MS = 500

interface Instance {
  kind: AmbientKind
  graph: Graph
  fade: GainNode
}

let current: Instance | null = null

const BUILDERS: Record<AmbientKind, (ctx: AudioContext, rng: Rng) => Graph> = {
  brown: (ctx, rng) => buildNoise(ctx, rng, { color: 'brown' }),
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
