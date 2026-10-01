/**
 * Deterministic noise generators. They fill plain Float32Arrays from a seeded random source, so the
 * same seed gives the same samples (unit tests, and no surprises between runs). The Web Audio side
 * only copies the result into an AudioBuffer.
 */
import { equalPowerPair } from './envelope'

/** A random source returning floats in [0, 1). */
export type Rng = () => number

/** mulberry32: tiny, fast, well distributed enough for noise and event timing. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform white noise in [-1, 1). */
export function whiteNoise(length: number, rng: Rng): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1
  return out
}

/**
 * Brown (red) noise: white noise run through a leaky integrator, so power falls 6 dB per octave.
 * The leak stops the running sum drifting away from zero; `leakHz` is where the spectrum flattens
 * out below (default 40 Hz, under what laptop speakers reproduce). The integrator is warmed up
 * first so the very first samples are as loud as the rest. The result is centred and scaled so its
 * largest excursion is `peak`.
 */
export function brownNoise(
  length: number,
  rng: Rng,
  sampleRate: number,
  { leakHz = 40, peak = 0.9 }: { leakHz?: number; peak?: number } = {},
): Float32Array {
  const keep = Math.exp((-2 * Math.PI * leakHz) / sampleRate)
  let y = 0
  const warmUp = Math.ceil(8 / (1 - keep))
  for (let i = 0; i < warmUp; i++) y = keep * y + (rng() * 2 - 1)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    y = keep * y + (rng() * 2 - 1)
    out[i] = y
  }
  return normalize(out, peak)
}

/** Subtracts the mean, then scales so the largest absolute sample equals `peak`. In place; returns the array. */
export function normalize(samples: Float32Array, peak: number): Float32Array {
  if (samples.length === 0) return samples
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] ?? 0
  const mean = sum / samples.length
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] ?? 0) - mean
    samples[i] = v
    max = Math.max(max, Math.abs(v))
  }
  if (max === 0) return samples
  const k = peak / max
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) * k
  return samples
}

/**
 * Turns `raw` (a continuous stretch of noise, `crossfade` samples longer than the loop) into a loop
 * of `raw.length - crossfade` samples with no click at the seam. The head of the loop is an
 * equal-power blend from the samples that come after the loop's end (which are what should follow
 * the last sample) into the loop's own start, so the wrap point is continuous. Uncorrelated noise
 * keeps its loudness through an equal-power blend, so no dip is heard either.
 */
export function makeLoopable(raw: Float32Array, crossfade: number): Float32Array {
  const fade = Math.max(0, Math.floor(crossfade))
  const length = raw.length - fade
  if (length <= 0 || fade === 0) return raw.slice()
  const out = raw.slice(0, length)
  for (let i = 0; i < Math.min(fade, length); i++) {
    const [fadingIn, fadingOut] = equalPowerPair(i / fade)
    out[i] = (raw[i] ?? 0) * fadingIn + (raw[length + i] ?? 0) * fadingOut
  }
  return out
}

export interface LoopSpec {
  type: 'white' | 'brown'
  sampleRate: number
  seconds: number
  /** Seam blend length in seconds (default 0.5). */
  crossfadeSeconds?: number
  seed: number
  peak?: number
  leakHz?: number
}

/** A seamless loop of white or brown noise, `seconds` long, ready to copy into an AudioBuffer. */
export function generateLoop(spec: LoopSpec): Float32Array {
  const rng = createRng(spec.seed)
  const peak = spec.peak ?? 0.9
  const length = Math.max(1, Math.round(spec.seconds * spec.sampleRate))
  const fade = Math.min(length, Math.round((spec.crossfadeSeconds ?? 0.5) * spec.sampleRate))
  const raw =
    spec.type === 'brown'
      ? brownNoise(length + fade, rng, spec.sampleRate, { leakHz: spec.leakHz, peak })
      : whiteNoise(length + fade, rng)
  return normalize(makeLoopable(raw, fade), peak)
}
