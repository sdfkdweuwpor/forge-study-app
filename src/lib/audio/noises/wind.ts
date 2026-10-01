import { filter, gain, loopSource, pinkLoop, slowMotion, stopAll, type Graph } from '../graph'
import type { Rng } from '../noise'

/** Wind: pink noise through a bandpass whose centre and loudness both drift slowly. */
export function buildWind(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 1)
  const source = loopSource(ctx, pinkLoop(ctx), rng)
  const band = filter(ctx, 'bandpass', 500, 0.8)
  const level = gain(ctx, 1.4)
  source.connect(band).connect(level).connect(out)
  const sweep = slowMotion(ctx, band.frequency, 0.06, 250)
  const gusts = slowMotion(ctx, level.gain, 0.11, 0.6)
  return { output: out, stop: () => stopAll([source, sweep, gusts]) }
}
