import {
  brownLoop,
  filter,
  gain,
  loopSource,
  ping,
  slowMotion,
  startScheduler,
  stopAll,
  whiteLoop,
  type Graph,
} from '../graph'
import type { Rng } from '../noise'
import { dropletEvent } from '../schedule'

/**
 * Rain: a band-limited hiss for the wash of it, a mid band for the patter, brown noise low-passed
 * for distant rumble, a very slow swell for gusts, and tiny high drops on top.
 */
export function buildRain(ctx: AudioContext, rng: Rng): Graph {
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
  const stopDrops = startScheduler(ctx, rng, 7, 0.04, (t) => {
    const d = dropletEvent(rng)
    ping(ctx, drops, t, d.freq, d.gain, d.decay, 0.6)
  })

  return {
    output: out,
    stop: () => {
      stopDrops()
      stopAll([wash, patter, rumble, gusts])
    },
  }
}
