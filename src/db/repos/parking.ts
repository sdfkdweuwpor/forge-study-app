/**
 * The distraction parking lot (BRIEF §5.11): a thought or an urge typed during focus is saved here so it
 * can be looked at after the session instead of acted on now. A row is `open` until it is marked `done`,
 * turned into a task (`converted`, with the task's id) or deleted. Every removal has an `undo`, so a
 * mis-tap costs nothing. Rows carry the id of the session they were parked in (`null` when none was
 * running), which is how the end-of-session dialog lists "parked during this session".
 */
import { newId } from '@/lib/ids'
import { db } from '../db'
import { emit } from '../events'
import type { ID, ParkingItem, Task } from '../types'
import { createTask, type RepoOptions, type Undoable } from './tasks'

/** The longest a parked thought may be. A thought is a line, not a note. */
export const PARKING_TEXT_MAX = 280

/** Whitespace collapsed, trimmed, cut at `PARKING_TEXT_MAX` (never through a surrogate pair). */
export function cleanParkingText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= PARKING_TEXT_MAX) return clean
  const chars = Array.from(clean)
  return chars.length <= PARKING_TEXT_MAX
    ? clean
    : chars.slice(0, PARKING_TEXT_MAX).join('').trimEnd()
}

export interface ParkingInput {
  text: string
  /** The session it was parked in. Omit or `null` when nothing was running. */
  sessionId?: ID | null
}

/** Parks a thought. Throws `RangeError` for a blank one (callers check first: a blank Enter parks nothing). */
export async function addParkingItem(
  input: ParkingInput,
  opts: RepoOptions = {},
): Promise<ParkingItem> {
  const text = cleanParkingText(input.text)
  if (text === '') throw new RangeError('A parked thought needs some text')
  const now = opts.now ?? Date.now()
  const item: ParkingItem = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    text,
    sessionId: input.sessionId ?? null,
    status: 'open',
    taskId: null,
  }
  await db.parkingLot.add(item)
  return item
}

export interface ParkingFilter {
  status?: ParkingItem['status']
  sessionId?: ID
}

const byAge = (a: ParkingItem, b: ParkingItem): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Parked thoughts, oldest first. With no filter, every row. */
export async function listParkingItems(filter: ParkingFilter = {}): Promise<ParkingItem[]> {
  const { status, sessionId } = filter
  const rows =
    sessionId !== undefined
      ? await db.parkingLot.where('sessionId').equals(sessionId).toArray()
      : status !== undefined
        ? await db.parkingLot.where('status').equals(status).toArray()
        : await db.parkingLot.toArray()
  return rows.filter((r) => status === undefined || r.status === status).sort(byAge)
}

/** How many thoughts are still waiting. */
export async function countOpenParkingItems(): Promise<number> {
  return db.parkingLot.where('status').equals('open').count()
}

/**
 * Marks a thought done (`'done'`) or brings it back (`'open'`). `null` when it is gone or a task was made
 * from it. `undo` puts the previous status back.
 */
export async function setParkingStatus(
  id: ID,
  status: 'open' | 'done',
  opts: RepoOptions = {},
): Promise<Undoable | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.parkingLot, async () => {
    const item = await db.parkingLot.get(id)
    if (!item || item.status === 'converted') return null
    if (item.status === status) return { undo: async () => undefined }
    await db.parkingLot.update(id, { status, updatedAt: now })
    return {
      undo: async () => {
        await db.transaction('rw', db.parkingLot, async () => {
          const current = await db.parkingLot.get(id)
          if (current?.status === status) {
            await db.parkingLot.update(id, { status: item.status, updatedAt: Date.now() })
          }
        })
      },
    }
  })
}

/** Removes a thought for good. `null` when it is already gone. `undo` puts the row back. */
export async function deleteParkingItem(id: ID): Promise<Undoable | null> {
  return db.transaction('rw', db.parkingLot, async () => {
    const item = await db.parkingLot.get(id)
    if (!item) return null
    await db.parkingLot.delete(id)
    return {
      undo: async () => {
        await db.parkingLot.put(item)
      },
    }
  })
}

export interface ConvertResult extends Undoable {
  task: Task
}

/**
 * Makes a task of an open thought (its text is the title; no date, so it lands in the Inbox) and marks
 * the thought `converted` with the task's id, in one transaction. `null` when the thought is gone or is
 * no longer open, so pressing twice, or from two tabs, never makes two tasks. `undo` removes the new
 * task and reopens the thought, as long as the task has not been touched since (a task that was already
 * completed or renamed is the person's now and stays).
 */
export async function convertParkingItem(
  id: ID,
  opts: RepoOptions = {},
): Promise<ConvertResult | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.parkingLot, db.tasks, async () => {
    const item = await db.parkingLot.get(id)
    if (!item || item.status !== 'open') return null
    const task = await createTask({ title: item.text }, { now })
    await db.parkingLot.update(id, { status: 'converted', taskId: task.id, updatedAt: now })
    return {
      task,
      undo: async () => {
        await db.transaction('rw', db.parkingLot, db.tasks, async () => {
          const current = await db.parkingLot.get(id)
          if (current?.taskId !== task.id) return
          const made = await db.tasks.get(task.id)
          // Untouched: still open and never edited since it was made.
          if (made && (made.status !== 'todo' || made.updatedAt !== task.updatedAt)) return
          if (made) {
            await db.tasks.delete(task.id)
            emit({ type: 'task.deleted', taskId: task.id })
          }
          await db.parkingLot.update(id, { status: 'open', taskId: null, updatedAt: Date.now() })
        })
      },
    }
  })
}
