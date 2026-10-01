import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { acceptAutoSlots, dismissAutoSlots, proposeAutoSlots } from '@/db/repos/autoslot'
import { createTask } from '@/db/repos/tasks'

/** 2026-09-29 09:30 local (a Tuesday). */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function bill(
  patch: Parameters<typeof createTask>[0] extends infer T ? Partial<T> : never = {},
) {
  return createTask(
    { title: 'Pay phone bill', dueDate: '2026-10-02', autoSlot: true, ...patch },
    { now: NOW },
  )
}

describe('proposeAutoSlots', () => {
  it('suggests a time for an opted-in task and writes nothing', async () => {
    const t = await bill()
    const p = await proposeAutoSlots({ now: NOW })
    expect(p.suggestions).toMatchObject([
      { taskId: t.id, doDate: '2026-09-29', startTime: '18:00', minutes: 30 },
    ])
    expect((await db.tasks.get(t.id))?.doDate).toBeNull()
  })

  it('leaves out tasks that did not opt in', async () => {
    await bill({ autoSlot: false })
    expect(await proposeAutoSlots({ now: NOW })).toEqual({ suggestions: [], noRoom: [] })
  })

  it('plans around a timed task', async () => {
    await createTask(
      { title: 'Gym', doDate: '2026-09-29', doTime: '18:00', durationMinutes: 60 },
      { now: NOW },
    )
    await bill()
    const p = await proposeAutoSlots({ now: NOW })
    expect(p.suggestions[0]).toMatchObject({ doDate: '2026-09-29', startTime: '19:00' })
  })
})

describe('acceptAutoSlots', () => {
  it('sets the day, time and length, turns the switch off, and can be undone', async () => {
    const t = await bill()
    const { suggestions } = await proposeAutoSlots({ now: NOW })
    const result = await acceptAutoSlots(suggestions, { now: NOW })
    expect(result.applied).toBe(1)
    expect(await db.tasks.get(t.id)).toMatchObject({
      doDate: '2026-09-29',
      doTime: '18:00',
      durationMinutes: 30,
      autoSlot: false,
      dueDate: '2026-10-02',
    })
    await result.undo()
    expect(await db.tasks.get(t.id)).toMatchObject({ doDate: null, doTime: null, autoSlot: true })
  })

  it('skips a task that got a day of its own meanwhile', async () => {
    const t = await bill()
    const { suggestions } = await proposeAutoSlots({ now: NOW })
    await db.tasks.update(t.id, { doDate: '2026-10-01' })
    const result = await acceptAutoSlots(suggestions, { now: NOW })
    expect(result.applied).toBe(0)
    expect((await db.tasks.get(t.id))?.doDate).toBe('2026-10-01')
  })
})

describe('acceptAutoSlots re-checks that the time is still free', () => {
  it('skips a suggestion whose time was taken since, and reports it', async () => {
    const t = await bill()
    const { suggestions } = await proposeAutoSlots({ now: NOW })
    // Something else moves into 18:00 after the suggestion was worked out.
    await createTask(
      { title: 'Dinner with Sam', doDate: '2026-09-29', doTime: '18:00', durationMinutes: 60 },
      { now: NOW },
    )
    const result = await acceptAutoSlots(suggestions, { now: NOW })
    expect(result.applied).toBe(0)
    expect(result.conflicts.map((c) => c.taskId)).toEqual([t.id])
    expect(await db.tasks.get(t.id)).toMatchObject({ doDate: null, doTime: null, autoSlot: true })
    // Asking again offers the next free time, after dinner.
    const again = await proposeAutoSlots({ now: NOW })
    expect(again.suggestions[0]).toMatchObject({ taskId: t.id, startTime: '19:00' })
  })

  it('applies the free ones and skips only the taken one', async () => {
    const a = await bill({ title: 'A', dueDate: '2026-09-29' })
    const b = await bill({ title: 'B', dueDate: '2026-10-02' })
    const { suggestions } = await proposeAutoSlots({ now: NOW })
    expect(suggestions).toHaveLength(2)
    const [first, second] = suggestions
    // Take exactly the second suggestion's time.
    await createTask(
      {
        title: 'Call',
        doDate: second?.doDate as string,
        doTime: second?.startTime as string,
        durationMinutes: 30,
      },
      { now: NOW },
    )
    const result = await acceptAutoSlots(suggestions, { now: NOW })
    expect(result.applied).toBe(1)
    expect(result.appliedSlots.map((s) => s.taskId)).toEqual([first?.taskId])
    expect(result.conflicts.map((s) => s.taskId)).toEqual([second?.taskId])
    const rows = await db.tasks.bulkGet([a.id, b.id])
    expect(rows.filter((r) => r?.doDate !== null)).toHaveLength(1)
  })
})

describe('dismissAutoSlots', () => {
  it('turns auto-schedule off, and Undo turns it back on', async () => {
    const t = await bill()
    const { undo } = await dismissAutoSlots([t.id], { now: NOW })
    expect((await db.tasks.get(t.id))?.autoSlot).toBe(false)
    expect((await proposeAutoSlots({ now: NOW })).suggestions).toEqual([])
    await undo()
    expect((await db.tasks.get(t.id))?.autoSlot).toBe(true)
  })
})
