import { filter, gain, loopSource, startScheduler, stopAll, whiteLoop, type Graph } from '../graph'
import type { Rng } from '../noise'
import { waveSwell } from '../schedule'

/** Ocean waves: white noise through a low-pass that opens and closes with each swell. */
export function buildWaves(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 1)
  const source = loopSource(ctx, whiteLoop(ctx), rng)
  const sweep = filter(ctx, 'lowpass', 300)
  const level = gain(ctx, 0.15)
  source.connect(sweep).connect(level).connect(out)

  const stopSwells = startScheduler(ctx, rng, 0.2, 5, (t) => {
    const { period, peak } = waveSwell(rng)
    const crest = t + period * 0.4
    sweep.frequency.setTargetAtTime(300 + peak * 2200, t, period * 0.2)
    level.gain.setTargetAtTime(0.3 + peak * 0.9, t, period * 0.2)
    sweep.frequency.setTargetAtTime(300, crest, period * 0.25)
    level.gain.setTargetAtTime(0.15, crest, period * 0.25)
  })
  return {
    output: out,
    stop: () => {
      stopSwells()
      stopAll([source])
    },
  }
}
