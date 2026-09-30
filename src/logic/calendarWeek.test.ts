// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import {
  calendarOrderIds,
  countOnDays,
  dropTime,
  durationOf,
  hourMarks,
  minutesOfDay,
  nowOffset,
  nudgeSlot,
  placeTimed,
  shiftAnchor,
  snapMinutes,
  tasksByDay,
  timeRangeFor,
  visibleDays,
  windowLabel,
} from './calendarWeek'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
    title: `Task ${seq}`,
    notes: [],
    status: 'todo',
    priority: 0,
    doDate: '2026-09-29',
    doTime: null,
    estimatePomodoros: null,
    estimateMinutes: null,
    tags: [],
    goalId: null,
    milestoneId: null,
    unitId: null,
    source: 'user',
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    orderInDay: 0,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order: seq,
    boardOrder: seq,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    durationMinutes: null,
    autoSlot: false,
    kind: 'task',
    assessmentId: null,
    sync: null,
    dueDate: null,
    dueTime: null,
    ...overrides,
  }
}

describe('visibleDays', () => {
  it('shows the whole week around the anchor, from the configured week start', () => {
    // 2026-09-29 is a Tuesday.
    expect(visibleDays('2026-09-29', 7, 1)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(visibleDays('2026-09-29', 7, 0)[0]).toBe('2026-09-27')
    expect(visibleDays('2026-09-27', 7, 1)[0]).toBe('2026-09-21')
  })

  it('shows a few days from the anchor on a phone', () => {
    expect(visibleDays('2026-09-29', 3, 1)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
  })

  it('moves by a window: a week, or as many days as are shown', () => {
    expect(shiftAnchor('2026-09-29', 7, 1)).toBe('2026-10-06')
    expect(shiftAnchor('2026-09-29', 7, -1)).toBe('2026-09-22')
    expect(shiftAnchor('2026-09-29', 3, 1)).toBe('2026-10-02')
    expect(shiftAnchor('2026-10-31', 7, 1)).toBe('2026-11-07') // across the DST change
  })

  it('labels a window', () => {
    expect(windowLabel(visibleDays('2026-09-29', 7, 1))).toBe('Sep 28 – Oct 4, 2026')
    expect(windowLabel(visibleDays('2026-09-22', 7, 1))).toBe('Sep 21 – 27, 2026')
    expect(windowLabel(['2026-12-30', '2026-12-31', '2027-01-01'])).toBe(
      'Dec 30, 2026 – Jan 1, 2027',
    )
    expect(windowLabel(['2026-09-29'])).toBe('Tue, Sep 29, 2026')
    expect(windowLabel([])).toBe('')
  })
})

describe('durationOf', () => {
  it('uses minutes, else pomodoros × 25, else the 25-minute minimum', () => {
    expect(durationOf({ estimateMinutes: 45, estimatePomodoros: 2 })).toBe(45)
    expect(durationOf({ estimateMinutes: null, estimatePomodoros: 3 })).toBe(75)
    expect(durationOf({ estimateMinutes: null, estimatePomodoros: null })).toBe(25)
    expect(durationOf({ estimateMinutes: 10, estimatePomodoros: null })).toBe(25)
    expect(durationOf({ estimateMinutes: 0, estimatePomodoros: 0 })).toBe(25)
  })
})

describe('timeRangeFor', () => {
  it('is 07:00–23:00 by default', () => {
    expect(timeRangeFor([task(), task({ doTime: '09:00' })])).toEqual({ start: 420, end: 1380 })
  })

  it('widens to whole hours around tasks outside the default hours', () => {
    expect(timeRangeFor([task({ doTime: '06:30' })]).start).toBe(360)
    expect(timeRangeFor([task({ doTime: '22:30', estimateMinutes: 90 })]).end).toBe(1440)
    expect(timeRangeFor([task({ doTime: '23:10', estimateMinutes: 25 })]).end).toBe(1440)
  })

  it('lists hour marks', () => {
    expect(hourMarks({ start: 420, end: 600 })).toEqual([420, 480, 540])
  })
})

describe('placeTimed', () => {
  it('places non-overlapping tasks full width', () => {
    const a = task({ doTime: '09:00', estimateMinutes: 30 })
    const b = task({ doTime: '10:00', estimateMinutes: 30 })
    const placed = placeTimed([b, a])
    expect(placed.map((p) => [p.task.id, p.start, p.end, p.lane, p.lanes])).toEqual([
      [a.id, 540, 570, 0, 1],
      [b.id, 600, 630, 0, 1],
    ])
  })

  it('splits the width between tasks that overlap', () => {
    const a = task({ doTime: '09:00', estimateMinutes: 60 })
    const b = task({ doTime: '09:30', estimateMinutes: 60 })
    const c = task({ doTime: '10:00', estimateMinutes: 30 })
    const placed = placeTimed([a, b, c])
    const by = (t: Task) => placed.find((p) => p.task.id === t.id)
    expect([by(a)?.lane, by(a)?.lanes]).toEqual([0, 2])
    expect([by(b)?.lane, by(b)?.lanes]).toEqual([1, 2])
    // c starts as a ends, so it reuses lane 0 inside the same cluster.
    expect([by(c)?.lane, by(c)?.lanes]).toEqual([0, 2])
  })

  it('gives a task the minimum height when its estimate is short or missing', () => {
    const a = task({ doTime: '09:00' })
    const b = task({ doTime: '09:20' })
    const placed = placeTimed([a, b])
    expect(placed[0]?.end).toBe(540 + 25)
    // b starts before a's 25 minutes are up, so they share the row.
    expect(placed.map((p) => p.lanes)).toEqual([2, 2])
  })

  it('starts a new cluster once everything before it has ended', () => {
    const a = task({ doTime: '09:00', estimateMinutes: 60 })
    const b = task({ doTime: '09:30', estimateMinutes: 60 })
    const c = task({ doTime: '11:00', estimateMinutes: 30 })
    const placed = placeTimed([a, b, c])
    expect(placed.find((p) => p.task.id === c.id)?.lanes).toBe(1)
  })

  it('skips tasks without a usable time', () => {
    expect(placeTimed([task(), task({ doTime: '25:99' as never })])).toEqual([])
  })
})

describe('tasksByDay / calendarOrderIds', () => {
  const days = visibleDays('2026-09-29', 7, 1)
  const allDay = task({ doDate: '2026-09-29' })
  const timed = task({ doDate: '2026-09-29', doTime: '14:00' })
  const other = task({ doDate: '2026-09-30', doTime: '08:00' })
  const away = task({ doDate: '2026-10-20', doTime: '08:00' })
  const undated = task({ doDate: null })

  it('files tasks under their day and separates the all-day strip', () => {
    const grid = tasksByDay([allDay, timed, other, away, undated], days)
    expect(grid).toHaveLength(7)
    const tue = grid.find((d) => d.day === '2026-09-29')
    expect(tue?.allDay.map((t) => t.id)).toEqual([allDay.id])
    expect(tue?.timed.map((p) => p.task.id)).toEqual([timed.id])
    expect(grid.find((d) => d.day === '2026-09-30')?.timed).toHaveLength(1)
  })

  it('orders ids the way the screen reads and counts what is on screen', () => {
    expect(calendarOrderIds([other, timed, allDay, away], days)).toEqual([
      allDay.id,
      timed.id,
      other.id,
    ])
    expect(countOnDays([allDay, timed, other, away, undated], days)).toBe(3)
  })
})

describe('dropTime', () => {
  const range = { start: 420, end: 1380 }
  const pxPerMinute = 64 / 60

  it('turns a height into a snapped time', () => {
    expect(dropTime(0, pxPerMinute, range)).toBe('07:00')
    expect(dropTime(64, pxPerMinute, range)).toBe('08:00')
    expect(dropTime(64 * 2 + 20, pxPerMinute, range)).toBe('09:15') // 78 min → nearest quarter is 75
    expect(dropTime(64 * 7.5, pxPerMinute, range)).toBe('14:30')
  })

  it('keeps the drop inside the grid', () => {
    expect(dropTime(-200, pxPerMinute, range)).toBe('07:00')
    expect(dropTime(64 * 20, pxPerMinute, range)).toBe('22:45')
  })

  it('snaps to quarters', () => {
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
  })
})

describe('now line', () => {
  it('sits inside the grid only', () => {
    const range = { start: 420, end: 1380 }
    expect(nowOffset(570, range)).toBe(150)
    expect(nowOffset(400, range)).toBeNull()
    expect(nowOffset(1400, range)).toBeNull()
  })

  it('reads local minutes of a moment', () => {
    // 2026-09-29 09:30 in New York.
    expect(minutesOfDay(new Date(2026, 8, 29, 9, 30).getTime())).toBe(570)
  })
})

describe('nudgeSlot', () => {
  it('moves whole days, keeping the time', () => {
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '14:00', dueDate: null }, { days: 1 }),
    ).toEqual({
      doDate: '2026-09-30',
      doTime: '14:00',
    })
    expect(nudgeSlot({ doDate: '2026-09-29', doTime: null, dueDate: null }, { days: -1 })).toEqual({
      doDate: '2026-09-28',
      doTime: null,
    })
    expect(
      nudgeSlot({ doDate: '2026-10-31', doTime: null, dueDate: null }, { days: 1 })?.doDate,
    ).toBe('2026-11-01')
  })

  it('moves a quarter hour, landing on quarter hours', () => {
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '14:00', dueDate: null }, { minutes: 15 })?.doTime,
    ).toBe('14:15')
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '14:00', dueDate: null }, { minutes: -15 })?.doTime,
    ).toBe('13:45')
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '14:10', dueDate: null }, { minutes: 15 })?.doTime,
    ).toBe('14:15')
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '14:10', dueDate: null }, { minutes: -15 })?.doTime,
    ).toBe('14:00')
  })

  it('gives an untimed task 09:00 when nudged later, and leaves it when nudged earlier', () => {
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: null, dueDate: null }, { minutes: 15 }),
    ).toEqual({
      doDate: '2026-09-29',
      doTime: '09:00',
    })
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: null, dueDate: null }, { minutes: -15 }),
    ).toBeNull()
  })

  it('stays inside the day', () => {
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '23:45', dueDate: null }, { minutes: 15 }),
    ).toBeNull()
    expect(
      nudgeSlot({ doDate: '2026-09-29', doTime: '00:00', dueDate: null }, { minutes: -15 }),
    ).toBeNull()
  })

  it('does nothing for a task without a date or a no-op change', () => {
    expect(nudgeSlot({ doDate: null, doTime: null, dueDate: null }, { days: 1 })).toBeNull()
    expect(nudgeSlot({ doDate: '2026-09-29', doTime: '14:00', dueDate: null }, {})).toBeNull()
  })
})
