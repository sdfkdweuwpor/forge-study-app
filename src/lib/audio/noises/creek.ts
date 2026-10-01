import { filter, gain, loopSource, slowMotion, stopAll, whiteLoop, type Graph } from '../graph'
import type { Rng } from '../noise'

/** Creek: bandpassed white noise whose centre and level burble quickly. */
export function buildCreek(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 1)
  const source = loopSource(ctx, whiteLoop(ctx), rng)
  const band = filter(ctx, 'bandpass', 1800, 1.4)
  const level = gain(ctx, 0.7)
  source.connect(band).connect(level).connect(out)
  const burble = slowMotion(ctx, band.frequency, 1.3, 700)
  const ripple = slowMotion(ctx, level.gain, 2.1, 0.25)
  return { output: out, stop: () => stopAll([source, burble, ripple]) }
}
