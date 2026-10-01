/**
 * The mixer: one gain per noise layer, all on the master bus. `applyMix` diffs a `Mix` against what
 * plays, so it is cheap to call on every slider tick. Music is added in a later task.
 */
import type { Mix, NoiseColor, NoiseLayer } from '@/db/types'
import { clamp01, fadeStopDelayMs, fadeTimeConstant, volumeToGain } from './envelope'
import { emitAudioChange, getContext, masterOutput, resumeContext, setBusVolume } from './engine'
import { gain, type Graph } from './graph'
import { createRng } from './noise'
import { NOISE_BUILDERS } from './noises'

const FADE_IN_MS = 900
const CROSSFADE_MS = 500
const RAMP_TC = 0.04

interface Entry {
  graph: Graph
  node: GainNode
  color: NoiseColor
}

const playing = new Map<NoiseLayer, Entry>()
/** Layers whose builder threw; skipped (and not re-reported) until they leave the mix. */
const failed = new Set<NoiseLayer>()

/** Fades a layer to silence, then stops its graph and disconnects it (one-shot tails included). */
function retire(ctx: AudioContext, e: Entry, fadeMs: number): Promise<void> {
  const now = ctx.currentTime
  const p = e.node.gain
  p.cancelScheduledValues(now)
  p.setValueAtTime(p.value, now)
  p.setTargetAtTime(0, now, fadeTimeConstant(fadeMs))
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      e.graph.stop()
      e.node.disconnect()
      resolve()
    }, fadeStopDelayMs(fadeMs))
  })
}

export async function applyMix(
  mix: Mix,
  opts: { onLayerError?: (layer: NoiseLayer, error: unknown) => void } = {},
): Promise<void> {
  const ctx = getContext()
  if (!ctx) return
  const before = playing.size
  setBusVolume(clamp01(mix.master))

  for (const layer of [...playing.keys()]) {
    const v = clamp01(mix.layers[layer] ?? 0)
    const e = playing.get(layer)!
    if (v === 0 || (layer === 'noise' && e.color !== mix.noiseColor)) {
      playing.delete(layer)
      void retire(ctx, e, CROSSFADE_MS)
    } else {
      e.node.gain.setTargetAtTime(volumeToGain(v), ctx.currentTime, RAMP_TC)
    }
  }
  for (const layer of failed) if (!(mix.layers[layer] ?? 0)) failed.delete(layer)

  for (const [layer, raw] of Object.entries(mix.layers) as [NoiseLayer, number][]) {
    const v = clamp01(raw)
    if (v === 0 || playing.has(layer) || failed.has(layer)) continue
    try {
      const graph = NOISE_BUILDERS[layer](ctx, createRng(Math.floor(Math.random() * 0xffffffff)), {
        color: mix.noiseColor,
      })
      const node = gain(ctx, 0)
      graph.output.connect(node).connect(masterOutput(ctx))
      node.gain.setTargetAtTime(volumeToGain(v), ctx.currentTime, fadeTimeConstant(FADE_IN_MS))
      playing.set(layer, { graph, node, color: mix.noiseColor })
    } catch (error) {
      failed.add(layer)
      opts.onLayerError?.(layer, error)
    }
  }

  if ((before === 0) !== (playing.size === 0)) emitAudioChange()
  await resumeContext(ctx)
}

/** Fades everything out over `fadeMs` and frees it. Resolves when it has stopped. */
export async function stopMix(fadeMs = 600): Promise<void> {
  const entries = [...playing.values()]
  playing.clear()
  failed.clear()
  if (!entries.length) return
  emitAudioChange()
  const ctx = getContext()
  if (!ctx) {
    for (const e of entries) e.graph.stop()
    return
  }
  await Promise.all(entries.map((e) => retire(ctx, e, fadeMs)))
}

export function playingLayers(): NoiseLayer[] {
  return [...playing.keys()]
}

/** True from the first layer starting until `stopMix`, even while the browser awaits a gesture. */
export function isMixPlaying(): boolean {
  return playing.size > 0
}
