import { gain, startScheduler, type Graph } from '../graph'
import type { Rng } from '../noise'
import { birdPhrase } from '../schedule'

/** Forest birds: sparse sine chirp phrases over silence. */
export function buildBirds(ctx: AudioContext, rng: Rng): Graph {
  const out = gain(ctx, 0.5)
  const stopPhrases = startScheduler(ctx, rng, 0.35, 2, (t) => {
    for (const n of birdPhrase(rng).notes) {
      const start = t + n.at
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(n.freq, start)
      osc.frequency.exponentialRampToValueAtTime(n.freq * 1.25, start + n.dur)
      const env = gain(ctx, 0.0001)
      env.gain.setValueAtTime(0.0001, start)
      env.gain.linearRampToValueAtTime(0.5, start + 0.01)
      env.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
      osc.connect(env).connect(out)
      osc.start(start)
      osc.stop(start + n.dur + 0.02)
    }
  })
  return { output: out, stop: stopPhrases }
}
