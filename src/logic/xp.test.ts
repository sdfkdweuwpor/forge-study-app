import { describe, expect, it } from 'vitest'
import type { Priority } from '@/db/types'
import {
  balance,
  isSessionCounted,
  levelFromLifetimeXp,
  lifetimeXp,
  spentXp,
  STREAK_MILESTONES,
  XP_COURSE_COMPLETE,
  XP_DAILY_GOAL,
  XP_RITUAL,
  XP_STREAK_MILESTONE,
  xpForLevel,
  xpForSession,
  xpForStreakMilestone,
  xpForTask,
  xpToReachLevel,
} from '@/logic/xp'

describe('constants', () => {
  it('match BRIEF §5.5', () => {
    expect(XP_COURSE_COMPLETE).toBe(250)
    expect(XP_DAILY_GOAL).toBe(25)
    expect(XP_RITUAL).toBe(10)
    expect([...STREAK_MILESTONES]).toEqual([7, 30, 100])
    expect(XP_STREAK_MILESTONE).toEqual({ 7: 100, 30: 500, 100: 2000 })
  })

  it('pays a streak milestone only on the exact length', () => {
    expect(xpForStreakMilestone(7)).toBe(100)
    expect(xpForStreakMilestone(30)).toBe(500)
    expect(xpForStreakMilestone(100)).toBe(2000)
    for (const days of [0, 1, 6, 8, 29, 31, 99, 101, -7, NaN])
      expect(xpForStreakMilestone(days)).toBe(0)
  })
})

describe('xpForTask', () => {
  it.each<[number | null | undefined, Priority | undefined, number]>([
    [0, 0, 10],
    [undefined, undefined, 10],
    [null, 0, 10],
    [1, 0, 15], // the brief's "+15 XP" float
    [2, 0, 20],
    [2, 1, 20],
    [2, 2, 20],
    [2, 3, 25], // high +5
    [2, 4, 30], // urgent +10
    [null, 4, 20],
    [8, 4, 60],
  ])('estimate %s, priority %s → %i', (estimate, priority, xp) => {
    expect(xpForTask({ estimate, priority })).toBe(xp)
  })

  it('never goes below the base for a bad estimate', () => {
    expect(xpForTask({ estimate: -3, priority: 0 })).toBe(10)
    expect(xpForTask({ estimate: NaN, priority: 0 })).toBe(10)
    expect(xpForTask({ estimate: Infinity, priority: 0 })).toBe(10)
    expect(xpForTask({})).toBe(10)
  })

  it('returns whole numbers', () => {
    expect(Number.isInteger(xpForTask({ estimate: 1.5, priority: 3 }))).toBe(true)
  })
})

describe('xpForSession', () => {
  it('pays one XP per focused minute when the session reaches 80% of the plan', () => {
    expect(xpForSession({ plannedMin: 25, actualMin: 25 })).toBe(25)
    expect(xpForSession({ plannedMin: 25, actualMin: 20 })).toBe(20) // exactly 80%
    expect(xpForSession({ plannedMin: 25, actualMin: 19 })).toBe(0)
    expect(xpForSession({ plannedMin: 25, actualMin: 30 })).toBe(30) // ran long
    expect(xpForSession({ plannedMin: 50, actualMin: 40 })).toBe(40)
    expect(xpForSession({ plannedMin: 50, actualMin: 39 })).toBe(0)
  })

  it('has no float noise at the 80% edge', () => {
    for (const planned of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 90, 120]) {
      const edge = (planned * 4) / 5
      expect(isSessionCounted({ plannedMin: planned, actualMin: edge })).toBe(true)
      expect(isSessionCounted({ plannedMin: planned, actualMin: edge - 0.01 })).toBe(false)
    }
  })

  it('counts a stopwatch session (no plan) from 10 minutes', () => {
    expect(xpForSession({ plannedMin: null, actualMin: 9 })).toBe(0)
    expect(xpForSession({ plannedMin: null, actualMin: 10 })).toBe(10)
    expect(xpForSession({ actualMin: 47 })).toBe(47)
    expect(xpForSession({ plannedMin: 0, actualMin: 12 })).toBe(12)
  })

  it('floors to whole minutes', () => {
    expect(xpForSession({ plannedMin: 25, actualMin: 24.9 })).toBe(24)
    expect(xpForSession({ plannedMin: 25, actualMin: 20.5 })).toBe(20)
  })

  it('pays nothing for zero, negative or non-finite time', () => {
    expect(xpForSession({ plannedMin: 25, actualMin: 0 })).toBe(0)
    expect(xpForSession({ plannedMin: 25, actualMin: -5 })).toBe(0)
    expect(xpForSession({ plannedMin: 25, actualMin: NaN })).toBe(0)
    expect(xpForSession({ plannedMin: null, actualMin: Infinity })).toBe(0)
  })
})

describe('levels', () => {
  it('xpForLevel(n) is the cost of going from n to n+1', () => {
    expect(xpForLevel(1)).toBe(100)
    expect(xpForLevel(2)).toBe(283)
    expect(xpForLevel(3)).toBe(520)
    expect(xpForLevel(4)).toBe(800)
    expect(xpForLevel(5)).toBe(1118)
    expect(xpForLevel(6)).toBe(1470)
    expect(xpForLevel(7)).toBe(1852) // the brief's "Level 7 … /1,800"
    expect(xpForLevel(10)).toBe(3162)
  })

  it('costs grow every level and clamp bad input to level 1', () => {
    for (let n = 1; n < 200; n++) expect(xpForLevel(n + 1)).toBeGreaterThan(xpForLevel(n))
    expect(xpForLevel(0)).toBe(100)
    expect(xpForLevel(-4)).toBe(100)
    expect(xpForLevel(2.9)).toBe(283)
  })

  it('xpToReachLevel is the running sum of costs', () => {
    expect(xpToReachLevel(1)).toBe(0)
    expect(xpToReachLevel(2)).toBe(100)
    expect(xpToReachLevel(3)).toBe(383)
    expect(xpToReachLevel(4)).toBe(903)
    expect(xpToReachLevel(5)).toBe(1703)
    expect(xpToReachLevel(7)).toBe(4291)
    expect(xpToReachLevel(0)).toBe(0)
  })

  it('levelFromLifetimeXp starts at level 1', () => {
    expect(levelFromLifetimeXp(0)).toEqual({ level: 1, intoLevel: 0, needed: 100, progress: 0 })
    expect(levelFromLifetimeXp(50)).toEqual({ level: 1, intoLevel: 50, needed: 100, progress: 0.5 })
    expect(levelFromLifetimeXp(99)).toMatchObject({ level: 1, intoLevel: 99 })
  })

  it('levels up exactly on the threshold', () => {
    expect(levelFromLifetimeXp(100)).toEqual({ level: 2, intoLevel: 0, needed: 283, progress: 0 })
    expect(levelFromLifetimeXp(382)).toMatchObject({ level: 2, intoLevel: 282, needed: 283 })
    expect(levelFromLifetimeXp(383)).toMatchObject({ level: 3, intoLevel: 0, needed: 520 })
  })

  it("reproduces the brief's sidebar: Level 7, 1,240 into the level", () => {
    const info = levelFromLifetimeXp(xpToReachLevel(7) + 1240)
    expect(info.level).toBe(7)
    expect(info.intoLevel).toBe(1240)
    expect(info.needed).toBe(1852)
    expect(info.progress).toBeCloseTo(1240 / 1852, 10)
  })

  it('is consistent with xpToReachLevel at every total', () => {
    let lastLevel = 1
    for (let total = 0; total < 60_000; total += 37) {
      const { level, intoLevel, needed, progress } = levelFromLifetimeXp(total)
      expect(level).toBeGreaterThanOrEqual(lastLevel)
      expect(xpToReachLevel(level) + intoLevel).toBe(total)
      expect(intoLevel).toBeGreaterThanOrEqual(0)
      expect(intoLevel).toBeLessThan(needed)
      expect(needed).toBe(xpForLevel(level))
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThan(1)
      lastLevel = level
    }
  })

  it('handles huge, fractional, negative and non-finite totals', () => {
    expect(levelFromLifetimeXp(100.9).level).toBe(2)
    expect(levelFromLifetimeXp(-50)).toMatchObject({ level: 1, intoLevel: 0 })
    expect(levelFromLifetimeXp(NaN)).toMatchObject({ level: 1, intoLevel: 0 })
    expect(levelFromLifetimeXp(Infinity)).toMatchObject({ level: 1, intoLevel: 0 })
    const big = levelFromLifetimeXp(50_000_000)
    expect(big.level).toBeGreaterThan(50)
    expect(xpToReachLevel(big.level) + big.intoLevel).toBe(50_000_000)
  })
})

describe('balance', () => {
  const event = (amount: number): { amount: number } => ({ amount })

  it('lifetime is the sum of every event, reversals included', () => {
    expect(lifetimeXp([])).toBe(0)
    expect(lifetimeXp([event(15), event(25), event(-15)])).toBe(25)
  })

  it('spent counts only redemptions that were not refunded', () => {
    expect(spentXp([])).toBe(0)
    expect(
      spentXp([
        { price: 300, refundedAt: null },
        { price: 1500, refundedAt: 1_700_000_000_000 },
        { price: 100, refundedAt: null },
      ]),
    ).toBe(400)
  })

  it('balance = lifetime − spent', () => {
    const events = [event(1000), event(500), event(-100)]
    const redemptions = [
      { price: 300, refundedAt: null },
      { price: 200, refundedAt: 1 },
    ]
    expect(lifetimeXp(events)).toBe(1400)
    expect(balance(events, redemptions)).toBe(1100)
  })

  it('levels come from lifetime XP, so spending never lowers them', () => {
    const events = [event(xpToReachLevel(7) + 1240)]
    const redemptions = [{ price: 4000, refundedAt: null }]
    expect(balance(events, redemptions)).toBe(1531)
    expect(levelFromLifetimeXp(lifetimeXp(events)).level).toBe(7)
  })

  it('balance(events) with no redemptions is just lifetime', () => {
    expect(balance([event(40), event(2)])).toBe(42)
    expect(balance([])).toBe(0)
  })

  it('a refund gives the XP back', () => {
    const events = [event(500)]
    expect(balance(events, [{ price: 300, refundedAt: null }])).toBe(200)
    expect(balance(events, [{ price: 300, refundedAt: 5 }])).toBe(500)
  })
})
