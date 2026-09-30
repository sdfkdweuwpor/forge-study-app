import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  completeEvening,
  completeMorning,
  focusMinutesOn,
  getOrCreateRitual,
  getRitual,
  listOpenToday,
  listReflections,
  loadTodayGroups,
  moveTasksToDay,
  moveUndoneToTomorrow,
  reopenEvening,
  saveReflection,
  setTop3,
} from '@/db/repos/rituals'
import { completeTask, createTask } from '@/db/repos/tasks'
import { getXpSummary, xpNetForKey } from '@/db/repos/xp'
import type { Session, Task } from '@/db/types'
import { eveningXpKey } from '@/logic/rituals'

const TODAY = '2026-09-29'
const TOMORROW = '2026-09-30'
const NOW = new Date(2026, 8, 29, 18, 30).getTime()

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  onDomainEvent('task.changed', (e) => void events.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

/** A task planned for `doDate` (default today). */
const task = (title: string, extra: Partial<Task> = {}): Promise<Task> =>
  createTask({ title, doDate: TODAY, ...extra }, { now: NOW - 60_000 })

const stored = async (id: string): Promise<Task> => {
  const row = await db.tasks.get(id)
  if (!row) throw new Error(`missing task ${id}`)
  return row
}

describe('the ritual row', () => {
  it('is created once per kind and day, under `kind:day`', async () => {
    const a = await getOrCreateRitual('morning', TODAY, { now: NOW })
    const b = await getOrCreateRitual('morning', TODAY, { now: NOW + 1000 })
    await getOrCreateRitual('evening', TODAY, { now: NOW })
    expect(a).toEqual(b)
    expect(a).toMatchObject({
      id: `morning:${TODAY}`,
      kind: 'morning',
      day: TODAY,
      top3: [],
      reflection: '',
      completedAt: null,
    })
    expect(await db.rituals.count()).toBe(2)
    expect(await getRitual('evening', TODAY)).toBeDefined()
    expect(await getRitual('evening', TOMORROW)).toBeUndefined()
  })
})

describe('setTop3', () => {
  it('keeps at most three ids, in the order picked, without repeats', async () => {
    const { ritual } = await setTop3(TODAY, ['c', 'a', 'c', 'b', 'd'], { now: NOW })
    expect(ritual.top3).toEqual(['c', 'a', 'b'])
    expect((await getRitual('morning', TODAY))?.top3).toEqual(['c', 'a', 'b'])
  })

  it('undo puts the earlier list back, and removes a row it created', async () => {
    const first = await setTop3(TODAY, ['a'], { now: NOW })
    const second = await setTop3(TODAY, ['b', 'c'], { now: NOW + 1 })
    await second.undo()
    expect((await getRitual('morning', TODAY))?.top3).toEqual(['a'])
    await first.undo()
    expect(await getRitual('morning', TODAY)).toBeUndefined()
  })
})

describe('completeMorning', () => {
  it('stores the top 3 and the moment it was done, and pays no XP', async () => {
    const { ritual } = await completeMorning(TODAY, { now: NOW, top3: ['a', 'b'] })
    expect(ritual).toMatchObject({ top3: ['a', 'b'], completedAt: NOW })
    expect(await db.xpEvents.count()).toBe(0)
  })

  it('is idempotent: a second call keeps the first completedAt', async () => {
    await completeMorning(TODAY, { now: NOW, top3: ['a'] })
    const again = await completeMorning(TODAY, { now: NOW + 5000, top3: ['b', 'a'] })
    expect(again.ritual.completedAt).toBe(NOW)
    expect(again.ritual.top3).toEqual(['b', 'a'])
    expect(await db.rituals.count()).toBe(1)
  })

  it('undo restores what was there before', async () => {
    await setTop3(TODAY, ['a'], { now: NOW })
    const done = await completeMorning(TODAY, { now: NOW + 1, top3: ['b'] })
    await done.undo()
    expect(await getRitual('morning', TODAY)).toMatchObject({ top3: ['a'], completedAt: null })
  })
})

describe('saveReflection', () => {
  it('saves one tidy line on the evening row and leaves the rest alone', async () => {
    await completeEvening(TODAY, { now: NOW })
    const row = await saveReflection(TODAY, '  Finished   C182 unit 2.\nTired but good.  ', {
      now: NOW + 1,
    })
    expect(row.reflection).toBe('Finished C182 unit 2. Tired but good.')
    expect(row.completedAt).toBe(NOW)
  })

  it('accepts an empty reflection', async () => {
    await saveReflection(TODAY, 'A note', { now: NOW })
    const row = await saveReflection(TODAY, '   ', { now: NOW + 1 })
    expect(row.reflection).toBe('')
  })
})

describe('completeEvening', () => {
  it('pays +10 XP once, with the reflection, in the ritual source', async () => {
    const result = await completeEvening(TODAY, { now: NOW, reflection: 'Good day.' })
    expect(result.ritual).toMatchObject({ completedAt: NOW, reflection: 'Good day.' })
    expect(result.xp).toMatchObject({ source: 'ritual', amount: 10, day: TODAY })
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(10)
    expect((await getXpSummary(TODAY)).today).toBe(10)
  })

  it('never double-awards: completing twice, or from a second tab, pays nothing more', async () => {
    await completeEvening(TODAY, { now: NOW })
    const again = await completeEvening(TODAY, { now: NOW + 60_000 })
    const parallel = await Promise.all([
      completeEvening(TODAY, { now: NOW + 2 }),
      completeEvening(TODAY, { now: NOW + 3 }),
    ])
    expect(again.xp).toBeNull()
    expect(parallel.map((r) => r.xp)).toEqual([null, null])
    expect(again.ritual.completedAt).toBe(NOW)
    expect(await db.xpEvents.count()).toBe(1)
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(10)
  })

  it('complete, undo, complete again: the net is +10, never +20', async () => {
    const first = await completeEvening(TODAY, { now: NOW })
    await first.undo()
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(0)
    expect((await getRitual('evening', TODAY))?.completedAt).toBeNull()

    const second = await completeEvening(TODAY, { now: NOW + 1000 })
    expect(second.xp?.amount).toBe(10)
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(10)

    // Undoing twice, or undoing what is already undone, takes nothing extra.
    await second.undo()
    await second.undo()
    await first.undo()
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(0)
    const log = await db.xpEvents.toArray()
    expect(log.map((e) => e.amount).sort((x, y) => x - y)).toEqual([-10, -10, 10, 10])
    expect((await getXpSummary(TODAY)).today).toBe(0)
  })

  it('keeps the reflection when it is undone', async () => {
    const done = await completeEvening(TODAY, {
      now: NOW,
      reflection: 'Slow start, strong finish.',
    })
    await done.undo()
    expect((await getRitual('evening', TODAY))?.reflection).toBe('Slow start, strong finish.')
  })

  it('pays once per day', async () => {
    await completeEvening(TODAY, { now: NOW })
    await completeEvening(TOMORROW, { now: NOW + 86_400_000 })
    expect((await getXpSummary(TOMORROW)).lifetime).toBe(20)
    expect(await xpNetForKey(eveningXpKey(TODAY))).toBe(10)
    expect(await xpNetForKey(eveningXpKey(TOMORROW))).toBe(10)
  })

  it('rolls back the row and the XP together when the write fails', async () => {
    const failing = (): void => {
      throw new Error('disk full')
    }
    db.xpEvents.hook('creating', failing)
    await expect(completeEvening(TODAY, { now: NOW })).rejects.toThrow()
    db.xpEvents.hook('creating').unsubscribe(failing)
    expect(await getRitual('evening', TODAY)).toBeUndefined()
    expect(await db.xpEvents.count()).toBe(0)
  })
})

describe('reopenEvening', () => {
  it('does nothing when the shutdown is not completed', async () => {
    expect(await reopenEvening(TODAY)).toBeNull()
    await saveReflection(TODAY, 'Just a note', { now: NOW })
    expect(await reopenEvening(TODAY)).toBeNull()
  })
})

describe("today's list", () => {
  async function seedDay() {
    const a = await task('C182 · Unit 2: Networks (45 min)', {
      doTime: '10:00',
      source: 'schedule',
    })
    const b = await task('Email mentor about term plan')
    const carried = await task('Renew library card', { doDate: '2026-09-27' })
    const later = await task('C779 · Unit 4 (30 min)', { doDate: TOMORROW })
    const doing = await task('D278 practice quiz', { doDate: null, status: 'doing' })
    const finished = await task('Reply to Financial Aid')
    await completeTask(finished.id, { now: NOW })
    const skipped = await task('Refill prescription', { skippedOn: TODAY })
    return { a, b, carried, later, doing, finished, skipped }
  }

  it('is what the Today screen groups: today, in progress, carried over, finished today', async () => {
    const { a, b, carried, doing, finished } = await seedDay()
    const groups = await loadTodayGroups(TODAY)
    expect(groups.fromGoals.map((t) => t.id)).toEqual([a.id])
    expect(groups.yours.map((t) => t.id).sort()).toEqual([b.id, doing.id].sort())
    expect(groups.carriedOver.map((c) => c.task.id)).toEqual([carried.id])
    expect(groups.completedToday.map((t) => t.id)).toEqual([finished.id])
  })

  it('lists open items with carried-over work last and marked with its day', async () => {
    const { carried, finished, later, skipped } = await seedDay()
    const items = await listOpenToday(TODAY)
    expect(items.at(-1)).toMatchObject({ carriedFrom: '2026-09-27' })
    expect(items.at(-1)?.task.id).toBe(carried.id)
    const ids = items.map((i) => i.task.id)
    expect(ids).not.toContain(finished.id)
    expect(ids).not.toContain(later.id)
    expect(ids).not.toContain(skipped.id)
  })

  it('adds up counted focus minutes for a day', async () => {
    const session = (id: string, day: string, minutes: number, counted: boolean): Session => ({
      id,
      createdAt: NOW,
      updatedAt: NOW,
      kind: 'focus',
      mode: 'pomodoro',
      status: 'completed',
      taskId: null,
      goalId: null,
      milestoneId: null,
      day,
      startedAt: NOW,
      endedAt: NOW + minutes * 60_000,
      plannedMinutes: minutes,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: minutes,
      round: 1,
      interrupted: false,
      counted,
      note: null,
    })
    await db.sessions.bulkAdd([
      session('s1', TODAY, 25, true),
      session('s2', TODAY, 25, true),
      session('s3', TODAY, 10, false),
      session('s4', TOMORROW, 25, true),
    ])
    expect(await focusMinutesOn(TODAY)).toBe(50)
    expect(await focusMinutesOn('2026-09-01')).toBe(0)
  })
})

describe('moveTasksToDay', () => {
  it('moves tasks in one go and undo puts back the exact date, time and pin', async () => {
    const timed = await task('Practice questions', { doTime: '16:30', source: 'schedule' })
    const plain = await task('Order takeout')
    const undated = await task('Sketch the C959 outline', { doDate: null, doTime: null })

    const result = await moveTasksToDay([timed.id, plain.id, undated.id], TOMORROW, { now: NOW })
    expect(result.moved).toEqual([timed.id, plain.id, undated.id])
    expect(await stored(timed.id)).toMatchObject({
      doDate: TOMORROW,
      doTime: '16:30',
      schedulePinned: true,
    })
    expect(await stored(plain.id)).toMatchObject({ doDate: TOMORROW })
    expect(await stored(undated.id)).toMatchObject({ doDate: TOMORROW })

    await result.undo()
    expect(await stored(timed.id)).toMatchObject({
      doDate: TODAY,
      doTime: '16:30',
      schedulePinned: false,
    })
    expect(await stored(plain.id)).toMatchObject({ doDate: TODAY, doTime: null })
    expect(await stored(undated.id)).toMatchObject({ doDate: null, doTime: null })
  })

  it('skips finished, missing and already-there tasks', async () => {
    const done = await task('Already done')
    await completeTask(done.id, { now: NOW })
    const there = await task('Already tomorrow', { doDate: TOMORROW })
    const open = await task('Still open')
    const result = await moveTasksToDay([done.id, 'gone', there.id, open.id, open.id], TOMORROW)
    expect(result.moved).toEqual([open.id])
    expect(await stored(done.id)).toMatchObject({ doDate: TODAY })
  })

  it('moves nothing and undoes nothing for an empty list', async () => {
    const result = await moveTasksToDay([], TOMORROW)
    expect(result.moved).toEqual([])
    await expect(result.undo()).resolves.toBeUndefined()
  })

  it('leaves a task alone on undo when it has been moved somewhere else since', async () => {
    const a = await task('Read chapter 4')
    const b = await task('Read chapter 5')
    const result = await moveTasksToDay([a.id, b.id], TOMORROW, { now: NOW })
    await moveTasksToDay([b.id], '2026-10-02', { now: NOW })
    await result.undo()
    expect(await stored(a.id)).toMatchObject({ doDate: TODAY })
    expect(await stored(b.id)).toMatchObject({ doDate: '2026-10-02' })
  })

  it('is one transaction: a failure part-way leaves every task where it was', async () => {
    const a = await task('First')
    const b = await task('boom')
    const c = await task('Third')
    const failing = (_mods: object, _key: string, row: Task): undefined => {
      if (row.title === 'boom') throw new Error('write failed')
      return undefined
    }
    db.tasks.hook('updating', failing)
    await expect(moveTasksToDay([a.id, b.id, c.id], TOMORROW)).rejects.toThrow()
    db.tasks.hook('updating').unsubscribe(failing)
    expect(await stored(a.id)).toMatchObject({ doDate: TODAY })
    expect(await stored(c.id)).toMatchObject({ doDate: TODAY })
  })

  it('emits task.changed for each task it moves', async () => {
    const a = await task('One')
    const b = await task('Two')
    events = []
    await moveTasksToDay([a.id, b.id], TOMORROW)
    await settleDomainEvents()
    expect(events.map((e) => e.type)).toEqual(['task.changed', 'task.changed'])
  })
})

describe('moveUndoneToTomorrow', () => {
  it('moves what Today still shows as open, and one Undo brings it all back', async () => {
    const planned = await task('C182 · Unit 2: Networks (45 min)', { doTime: '10:00' })
    const other = await task('Email mentor about term plan')
    const carried = await task('Renew library card', { doDate: '2026-09-27' })
    const doing = await task('D278 practice quiz', { doDate: null, status: 'doing' })
    const finished = await task('Reply to Financial Aid')
    await completeTask(finished.id, { now: NOW })
    const later = await task('C779 · Unit 4 (30 min)', { doDate: '2026-10-02' })

    const result = await moveUndoneToTomorrow(TODAY, { now: NOW })
    expect(result.moved.sort()).toEqual([planned.id, other.id, carried.id, doing.id].sort())
    for (const t of [planned, other, carried, doing]) {
      expect((await stored(t.id)).doDate).toBe(TOMORROW)
    }
    // Finished work and work planned for a later day stay put.
    expect(await stored(finished.id)).toMatchObject({ doDate: TODAY, status: 'done' })
    expect((await stored(later.id)).doDate).toBe('2026-10-02')

    await result.undo()
    expect(await stored(planned.id)).toMatchObject({ doDate: TODAY, doTime: '10:00' })
    expect((await stored(other.id)).doDate).toBe(TODAY)
    expect((await stored(carried.id)).doDate).toBe('2026-09-27')
    expect((await stored(doing.id)).doDate).toBeNull()
  })

  it('skips the ones left out', async () => {
    const a = await task('Read chapter 4')
    const b = await task('Read chapter 5')
    const result = await moveUndoneToTomorrow(TODAY, { leave: [b.id] })
    expect(result.moved).toEqual([a.id])
    expect((await stored(b.id)).doDate).toBe(TODAY)
  })

  it('does nothing when the day is clear', async () => {
    const result = await moveUndoneToTomorrow(TODAY)
    expect(result.moved).toEqual([])
  })
})

describe('listReflections', () => {
  it('lists evening reflections with words, newest first', async () => {
    await saveReflection('2026-09-27', 'Slow but steady.', { now: NOW })
    await saveReflection('2026-09-29', 'Finished C182 unit 2.', { now: NOW })
    await saveReflection('2026-09-28', '', { now: NOW })
    await setTop3('2026-09-29', ['a'], { now: NOW })
    const rows = await listReflections()
    expect(rows.map((r) => r.day)).toEqual(['2026-09-29', '2026-09-27'])
    expect(await listReflections(1)).toHaveLength(1)
  })
})
