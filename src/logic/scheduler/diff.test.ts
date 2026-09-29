import { describe, expect, it } from 'vitest'
import type { ISODate, Task } from '@/db/types'
import { chunkFields, diffSchedule, hasUserContent, isActivePin, isDiffEmpty } from './diff'
import { taskFromChunk, taskRow } from './fixtures'
import type { PlannedChunk } from './types'

const TODAY: ISODate = '2026-10-06'
const TOMORROW: ISODate = '2026-10-07'

function chunk(
  unitId: string,
  seq: number,
  date: ISODate,
  minutes = 60,
  extra: Partial<PlannedChunk> = {},
): PlannedChunk {
  return {
    key: `${unitId}:${seq}`,
    date,
    minutes,
    courseId: 'c',
    unitId,
    seq,
    seqTotal: 3,
    title: `C · ${unitId} (${seq}/3)`,
    orderInDay: 0,
    ...extra,
  }
}

const open = (c: PlannedChunk, extra: Partial<Task> = {}): Task => ({
  ...taskFromChunk(c),
  ...extra,
})

describe('diffSchedule', () => {
  it('creates, updates in place, deletes untouched and leaves pins and done tasks alone', () => {
    const was = [chunk('u', 1, '2026-10-05'), chunk('u', 2, TODAY), chunk('u', 3, TOMORROW)]
    const tasks = [
      open(was[0]!, { id: 'done', status: 'done' }),
      open(was[1]!, { id: 'moved' }),
      open(was[2]!, { id: 'pinned', schedulePinned: true, dueDate: '2026-10-09' }),
      open(chunk('gone', 1, TODAY), { id: 'stale' }),
      taskRow('mine', { source: 'user', dueDate: TODAY }),
    ]
    const now = [chunk('u', 2, TOMORROW, 45), chunk('v', 1, TOMORROW, 30, { orderInDay: 1 })]
    const diff = diffSchedule(tasks, now, { today: TODAY })
    expect(diff.insert.map((c) => c.key)).toEqual(['v:1'])
    expect(diff.update).toEqual([
      {
        id: 'moved',
        chunk: now[0],
        changes: { dueDate: TOMORROW, estimateMinutes: 45 },
      },
    ])
    expect(diff.remove).toEqual(['stale'])
    expect(diff.trash).toEqual([])
    expect(diff.keep).toEqual(['done', 'pinned'])
  })

  it('writes nothing when the plan is unchanged (idempotent)', () => {
    const plan = [chunk('u', 1, TODAY), chunk('u', 2, TOMORROW)]
    const diff = diffSchedule(
      plan.map((c) => open(c)),
      plan,
      { today: TODAY },
    )
    expect(isDiffEmpty(diff)).toBe(true)
  })

  it('returns an expired pin to the pool and clears the pin', () => {
    const c = chunk('u', 1, TODAY)
    const t = open(c, { id: 'old-pin', schedulePinned: true, dueDate: '2026-10-01' })
    expect(isActivePin(t, TODAY)).toBe(false)
    const diff = diffSchedule([t], [c], { today: TODAY })
    expect(diff.update).toEqual([
      { id: 'old-pin', chunk: c, changes: { dueDate: TODAY, schedulePinned: false } },
    ])
  })

  it('honours an explicit pinned set over the default rule', () => {
    const c = chunk('u', 1, TODAY)
    const t = open(c, { id: 'p', schedulePinned: true, dueDate: TOMORROW })
    expect(
      diffSchedule([t], [c], { today: TODAY, pinnedIds: new Set() }).update[0]?.changes,
    ).toEqual({
      dueDate: TODAY,
      schedulePinned: false,
    })
    expect(diffSchedule([t], [], { today: TODAY }).keep).toEqual(['p'])
  })

  it('moves a skipped task off today by swapping keys with an unskipped one', () => {
    // Before: S = u:1 and T = u:2 both today. S was skipped; the new plan has u:1 today, u:2 tomorrow.
    const s = open(chunk('u', 1, TODAY, 45), { id: 'S', skippedOn: TODAY })
    const t = open(chunk('u', 2, TODAY, 45, { orderInDay: 1 }), { id: 'T' })
    const plan = [chunk('u', 1, TODAY, 45), chunk('u', 2, TOMORROW, 45)]
    const diff = diffSchedule([s, t], plan, { today: TODAY })
    const byId = new Map(diff.update.map((u) => [u.id, u.chunk.key]))
    expect(byId.get('S')).toBe('u:2')
    expect(byId.get('T')).toBe('u:1')
    expect(diff.insert).toEqual([])
    expect(diff.remove).toEqual([])

    // Applying it and diffing again changes nothing.
    const after = [s, t].map((task) => {
      const u = diff.update.find((x) => x.id === task.id)
      return u ? { ...task, ...u.changes } : task
    })
    expect(isDiffEmpty(diffSchedule(after, plan, { today: TODAY }))).toBe(true)
  })

  it('never matches a skipped task to a chunk dated today', () => {
    const s = open(chunk('u', 1, TODAY), { id: 'S', skippedOn: TODAY })
    const diff = diffSchedule([s], [chunk('u', 1, TODAY)], { today: TODAY })
    expect(diff.update).toEqual([])
    expect(diff.remove).toEqual(['S'])
    expect(diff.insert.map((c) => c.key)).toEqual(['u:1'])
  })

  it('trashes an unmatched task that carries the user’s own work instead of deleting it', () => {
    const base = chunk('u', 3, TODAY)
    const tasks = [
      open(base, { id: 'noted', notes: [{ id: 'b', type: 'p', text: 'Ask mentor about this' }] }),
      open(chunk('u', 4, TODAY), { id: 'empty-note', notes: [{ id: 'b', type: 'p', text: '  ' }] }),
      open(chunk('u', 5, TODAY), { id: 'started', status: 'doing' }),
    ]
    const diff = diffSchedule(tasks, [], { today: TODAY })
    expect(diff.trash).toEqual(['noted', 'started'])
    expect(diff.remove).toEqual(['empty-note'])
    expect(hasUserContent(taskRow('x', { tags: ['C182'] }))).toBe(true)
    expect(hasUserContent(taskRow('x', { priority: 3 }))).toBe(true)
    expect(hasUserContent(taskRow('x', { subtasks: [{ id: 's', title: 'a', done: false }] }))).toBe(
      true,
    )
    expect(hasUserContent(taskRow('x'))).toBe(false)
  })

  it('re-keys an unmatched task to a free chunk of the same unit, keeping its notes', () => {
    const t = open(chunk('u', 7, TODAY), {
      id: 'keeper',
      notes: [{ id: 'b', type: 'p', text: 'notes' }],
    })
    const diff = diffSchedule([t], [chunk('u', 1, TOMORROW)], { today: TODAY })
    expect(diff.update[0]?.changes).toMatchObject({ scheduleKey: 'u:1', dueDate: TOMORROW })
    expect(diff.trash).toEqual([])
    expect(diff.insert).toEqual([])
  })

  it('keeps the oldest of two tasks that share a key and drops the other', () => {
    const c = chunk('u', 1, TODAY)
    const older = open(c, { id: 'b-older', createdAt: 1 })
    const newer = open(c, { id: 'a-newer', createdAt: 2 })
    const diff = diffSchedule([newer, older], [c], { today: TODAY })
    expect(diff.update).toEqual([])
    expect(diff.remove).toEqual(['a-newer'])
  })

  it('sets unitId to null for a course without units (synthetic unit = course id)', () => {
    const synthetic = chunk('c', 1, TODAY)
    expect(chunkFields(synthetic)).toMatchObject({
      unitId: null,
      milestoneId: 'c',
      scheduleKey: 'c:1',
    })
    expect(chunkFields(chunk('u', 1, TODAY, 50))).toMatchObject({
      unitId: 'u',
      estimatePomodoros: 2,
    })
  })

  it('returns lists in a stable order', () => {
    const tasks = ['z', 'a', 'm'].map((id, i) => open(chunk(`g${i}`, 1, TODAY), { id }))
    expect(diffSchedule(tasks, [], { today: TODAY }).remove).toEqual(['a', 'm', 'z'])
  })
})
