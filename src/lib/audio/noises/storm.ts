import { brownLoop, filter, gain, loopSource, startScheduler, stopAll, type Graph } from '../graph'
import type { Rng } from '../noise'
import { thunderEvent } from '../schedule'
import { buildRain } from './rain'

/** Heavy rain with distant thunder: a low-passed brown rumble that swells, then rolls away. */
export function buildStorm(ctx: AudioContext, rng: Rng): Graph {
  const rain = buildRain(ctx, rng)
  const out = gain(ctx, 1.2)
  rain.output.connect(out)
  const thunder = gain(ctx, 1)
  thunder.connect(out)
  const buffer = brownLoop(ctx)
  const live: { source: AudioScheduledSourceNode; end: number }[] = []

  const stopThunder = startScheduler(ctx, rng, 0.15, 6, (t) => {
    const e = thunderEvent(rng)
    const source = loopSource(ctx, buffer, rng)
    const env = gain(ctx, 0.0001)
    source
      .connect(filter(ctx, 'lowpass', 140))
      .connect(env)
      .connect(thunder)
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(e.gain * 2, t + 0.15)
    env.gain.exponentialRampToValueAtTime(0.0001, t + e.rumbleSeconds)
    source.stop(t + e.rumbleSeconds + 0.05)
    // Drop thunders that have already ended so a long-running storm does not grow this list.
    while (live.length && live[0]!.end < ctx.currentTime) live.shift()
    live.push({ source, end: t + e.rumbleSeconds + 0.05 })
  })

  return {
    output: out,
    stop: () => {
      stopThunder()
      rain.stop()
      stopAll(live.map((l) => l.source))
    },
  }
}
