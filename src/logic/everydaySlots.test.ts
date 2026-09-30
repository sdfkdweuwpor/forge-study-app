// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import { TASK_V2_DEFAULTS } from './taskDates'
import {
  autoSlotCandidates,
  busyBlocksOf,
  defaultEverydayWindows,
  describeNoRoom,
  describeSuggestion,
  everydayWindowsOf,
  slotMinutesOf,
  suggestAutoSlots,
} from './everydaySlots'

/** Tuesday 2026-09-29, 09:30 local. */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'

let n = 0
function task(patch: Partial<Task> = {}): Task {
  n += 1
  return {
    id: `t${n}`,
    createdAt: 0,
    updatedAt: 0,
    title: `Task ${n}`,
    notes: [],
    status: 'todo',
    priority: 0,
    ...TASK_V2_DEFAULTS,
    dueDate: null,
    dueTime: null,
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
    order: 0,
    boardOrder: 0,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    ...patch,
  }
}

const bill = (patch: Partial<Task> = {}) =>
  task({ id: 'bill', title: 'Pay phone bill', autoSlot: true, dueDate: '2026-10-02', ...patch })

describe('everyday windows', () => {
  it('default to weekdays 18:00–21:00 and weekends 10:00–18:00', () => {
    const w = defaultEverydayWindows()
    expect(w[1]).toEqual([{ start: '18:00', end: '21:00' }])
    expect(w[0]).toEqual([{ start: '10:00', end: '18:00' }])
    expect(w[6]).toEqual([{ start: '10:00', end: '18:00' }])
  })

  it('read the old untouched 09:00–21:00 default as the everyday defaults', () => {
    const old = Array.from({ length: 7 }, () => [{ start: '09:00', end: '21:00' }])
    expect(everydayWindowsOf(old)).toEqual(defaultEverydayWindows())
    expect(everydayWindowsOf(undefined)).toEqual(defaultEverydayWindows())
    const custom = defaultEverydayWindows()
    custom[2] = [{ start: '07:00', end: '08:00' }]
    expect(everydayWindowsOf(custom)[2]).toEqual([{ start: '07:00', end: '08:00' }])
  })
})

describe('candidates and busy time', () => {
  it('only opted-in open tasks with a deadline and no do date are candidates', () => {
    const ok = bill()
    const list = [
      ok,
      bill({ id: 'a', autoSlot: false }),
      bill({ id: 'b', doDate: '2026-10-01' }),
      bill({ id: 'c', status: 'done' }),
      bill({ id: 'd', dueDate: null }),
    ]
    expect(autoSlotCandidates(list).map((t) => t.id)).toEqual(['bill'])
  })

  it('timed open tasks block their slot, untimed and done ones do not', () => {
    const blocks = busyBlocksOf([
      task({ id: 'x', doDate: TODAY, doTime: '18:00', durationMinutes: 60 }),
      task({ id: 'y', doDate: TODAY }),
      task({ id: 'z', doDate: TODAY, doTime: '19:00', status: 'done' }),
    ])
    expect(blocks).toEqual([
      { date: TODAY, start: '18:00', durationMinutes: 60, source: 'task', id: 'x' },
    ])
  })

  it('uses the slot length, else the estimate, else 30 minutes', () => {
    expect(slotMinutesOf({ durationMinutes: 45, estimateMinutes: null, estimatePomodoros: null })).toBe(45)
    expect(slotMinutesOf({ durationMinutes: null, estimateMinutes: null, estimatePomodoros: 2 })).toBe(50)
    expect(slotMinutesOf({ durationMinutes: null, estimateMinutes: null, estimatePomodoros: null })).toBe(30)
  })
})

describe('suggestAutoSlots', () => {
  it('suggests the first open evening slot before the deadline', () => {
    const r = suggestAutoSlots([bill()], undefined, [], NOW)
    expect(r.noRoom).toEqual([])
    expect(r.suggestions).toEqual([
      {
        taskId: 'bill',
        title: 'Pay phone bill',
        doDate: TODAY,
        startTime: '18:00',
        minutes: 30,
        dueDate: '2026-10-02',
      },
    ])
    expect(describeSuggestion(r.suggestions[0]!, TODAY)).toBe('Pay phone bill → Today 6 PM (30 min)')
  })

  it('plans around timed tasks (and goal sessions)', () => {
    const study = task({
      id: 's',
      doDate: TODAY,
      doTime: '18:00',
      durationMinutes: 180,
      source: 'schedule',
      kind: 'study',
    })
    const r = suggestAutoSlots([bill(), study], undefined, [], NOW)
    expect(r.suggestions[0]).toMatchObject({ doDate: '2026-09-30', startTime: '18:00' })
  })

  it('reports no room, gently, when nothing fits before the deadline', () => {
    const r = suggestAutoSlots([bill({ dueDate: TODAY, dueTime: '12:00' })], undefined, [], NOW)
    expect(r.suggestions).toEqual([])
    expect(r.noRoom[0]).toMatchObject({ taskId: 'bill', reason: 'noRoom' })
    expect(describeNoRoom(r.noRoom[0]!, TODAY)).toBe('No open time before today — pick a time')
    expect(describeNoRoom({ ...r.noRoom[0]!, dueDate: '2026-10-02' }, TODAY)).toBe(
      'No open time before Fri — pick a time',
    )
  })

  it('does not suggest into a day off', () => {
    const r = suggestAutoSlots(
      [bill()],
      undefined,
      [{ start: '2026-09-29', end: '2026-10-01' }],
      NOW,
    )
    expect(r.suggestions[0]).toMatchObject({ doDate: '2026-10-02', startTime: '18:00' })
  })

  it('is empty with no candidates', () => {
    expect(suggestAutoSlots([task()], undefined, [], NOW)).toEqual({ suggestions: [], noRoom: [] })
  })
})
