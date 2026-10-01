import {
  brownLoop,
  filter,
  gain,
  loopSource,
  ping,
  slowMotion,
  startScheduler,
  stopAll,
  type Graph,
} from '../graph'
import type { Rng } from '../noise'
import { CLINK_OVERTONE, clinkEvent } from '../schedule'

/** Voices of the café murmur: where each sits in the spectrum, and how fast it swells and fades. */
const CAFE_VOICES = [
  { freq: 420, q: 0.9, level: 3, lfoHz: 0.09, swell: 0.6 },
  { freq: 850, q: 1.1, level: 4, lfoHz: 0.14, swell: -0.6 },
  { freq: 1500, q: 1.2, level: 3, lfoHz: 0.21, swell: 0.6 },
] as const

/**
 * Café: three bandpassed bands of brown noise, each slowly swelling and fading out of step with the
 * others (a room of people, none of them audible), a low room tone, and an occasional soft clink.
 */
export function buildCafe(ctx: AudioContext, rng: Rng): Graph {
  // Trimmed: the three mid bands add up much louder than the same level of brown noise.
  const out = gain(ctx, 0.45)
  const room = filter(ctx, 'lowpass', 3200)
  room.connect(out)
  const sources: AudioScheduledSourceNode[] = []

  for (const v of CAFE_VOICES) {
    const source = loopSource(ctx, brownLoop(ctx), rng)
    const swell = gain(ctx, 1)
    source
      .connect(filter(ctx, 'bandpass', v.freq, v.q))
      .connect(gain(ctx, v.level))
      .connect(swell)
      .connect(room)
    sources.push(source, slowMotion(ctx, swell.gain, v.lfoHz, v.swell))
  }

  const tone = loopSource(ctx, brownLoop(ctx), rng)
  tone
    .connect(filter(ctx, 'lowpass', 180))
    .connect(gain(ctx, 0.25))
    .connect(room)
  sources.push(tone)

  const clinks = gain(ctx, 1)
  clinks.connect(out)
  const stopClinks = startScheduler(ctx, rng, 0.16, 2.5, (t) => {
    const c = clinkEvent(rng)
    ping(ctx, clinks, t, c.freq, c.gain, c.decay, 1)
    ping(ctx, clinks, t, c.freq * CLINK_OVERTONE, c.gain * 0.5, c.decay * 0.6, 1)
  })

  return {
    output: out,
    stop: () => {
      stopClinks()
      stopAll(sources)
    },
  }
}
