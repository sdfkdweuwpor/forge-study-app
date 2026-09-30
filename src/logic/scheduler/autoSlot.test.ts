import { describe, expect, it } from 'vitest'
import { atTime } from '../dates'
import { autoSlotTasks, DEFAULT_TASK_MINUTES } from './autoSlot'
import { avail2, MON, weekWin, win } from './plannerFixtures'

// Task hours Mon–Fri 09:00–12:00; an appointment Monday 09:00–10:00; it is Monday 08:00.
const hours = avail2(weekWin(win(['09:00', '12:00'])))
const busy = [{ date: MON, start: '09:00', durationMinutes: 60, source: 'calendar' as const }]
const now = atTime(MON, '08:00')

describe('autoSlotTasks', () => {
  it('slots earliest due first, then shortest first, before each due time; reports what does not fit', () => {
    const res = autoSlotTasks(
      [
        { id: 't1', estimateMinutes: 60, dueDate: '2026-10-06' },
        { id: 't2', estimateMinutes: 30, dueDate: MON, dueTime: '11:00' },
        { id: 't3', estimateMinutes: 200, dueDate: '2026-10-07' }, // longer than any window
        { id: 't4', estimateMinutes: 30, dueDate: '2026-10-02' }, // already due
        { id: 't5', estimateMinutes: null, dueDate: '2026-10-06' }, // no estimate: 25 min
        { id: 't6', estimateMinutes: 120, dueDate: MON }, // only 90 min left on Monday
      ],
      busy,
      hours,
      now,
    )
    expect(res).toEqual([
      { taskId: 't1', doDate: MON, startTime: '10:55' },
      { taskId: 't2', doDate: MON, startTime: '10:00' },
      { taskId: 't3', reason: 'noRoom' },
      { taskId: 't4', reason: 'pastDue' },
      { taskId: 't5', doDate: MON, startTime: '10:30' },
      { taskId: 't6', reason: 'noRoom' },
    ])
    expect(DEFAULT_TASK_MINUTES).toBe(25)
  })

  it('never ends after the due time on the due day', () => {
    const [r] = autoSlotTasks([{ id: 'x', estimateMinutes: 60, dueDate: MON, dueTime: '10:30' }], busy, hours, now)
    expect(r).toEqual({ taskId: 'x', reason: 'noRoom' }) // 10:00–11:00 would end after 10:30
    const [ok] = autoSlotTasks([{ id: 'y', estimateMinutes: 30, dueDate: MON, dueTime: '10:30' }], busy, hours, now)
    expect(ok).toEqual({ taskId: 'y', doDate: MON, startTime: '10:00' })
  })

  it('uses later days, skips blackouts and time already past', () => {
    const later = atTime(MON, '11:40')
    const off = avail2(weekWin(win(['09:00', '12:00'])), { blackouts: [{ start: '2026-10-06', end: '2026-10-06' }] })
    const res = autoSlotTasks([{ id: 'z', estimateMinutes: 45, dueDate: '2026-10-09' }], [], off, later)
    expect(res).toEqual([{ taskId: 'z', doDate: '2026-10-07', startTime: '09:00' }])
  })

  it('never overlaps busy time or other slotted tasks', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, estimateMinutes: 25 + (i % 3) * 20, dueDate: '2026-10-09' }))
    const res = autoSlotTasks(tasks, busy, hours, now)
    const spans = res.flatMap((r, i) =>
      'doDate' in r ? [[r.doDate, Number(r.startTime.slice(0, 2)) * 60 + Number(r.startTime.slice(3)), (tasks[i]?.estimateMinutes ?? 0)] as const] : [],
    )
    const all = [...spans.map(([d, s, m]) => [d, s, s + m] as const), [MON, 540, 600] as const]
    for (const a of all)
      for (const b of all)
        if (a !== b && a[0] === b[0]) expect(a[2] <= b[1] || b[2] <= a[1]).toBe(true)
    for (const [, s, m] of spans) expect(s >= 540 && s + m <= 720).toBe(true)
  })
})
