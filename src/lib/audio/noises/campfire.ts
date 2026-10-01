import {
  brownLoop,
  filter,
  gain,
  loopSource,
  ping,
  startScheduler,
  stopAll,
  whiteLoop,
  type Graph,
} from '../graph'
import type { Rng } from '../noise'
import { crackleEvent } from '../schedule'

/** Campfire: a low brown bed, a faint hiss, and sharp random pops. */
export function buildCampfire(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 1)
  const bed = loopSource(ctx, brownLoop(ctx), rng)
  bed
    .connect(filter(ctx, 'lowpass', 400))
    .connect(gain(ctx, 0.9))
    .connect(out)
  const hiss = loopSource(ctx, whiteLoop(ctx), rng)
  hiss
    .connect(filter(ctx, 'bandpass', 3500, 0.7))
    .connect(gain(ctx, 0.04))
    .connect(out)

  const pops = gain(ctx, 1)
  pops.connect(out)
  const stopPops = startScheduler(ctx, rng, 6, 0.02, (t) => {
    const c = crackleEvent(rng)
    ping(ctx, pops, t, c.freq, c.gain, c.decay, 0.5)
  })
  return {
    output: out,
    stop: () => {
      stopPops()
      stopAll([bed, hiss])
    },
  }
}
