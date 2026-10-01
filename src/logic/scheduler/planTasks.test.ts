// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import { taskRow } from './fixtures'
import type { PlanItem } from './plannerTypes'
import {
  currentPlanItems,
  diffPlanTasks,
  isPlanDiffEmpty,
  planItemFields,
  planRevision,
} from './planTasks'

const TODAY = '2026-10-05'

function item(key: string, doDate: string, extra: Partial<PlanItem> = {}): PlanItem {
  const study = !key.includes('review') && !key.startsWith('milestone') && !key.startsWith('a')
  const unit = key.split(':')[0] ?? null
  return {
    key,
    kind: 'study',
    title: `Item ${key}`,
    courseId: 'c1',
    unitId: study ? unit : null,
    assessmentId: null,
    doDate,
    startTime: '09:00',
    durationMinutes: 50,
    dueDate: null,
    seq: study ? Number(key.split(':')[1]) : null,
    seqTotal: null,
    ...extra,
  }
}

/** A stored task for `it`, as the repo writes it. */
function stored(it: PlanItem, id: string, extra: Partial<Task> = {}): Task {
  return taskRow(id, { ...planItemFields(it, 0), ...extra })
}

describe('planItemFields', () => {
  it('gives a session its slot, length and estimates', () => {
    expect(planItemFields(item('u1:2', TODAY), 1)).toEqual({
      title: 'Item u1:2',
      kind: 'study',
      doDate: TODAY,
      doTime: '09:00',
      durationMinutes: 50,
      estimateMinutes: 50,
      estimatePomodoros: 2,
      orderInDay: 1,
      scheduleKey: 'u1:2',
      milestoneId: 'c1',
      unitId: 'u1',
      assessmentId: null,
      dueDate: null,
    })
  })

  it('leaves a day marker without time or duration, and a course-level unit without a unit row', () => {
    const marker = planItemFields(
      item('milestone:2026-10-05', '2026-10-10', {
        kind: 'milestone',
        courseId: null,
        startTime: null,
        durationMinutes: 0,
        dueDate: '2026-10-10',
      }),
      2,
    )
    expect(marker).toMatchObject({
      doTime: null,
      durationMinutes: null,
      estimateMinutes: null,
      estimatePomodoros: null,
      dueDate: '2026-10-10',
      milestoneId: null,
    })
    expect(planItemFields(item('c1:1', TODAY, { unitId: 'c1' }), 0).unitId).toBeNull()
  })
})

describe('diffPlanTasks', () => {
  it('updates matched rows in place, inserts new items, removes or trashes the rest, keeps done and pins', () => {
    const was = [item('u1:1', TODAY), item('u1:2', '2026-10-06'), item('u1:3', '2026-10-07')]
    const tasks = [
      stored(was[0]!, 'done', { status: 'done' }),
      stored(was[1]!, 'moves'),
      stored(was[2]!, 'noted', { notes: [{ id: 'n', type: 'p', text: 'mine' }] }),
      stored(item('u1:4', '2026-10-08'), 'pinned', { schedulePinned: true }),
      stored(item('u1:5', '2026-10-09'), 'gone'),
      taskRow('own', { source: 'user', scheduleKey: null, kind: 'task' }),
    ]
    const next = [
      item('u1:2', '2026-10-07'),
      item('review:x:1', '2026-10-08', { kind: 'review', assessmentId: 'x' }),
    ]
    const diff = diffPlanTasks(tasks, next, { today: TODAY })
    expect(diff.keep).toEqual(['done', 'pinned'])
    expect(diff.update).toEqual([{ id: 'moves', item: next[0], changes: { doDate: '2026-10-07' } }])
    expect(diff.remove).toEqual(['gone'])
    expect(diff.trash).toEqual(['noted'])
    expect(diff.insert.map((f) => [f.scheduleKey, f.kind, f.assessmentId])).toEqual([
      ['review:x:1', 'review', 'x'],
    ])
    expect(isPlanDiffEmpty(diff)).toBe(false)
  })

  it('a stored plan that matches writes nothing', () => {
    const items = [item('u1:1', TODAY), item('u1:2', '2026-10-06')]
    const tasks = items.map((it, i) => stored(it, `t${i}`))
    expect(isPlanDiffEmpty(diffPlanTasks(tasks, items, { today: TODAY }))).toBe(true)
  })

  it('a session skipped today never keeps a slot today: it takes a later one of its unit', () => {
    const plan = [
      item('u1:1', TODAY),
      item('u1:2', TODAY, { startTime: '10:00' }),
      item('u1:3', '2026-10-06'),
    ]
    const tasks = [
      stored(plan[0]!, 'skipped', { skippedOn: TODAY }),
      stored(plan[1]!, 'second'),
      stored(plan[2]!, 'third'),
    ]
    const next = [item('u1:1', TODAY), item('u1:2', '2026-10-06'), item('u1:3', '2026-10-07')]
    const diff = diffPlanTasks(tasks, next, { today: TODAY })
    const to = new Map(diff.update.map((u) => [u.id, u.item.key]))
    expect(to.get('skipped')).not.toBe('u1:1')
    const skippedItem = next.find((i) => i.key === (to.get('skipped') ?? 'u1:1'))
    expect(skippedItem?.doDate).not.toBe(TODAY)
    expect(diff.insert).toEqual([])
    expect(diff.remove).toEqual([])
  })

  it('a skipped review keeps its own key (it has no other)', () => {
    const r = item('review:x:1', TODAY, { kind: 'review', assessmentId: 'x', unitId: null })
    const diff = diffPlanTasks([stored(r, 'r', { skippedOn: TODAY })], [r], { today: TODAY })
    expect(diff).toMatchObject({ insert: [], remove: [], trash: [] })
  })

  it('clears an expired pin when the task is matched again', () => {
    const it0 = item('u1:1', TODAY)
    const t = stored(item('u1:1', '2026-10-01'), 'old', { schedulePinned: true })
    const diff = diffPlanTasks([t], [it0], { today: TODAY })
    expect(diff.update[0]?.changes).toEqual({ doDate: TODAY, schedulePinned: false })
  })
})

describe('currentPlanItems and planRevision', () => {
  it('reads the stored plan items (not everyday tasks), with pins and status', () => {
    const tasks = [
      stored(item('u1:1', TODAY), 'a', { status: 'done' }),
      stored(item('u1:2', '2026-10-06'), 'b', { schedulePinned: true }),
      stored(
        item('milestone:2026-10-05', '2026-10-10', {
          kind: 'milestone',
          startTime: null,
          durationMinutes: 0,
        }),
        'm',
      ),
      taskRow('own', { source: 'user', scheduleKey: null, kind: 'task', doDate: TODAY }),
    ]
    const current = currentPlanItems(tasks, TODAY)
    expect(current.map((c) => [c.key, c.status, c.pinned, c.durationMinutes])).toEqual([
      ['u1:1', 'done', false, 50],
      ['u1:2', 'open', true, 50],
      ['milestone:2026-10-05', 'open', false, 0],
    ])
  })

  it('changes when an open item moves or is finished, not when nothing does', () => {
    const tasks = [stored(item('u1:1', TODAY), 'a'), stored(item('u1:2', '2026-10-06'), 'b')]
    const rev = planRevision(currentPlanItems(tasks, TODAY))
    expect(planRevision(currentPlanItems([...tasks].reverse(), TODAY))).toBe(rev)
    const moved = [tasks[0]!, { ...tasks[1]!, doTime: '10:00' }]
    expect(planRevision(currentPlanItems(moved, TODAY))).not.toBe(rev)
    const done = [{ ...tasks[0]!, status: 'done' as const }, tasks[1]!]
    expect(planRevision(currentPlanItems(done, TODAY))).not.toBe(rev)
  })
})
