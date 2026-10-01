import { describe, expect, it } from 'vitest'
import type { Readiness } from '@/db/types'
import { extraReviewMinutesFrom, reviewMinutesForScore } from './readinessPlan'

function row(id: string, extra: Partial<Readiness>): Readiness {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    goalId: 'g',
    milestoneId: 'c182',
    unitId: null,
    score: 0.5,
    extraReviewMinutes: 0,
    inputs: { paPct: null, cardRetention: null, questionAccuracy: null, unitsDonePct: 0 },
    computedAt: 1,
    ...extra,
  }
}

describe('extraReviewMinutesFrom (readiness → the planner hook)', () => {
  it('maps unit rows to units and course rows to courses', () => {
    const out = extraReviewMinutesFrom([
      row('c182', { extraReviewMinutes: 45 }),
      row('u1', { unitId: 'u1', extraReviewMinutes: 30 }),
      row('u2', { unitId: 'u2', extraReviewMinutes: 0 }),
    ])
    expect([...out.courses]).toEqual([['c182', 45]])
    expect([...out.units]).toEqual([['u1', 30]])
  })

  it('drops invalid minutes and lets the latest row win', () => {
    const out = extraReviewMinutesFrom([
      row('u1-new', { unitId: 'u1', extraReviewMinutes: 20, computedAt: 5 }),
      row('u1-old', { unitId: 'u1', extraReviewMinutes: 60, computedAt: 2 }),
      row('u3', { unitId: 'u3', extraReviewMinutes: Number.NaN }),
      row('u4', { unitId: 'u4', extraReviewMinutes: 12.4 }),
    ])
    expect(out.units.get('u1')).toBe(20)
    expect(out.units.has('u3')).toBe(false)
    expect(out.units.get('u4')).toBe(12)
  })
})

describe('reviewMinutesForScore', () => {
  it('is nothing once ready, and grows with the gap in whole grains', () => {
    expect(reviewMinutesForScore(0.8)).toBe(0)
    expect(reviewMinutesForScore(1)).toBe(0)
    expect(reviewMinutesForScore(0)).toBe(120)
    expect(reviewMinutesForScore(0.4)).toBe(60)
    expect(reviewMinutesForScore(0.7)).toBe(15)
    expect(reviewMinutesForScore(0.7, { maxMinutes: 60, grain: 10 })).toBe(10)
    expect(reviewMinutesForScore(Number.NaN)).toBe(0)
    expect(reviewMinutesForScore(-3)).toBe(120)
  })
})
