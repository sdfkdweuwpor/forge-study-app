import { describe, expect, it } from 'vitest'
import {
  bellCurve,
  bellGain,
  clamp01,
  equalPowerPair,
  fadeStopDelayMs,
  fadeTimeConstant,
  smoothstep,
  volumeToGain,
} from './envelope'

describe('clamp01', () => {
  it('keeps values in range and turns junk into 0', () => {
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('volumeToGain', () => {
  it('is silent at 0, unity at 1, and tapers in between', () => {
    expect(volumeToGain(0)).toBe(0)
    expect(volumeToGain(1)).toBe(1)
    expect(volumeToGain(0.5)).toBeCloseTo(0.25)
  })

  it('never decreases as the slider rises, and clamps out-of-range input', () => {
    let last = -1
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = volumeToGain(v)
      expect(g).toBeGreaterThanOrEqual(last)
      last = g
    }
    expect(volumeToGain(2)).toBe(1)
    expect(volumeToGain(-1)).toBe(0)
  })
})

describe('smoothstep and equalPowerPair', () => {
  it('smoothstep runs 0 to 1 with flat ends', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5)
    expect(smoothstep(0.01)).toBeLessThan(0.001)
  })

  it('an equal-power pair always carries constant power', () => {
    for (let x = 0; x <= 1; x += 0.1) {
      const [a, b] = equalPowerPair(x)
      expect(a * a + b * b).toBeCloseTo(1)
    }
    expect(equalPowerPair(0)).toEqual([0, 1])
  })
})

describe('fades', () => {
  it('reach within 1% of the target by the end of the fade', () => {
    for (const ms of [200, 600, 900, 3000]) {
      const remaining = Math.exp(-(ms / 1000) / fadeTimeConstant(ms))
      expect(remaining).toBeLessThan(0.01)
    }
  })

  it('a zero-length fade still has a positive time constant, and teardown waits past the fade', () => {
    expect(fadeTimeConstant(0)).toBeGreaterThan(0)
    expect(fadeStopDelayMs(600)).toBeGreaterThan(600)
    expect(fadeStopDelayMs(0)).toBeGreaterThan(0)
    expect(fadeStopDelayMs(-5)).toBeGreaterThan(0)
  })
})

describe('bellGain', () => {
  const env = { attack: 0.01, tau: 0.2, duration: 1 }

  it('is silent before the start and at or after the end', () => {
    expect(bellGain(0, env)).toBe(0)
    expect(bellGain(-1, env)).toBe(0)
    expect(bellGain(1, env)).toBe(0)
    expect(bellGain(5, env)).toBe(0)
  })

  it('rises to 1 over the attack, then only falls', () => {
    expect(bellGain(0.01, env)).toBeCloseTo(1, 5)
    expect(bellGain(0.005, env)).toBeGreaterThan(0.5)
    expect(bellGain(0.005, env)).toBeLessThan(1)
    let last = 1.0001
    for (let t = 0.01; t < 1; t += 0.01) {
      const g = bellGain(t, env)
      expect(g).toBeLessThanOrEqual(last)
      last = g
    }
  })

  it('decays by the time constant', () => {
    expect(bellGain(0.21, env)).toBeCloseTo(Math.exp(-1), 3)
  })

  it('tapers to zero over the release so the note ends without a click', () => {
    expect(bellGain(0.999, env)).toBeLessThan(0.001)
    expect(bellGain(0.97, env)).toBeLessThan(bellGain(0.9, env))
  })
})

describe('bellCurve', () => {
  const env = { attack: 0.008, tau: 0.25, duration: 0.9 }

  it('starts and ends at exactly zero, and never exceeds the peak', () => {
    const c = bellCurve(env, 0.3)
    expect(c[0]).toBe(0)
    expect(c[c.length - 1]).toBe(0)
    expect(Math.max(...c)).toBeLessThanOrEqual(0.3)
    expect(Math.max(...c)).toBeGreaterThan(0.2)
  })

  it('has the requested number of points (at least 2)', () => {
    expect(bellCurve(env, 1, 50)).toHaveLength(50)
    expect(bellCurve(env, 1, 0)).toHaveLength(2)
  })
})
