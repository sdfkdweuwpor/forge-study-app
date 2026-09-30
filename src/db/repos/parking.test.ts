import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  PARKING_TEXT_MAX,
  ParkingUndoError,
  addParkingItem,
  cleanParkingText,
  convertParkingItem,
  countOpenParkingItems,
  deleteParkingItem,
  listParkingItems,
  setParkingStatus,
} from '@/db/repos/parking'
import { completeTask, updateTask } from '@/db/repos/tasks'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

let emitted: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  emitted = []
  onDomainEvent('task.created', (e) => void emitted.push(e))
  onDomainEvent('task.deleted', (e) => void emitted.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('cleanParkingText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanParkingText('  check   my\n email\t ')).toBe('check my email')
  })

  it('caps a long thought without cutting an emoji in half', () => {
    const long = `${'a'.repeat(PARKING_TEXT_MAX - 1)}😀😀😀`
    const clean = cleanParkingText(long)
    expect(Array.from(clean)).toHaveLength(PARKING_TEXT_MAX)
    expect(clean.endsWith('😀')).toBe(true)
    // Nothing is lost from a thought that already fits.
    expect(cleanParkingText('a'.repeat(PARKING_TEXT_MAX))).toHaveLength(PARKING_TEXT_MAX)
  })
})

describe('addParkingItem', () => {
  it('parks an open thought with its session', async () => {
    const item = await addParkingItem(
      { text: '  Reply to Dr. Okafor  ', sessionId: 's1' },
      { now: NOW },
    )
    expect(item).toMatchObject({
      text: 'Reply to Dr. Okafor',
      sessionId: 's1',
      status: 'open',
      taskId: null,
      createdAt: NOW,
    })
    expect(await db.parkingLot.get(item.id)).toEqual(item)
  })

  it('has no session when none was running', async () => {
    const item = await addParkingItem({ text: 'Look up Big-O of merge sort' })
    expect(item.sessionId).toBeNull()
  })

  it('refuses a blank thought', async () => {
    await expect(addParkingItem({ text: '   ' })).rejects.toBeInstanceOf(RangeError)
    expect(await db.parkingLot.count()).toBe(0)
  })
})

describe('listParkingItems', () => {
  it('lists oldest first, and filters by status or session', async () => {
    const a = await addParkingItem({ text: 'first', sessionId: 's1' }, { now: NOW })
    const b = await addParkingItem({ text: 'second', sessionId: 's2' }, { now: NOW + 1000 })
    const c = await addParkingItem({ text: 'third', sessionId: 's1' }, { now: NOW + 2000 })
    await setParkingStatus(b.id, 'done')

    expect((await listParkingItems()).map((i) => i.text)).toEqual(['first', 'second', 'third'])
    expect((await listParkingItems({ status: 'open' })).map((i) => i.id)).toEqual([a.id, c.id])
    expect((await listParkingItems({ sessionId: 's1' })).map((i) => i.id)).toEqual([a.id, c.id])
    expect(await listParkingItems({ sessionId: 's1', status: 'done' })).toEqual([])
    expect(await countOpenParkingItems()).toBe(2)
  })
})

describe('setParkingStatus', () => {
  it('marks a thought done and undo reopens it', async () => {
    const item = await addParkingItem({ text: 'buy a new desk lamp' }, { now: NOW })
    const result = await setParkingStatus(item.id, 'done', { now: NOW + 5000 })
    expect(result).not.toBeNull()
    expect(await db.parkingLot.get(item.id)).toMatchObject({
      status: 'done',
      updatedAt: NOW + 5000,
    })

    await result?.undo()
    expect((await db.parkingLot.get(item.id))?.status).toBe('open')
  })

  it('can reopen a done thought', async () => {
    const item = await addParkingItem({ text: 'x' })
    await setParkingStatus(item.id, 'done')
    await setParkingStatus(item.id, 'open')
    expect((await db.parkingLot.get(item.id))?.status).toBe('open')
  })

  it('does nothing for a missing thought or one that became a task', async () => {
    expect(await setParkingStatus('nope', 'done')).toBeNull()
    const item = await addParkingItem({ text: 'x' })
    await convertParkingItem(item.id)
    expect(await setParkingStatus(item.id, 'done')).toBeNull()
    expect((await db.parkingLot.get(item.id))?.status).toBe('converted')
  })

  it('changes nothing, and offers no undo, when it already has that status', async () => {
    const item = await addParkingItem({ text: 'x' }, { now: NOW })
    expect(await setParkingStatus(item.id, 'open', { now: NOW + 1000 })).toBeNull()
    expect((await db.parkingLot.get(item.id))?.updatedAt).toBe(NOW)
    await setParkingStatus(item.id, 'done')
    expect(await setParkingStatus(item.id, 'done')).toBeNull()
  })

  it('undo throws, and leaves the thought as it is, when its status changed since', async () => {
    const item = await addParkingItem({ text: 'x' })
    const done = await setParkingStatus(item.id, 'done')
    // Another tab brought it back, and then a task was made from it.
    await setParkingStatus(item.id, 'open')
    await convertParkingItem(item.id)

    const undone = done?.undo()
    await expect(undone).rejects.toBeInstanceOf(ParkingUndoError)
    await expect(undone).rejects.toThrow('changed since')
    expect((await db.parkingLot.get(item.id))?.status).toBe('converted')
  })
})

describe('deleteParkingItem', () => {
  it('removes the row and undo puts it back unchanged', async () => {
    const item = await addParkingItem(
      { text: 'email the registrar', sessionId: 's1' },
      { now: NOW },
    )
    const result = await deleteParkingItem(item.id)
    expect(await db.parkingLot.get(item.id)).toBeUndefined()

    await result?.undo()
    expect(await db.parkingLot.get(item.id)).toEqual(item)
  })

  it('is null for a thought that is already gone', async () => {
    expect(await deleteParkingItem('nope')).toBeNull()
  })
})

describe('convertParkingItem', () => {
  it('makes an Inbox task with the thought as its title and links both ways', async () => {
    const item = await addParkingItem({ text: 'Look up the C182 OA schedule' }, { now: NOW })
    const result = await convertParkingItem(item.id, { now: NOW + 1000 })
    expect(result).not.toBeNull()
    const task = result?.task
    expect(task).toMatchObject({
      title: 'Look up the C182 OA schedule',
      status: 'todo',
      doDate: null,
    })

    expect(await db.parkingLot.get(item.id)).toMatchObject({
      status: 'converted',
      taskId: task?.id,
    })
    expect(await db.tasks.get(task?.id ?? '')).toMatchObject({
      title: 'Look up the C182 OA schedule',
    })
    await settleDomainEvents()
    expect(emitted).toContainEqual({ type: 'task.created', taskId: task?.id })
  })

  it('never makes two tasks from one thought', async () => {
    const item = await addParkingItem({ text: 'x' })
    const [a, b] = await Promise.all([convertParkingItem(item.id), convertParkingItem(item.id)])
    expect([a, b].filter((r) => r !== null)).toHaveLength(1)
    expect(await db.tasks.count()).toBe(1)
    expect(await convertParkingItem(item.id)).toBeNull()
  })

  it('is null for a missing thought and for one that is done', async () => {
    expect(await convertParkingItem('nope')).toBeNull()
    const item = await addParkingItem({ text: 'x' })
    await setParkingStatus(item.id, 'done')
    expect(await convertParkingItem(item.id)).toBeNull()
    expect(await db.tasks.count()).toBe(0)
  })

  it('undo removes the new task and reopens the thought', async () => {
    const item = await addParkingItem({ text: 'Skim the D278 syllabus' })
    const result = await convertParkingItem(item.id, { now: NOW })
    await result?.undo()

    expect(await db.tasks.count()).toBe(0)
    expect(await db.parkingLot.get(item.id)).toMatchObject({ status: 'open', taskId: null })
    await settleDomainEvents()
    expect(emitted.map((e) => e.type)).toEqual(['task.created', 'task.deleted'])
  })

  it('undo throws, and keeps the task, once it has been edited', async () => {
    const item = await addParkingItem({ text: 'Skim the D278 syllabus' })
    const result = await convertParkingItem(item.id, { now: NOW })
    await updateTask(
      result?.task.id ?? '',
      { title: 'Skim the D278 syllabus and take notes' },
      { now: NOW + 60_000 },
    )
    const undone = result?.undo()

    // Not a silent success: a toast would otherwise say "Undone" about a task that stays.
    await expect(undone).rejects.toBeInstanceOf(ParkingUndoError)
    await expect(undone).rejects.toThrow('The task changed since, so it was kept')
    expect(await db.tasks.count()).toBe(1)
    expect(await db.parkingLot.get(item.id)).toMatchObject({
      status: 'converted',
      taskId: result?.task.id,
    })
  })

  it('undo throws, and keeps the task, once it has been completed', async () => {
    const item = await addParkingItem({ text: 'Skim the D278 syllabus' })
    const result = await convertParkingItem(item.id, { now: NOW })
    await completeTask(result?.task.id ?? '', { now: NOW + 60_000 })

    await expect(result?.undo()).rejects.toThrow('The task changed since, so it was kept')
    expect((await db.tasks.get(result?.task.id ?? ''))?.status).toBe('done')
    expect((await db.parkingLot.get(item.id))?.status).toBe('converted')
  })

  it('undo throws when the thought was changed since (deleted, say)', async () => {
    const item = await addParkingItem({ text: 'Skim the D278 syllabus' })
    const result = await convertParkingItem(item.id, { now: NOW })
    await deleteParkingItem(item.id)

    await expect(result?.undo()).rejects.toBeInstanceOf(ParkingUndoError)
    // Nothing was removed on the way to failing.
    expect(await db.tasks.count()).toBe(1)
  })

  it('undo still works when the task was removed by hand: the thought comes back', async () => {
    const item = await addParkingItem({ text: 'Skim the D278 syllabus' })
    const result = await convertParkingItem(item.id, { now: NOW })
    await db.tasks.delete(result?.task.id ?? '')
    await result?.undo()
    expect(await db.parkingLot.get(item.id)).toMatchObject({ status: 'open', taskId: null })
  })
})
