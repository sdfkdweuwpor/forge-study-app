import { beforeEach, describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { ensureSettings } from '@/db/repos/settings'
import type { Session, Task } from '@/db/types'
import { TASK_V2_DEFAULTS } from '@/logic/taskDates'
import {
  loadAccuracyInputs,
  loadDoneTasks,
  loadFocusSessions,
  loadLifetimeTotals,
  loadRefRows,
} from './queries'

let seq = 0

function session(day: string, over: Partial<Session> = {}): Session {
  seq += 1
  const startedAt = new Date(`${day}T09:00:00`).getTime() + seq * 1000
  return {
    id: `s${seq}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day,
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
    ...over,
  }
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    title: id,
    notes: [],
    status: 'done',
    priority: 0,
    dueDate: null,
    dueTime: null,
    estimatePomodoros: 2,
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
    order: 1,
    boardOrder: 1,
    startedAt: null,
    completedAt: 5,
    completedDay: '2026-09-28',
    ...TASK_V2_DEFAULTS,
    doDate: null,
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
})

describe('loadFocusSessions', () => {
  it('returns counted focus sessions in the day range, and nothing else', async () => {
    await db.sessions.bulkAdd([
      session('2026-09-01'), // before
      session('2026-09-10'),
      session('2026-09-11', { counted: false }),
      session('2026-09-12', { kind: 'break' }),
      session('2026-09-13', { status: 'abandoned', counted: false }),
      session('2026-09-29'),
      session('2026-09-30'), // after
    ])
    const rows = await loadFocusSessions('2026-09-10', '2026-09-29')
    expect(rows.map((r) => r.day)).toEqual(['2026-09-10', '2026-09-29'])
  })

  it('keeps only the fields the statistics read', async () => {
    await db.sessions.add(session('2026-09-10', { note: 'private' }))
    const [row] = await loadFocusSessions('2026-09-10', '2026-09-10')
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty('note')
    expect(row).toMatchObject({ kind: 'focus', counted: true, actualMinutes: 25 })
  })
})

describe('loadDoneTasks', () => {
  it('returns tasks finished in range', async () => {
    await db.tasks.bulkAdd([
      task('in', { completedDay: '2026-09-20' }),
      task('before', { completedDay: '2026-08-01' }),
      task('open', { status: 'todo', completedDay: null, completedAt: null }),
    ])
    const rows = await loadDoneTasks('2026-09-01', '2026-09-30')
    expect(rows.map((r) => r.id)).toEqual(['in'])
  })
})

describe('loadAccuracyInputs', () => {
  it('pairs finished, estimated tasks with the time logged on them, even from before the window', async () => {
    await db.tasks.bulkAdd([
      task('a', { completedDay: '2026-09-20', estimatePomodoros: 2 }),
      task('noEstimate', { completedDay: '2026-09-20', estimatePomodoros: null }),
      task('old', { completedDay: '2026-05-01' }),
    ])
    await db.sessions.bulkAdd([
      session('2026-09-01', { taskId: 'a' }), // logged before the window: still counts
      session('2026-09-20', { taskId: 'a' }),
      session('2026-09-20', { taskId: 'a', counted: false }),
      session('2026-09-20', { taskId: 'noEstimate' }),
      session('2026-09-20', { taskId: null }),
    ])
    const { tasks, sessions } = await loadAccuracyInputs('2026-09-01', '2026-09-30')
    expect(tasks.map((t) => [t.id, t.title])).toEqual([['a', 'a']])
    expect(sessions.map((s) => [s.taskId, s.day]).sort()).toEqual([
      ['a', '2026-09-01'],
      ['a', '2026-09-20'],
    ])
  })

  it('is empty when nothing qualifies', async () => {
    expect(await loadAccuracyInputs('2026-09-01', '2026-09-30')).toEqual({
      tasks: [],
      sessions: [],
    })
  })
})

describe('loadLifetimeTotals', () => {
  it('adds up every counted session and finished task, whatever the date', async () => {
    await db.sessions.bulkAdd([
      session('2024-01-01', { actualMinutes: 50, plannedMinutes: 50 }),
      session('2026-09-29'),
      session('2026-09-29', { counted: false }),
      session('2026-09-29', { kind: 'break' }),
    ])
    await db.tasks.bulkAdd([task('a'), task('b'), task('c', { status: 'todo' })])
    expect(await loadLifetimeTotals()).toEqual({ focusMinutes: 75, sessions: 2, tasksDone: 2 })
  })

  it('is all zeros on an empty database', async () => {
    expect(await loadLifetimeTotals()).toEqual({ focusMinutes: 0, sessions: 0, tasksDone: 0 })
  })
})

describe('loadRefRows', () => {
  it('is empty without goals or courses', async () => {
    expect(await loadRefRows()).toEqual({ goals: [], courses: [] })
  })
})
