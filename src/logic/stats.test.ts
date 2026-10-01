import { describe, expect, it } from 'vitest'
import {
  countedMinutes,
  estimateAccuracy,
  focusMinutesByDay,
  focusMinutesMap,
  hourHistogram,
  isWithin20,
  minutesByCourse,
  minutesByGoal,
  peakHour,
  taskDoneDay,
  tasksCompletedByWeek,
  totalCountedMinutes,
  yearHeatmap,
  type NamedRef,
  type StatSession,
  type StatTask,
} from './stats'

// Tests run in America/New_York: DST starts 2026-03-08 (02:00 → 03:00) and ends 2026-11-01 (02:00 → 01:00).

/** Local instant. Month is 1-based here. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

let seq = 0
/** A counted focus session on `day` that starts at `hhmm` and lasts `minutes` (no pauses). */
function sess(day: string, minutes: number, extra: Partial<StatSession> = {}): StatSession {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number]
  const startedAt = extra.startedAt ?? at(y, mo, d, 9, 0)
  seq += 1
  return {
    id: `s${seq}`,
    kind: 'focus',
    status: 'completed',
    counted: true,
    day,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    actualMinutes: minutes,
    pausedMs: 0,
    taskId: null,
    goalId: null,
    milestoneId: null,
    ...extra,
  }
}

const task = (id: string, extra: Partial<StatTask> = {}): StatTask => ({
  id,
  status: 'done',
  completedAt: null,
  completedDay: null,
  estimatePomodoros: 2,
  ...extra,
})

const TODAY = '2026-09-29' // a Tuesday

describe('countedMinutes', () => {
  it('counts only finished, counted focus sessions', () => {
    expect(countedMinutes(sess(TODAY, 25))).toBe(25)
    expect(countedMinutes(sess(TODAY, 25, { kind: 'break' }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { status: 'running' }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { status: 'abandoned' }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { counted: false }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { actualMinutes: null }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { actualMinutes: -5 }))).toBe(0)
    expect(countedMinutes(sess(TODAY, 25, { actualMinutes: Number.NaN }))).toBe(0)
  })
})

describe('focusMinutesMap and focusMinutesByDay', () => {
  it('sums per day and ignores what does not count', () => {
    const rows = [
      sess('2026-09-28', 25),
      sess('2026-09-28', 50),
      sess('2026-09-29', 25, { counted: false }),
      sess('2026-09-29', 25, { kind: 'break' }),
    ]
    expect([...focusMinutesMap(rows)]).toEqual([['2026-09-28', 75]])
  })

  it('bounds by range, inclusive', () => {
    const rows = [sess('2026-09-01', 10), sess('2026-09-02', 20), sess('2026-09-03', 30)]
    expect([...focusMinutesMap(rows, { from: '2026-09-02', to: '2026-09-03' })]).toEqual([
      ['2026-09-02', 20],
      ['2026-09-03', 30],
    ])
  })

  it('returns exactly `days` entries, oldest first, ending today, zero-filled', () => {
    const rows = [sess('2026-09-29', 25), sess('2026-09-15', 50), sess('2026-08-01', 99)]
    const out = focusMinutesByDay(rows, TODAY, 30)
    expect(out).toHaveLength(30)
    expect(out[0]).toEqual({ day: '2026-08-31', minutes: 0 })
    expect(out[29]).toEqual({ day: TODAY, minutes: 25 })
    expect(out.find((d) => d.day === '2026-09-15')?.minutes).toBe(50)
    // The one from before the window is not in it.
    expect(out.reduce((sum, d) => sum + d.minutes, 0)).toBe(75)
  })

  it('files a session that runs past midnight under the day it started', () => {
    const late = sess('2026-09-28', 60, { startedAt: at(2026, 9, 28, 23, 30) })
    const out = focusMinutesByDay([late], TODAY, 3)
    expect(out).toEqual([
      { day: '2026-09-27', minutes: 0 },
      { day: '2026-09-28', minutes: 60 },
      { day: '2026-09-29', minutes: 0 },
    ])
  })

  it('has one entry per calendar day across the spring DST change', () => {
    const out = focusMinutesByDay([sess('2026-03-08', 30)], '2026-03-10', 5)
    expect(out.map((d) => d.day)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    expect(out[2]?.minutes).toBe(30)
  })

  it('has one entry per calendar day across the autumn DST change', () => {
    const out = focusMinutesByDay([sess('2026-11-01', 30)], '2026-11-03', 4)
    expect(out.map((d) => d.day)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
    expect(out[1]?.minutes).toBe(30)
  })

  it('shows at least one day for days < 1', () => {
    expect(focusMinutesByDay([], TODAY, 0)).toEqual([{ day: TODAY, minutes: 0 }])
  })

  it('rounds a day to whole minutes for display', () => {
    const rows = [sess(TODAY, 12.4), sess(TODAY, 12.4)]
    expect(focusMinutesByDay(rows, TODAY, 1)).toEqual([{ day: TODAY, minutes: 25 }])
  })
})

describe('totalCountedMinutes', () => {
  it('adds every counted minute and nothing else', () => {
    const rows = [sess(TODAY, 25), sess(TODAY, 30, { counted: false }), sess('2025-01-01', 50)]
    expect(totalCountedMinutes(rows)).toBe(75)
    expect(totalCountedMinutes([])).toBe(0)
  })
})

describe('taskDoneDay', () => {
  it('prefers completedDay, falls back to the day of completedAt, else null', () => {
    expect(taskDoneDay({ completedDay: '2026-09-01', completedAt: at(2026, 9, 2, 12) })).toBe(
      '2026-09-01',
    )
    expect(taskDoneDay({ completedDay: null, completedAt: at(2026, 9, 2, 23, 59) })).toBe(
      '2026-09-02',
    )
    expect(taskDoneDay({ completedDay: null, completedAt: null })).toBeNull()
  })
})

describe('tasksCompletedByWeek', () => {
  const done = (id: string, completedDay: string): StatTask => task(id, { completedDay })

  it('gives `weeks` zero-filled weeks ending with the current one', () => {
    const out = tasksCompletedByWeek([], TODAY, 12, 1)
    expect(out).toHaveLength(12)
    expect(out[11]?.weekStart).toBe('2026-09-28') // Monday
    expect(out[0]?.weekStart).toBe('2026-07-13')
    expect(out.every((w) => w.count === 0)).toBe(true)
  })

  it('counts finished tasks in their week and ignores open ones', () => {
    const rows = [
      done('a', '2026-09-29'),
      done('b', '2026-09-28'),
      done('c', '2026-09-27'), // Sunday: the week before, when weeks start Monday
      task('d', { status: 'todo', completedDay: '2026-09-29' }),
      done('old', '2025-01-01'),
    ]
    const out = tasksCompletedByWeek(rows, TODAY, 3, 1)
    expect(out.map((w) => [w.weekStart, w.count])).toEqual([
      ['2026-09-14', 0],
      ['2026-09-21', 1],
      ['2026-09-28', 2],
    ])
  })

  it('moves the boundary with weekStartsOn', () => {
    const rows = [done('c', '2026-09-27')] // Sunday
    const monday = tasksCompletedByWeek(rows, TODAY, 2, 1)
    const sunday = tasksCompletedByWeek(rows, TODAY, 2, 0)
    expect(monday.map((w) => w.count)).toEqual([1, 0])
    expect(sunday.map((w) => [w.weekStart, w.count])).toEqual([
      ['2026-09-20', 0],
      ['2026-09-27', 1],
    ])
  })

  it('files a task by the day of completedAt when completedDay is missing', () => {
    const rows = [task('a', { completedAt: at(2026, 9, 29, 8) })]
    expect(tasksCompletedByWeek(rows, TODAY, 1, 1)[0]?.count).toBe(1)
  })

  it('ignores a completion dated after today', () => {
    expect(tasksCompletedByWeek([done('f', '2026-09-30')], TODAY, 1, 1)[0]?.count).toBe(0)
  })

  it('keeps week starts one week apart across the autumn DST change', () => {
    const out = tasksCompletedByWeek([done('a', '2026-11-01')], '2026-11-10', 3, 0)
    expect(out.map((w) => w.weekStart)).toEqual(['2026-10-25', '2026-11-01', '2026-11-08'])
    expect(out[1]?.count).toBe(1)
  })
})

describe('minutesByGoal and minutesByCourse', () => {
  const goals: NamedRef[] = [
    { id: 'g-wgu', title: 'WGU B.S. Computer Science', color: 'blue' },
    { id: 'g-aws', title: 'AWS Cloud Practitioner', color: 'orange' },
  ]
  const range = { from: '2026-09-01', to: TODAY }

  it('sums per goal, most time first, with Other last', () => {
    const rows = [
      sess('2026-09-10', 25, { goalId: 'g-aws' }),
      sess('2026-09-11', 50, { goalId: 'g-wgu' }),
      sess('2026-09-12', 25, { goalId: 'g-wgu' }),
      sess('2026-09-13', 200), // no goal
    ]
    expect(minutesByGoal(rows, goals, range)).toEqual([
      { id: 'g-wgu', title: 'WGU B.S. Computer Science', color: 'blue', minutes: 75 },
      { id: 'g-aws', title: 'AWS Cloud Practitioner', color: 'orange', minutes: 25 },
      { id: null, title: 'Other', color: 'gray', minutes: 200 },
    ])
  })

  it('folds a deleted goal into Other', () => {
    const rows = [sess('2026-09-10', 30, { goalId: 'gone' }), sess('2026-09-11', 20)]
    expect(minutesByGoal(rows, goals, range)).toEqual([
      { id: null, title: 'Other', color: 'gray', minutes: 50 },
    ])
  })

  it('leaves out uncounted sessions, breaks and other dates', () => {
    const rows = [
      sess('2026-09-10', 25, { goalId: 'g-wgu', counted: false }),
      sess('2026-09-10', 25, { goalId: 'g-wgu', kind: 'break' }),
      sess('2026-08-31', 25, { goalId: 'g-wgu' }),
      sess('2026-09-30', 25, { goalId: 'g-wgu' }),
      sess(TODAY, 25, { goalId: 'g-wgu' }),
    ]
    expect(minutesByGoal(rows, goals, range).map((r) => r.minutes)).toEqual([25])
  })

  it('breaks ties by title so the order never flickers', () => {
    const rows = [
      sess('2026-09-10', 25, { goalId: 'g-wgu' }),
      sess('2026-09-10', 25, { goalId: 'g-aws' }),
    ]
    expect(minutesByGoal(rows, goals, range).map((r) => r.id)).toEqual(['g-aws', 'g-wgu'])
  })

  it('reads the course from milestoneId', () => {
    const courses: NamedRef[] = [
      { id: 'c182', title: 'C182 Introduction to IT', color: 'gray' },
      { id: 'c779', title: 'C779 Web Development Foundations', color: 'blue' },
    ]
    const rows = [
      sess('2026-09-10', 45, { milestoneId: 'c779', goalId: 'g-wgu' }),
      sess('2026-09-11', 25, { milestoneId: 'c182' }),
      sess('2026-09-12', 25, { milestoneId: 'c779' }),
      sess('2026-09-13', 10, { goalId: 'g-wgu' }),
    ]
    const out = minutesByCourse(rows, courses, range)
    expect(out.map((r) => [r.id, r.minutes])).toEqual([
      ['c779', 70],
      ['c182', 25],
      [null, 10],
    ])
  })

  it('returns nothing when nothing counts', () => {
    expect(minutesByGoal([], goals, range)).toEqual([])
  })
})

describe('hourHistogram', () => {
  const range = { from: '2026-01-01', to: '2026-12-31' }
  const total = (h: number[]): number => h.reduce((a, b) => a + b, 0)

  it('has 24 hours and puts a session inside one hour in that hour', () => {
    const h = hourHistogram([sess(TODAY, 25, { startedAt: at(2026, 9, 29, 9, 5) })], range)
    expect(h).toHaveLength(24)
    expect(h[9]).toBe(25)
    expect(total(h)).toBe(25)
  })

  it('splits a session that crosses one hour boundary', () => {
    const h = hourHistogram([sess(TODAY, 30, { startedAt: at(2026, 9, 29, 9, 45) })], range)
    expect(h[9]).toBe(15)
    expect(h[10]).toBe(15)
  })

  it('spreads a session longer than two hours over every hour it touched', () => {
    // 9:30 to 12:30: 30 + 60 + 60 + 30.
    const h = hourHistogram([sess(TODAY, 180, { startedAt: at(2026, 9, 29, 9, 30) })], range)
    expect(h.slice(8, 14)).toEqual([0, 30, 60, 60, 30, 0])
    expect(total(h)).toBe(180)
  })

  it('wraps past midnight into the early hours', () => {
    const h = hourHistogram([sess(TODAY, 90, { startedAt: at(2026, 9, 29, 23, 30) })], range)
    expect(h[23]).toBe(30)
    expect(h[0]).toBe(60)
    expect(total(h)).toBe(90)
  })

  it('always adds up to the counted minutes, also with pauses', () => {
    // 60 minutes on the wall clock, 30 of them paused: 30 active minutes spread over the hour and a half.
    const startedAt = at(2026, 9, 29, 9, 30)
    const s = sess(TODAY, 30, {
      startedAt,
      endedAt: startedAt + 60 * 60_000,
      pausedMs: 30 * 60_000,
    })
    const h = hourHistogram([s], range)
    expect(h[9]).toBeCloseTo(15, 6)
    expect(h[10]).toBeCloseTo(15, 6)
    expect(total(h)).toBeCloseTo(30, 6)
  })

  it('spreads a capped stopwatch over the time it counted, not the whole night', () => {
    // Left running from 22:00 to 08:00; counted minutes are capped at 4 hours.
    const startedAt = at(2026, 9, 29, 22, 0)
    const s = sess(TODAY, 240, { startedAt, endedAt: startedAt + 10 * 3_600_000 })
    const h = hourHistogram([s], range)
    expect(h[22]).toBeCloseTo(60, 6)
    expect(h[23]).toBeCloseTo(60, 6)
    expect(h[0]).toBeCloseTo(60, 6)
    expect(h[1]).toBeCloseTo(60, 6)
    expect(h[2]).toBe(0)
    expect(total(h)).toBeCloseTo(240, 6)
  })

  it('puts all minutes in the start hour when the row has no length', () => {
    const startedAt = at(2026, 9, 29, 14, 20)
    const h = hourHistogram([sess(TODAY, 20, { startedAt, endedAt: startedAt })], range)
    expect(h[14]).toBe(20)
  })

  it('handles a missing end time', () => {
    const h = hourHistogram(
      [sess(TODAY, 30, { startedAt: at(2026, 9, 29, 9, 45), endedAt: null })],
      range,
    )
    expect(h[9]).toBe(15)
    expect(h[10]).toBe(15)
  })

  it('ignores uncounted sessions, breaks and days outside the range', () => {
    const rows = [
      sess(TODAY, 25, { counted: false }),
      sess(TODAY, 25, { kind: 'break' }),
      sess('2025-12-31', 25),
      sess('2027-01-01', 25),
    ]
    expect(total(hourHistogram(rows, range))).toBe(0)
  })

  it('counts an early-morning session in the early-morning hour', () => {
    const h = hourHistogram([sess(TODAY, 25, { startedAt: at(2026, 9, 29, 7, 30) })], range)
    expect(h[7]).toBe(25)
  })

  it('does not double the missing spring hour: 1:30 to 3:30 wall clock is one hour of study', () => {
    // 01:30 EST + 60 min = 03:30 EDT on 2026-03-08. Hour 2 does not exist that night.
    const s = sess('2026-03-08', 60, { startedAt: at(2026, 3, 8, 1, 30) })
    const h = hourHistogram([s], range)
    expect(h[1]).toBe(30)
    expect(h[2]).toBe(0)
    expect(h[3]).toBe(30)
  })

  it('counts the repeated autumn hour twice into the same bucket', () => {
    // 01:30 EDT + 60 min = 01:30 EST on 2026-11-01: both halves are "1 a.m.".
    const s = sess('2026-11-01', 60, { startedAt: at(2026, 11, 1, 1, 30) })
    const h = hourHistogram([s], range)
    expect(h[1]).toBe(60)
    expect(h[2]).toBe(0)
    expect(total(h)).toBe(60)
  })

  it('splits correctly on the ordinary hours of a DST day', () => {
    const s = sess('2026-11-01', 50, { startedAt: at(2026, 11, 1, 9, 40) })
    const h = hourHistogram([s], range)
    expect(h[9]).toBe(20)
    expect(h[10]).toBe(30)
  })

  it('is empty for no sessions', () => {
    expect(hourHistogram([], range)).toEqual(new Array<number>(24).fill(0))
  })
})

describe('peakHour', () => {
  it('finds the busiest hour, the earliest on a tie', () => {
    const h = new Array<number>(24).fill(0)
    h[9] = 60
    h[20] = 60
    h[14] = 30
    expect(peakHour(h)).toBe(9)
  })

  it('is null when there is no time', () => {
    expect(peakHour(new Array<number>(24).fill(0))).toBeNull()
    expect(peakHour([])).toBeNull()
  })
})

describe('estimateAccuracy', () => {
  it('rounds actual pomodoros to the nearest half', () => {
    const tasks = [task('a'), task('b'), task('c'), task('d')]
    const sessions = [
      sess(TODAY, 50, { taskId: 'a' }), // 2.0
      sess(TODAY, 37, { taskId: 'b' }), // 1.48 → 1.5
      sess(TODAY, 40, { taskId: 'c' }), // 1.6 → 1.5
      sess(TODAY, 44, { taskId: 'd' }), // 1.76 → 2
    ]
    expect(estimateAccuracy(tasks, sessions).points.map((p) => p.actual)).toEqual([2, 1.5, 1.5, 2])
  })

  it('never shows 0 once time is logged', () => {
    const r = estimateAccuracy([task('a')], [sess(TODAY, 5, { taskId: 'a' })])
    expect(r.points[0]?.actual).toBe(0.5)
  })

  it('adds up every counted session on a task', () => {
    const r = estimateAccuracy(
      [task('a', { estimatePomodoros: 3 })],
      [
        sess(TODAY, 25, { taskId: 'a' }),
        sess(TODAY, 25, { taskId: 'a' }),
        sess(TODAY, 25, { taskId: 'a' }),
      ],
    )
    expect(r.points).toEqual([{ taskId: 'a', planned: 3, actual: 3 }])
  })

  it('skips tasks with no estimate, no logged time, or not done', () => {
    const tasks = [
      task('noEstimate', { estimatePomodoros: null }),
      task('zero', { estimatePomodoros: 0 }),
      task('noTime'),
      task('open', { status: 'todo' }),
      task('ok'),
    ]
    const sessions = [
      sess(TODAY, 25, { taskId: 'noEstimate' }),
      sess(TODAY, 25, { taskId: 'zero' }),
      sess(TODAY, 25, { taskId: 'open' }),
      sess(TODAY, 25, { taskId: 'ok' }),
      sess(TODAY, 25, { taskId: 'ok', counted: false }), // does not add
    ]
    const r = estimateAccuracy(tasks, sessions)
    expect(r.points).toEqual([{ taskId: 'ok', planned: 2, actual: 1 }])
  })

  it('measures the share within ±20 % (the edge is inside)', () => {
    expect(isWithin20(2, 2)).toBe(true)
    expect(isWithin20(5, 6)).toBe(true) // exactly +20 %
    expect(isWithin20(5, 4)).toBe(true) // exactly −20 %
    expect(isWithin20(2, 2.5)).toBe(false)
    expect(isWithin20(2, 1.5)).toBe(false)
    expect(isWithin20(1, 1)).toBe(true)
    expect(isWithin20(1, 1.5)).toBe(false)

    const tasks = [
      task('a', { estimatePomodoros: 2 }),
      task('b', { estimatePomodoros: 2 }),
      task('c', { estimatePomodoros: 5 }),
      task('d', { estimatePomodoros: 1 }),
    ]
    const sessions = [
      sess(TODAY, 50, { taskId: 'a' }), // 2 → within
      sess(TODAY, 75, { taskId: 'b' }), // 3 → not
      sess(TODAY, 150, { taskId: 'c' }), // 6 → within (+20 %)
      sess(TODAY, 25, { taskId: 'd' }), // 1 → within
    ]
    const r = estimateAccuracy(tasks, sessions)
    expect(r.within).toBe(3)
    expect(r.share).toBe(0.75)
    expect(r.meanRatio).toBeCloseTo((1 + 1.5 + 1.2 + 1) / 4, 3)
  })

  it('is empty and null-valued with nothing to compare', () => {
    expect(estimateAccuracy([], [])).toEqual({
      points: [],
      within: 0,
      share: null,
      meanRatio: null,
    })
  })

  it('lists points in the order the tasks were finished', () => {
    const tasks = [
      task('late', { completedAt: 200 }),
      task('early', { completedAt: 100 }),
      task('tie-b', { completedAt: 300 }),
      task('tie-a', { completedAt: 300 }),
    ]
    const sessions = tasks.map((t) => sess(TODAY, 25, { taskId: t.id }))
    expect(estimateAccuracy(tasks, sessions).points.map((p) => p.taskId)).toEqual([
      'early',
      'late',
      'tie-a',
      'tie-b',
    ])
  })
})

describe('yearHeatmap', () => {
  const none = new Set<string>()
  const map = (entries: Record<string, number>): Map<string, number> =>
    new Map(Object.entries(entries))

  it('is 53 whole weeks ending with the week that holds today', () => {
    const h = yearHeatmap(map({}), none, TODAY, 1)
    expect(h.weeks).toHaveLength(53)
    expect(h.weeks.every((w) => w.cells.length === 7)).toBe(true)
    expect(h.weeks[52]?.weekStart).toBe('2026-09-28')
    expect(h.weeks[0]?.weekStart).toBe('2025-09-29')
    expect(h.from).toBe('2025-09-29')
    expect(h.to).toBe('2026-10-04')
    // Today is the second cell of a Monday-first week.
    expect(h.weeks[52]?.cells[1]?.day).toBe(TODAY)
  })

  it('lays the first column out per weekStartsOn', () => {
    const sun = yearHeatmap(map({}), none, TODAY, 0)
    expect(sun.weeks[52]?.weekStart).toBe('2026-09-27')
    expect(sun.weeks[52]?.cells[2]?.day).toBe(TODAY)
  })

  it('marks the rest of this week as future and gives it no level', () => {
    const h = yearHeatmap(map({ [TODAY]: 25 }), none, TODAY, 1)
    const last = h.weeks[52]?.cells ?? []
    expect(last.map((c) => c.future)).toEqual([false, false, true, true, true, true, true])
    expect(last[0]?.level).toBe(0)
    expect(last[1]?.level).toBe(4)
    expect(last.slice(2).every((c) => c.level === 0 && c.minutes === 0)).toBe(true)
  })

  it('cells are consecutive calendar days across both DST changes', () => {
    const days = yearHeatmap(map({}), none, '2026-11-10', 0).weeks.flatMap((w) =>
      w.cells.map((c) => c.day),
    )
    expect(new Set(days).size).toBe(53 * 7)
    for (let i = 1; i < days.length; i++) expect((days[i] ?? '') > (days[i - 1] ?? '')).toBe(true)
    expect(days).toContain('2026-03-08')
    expect(days).toContain('2026-11-01')
  })

  it('splits days with focus into quartiles by rank', () => {
    const minutes = Object.fromEntries(
      [10, 20, 30, 40, 50, 60, 70, 80].map((m, i) => [
        `2026-09-${String(i + 1).padStart(2, '0')}`,
        m,
      ]),
    )
    const cells = yearHeatmap(map(minutes), none, TODAY, 1).weeks.flatMap((w) => w.cells)
    const level = (day: string): number | undefined => cells.find((c) => c.day === day)?.level
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => level(`2026-09-0${d}`))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
    ])
    expect(level('2026-09-09')).toBe(0)
  })

  it('computes quartiles over the range shown, not over all history', () => {
    // A huge day two years ago must not flatten the year on screen.
    const withOld = yearHeatmap(
      map({ '2024-01-01': 900, '2026-09-01': 20, '2026-09-02': 40 }),
      none,
      TODAY,
      1,
    )
    const without = yearHeatmap(map({ '2026-09-01': 20, '2026-09-02': 40 }), none, TODAY, 1)
    expect(withOld.max).toBe(40)
    expect(withOld.activeDays).toBe(2)
    expect(withOld.weeks).toEqual(without.weeks)
    const cells = withOld.weeks.flatMap((w) => w.cells)
    expect(cells.find((c) => c.day === '2026-09-01')?.level).toBe(2)
    expect(cells.find((c) => c.day === '2026-09-02')?.level).toBe(4)
  })

  it('gives equal days the same level, and one active day the top level', () => {
    const same = yearHeatmap(
      map({ '2026-09-01': 25, '2026-09-02': 25, '2026-09-03': 25 }),
      none,
      TODAY,
      1,
    )
    const levels = same.weeks
      .flatMap((w) => w.cells)
      .filter((c) => c.minutes > 0)
      .map((c) => c.level)
    expect(levels).toEqual([4, 4, 4])
    const one = yearHeatmap(map({ '2026-09-01': 5 }), none, TODAY, 1)
    expect(one.weeks.flatMap((w) => w.cells).find((c) => c.minutes > 0)?.level).toBe(4)
  })

  it('ranks by the exact minutes, not the rounded ones', () => {
    const h = yearHeatmap(map({ '2026-09-01': 25.4, '2026-09-02': 24.6 }), none, TODAY, 1)
    const cells = h.weeks.flatMap((w) => w.cells)
    expect(cells.find((c) => c.day === '2026-09-01')?.level).toBe(4)
    expect(cells.find((c) => c.day === '2026-09-02')?.level).toBe(2)
  })

  it('is all zeros with no data', () => {
    const h = yearHeatmap(map({}), none, TODAY, 1)
    expect(h.max).toBe(0)
    expect(h.totalMinutes).toBe(0)
    expect(h.activeDays).toBe(0)
    expect(h.weeks.every((w) => w.cells.every((c) => c.level === 0 && !c.frozen))).toBe(true)
  })

  it('totals only the days shown', () => {
    const h = yearHeatmap(
      map({ '2026-09-01': 30, '2026-09-02': 45, '2020-01-01': 500, '2026-10-02': 100 }),
      none,
      TODAY,
      1,
    )
    expect(h.totalMinutes).toBe(75)
    expect(h.activeDays).toBe(2)
  })

  it('marks frozen days, but never a future one', () => {
    const h = yearHeatmap(map({}), new Set(['2026-09-13', '2026-10-01']), TODAY, 1)
    const cells = h.weeks.flatMap((w) => w.cells)
    expect(cells.find((c) => c.day === '2026-09-13')?.frozen).toBe(true)
    expect(cells.find((c) => c.day === '2026-10-01')?.frozen).toBe(false)
    expect(cells.filter((c) => c.frozen)).toHaveLength(1)
  })

  it('takes a different number of weeks', () => {
    const h = yearHeatmap(map({}), none, TODAY, 1, 26)
    expect(h.weeks).toHaveLength(26)
    expect(h.weeks[0]?.weekStart).toBe('2026-04-06')
  })
})
