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

async function bill(patch: Parameters<typeof createTask>[0] extends infer T ? Partial<T> : never = {}) {
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
