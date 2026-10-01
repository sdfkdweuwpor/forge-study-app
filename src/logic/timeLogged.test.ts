import { describe, expect, it } from 'vitest'
import { countsAsLogged, formatLogged, timePerGoal, type LoggedSession } from './timeLogged'

const s = (o: Partial<LoggedSession> = {}): LoggedSession => ({
  goalId: 'g1',
  day: '2026-09-29',
  kind: 'focus',
  status: 'completed',
  actualMinutes: 25,
  ...o,
})

describe('countsAsLogged', () => {
  it('counts finished or stopped focus sessions with minutes only', () => {
    expect(countsAsLogged(s())).toBe(true)
    expect(countsAsLogged(s({ status: 'abandoned' }))).toBe(true)
    expect(countsAsLogged(s({ status: 'running' }))).toBe(false)
    expect(countsAsLogged(s({ kind: 'break' }))).toBe(false)
    expect(countsAsLogged(s({ actualMinutes: null }))).toBe(false)
    expect(countsAsLogged(s({ actualMinutes: 0 }))).toBe(false)
  })
})

describe('timePerGoal', () => {
  const order = ['g1', 'g2']
  it('sums per goal, most time first, with Other last', () => {
    const rows = [
      s({ goalId: 'g1', actualMinutes: 25 }),
      s({ goalId: 'g2', actualMinutes: 50 }),
      s({ goalId: null, actualMinutes: 90 }),
      s({ goalId: 'g1', actualMinutes: 25 }),
    ]
    expect(timePerGoal(rows, order, '2026-09-29', '2026-09-29')).toEqual([
      { goalId: 'g1', minutes: 50 },
      { goalId: 'g2', minutes: 50 },
      { goalId: null, minutes: 90 },
    ])
  })

  it('treats a deleted goal as Other', () => {
    const rows = [s({ goalId: 'gone', actualMinutes: 10 }), s({ goalId: null, actualMinutes: 5 })]
    expect(timePerGoal(rows, order, '2026-09-29', '2026-09-29')).toEqual([
      { goalId: null, minutes: 15 },
    ])
  })

  it('keeps to the day range and skips what does not count', () => {
    const rows = [
      s({ day: '2026-09-28', actualMinutes: 30 }),
      s({ day: '2026-09-27', actualMinutes: 30 }),
      s({ status: 'running' }),
    ]
    expect(timePerGoal(rows, order, '2026-09-28', '2026-09-29')).toEqual([
      { goalId: 'g1', minutes: 30 },
    ])
    expect(timePerGoal([], order, '2026-09-28', '2026-09-29')).toEqual([])
  })
})

describe('formatLogged', () => {
  it('reads as minutes or hours', () => {
    expect(formatLogged(45)).toBe('45 min')
    expect(formatLogged(60)).toBe('1 h')
    expect(formatLogged(85)).toBe('1 h 25 min')
  })
})
