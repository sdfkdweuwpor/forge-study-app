import { describe, expect, it } from 'vitest'
import {
  accuracySentence,
  dayBars,
  dayName,
  durationText,
  hoursText,
  minutesTick,
  weekBars,
} from './statsLabels'

describe('dayName and dayBars', () => {
  it('names a day the way a person says it', () => {
    expect(dayName('2026-09-29')).toBe('Tue, Sep 29')
    expect(dayName('2026-01-01')).toBe('Thu, Jan 1')
  })

  it('keeps the day as the key and puts a short label on the axis', () => {
    expect(dayBars([{ day: '2026-09-29', minutes: 75 }])).toEqual([
      { key: '2026-09-29', label: 'Tue, Sep 29', value: 75, tick: 'Sep 29' },
    ])
  })
})

describe('weekBars', () => {
  it('says the current week is still filling up', () => {
    const bars = weekBars(
      [
        { weekStart: '2026-09-21', count: 6 },
        { weekStart: '2026-09-28', count: 2 },
      ],
      '2026-09-29',
      1,
    )
    expect(bars.map((b) => b.label)).toEqual(['Week of Sep 21', 'Week of Sep 28 (so far)'])
    expect(bars.map((b) => b.value)).toEqual([6, 2])
    expect(bars[0]?.tick).toBe('Sep 21')
  })

  it('finds the current week with a Sunday start too', () => {
    const bars = weekBars([{ weekStart: '2026-09-27', count: 1 }], '2026-09-29', 0)
    expect(bars[0]?.label).toBe('Week of Sep 27 (so far)')
  })
})

describe('minutes text', () => {
  it('labels an axis', () => {
    expect([0, 20, 30, 60, 90, 120, 180].map(minutesTick)).toEqual([
      '0',
      '20m',
      '30m',
      '1h',
      '1.5h',
      '2h',
      '3h',
    ])
  })

  it('formats a duration', () => {
    expect([0, 45, 60, 85, 120, 59.6].map(durationText)).toEqual([
      '0 min',
      '45 min',
      '1 h',
      '1 h 25 min',
      '2 h',
      '1 h',
    ])
  })

  it('formats lifetime hours', () => {
    expect([0, 45, 60, 510, 600, 8520].map(hoursText)).toEqual([
      '0 min',
      '45 min',
      '1 h',
      '8.5 h',
      '10 h',
      '142 h',
    ])
  })
})

describe('accuracySentence', () => {
  const points = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ taskId: `t${i}`, planned: 1, actual: 1 }))

  it('states how many landed within the band, in counts', () => {
    expect(accuracySentence({ share: 0.625, points: points(16) })).toBe(
      '10 of 16 finished tasks took about as long as you planned.',
    )
    expect(accuracySentence({ share: 1, points: points(3) })).toBe(
      'All 3 finished tasks took about as long as you planned.',
    )
  })

  it('stays neutral when none did', () => {
    expect(accuracySentence({ share: 0, points: points(4) })).toBe(
      'Your 4 finished tasks ran longer or shorter than planned. The dots show which way.',
    )
  })

  it('says nothing without data, and handles one task', () => {
    expect(accuracySentence({ share: null, points: [] })).toBeNull()
    expect(accuracySentence({ share: 1, points: points(1) })).toBe(
      'Your finished task took about as long as you planned.',
    )
    expect(accuracySentence({ share: 0, points: points(1) })).toBe(
      'Your finished task ran longer or shorter than planned. The dot shows which way.',
    )
  })
})
