/**
 * Trash (PLAN §3.5): deleting moves the row, and everything that goes with it, into one `trash` row
 * with a JSON-like payload and a 30-day expiry. Nothing else ever has to filter out "deleted" rows, and
 * restoring is one `bulkPut` per table with the original ids and timestamps. XP events are never trashed.
 *
 * What goes with a row:
 *  - a task: itself (its checklist is embedded in the row);
 *  - a course (milestone): its units, tasks, assessments, flashcards, resources and their files;
 *  - a goal: its courses and everything under them, plus the goal's own tasks.
 */
import { newId } from '@/lib/ids'
import type { Table } from 'dexie'
import { db } from '../db'
import { emit } from '../events'
import type { Base, ID, Millis, Resource, TableName, Task, TrashItem } from '../types'

/** How long a trashed item can be restored. */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type TrashPayload = Partial<Record<TableName, unknown[]>>

export interface TrashResult {
  /** The id of the `trash` row. */
  trashId: ID
  item: TrashItem
  /** Puts everything back (restore from trash). */
  undo: () => Promise<void>
}

const table = (name: TableName): Table<Base, ID> => db.table(name)

interface Gathered {
  title: string
  payload: TrashPayload
}

function titleOf(name: TableName, row: Record<string, unknown>, id: ID): string {
  const title = typeof row.title === 'string' ? row.title : ''
  if (name === 'milestones') {
    const code = typeof row.code === 'string' && row.code !== '' ? `${row.code} ` : ''
    return `${code}${title}`.trim() || id
  }
  return title || (typeof row.name === 'string' ? row.name : '') || id
}

async function gather(name: TableName, id: ID): Promise<Gathered | null> {
  const row = await table(name).get(id)
  if (!row) return null
  const payload: TrashPayload = { [name]: [row] }
  const add = (key: TableName, rows: readonly unknown[]): void => {
    if (rows.length > 0) payload[key] = [...(payload[key] ?? []), ...rows]
  }

  if (name === 'goals') {
    add('milestones', await db.milestones.where('goalId').equals(id).toArray())
    add('units', await db.units.where('goalId').equals(id).toArray())
    add('tasks', await db.tasks.where('goalId').equals(id).toArray())
    add('assessments', await db.assessments.where('goalId').equals(id).toArray())
    add('flashcards', await db.flashcards.where('goalId').equals(id).toArray())
    add('resources', await db.resources.where('goalId').equals(id).toArray())
  } else if (name === 'milestones') {
    add('units', await db.units.where('milestoneId').equals(id).toArray())
    add('tasks', await db.tasks.where('milestoneId').equals(id).toArray())
    add('assessments', await db.assessments.where('milestoneId').equals(id).toArray())
    add('flashcards', await db.flashcards.where('milestoneId').equals(id).toArray())
    add('resources', await db.resources.where('milestoneId').equals(id).toArray())
  }

  const resources = (payload.resources ?? []) as Resource[]
  const fileIds = [...new Set(resources.flatMap((r) => (r.fileId ? [r.fileId] : [])))]
  if (fileIds.length > 0) {
    add(
      'files',
      (await db.files.bulkGet(fileIds)).filter((f) => f !== undefined),
    )
  }

  return { title: titleOf(name, row as unknown as Record<string, unknown>, id), payload }
}

/** Every table a trash operation can touch, so one transaction covers a whole cascade. */
export function trashTables(): Table[] {
  return [
    db.tasks,
    db.goals,
    db.milestones,
    db.units,
    db.assessments,
    db.flashcards,
    db.resources,
    db.files,
    db.trash,
  ]
}

function idsOf(rows: readonly unknown[] | undefined): ID[] {
  return (rows ?? []).map((r) => (r as Base).id)
}

function emitFor(payload: TrashPayload, kind: 'deleted' | 'restored'): void {
  for (const id of idsOf(payload.tasks)) {
    emit(
      kind === 'deleted'
        ? { type: 'task.deleted', taskId: id }
        : { type: 'task.changed', taskId: id },
    )
  }
  const goalIds = new Set<ID>(idsOf(payload.goals))
  for (const m of (payload.milestones ?? []) as Array<{ goalId: ID }>) goalIds.add(m.goalId)
  for (const goalId of goalIds) emit({ type: 'goal.changed', goalId })
}

export interface MoveToTrashOptions {
  now?: Millis
}

/**
 * Moves a row and its cascade to the trash in one transaction. Returns `null` when the row does not
 * exist (already deleted in another tab, say). `undo()` is `restoreFromTrash` for the new entry.
 */
export async function moveToTrash(
  name: TableName,
  id: ID,
  opts: MoveToTrashOptions = {},
): Promise<TrashResult | null> {
  const now = opts.now ?? Date.now()
  const item = await db.transaction('rw', trashTables(), async () => {
    const found = await gather(name, id)
    if (!found) return null
    const entry: TrashItem = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      entityTable: name,
      entityId: id,
      title: found.title,
      expiresAt: now + TRASH_TTL_MS,
      payload: found.payload,
    }
    await db.trash.add(entry)
    for (const [tableName, rows] of Object.entries(found.payload) as [TableName, unknown[]][]) {
      await table(tableName).bulkDelete(idsOf(rows))
    }
    emitFor(found.payload, 'deleted')
    return entry
  })
  if (!item) return null
  return { trashId: item.id, item, undo: async () => void (await restoreFromTrash(item.id)) }
}

/**
 * Puts a trashed item and its cascade back, keeping ids and timestamps, and removes the trash row.
 * Returns the restored entry, or `null` when it is gone (restored already, or purged).
 */
export async function restoreFromTrash(trashId: ID): Promise<TrashItem | null> {
  return db.transaction('rw', trashTables(), async () => {
    const item = await db.trash.get(trashId)
    if (!item) return null
    for (const [tableName, rows] of Object.entries(item.payload) as [TableName, unknown[]][]) {
      if (rows.length > 0) await table(tableName).bulkPut(rows as Base[])
    }
    await db.trash.delete(trashId)
    emitFor(item.payload, 'restored')
    return item
  })
}

/** Deletes trash entries whose 30 days are over. Returns how many were removed. */
export async function purgeExpired(now: Millis = Date.now()): Promise<number> {
  return db.trash.where('expiresAt').belowOrEqual(now).delete()
}

/** The tasks inside a trash entry, for callers that want to show what would come back. */
export function trashedTasks(item: TrashItem): Task[] {
  return (item.payload.tasks ?? []) as Task[]
}
