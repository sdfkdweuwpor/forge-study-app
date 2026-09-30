// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { Goal, Milestone } from '@/db/types'
import {
  buildHeatmap,
  countdownText,
  currentStreak,
  dayPart,
  estimateText,
  greeting,
  levelForMinutes,
  levelForTasks,
  carriedFromText,
  pomodorosDone,
  upcomingTargets,
  type GoalSession,
} from './todayStats'

const TODAY = '2026-09-29'

describe('greeting', () => {
  it('follows the local hour', () => {
    expect(dayPart(0)).toBe('morning')
    expect(dayPart(11)).toBe('morning')
    expect(dayPart(12)).toBe('afternoon')
    expect(dayPart(17)).toBe('afternoon')
    expect(dayPart(18)).toBe('evening')
    expect(dayPart(23)).toBe('evening')
  })

  it('adds the name when there is one', () => {
    expect(greeting(9)).toBe('Good morning')
    expect(greeting(9, 'Sam')).toBe('Good morning, Sam')
    expect(greeting(14, '  Sam  ')).toBe('Good afternoon, Sam')
    expect(greeting(20, '   ')).toBe('Good evening')
  })
})

function session(overrides: Partial<GoalSession> = {}): GoalSession {
  return {
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    counted: true,
    actualMinutes: 25,
    day: TODAY,
    ...overrides,
  }
}

describe('pomodorosDone', () => {
  it('is 0 with no sessions', () => {
    expect(pomodorosDone([], TODAY, 25)).toBe(0)
  })

  it('counts each finished pomodoro session once', () => {
    expect(pomodorosDone([session(), session(), session({ actualMinutes: 20 })], TODAY, 25)).toBe(3)
  })

  it('ignores breaks, other days, running, abandoned and uncounted sessions', () => {
    const rows = [
      session({ kind: 'break' }),
      session({ day: '2026-09-28' }),
      session({ status: 'running' }),
      session({ status: 'abandoned' }),
      session({ counted: false }),
    ]
    expect(pomodorosDone(rows, TODAY, 25)).toBe(0)
  })

  it('turns custom and stopwatch sessions into whole pomodoros of focused time', () => {
    const rows = [
      session({ mode: 'custom', actualMinutes: 50 }),
      session({ mode: 'stopwatch', actualMinutes: 74 }),
      session({ mode: 'stopwatch', actualMinutes: 12 }),
    ]
    expect(pomodorosDone(rows, TODAY, 25)).toBe(2 + 2 + 0)
  })

  it('survives a missing actual duration and a zero pomodoro length', () => {
    expect(pomodorosDone([session({ mode: 'custom', actualMinutes: null })], TODAY, 25)).toBe(0)
    expect(pomodorosDone([session({ mode: 'custom', actualMinutes: 3 })], TODAY, 0)).toBe(3)
  })
})

describe('currentStreak', () => {
  const q = (...days: string[]) => days.map((day) => ({ day, qualified: true }))

  it('is 0 without rows', () => {
    expect(currentStreak([], TODAY)).toBe(0)
  })

  it('counts consecutive qualifying days ending today', () => {
    expect(currentStreak(q('2026-09-27', '2026-09-28', TODAY), TODAY)).toBe(3)
  })

  it('keeps yesterday’s streak alive while today is still open', () => {
    expect(currentStreak(q('2026-09-26', '2026-09-27', '2026-09-28'), TODAY)).toBe(3)
  })

  it('is 0 once a whole day was missed', () => {
    expect(currentStreak(q('2026-09-26', '2026-09-27'), TODAY)).toBe(0)
  })

  it('stops at a gap and at days that did not qualify', () => {
    const rows = [...q(TODAY, '2026-09-28', '2026-09-26'), { day: '2026-09-27', qualified: false }]
    expect(currentStreak(rows, TODAY)).toBe(2)
  })

  it('counts across a month boundary', () => {
    expect(currentStreak(q('2026-09-30', '2026-10-01', '2026-10-02'), '2026-10-02')).toBe(3)
  })
})

describe('heat levels', () => {
  it('shades focus minutes', () => {
    expect([0, 1, 24, 25, 59, 60, 119, 120, 400].map(levelForMinutes)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ])
  })

  it('shades finished tasks', () => {
    expect([0, 1, 2, 3, 4, 9].map(levelForTasks)).toEqual([0, 1, 2, 3, 4, 4])
  })
})

describe('buildHeatmap', () => {
  it('lists the last 14 days, oldest first, ending today', () => {
    const map = buildHeatmap({ today: TODAY, focusMinutes: new Map(), tasksDone: new Map() })
    expect(map.days).toHaveLength(14)
    expect(map.days[0]?.day).toBe('2026-09-16')
    expect(map.days[13]?.day).toBe(TODAY)
  })

  it('falls back to finished tasks while there is no focus time', () => {
    const map = buildHeatmap({
      today: TODAY,
      focusMinutes: new Map(),
      tasksDone: new Map([
        ['2026-09-28', 3],
        ['2026-09-20', 1],
      ]),
    })
    expect(map.basis).toBe('tasks')
    expect(map.days.find((d) => d.day === '2026-09-28')?.level).toBe(3)
    expect(map.days.find((d) => d.day === '2026-09-20')?.level).toBe(1)
    expect(map.days.find((d) => d.day === TODAY)?.level).toBe(0)
  })

  it('uses focus minutes as soon as any day has them, and ignores tasks then', () => {
    const map = buildHeatmap({
      today: TODAY,
      focusMinutes: new Map([[TODAY, 75]]),
      tasksDone: new Map([['2026-09-28', 5]]),
    })
    expect(map.basis).toBe('focus')
    expect(map.days.find((d) => d.day === TODAY)).toMatchObject({ minutes: 75, level: 3 })
    expect(map.days.find((d) => d.day === '2026-09-28')).toMatchObject({ tasks: 5, level: 0 })
  })

  it('honours a different length and rounds minutes', () => {
    const map = buildHeatmap({
      today: TODAY,
      length: 3,
      focusMinutes: new Map([[TODAY, 24.6]]),
      tasksDone: new Map(),
    })
    expect(map.days.map((d) => d.day)).toEqual(['2026-09-27', '2026-09-28', TODAY])
    expect(map.days[2]?.minutes).toBe(25)
  })
})

function goal(overrides: Partial<Goal> = {}): Pick<Goal, 'id' | 'title' | 'status' | 'targetDate'> {
  return {
    id: 'g1',
    title: 'B.S. Computer Science',
    status: 'active',
    targetDate: null,
    ...overrides,
  }
}

function course(
  overrides: Partial<Milestone> = {},
): Pick<Milestone, 'id' | 'goalId' | 'kind' | 'code' | 'title' | 'status' | 'dueDate'> {
  return {
    id: 'm1',
    goalId: 'g1',
    kind: 'course',
    code: 'C779',
    title: 'Web Development Foundations',
    status: 'active',
    dueDate: null,
    ...overrides,
  }
}

describe('upcomingTargets', () => {
  it('lists unfinished courses with a date, soonest first, with the days left', () => {
    const list = upcomingTargets(
      [],
      [
        course({ id: 'd278', code: 'D278', dueDate: '2026-11-13' }),
        course({ id: 'c779', code: 'C779', dueDate: '2026-10-11' }),
        course({ id: 'c182', code: 'C182', status: 'done', dueDate: '2026-09-20' }),
        course({ id: 'nodate', code: 'C172', dueDate: null }),
      ],
      TODAY,
    )
    expect(list.map((c) => [c.code, c.days])).toEqual([
      ['C779', 12],
      ['D278', 45],
    ])
  })

  it('includes active goals with a target date, after a course on the same day', () => {
    const list = upcomingTargets(
      [
        goal({ id: 'g1', targetDate: '2026-10-11' }),
        goal({ id: 'g2', title: 'Paused', status: 'paused', targetDate: '2026-10-01' }),
        goal({ id: 'g3', title: 'No date', targetDate: null }),
      ],
      [course({ id: 'c779', dueDate: '2026-10-11' })],
      TODAY,
    )
    expect(list.map((c) => [c.kind, c.id])).toEqual([
      ['course', 'c779'],
      ['goal', 'g1'],
    ])
  })

  it('keeps an unfinished course that is past its date, first, with negative days', () => {
    const list = upcomingTargets(
      [],
      [
        course({ id: 'late', code: 'C182', dueDate: '2026-09-26' }),
        course({ id: 'soon', code: 'C779', dueDate: '2026-10-01' }),
      ],
      TODAY,
    )
    expect(list.map((c) => c.days)).toEqual([-3, 2])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      course({ id: `m${i}`, dueDate: `2026-10-0${i + 1}` }),
    )
    expect(upcomingTargets([], many, TODAY, 2)).toHaveLength(2)
    expect(upcomingTargets([], many, TODAY, 0)).toHaveLength(0)
  })

  it('has nothing to show for a brand-new user', () => {
    expect(upcomingTargets([], [], TODAY)).toEqual([])
  })
})

describe('labels', () => {
  it('writes a countdown', () => {
    expect(countdownText(12)).toBe('12 days')
    expect(countdownText(1)).toBe('1 day')
    expect(countdownText(0)).toBe('Today')
    expect(countdownText(-1)).toBe('1 day overdue')
    expect(countdownText(-4)).toBe('4 days overdue')
  })

  it('says which day a carried-over row is from, never how late it is', () => {
    // 2026-09-29 is a Tuesday.
    expect(carriedFromText('2026-09-28', '2026-09-29')).toBe('from Mon')
    expect(carriedFromText('2026-09-26', '2026-09-29')).toBe('from Sat')
    expect(carriedFromText('2026-09-23', '2026-09-29')).toBe('from Wed')
    expect(carriedFromText('2026-09-20', '2026-09-29')).toBe('from Sep 20')
    expect(carriedFromText('2025-12-30', '2026-09-29')).toBe('from Dec 30, 2025')
    expect(carriedFromText('2026-09-28', '2026-09-29')).not.toMatch(/overdue|late|ago/)
  })
})

describe('estimateText', () => {
  it('prefers minutes, then pomodoros', () => {
    expect(estimateText({ estimateMinutes: 45, estimatePomodoros: 2 })).toBe('45 min')
    expect(estimateText({ estimateMinutes: 60, estimatePomodoros: null })).toBe('1 h')
    expect(estimateText({ estimateMinutes: 90, estimatePomodoros: null })).toBe('1 h 30 min')
    expect(estimateText({ estimateMinutes: null, estimatePomodoros: 1 })).toBe('1 pomodoro')
    expect(estimateText({ estimateMinutes: null, estimatePomodoros: 3 })).toBe('3 pomodoros')
  })

  it('has nothing to say without an estimate', () => {
    expect(estimateText({ estimateMinutes: null, estimatePomodoros: null })).toBeNull()
    expect(estimateText({ estimateMinutes: 0, estimatePomodoros: 0 })).toBeNull()
  })
})
