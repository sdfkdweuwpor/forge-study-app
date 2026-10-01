import { describe, expect, it } from 'vitest'
import type { ISODate, Session, StreakDay } from '@/db/types'
import {
  buildStreakDays,
  hasCurrentShape,
  sameDayValues,
  summarizeDay,
  type DaySettings,
  type StreakDayValues,
} from './streakDays'

type SessionRow = Pick<Session, 'kind' | 'mode' | 'status' | 'counted' | 'actualMinutes' | 'day'>

const TODAY = '2026-09-29'

function session(day: ISODate, over: Partial<SessionRow> = {}): SessionRow {
  return {
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    counted: true,
    actualMinutes: 25,
    day,
    ...over,
  }
}

const settings = (over: Partial<DaySettings> = {}): DaySettings => ({
  today: TODAY,
  pomodoroMin: 25,
  dailyGoalPomodoros: 3,
  existing: new Map(),
  ...over,
})

describe('summarizeDay', () => {
  it('counts only completed, counted focus sessions', () => {
    const row = summarizeDay(
      '2026-09-28',
      {
        sessions: [
          session('2026-09-28'),
          session('2026-09-28', { actualMinutes: 30 }),
          session('2026-09-28', { counted: false }),
          session('2026-09-28', { status: 'abandoned' }),
          session('2026-09-28', { kind: 'break' }),
        ],
        tasksDone: 2,
        xp: 80,
      },
      settings(),
    )
    expect(row).toEqual({
      day: '2026-09-28',
      focusMinutes: 55,
      focusSessions: 2,
      pomodoros: 2,
      tasksDone: 2,
      dailyGoalTarget: 3,
      dailyGoalHit: false,
      qualified: true,
      xp: 80,
    })
  })

  it('qualifies by the daily goal too, and a goal of 0 still needs one pomodoro', () => {
    const hit = summarizeDay(
      '2026-09-28',
      { sessions: [session('2026-09-28')], tasksDone: 0, xp: 0 },
      settings({ dailyGoalPomodoros: 0 }),
    )
    expect(hit).toMatchObject({ dailyGoalTarget: 1, dailyGoalHit: true, qualified: true })
  })

  it('does not qualify on finished tasks alone', () => {
    const row = summarizeDay('2026-09-28', { sessions: [], tasksDone: 4, xp: 60 }, settings())
    expect(row).toMatchObject({ focusSessions: 0, qualified: false, tasksDone: 4 })
  })

  it('has no row for a day where nothing happened', () => {
    expect(summarizeDay('2026-09-28', { sessions: [], tasksDone: 0, xp: 0 }, settings())).toBeNull()
    expect(
      summarizeDay(
        '2026-09-28',
        { sessions: [session('2026-09-28', { counted: false })], tasksDone: 0, xp: 0 },
        settings(),
      ),
    ).toBeNull()
  })

  it('turns a custom session into whole pomodoros for the goal', () => {
    const row = summarizeDay(
      '2026-09-28',
      {
        sessions: [session('2026-09-28', { mode: 'custom', actualMinutes: 80 })],
        tasksDone: 0,
        xp: 0,
      },
      settings({ dailyGoalPomodoros: 3 }),
    )
    expect(row).toMatchObject({ focusMinutes: 80, pomodoros: 3, dailyGoalHit: true })
  })

  it('keeps the target a past day was stored with, while today follows the setting', () => {
    const existing = new Map([
      ['2026-09-28', { dailyGoalTarget: 6 }],
      [TODAY, { dailyGoalTarget: 6 }],
    ])
    const sessions = [session('2026-09-28'), session('2026-09-28'), session('2026-09-28')]
    const past = summarizeDay(
      '2026-09-28',
      { sessions, tasksDone: 0, xp: 0 },
      settings({ existing }),
    )
    expect(past).toMatchObject({ dailyGoalTarget: 6, pomodoros: 3, dailyGoalHit: false })

    const todays = [session(TODAY), session(TODAY), session(TODAY)]
    const now = summarizeDay(
      TODAY,
      { sessions: todays, tasksDone: 0, xp: 0 },
      settings({ existing }),
    )
    expect(now).toMatchObject({ dailyGoalTarget: 3, dailyGoalHit: true })
  })
})

describe('buildStreakDays', () => {
  it('groups every source by day in one pass and skips days outside the range', () => {
    const rows = buildStreakDays(
      '2026-09-27',
      '2026-09-29',
      {
        sessions: [session('2026-09-26'), session('2026-09-27'), session('2026-09-29')],
        tasks: [
          { status: 'done', completedDay: '2026-09-27' },
          { status: 'done', completedDay: '2026-09-28' },
          { status: 'todo', completedDay: null },
          { status: 'done', completedDay: null },
        ],
        xpEvents: [
          { day: '2026-09-28', amount: 15 },
          { day: '2026-09-28', amount: -15 },
          { day: '2026-09-28', amount: 20 },
          { day: '2026-10-05', amount: 999 },
        ],
      },
      settings(),
    )
    expect([...rows.keys()].sort()).toEqual(['2026-09-27', '2026-09-28', '2026-09-29'])
    expect(rows.get('2026-09-27')).toMatchObject({
      focusSessions: 1,
      tasksDone: 1,
      qualified: true,
    })
    expect(rows.get('2026-09-28')).toMatchObject({
      focusSessions: 0,
      tasksDone: 1,
      xp: 20,
      qualified: false,
    })
    expect(rows.get('2026-09-29')).toMatchObject({ focusSessions: 1, qualified: true })
  })

  it('handles thousands of rows quickly', () => {
    const sessions: SessionRow[] = []
    for (let i = 0; i < 5000; i++) {
      const day = `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`
      sessions.push(session(day))
    }
    const t0 = performance.now()
    const rows = buildStreakDays(
      '2026-01-01',
      '2026-12-31',
      { sessions, tasks: [], xpEvents: [] },
      settings(),
    )
    expect(performance.now() - t0).toBeLessThan(200)
    expect(rows.size).toBeGreaterThan(0)
  })
})

describe('sameDayValues and hasCurrentShape', () => {
  const values: StreakDayValues = {
    day: '2026-09-28',
    focusMinutes: 25,
    focusSessions: 1,
    pomodoros: 1,
    tasksDone: 0,
    dailyGoalTarget: 3,
    dailyGoalHit: false,
    qualified: true,
    xp: 25,
  }

  it('compares every field but the bookkeeping', () => {
    expect(sameDayValues(values, { ...values })).toBe(true)
    expect(sameDayValues(values, { ...values, xp: 26 })).toBe(false)
    expect(sameDayValues(values, { ...values, qualified: false })).toBe(false)
  })

  it('spots a row from an older shape', () => {
    const row: StreakDay = { ...values, id: values.day, createdAt: 1, updatedAt: 1 }
    expect(hasCurrentShape(row)).toBe(true)
    expect(hasCurrentShape({ id: row.id, day: row.day, qualified: true })).toBe(false)
    expect(hasCurrentShape({ ...row, id: 'other' })).toBe(false)
  })
})
