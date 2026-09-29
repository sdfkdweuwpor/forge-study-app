import { describe, expect, it } from 'vitest'
import { quickDates } from './quickDates'

const byId = (today: string, weekStartsOn?: 0 | 1) =>
  Object.fromEntries(
    quickDates(today, ['today', 'tomorrow', 'next-week'], weekStartsOn).map((q) => [q.id, q.date]),
  )

describe('quickDates', () => {
  it('returns today, tomorrow and the next Monday for a Tuesday', () => {
    // 2026-09-29 is a Tuesday.
    expect(byId('2026-09-29')).toEqual({
      today: '2026-09-29',
      tomorrow: '2026-09-30',
      'next-week': '2026-10-05',
    })
  })

  it('rolls "next week" past the current week on a Sunday when weeks start on Monday', () => {
    expect(byId('2026-10-04')['next-week']).toBe('2026-10-05')
  })

  it('follows a Sunday week start', () => {
    expect(byId('2026-09-29', 0)['next-week']).toBe('2026-10-04')
    expect(byId('2026-10-04', 0)['next-week']).toBe('2026-10-11')
  })

  it('counts whole calendar days across the November DST change', () => {
    // US clocks fall back on Sunday 2026-11-01; the tests run in America/New_York.
    expect(byId('2026-10-31')).toEqual({
      today: '2026-10-31',
      tomorrow: '2026-11-01',
      'next-week': '2026-11-02',
    })
  })

  it('crosses month and year boundaries', () => {
    expect(byId('2026-12-31').tomorrow).toBe('2027-01-01')
    expect(byId('2026-12-31')['next-week']).toBe('2027-01-04')
  })

  it('respects the requested ids and order, with labels', () => {
    expect(quickDates('2026-09-29', ['tomorrow', 'today'])).toEqual([
      { id: 'tomorrow', label: 'Tomorrow', date: '2026-09-30' },
      { id: 'today', label: 'Today', date: '2026-09-29' },
    ])
  })
})
