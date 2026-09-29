import { describe, expect, it } from 'vitest'
import {
  dueLabel,
  estimateLabel,
  formatDay,
  formatDayLong,
  formatTimeOfDay,
  formatXp,
  relativeDay,
  subtaskProgress,
} from './taskDisplay'

const TODAY = '2026-09-29' // a Tuesday

describe('formatTimeOfDay', () => {
  it('uses a 12-hour clock and drops :00', () => {
    expect(formatTimeOfDay('14:00')).toBe('2 PM')
    expect(formatTimeOfDay('14:30')).toBe('2:30 PM')
    expect(formatTimeOfDay('09:05')).toBe('9:05 AM')
    expect(formatTimeOfDay('00:00')).toBe('12 AM')
    expect(formatTimeOfDay('00:05')).toBe('12:05 AM')
    expect(formatTimeOfDay('12:00')).toBe('12 PM')
    expect(formatTimeOfDay('23:59')).toBe('11:59 PM')
  })

  it('leaves malformed input alone', () => {
    expect(formatTimeOfDay('noon')).toBe('noon')
  })
})

describe('day formats', () => {
  it('omit the year within the current year', () => {
    expect(formatDay('2026-10-12', TODAY)).toBe('Oct 12')
    expect(formatDay('2027-01-04', TODAY)).toBe('Jan 4, 2027')
    expect(formatDayLong('2026-09-25', TODAY)).toBe('Fri, Sep 25')
    expect(formatDayLong('2027-01-04', TODAY)).toBe('Mon, Jan 4, 2027')
  })
})

describe('relativeDay', () => {
  it('uses words near today', () => {
    expect(relativeDay('2026-09-29', TODAY)).toBe('Today')
    expect(relativeDay('2026-09-30', TODAY)).toBe('Tomorrow')
    expect(relativeDay('2026-09-28', TODAY)).toBe('Yesterday')
    expect(relativeDay('2026-09-26', TODAY)).toBe('3 days ago')
  })

  it('names the weekday for the next six days, then switches to dates', () => {
    expect(relativeDay('2026-10-01', TODAY)).toBe('Thursday')
    expect(relativeDay('2026-10-05', TODAY)).toBe('Monday')
    expect(relativeDay('2026-10-06', TODAY)).toBe('Oct 6')
  })

  it('switches to dates for old days too', () => {
    expect(relativeDay('2026-09-15', TODAY)).toBe('Sep 15')
  })
})

describe('dueLabel', () => {
  it('is null without a due date', () => {
    expect(dueLabel({ dueDate: null, dueTime: null, status: 'todo' }, TODAY)).toBeNull()
  })

  it('flags open overdue tasks', () => {
    const label = dueLabel({ dueDate: '2026-09-25', dueTime: '10:00', status: 'todo' }, TODAY)
    expect(label).toEqual({
      text: '4 days ago',
      tone: 'overdue',
      description: 'Overdue, due Fri, Sep 25, 10 AM',
    })
  })

  it('adds the time of day for today and later', () => {
    expect(dueLabel({ dueDate: TODAY, dueTime: '14:00', status: 'todo' }, TODAY)).toEqual({
      text: 'Today, 2 PM',
      tone: 'today',
      description: 'Due Tue, Sep 29, 2 PM',
    })
    expect(dueLabel({ dueDate: '2026-09-30', dueTime: null, status: 'doing' }, TODAY)).toEqual({
      text: 'Tomorrow',
      tone: 'upcoming',
      description: 'Due Wed, Sep 30',
    })
  })

  it('is quiet for finished tasks, even past due', () => {
    const label = dueLabel({ dueDate: '2026-09-25', dueTime: null, status: 'done' }, TODAY)
    expect(label?.tone).toBe('done')
    expect(label?.description).toBe('Was due Fri, Sep 25')
  })
})

describe('estimateLabel', () => {
  it('prefers pomodoros', () => {
    expect(estimateLabel({ estimatePomodoros: 2, estimateMinutes: 45 })).toEqual({
      text: '~2',
      description: '2 pomodoros, about 50 min',
    })
    expect(estimateLabel({ estimatePomodoros: 1, estimateMinutes: null })?.description).toBe(
      '1 pomodoro, about 25 min',
    )
  })

  it('falls back to minutes, and to nothing', () => {
    expect(estimateLabel({ estimatePomodoros: null, estimateMinutes: 45 })).toEqual({
      text: '45m',
      description: 'About 45 min',
    })
    expect(estimateLabel({ estimatePomodoros: null, estimateMinutes: null })).toBeNull()
    expect(estimateLabel({ estimatePomodoros: 0, estimateMinutes: 0 })).toBeNull()
  })
})

describe('subtaskProgress', () => {
  it('counts finished items', () => {
    expect(subtaskProgress([{ done: true }, { done: false }, { done: false }])).toEqual({
      done: 1,
      total: 3,
      text: '1/3',
    })
    expect(subtaskProgress([])).toBeNull()
  })
})

describe('formatXp', () => {
  it('signs gains and reversals', () => {
    expect(formatXp(15)).toBe('+15 XP')
    expect(formatXp(-15)).toBe('−15 XP')
    expect(formatXp(0)).toBe('+0 XP')
  })
})
