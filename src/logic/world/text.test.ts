import { describe, expect, it } from 'vitest'
import { LEGEND, STREAK_PERKS, describeWorld, formatEarnedDate, kindName, statsLine, tooltipText } from './text'
import type { Placed } from './types'

const item = (over: Partial<Placed> = {}): Placed => ({
  id: 'task:a',
  kind: 'house',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  floors: 0,
  variant: 0,
  label: null,
  earnedFrom: 'Finished "Read chapter 4"',
  earnedAt: new Date(2026, 8, 29, 19, 40).getTime(),
  ...over,
})

describe('statsLine', () => {
  it('reads like the toolbar shows it', () => {
    expect(statsLine({ tiles: 42, floors: 12, landmarks: 3, streakLevel: 0 })).toBe('42 tiles · 12 floors · 3 landmarks')
  })
  it('uses the singular for one', () => {
    expect(statsLine({ tiles: 1, floors: 1, landmarks: 1, streakLevel: 2 })).toBe('1 tile · 1 floor · 1 landmark')
  })
  it('is gentle when there is nothing yet', () => {
    expect(statsLine({ tiles: 0, floors: 0, landmarks: 0, streakLevel: 0 })).toBe('Nothing built yet')
  })
  it('keeps zeros next to non-zeros', () => {
    expect(statsLine({ tiles: 0, floors: 3, landmarks: 0, streakLevel: 0 })).toBe('0 tiles · 3 floors · 0 landmarks')
  })
})

describe('describeWorld', () => {
  it('says the same in a sentence', () => {
    expect(describeWorld({ tiles: 2, floors: 1, landmarks: 0, streakLevel: 0 })).toBe('Your city has 2 tiles, 1 floor and 0 landmarks.')
    expect(describeWorld({ tiles: 0, floors: 0, landmarks: 0, streakLevel: 0 })).toMatch(/waiting for the first thing you finish/)
  })
})

describe('tooltipText', () => {
  it('leads with the label of a landmark', () => {
    const t = tooltipText(item({ kind: 'landmark', label: 'C182 Tower', earnedFrom: 'Completed C182 Introduction to IT' }))
    expect(t).toEqual({ title: 'C182 Tower', detail: 'Completed C182 Introduction to IT', date: 'Sep 29, 2026' })
  })
  it('names a plain tile by what it is', () => {
    expect(tooltipText(item()).title).toBe('House')
    expect(tooltipText(item({ kind: 'lamp' })).title).toBe('Lamp post')
    expect(tooltipText(item({ kind: 'block' })).title).toBe('Tower block')
  })
  it('copes with a missing date', () => {
    expect(tooltipText(item({ earnedAt: null })).date).toBe('')
  })
})

describe('formatEarnedDate and names', () => {
  it('formats in local time', () => {
    expect(formatEarnedDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe('Jan 5, 2026')
    expect(formatEarnedDate(new Date(2026, 11, 31, 0, 1).getTime())).toBe('Dec 31, 2026')
  })
  it('names every kind', () => {
    expect(kindName('castle')).toBe('Castle')
    expect(kindName('decor')).toBe('Shrub')
  })
})

describe('the legend', () => {
  it('explains each earned kind once, and every streak perk adds and never takes', () => {
    expect(LEGEND.map((r) => r.kind)).toEqual(['house', 'block', 'landmark', 'monument', 'castle'])
    expect(STREAK_PERKS.map((p) => p.days)).toEqual([3, 7, 14, 30])
    for (const p of STREAK_PERKS) expect(p.perk).not.toMatch(/lose|lost|broken|miss|die|fade/i)
  })
})
