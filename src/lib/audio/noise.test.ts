import { describe, expect, it } from 'vitest'
import {
  brownNoise,
  createRng,
  generateLoop,
  makeLoopable,
  normalize,
  pinkNoise,
  whiteNoise,
} from './noise'

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
/** RMS of the sample-to-sample step: small for smooth (brown) noise, large for white. */
function stepRms(a: Float32Array): number {
  let s = 0
  for (let i = 1; i < a.length; i++) s += ((a[i] ?? 0) - (a[i - 1] ?? 0)) ** 2
  return Math.sqrt(s / (a.length - 1))
}

describe('createRng', () => {
  it('gives the same sequence for the same seed and stays in [0, 1)', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 1000; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('gives different sequences for different seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it('is roughly uniform', () => {
    const r = createRng(7)
    let sum = 0
    for (let i = 0; i < 20000; i++) sum += r()
    expect(sum / 20000).toBeGreaterThan(0.49)
    expect(sum / 20000).toBeLessThan(0.51)
  })
})

describe('whiteNoise', () => {
  it('is deterministic per seed, bounded and centred', () => {
    const a = whiteNoise(4000, createRng(5))
    const b = whiteNoise(4000, createRng(5))
    expect(a).toEqual(b)
    expect(peak(a)).toBeLessThanOrEqual(1)
    expect(Math.abs(mean(a))).toBeLessThan(0.05)
  })
})

describe('normalize', () => {
  it('removes the mean and scales the largest sample to the peak', () => {
    const out = normalize(Float32Array.from([1, 2, 3, 4, 10]), 0.5)
    expect(Math.abs(mean(out))).toBeLessThan(1e-6)
    expect(peak(out)).toBeCloseTo(0.5, 5)
  })

  it('leaves silence alone', () => {
    expect(normalize(new Float32Array(4), 0.9)).toEqual(new Float32Array(4))
    expect(normalize(new Float32Array(0), 0.9)).toHaveLength(0)
  })
})

describe('brownNoise', () => {
  const sr = 44100

  it('is deterministic for a seed and differs between seeds', () => {
    const a = brownNoise(5000, createRng(9), sr)
    expect(a).toEqual(brownNoise(5000, createRng(9), sr))
    expect(a).not.toEqual(brownNoise(5000, createRng(10), sr))
  })

  it('is centred and peaks at the requested level', () => {
    const a = brownNoise(sr, createRng(3), sr, { peak: 0.8 })
    expect(Math.abs(mean(a))).toBeLessThan(1e-4)
    expect(peak(a)).toBeCloseTo(0.8, 4)
  })

  it('is much smoother than white noise (power falls with frequency)', () => {
    const white = normalize(whiteNoise(sr, createRng(3)), 0.9)
    const brown = brownNoise(sr, createRng(3), sr)
    expect(stepRms(brown) / rms(brown)).toBeLessThan(0.25 * (stepRms(white) / rms(white)))
  })

  it('is as loud at the start as later (the integrator is warmed up)', () => {
    const a = brownNoise(sr * 4, createRng(11), sr)
    const head = rms(a.slice(0, 1000))
    const rest = rms(a.slice(sr))
    expect(head).toBeGreaterThan(rest * 0.4)
    expect(head).toBeLessThan(rest * 2.5)
  })
})

describe('makeLoopable', () => {
  const sr = 8000
  const fade = 800
  const length = 8000

  it('shortens the input by the crossfade length', () => {
    const raw = brownNoise(length + fade, createRng(1), sr)
    expect(makeLoopable(raw, fade)).toHaveLength(length)
  })

  it('makes the wrap point continuous: the loop start is what follows its end in the source', () => {
    const raw = brownNoise(length + fade, createRng(1), sr)
    const loop = makeLoopable(raw, fade)
    expect(loop[0]).toBe(raw[length])
    expect(loop[length - 1]).toBe(raw[length - 1])
    // Body untouched after the blend.
    expect(loop[fade + 10]).toBe(raw[fade + 10])
  })

  it('has no click at the seam, unlike a plain cut', () => {
    const raw = brownNoise(length + fade, createRng(21), sr)
    const loop = makeLoopable(raw, fade)
    const seam = Math.abs((loop[0] ?? 0) - (loop[length - 1] ?? 0))
    const cut = raw.slice(0, length)
    const naiveSeam = Math.abs((cut[0] ?? 0) - (cut[length - 1] ?? 0))
    expect(seam).toBeLessThan(4 * stepRms(loop))
    expect(seam).toBeLessThan(naiveSeam)
  })

  it('keeps loudness through the blend (equal power), so there is no dip', () => {
    const raw = whiteNoise(length + fade, createRng(4))
    const loop = makeLoopable(raw, fade)
    const blended = rms(loop.slice(0, fade))
    const body = rms(loop.slice(fade))
    expect(blended / body).toBeGreaterThan(0.85)
    expect(blended / body).toBeLessThan(1.15)
  })

  it('with no crossfade returns a copy', () => {
    const raw = whiteNoise(100, createRng(2))
    const loop = makeLoopable(raw, 0)
    expect(loop).toEqual(raw)
    expect(loop).not.toBe(raw)
  })
})

describe('generateLoop', () => {
  const base = { sampleRate: 8000, seconds: 2, seed: 77 } as const

  it('makes a loop of the requested length', () => {
    expect(generateLoop({ ...base, type: 'brown' })).toHaveLength(16000)
    expect(generateLoop({ ...base, type: 'white' })).toHaveLength(16000)
  })

  it('is deterministic per seed', () => {
    expect(generateLoop({ ...base, type: 'brown' })).toEqual(
      generateLoop({ ...base, type: 'brown' }),
    )
    expect(generateLoop({ ...base, type: 'brown' })).not.toEqual(
      generateLoop({ ...base, type: 'brown', seed: 78 }),
    )
  })

  it('peaks at the requested level and stays centred', () => {
    for (const type of ['brown', 'white'] as const) {
      const loop = generateLoop({ ...base, type, peak: 0.5 })
      expect(peak(loop)).toBeCloseTo(0.5, 4)
      expect(Math.abs(mean(loop))).toBeLessThan(1e-4)
    }
  })
})

describe('pinkNoise', () => {
  it('has less high-frequency energy than white and stays within +-1 once normalised', () => {
    const meanAbsDiff = (a: Float32Array) => {
      let s = 0
      for (let i = 1; i < a.length; i++) s += Math.abs((a[i] ?? 0) - (a[i - 1] ?? 0))
      return s / (a.length - 1)
    }
    const white = normalize(whiteNoise(20000, createRng(7)), 0.9)
    const pink = normalize(pinkNoise(20000, createRng(7)), 0.9)
    expect(meanAbsDiff(pink)).toBeLessThan(meanAbsDiff(white))
    expect(peak(pink)).toBeLessThanOrEqual(1)
  })

  it('is deterministic and generateLoop accepts it', () => {
    expect(pinkNoise(100, createRng(3))).toEqual(pinkNoise(100, createRng(3)))
    const loop = generateLoop({ type: 'pink', sampleRate: 8000, seconds: 1, seed: 5 })
    expect(loop.length).toBe(8000)
    expect(peak(loop)).toBeLessThanOrEqual(1)
  })
})
