import { describe, expect, it } from 'vitest'
import {
  CONFETTI_MS,
  DISMISS_FADE_MS,
  LEVEL_UP_MS,
  confettiPose,
  levelUpFrame,
  makeConfetti,
} from '@/logic/levelUpMotion'

describe('levelUpFrame', () => {
  it('lasts under 1.5 seconds (BRIEF §3.5)', () => {
    expect(LEVEL_UP_MS).toBeLessThan(1500)
    expect(CONFETTI_MS).toBeLessThan(LEVEL_UP_MS)
  })

  it('fades in from nothing, holds, fades out to nothing, then is done', () => {
    expect(levelUpFrame(0, false).opacity).toBe(0)
    expect(levelUpFrame(100, false).opacity).toBeGreaterThan(0)
    expect(levelUpFrame(100, false).opacity).toBeLessThan(1)
    expect(levelUpFrame(600, false).opacity).toBe(1)
    expect(levelUpFrame(LEVEL_UP_MS - 100, false).opacity).toBeGreaterThan(0)
    expect(levelUpFrame(LEVEL_UP_MS - 100, false).opacity).toBeLessThan(1)
    const end = levelUpFrame(LEVEL_UP_MS, false)
    expect(end.opacity).toBe(0)
    expect(end.done).toBe(true)
    expect(levelUpFrame(LEVEL_UP_MS - 1, false).done).toBe(false)
  })

  it('never leaves 0..1 and never goes backwards while fading in', () => {
    let last = 0
    for (let t = 0; t <= 200; t += 5) {
      const { opacity } = levelUpFrame(t, false)
      expect(opacity).toBeGreaterThanOrEqual(last)
      last = opacity
    }
    for (let t = -50; t <= LEVEL_UP_MS + 200; t += 7) {
      const { opacity, scale } = levelUpFrame(t, false)
      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(1)
      expect(scale).toBeGreaterThan(0.9)
      expect(scale).toBeLessThanOrEqual(1)
    }
  })

  it('with reduced motion only fades: no scale, no confetti', () => {
    for (let t = 0; t <= LEVEL_UP_MS; t += 50) {
      const frame = levelUpFrame(t, true)
      expect(frame.scale).toBe(1)
      expect(frame.confettiMs).toBeNull()
    }
    expect(levelUpFrame(0, true).opacity).toBe(0)
    expect(levelUpFrame(600, true).opacity).toBe(1)
    expect(levelUpFrame(LEVEL_UP_MS, true).done).toBe(true)
  })

  it('runs the confetti clock only while the confetti flies', () => {
    expect(levelUpFrame(0, false).confettiMs).toBe(0)
    expect(levelUpFrame(500, false).confettiMs).toBe(500)
    expect(levelUpFrame(CONFETTI_MS, false).confettiMs).toBeNull()
  })

  it('fades out quickly from wherever it was when dismissed early', () => {
    const before = levelUpFrame(500, false, 500)
    expect(before.opacity).toBe(1)
    expect(before.done).toBe(false)
    const half = levelUpFrame(500 + DISMISS_FADE_MS / 2, false, 500)
    expect(half.opacity).toBeGreaterThan(0)
    expect(half.opacity).toBeLessThan(1)
    const gone = levelUpFrame(500 + DISMISS_FADE_MS, false, 500)
    expect(gone.opacity).toBe(0)
    expect(gone.done).toBe(true)
  })

  it('treats a non-finite time as the start', () => {
    expect(levelUpFrame(NaN, false)).toMatchObject({ opacity: 0, done: false })
    expect(levelUpFrame(-100, false).opacity).toBe(0)
  })
})

describe('confetti', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(makeConfetti(8, 54, 9)).toEqual(makeConfetti(8, 54, 9))
    expect(makeConfetti(8, 54, 9)).not.toEqual(makeConfetti(9, 54, 9))
  })

  it('spreads the pieces over every palette colour, evenly', () => {
    const pieces = makeConfetti(8, 54, 9)
    expect(pieces).toHaveLength(54)
    const counts = new Array<number>(9).fill(0)
    for (const p of pieces) counts[p.color] = (counts[p.color] ?? 0) + 1
    expect(counts).toEqual(new Array<number>(9).fill(6))
  })

  it('makes small squares', () => {
    for (const p of makeConfetti(3, 90, 9)) {
      expect(p.size).toBeGreaterThanOrEqual(6)
      expect(p.size).toBeLessThanOrEqual(11)
    }
  })

  it('handles an empty or degenerate request', () => {
    expect(makeConfetti(1, 0, 9)).toEqual([])
    expect(makeConfetti(1, -4, 9)).toEqual([])
    expect(makeConfetti(1, 3, 0).every((p) => p.color === 0)).toBe(true)
  })

  it('starts at the middle of the screen and rises, then falls', () => {
    const [seed] = makeConfetti(5, 1, 9)
    if (!seed) throw new Error('expected a piece')
    // Straight up: the apex is where gravity has eaten the launch speed (0.8 / 1.9 ≈ 0.42 s).
    const piece = { ...seed, angle: -Math.PI / 2, speed: 0.8, delay: 0 }
    const start = confettiPose(piece, 1, 1000, 800)
    expect(Math.abs((start?.x ?? 0) - 500)).toBeLessThan(2)
    expect(Math.abs((start?.y ?? 0) - 800 * 0.46)).toBeLessThan(2)
    const ys = [100, 250, 420, 600, 800, 1000].map(
      (ms) => confettiPose(piece, ms, 1000, 800)?.y ?? NaN,
    )
    const apex = Math.min(...ys)
    expect(apex).toBeLessThan(start?.y ?? 0)
    expect(ys[0]).toBeGreaterThan(apex)
    expect(ys[ys.length - 1]).toBeGreaterThan(apex)
    // It stays on screen at its highest.
    expect(apex).toBeGreaterThan(0)
  })

  it('is not there before its launch or after the confetti ends, and fades at the end', () => {
    const [piece] = makeConfetti(5, 1, 9)
    if (!piece) throw new Error('expected a piece')
    expect(confettiPose({ ...piece, delay: 0.1 }, 50, 1000, 800)).toBeNull()
    expect(confettiPose(piece, CONFETTI_MS, 1000, 800)).toBeNull()
    expect(confettiPose(piece, 300, 1000, 800)?.alpha).toBe(1)
    const fading = confettiPose(piece, CONFETTI_MS - 100, 1000, 800)
    expect(fading?.alpha).toBeGreaterThan(0)
    expect(fading?.alpha).toBeLessThan(1)
  })

  it('always returns finite numbers', () => {
    for (const p of makeConfetti(11, 60, 9)) {
      for (let ms = 0; ms < CONFETTI_MS; ms += 60) {
        const pose = confettiPose(p, ms, 375, 812)
        if (!pose) continue
        for (const n of [pose.x, pose.y, pose.size, pose.rotation, pose.alpha]) {
          expect(Number.isFinite(n)).toBe(true)
        }
      }
    }
  })
})
