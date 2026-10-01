import type { NoiseColor } from '@/db/types'
import {
  brownLoop,
  filter,
  gain,
  loopSource,
  pinkLoop,
  stopAll,
  whiteLoop,
  type Graph,
} from '../graph'
import type { Rng } from '../noise'

const LOOPS = { white: whiteLoop, pink: pinkLoop, brown: brownLoop }

/** A plain bed of white, pink or brown noise. High-passed at 35 Hz to keep speaker cones still. */
export function buildNoise(ctx: AudioContext, rng: Rng, opts: { color: NoiseColor }): Graph {
  const source = loopSource(ctx, LOOPS[opts.color](ctx), rng)
  const out = gain(ctx, 1)
  source.connect(filter(ctx, 'highpass', 35)).connect(out)
  return { output: out, stop: () => stopAll([source]) }
}
