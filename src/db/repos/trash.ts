/**
 * Trash (PLAN §3.5): deleting moves the row, and everything that goes with it, into one `trash` row
 * with a JSON-like payload and a 30-day expiry. Nothing else ever has to filter out "deleted" rows, and
 * restoring is one `bulkPut` per table with the original ids and timestamps. XP events are never trashed.
 *
 * What goes with a row:
 *  - a task: itself (its checklist is embedded in the row);
 *  - a course (milestone): its units, tasks, assessments (logs and planned), flashcards, practice
 *    questions and their attempts, readiness rows, resources and their files;
 *  - a goal: its courses and everything under them, plus the goal's own tasks and plan proposals.
 */
import { newId } from '@/lib/ids'
import { trashExpiry } from '@/logic/retention'
import { UndoRefusedError } from '@/logic/undo'
import {
  countContents,
  parentFields,
  parentRefs,
  type ParentRef,
  type ParentTable,
  type TrashEntry,
  type TrashParent,
} from '@/logic/trashList'
import type { Table } from 'dexie'
import { db } from '../db'
import { emit } from '../events'
import type { Base, ID, Millis, Resource, TableName, Task, TrashItem } from '../types'

/**
 * How long a trashed item can be restored, as a length of time. The real expiry is `trashExpiry(now)`
 * (30 calendar days later at the same local time), which differs from this by an hour across a DST change.
 */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type TrashPayload = Partial<Record<TableName, unknown[]>>

export interface TrashResult {
  /** The id of the `trash` row. */
  trashId: ID
  item: TrashItem
  /**
   * Puts everything back, the way the Trash page restores it (`restoreTrashItem`): if its goal or course was
   * trashed since, that comes back too; if it is gone for good, a task returns without the link. Quietly
   * does nothing when the entry is already restored or purged; throws (so a toast can offer Retry) when a
   * course or unit has nowhere to return to.
   */
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

/** Every attempt at the given questions. */
async function attemptsOf(questionIds: readonly ID[]): Promise<unknown[]> {
  if (questionIds.length === 0) return []
  return db.questionAttempts
    .where('questionId')
    .anyOf([...questionIds])
    .toArray()
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
    add('plannedAssessments', await db.plannedAssessments.where('goalId').equals(id).toArray())
    add('planProposals', await db.planProposals.where('goalId').equals(id).toArray())
    add('flashcards', await db.flashcards.where('goalId').equals(id).toArray())
    add('practiceQuestions', await db.practiceQuestions.where('goalId').equals(id).toArray())
    add(
      'questionAttempts',
      await attemptsOf(await db.practiceQuestions.where('goalId').equals(id).primaryKeys()),
    )
    add('readiness', await db.readiness.where('goalId').equals(id).toArray())
    add('resources', await db.resources.where('goalId').equals(id).toArray())
  } else if (name === 'milestones') {
    add('units', await db.units.where('milestoneId').equals(id).toArray())
    add('tasks', await db.tasks.where('milestoneId').equals(id).toArray())
    add('assessments', await db.assessments.where('milestoneId').equals(id).toArray())
    add('plannedAssessments', await db.plannedAssessments.where('milestoneId').equals(id).toArray())
    add('flashcards', await db.flashcards.where('milestoneId').equals(id).toArray())
    add('practiceQuestions', await db.practiceQuestions.where('milestoneId').equals(id).toArray())
    add('questionAttempts', await db.questionAttempts.where('milestoneId').equals(id).toArray())
    add('readiness', await db.readiness.where('milestoneId').equals(id).toArray())
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
    db.plannedAssessments,
    db.planProposals,
    db.flashcards,
    db.practiceQuestions,
    db.questionAttempts,
    db.readiness,
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
 * exist (already deleted in another tab, say). `undo()` restores the new entry (see `TrashResult.undo`).
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
      expiresAt: trashExpiry(now),
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
  return {
    trashId: item.id,
    item,
    undo: async () => {
      const out = await restoreTrashItem(item.id)
      // Nothing has changed by trying again, so the toast gives the reason and no Retry.
      if (!out.ok && out.reason !== 'missing') throw new UndoRefusedError(out.message)
    },
  }
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

/** Deletes trash entries whose 30 days are over (the safety feature runs this once a day at app start). Returns how many were removed. */
export async function purgeExpired(now: Millis = Date.now()): Promise<number> {
  return db.trash.where('expiresAt').belowOrEqual(now).delete()
}

/** The tasks inside a trash entry, for callers that want to show what would come back. */
export function trashedTasks(item: TrashItem): Task[] {
  return (item.payload.tasks ?? []) as Task[]
}

// ─── The Trash page (Phase 11c) ─────────────────────────────────────────────

const PARENT_TABLES: readonly ParentTable[] = ['goals', 'milestones', 'units']
const keyOf = (table: string, id: ID): string => `${table}:${id}`

/** The row an entry is about: the one row of `entityTable` in its payload whose id is `entityId`. */
function ownRow(item: TrashItem): unknown {
  return (item.payload[item.entityTable] ?? []).find((r) => (r as Base).id === item.entityId)
}

const titleOfRow = (table: ParentTable, row: unknown): string => {
  const r = row as { title?: unknown; code?: unknown }
  const title = typeof r.title === 'string' ? r.title : ''
  const code =
    table === 'milestones' && typeof r.code === 'string' && r.code !== '' ? `${r.code} ` : ''
  return `${code}${title}`.trim()
}

interface Resolved {
  ref: ParentRef
  /** Where the container is: in the app, in the Trash (in `holder`), or nowhere. */
  state: 'present' | 'trashed' | 'gone'
  holder?: TrashItem
  title: string
}

interface Analysis {
  parents(item: TrashItem): Resolved[]
  /** Whether the entry can come back at all (see `restoreTrashItem`). */
  restorable(item: TrashItem): boolean
}

/**
 * Works out, for every entry, where the goal, course and unit its own row points at are now. A container
 * that is in the app is fine; one that is in another entry comes back with it; one that is nowhere is
 * "gone", and (when it is a task) is left behind. An entry whose container is trashed but cannot itself
 * come back counts as gone. Reads only; call inside the caller's transaction.
 */
async function analyze(items: readonly TrashItem[]): Promise<Analysis> {
  // Every container that sits inside some entry (a goal's entry holds its courses and units too).
  const held = new Map<string, { item: TrashItem; title: string }>()
  for (const item of items) {
    for (const table of PARENT_TABLES) {
      for (const row of item.payload[table] ?? []) {
        held.set(keyOf(table, (row as Base).id), { item, title: titleOfRow(table, row) })
      }
    }
  }
  // Every container an entry's own row points at, and which of them exist in the app right now.
  const own = new Map<ID, ParentRef[]>()
  const wanted: Record<ParentTable, Set<ID>> = {
    goals: new Set(),
    milestones: new Set(),
    units: new Set(),
  }
  for (const item of items) {
    const refs = parentRefs(item.entityTable, ownRow(item))
    own.set(item.id, refs)
    for (const r of refs) wanted[r.table].add(r.id)
  }
  const present = new Set<string>()
  for (const table of PARENT_TABLES) {
    const ids = [...wanted[table]]
    if (ids.length === 0) continue
    const rows = await db.table(table).bulkGet(ids)
    rows.forEach((row, i) => {
      if (row !== undefined) present.add(keyOf(table, ids[i] ?? ''))
    })
  }

  const memo = new Map<ID, boolean>()
  const resolving = new Set<ID>()

  const restorable = (item: TrashItem): boolean => {
    const known = memo.get(item.id)
    if (known !== undefined) return known
    // A cycle cannot happen (a container never sits inside its own child); answer "no" rather than loop.
    if (resolving.has(item.id)) return false
    resolving.add(item.id)
    const ok = item.entityTable === 'tasks' || parents(item).every((p) => p.state !== 'gone')
    resolving.delete(item.id)
    memo.set(item.id, ok)
    return ok
  }

  const parents = (item: TrashItem): Resolved[] =>
    (own.get(item.id) ?? []).map((ref): Resolved => {
      const key = keyOf(ref.table, ref.id)
      if (present.has(key)) return { ref, state: 'present', title: '' }
      const holder = held.get(key)
      if (holder && holder.item.id !== item.id && restorable(holder.item)) {
        return { ref, state: 'trashed', holder: holder.item, title: holder.title }
      }
      return { ref, state: 'gone', title: holder?.title ?? '' }
    })

  return { parents, restorable }
}

/** Everything in the Trash for the page, newest deletion first. Reads one consistent view of the trash and the containers. */
export async function listTrash(): Promise<TrashEntry[]> {
  return db.transaction('r', [db.trash, db.goals, db.milestones, db.units], async () => {
    const items = await db.trash.toArray()
    if (items.length === 0) return []
    const analysis = await analyze(items)
    return items
      .map((item): TrashEntry => {
        const parents: TrashParent[] = analysis
          .parents(item)
          .filter((p) => p.state !== 'present')
          .map((p) => ({
            table: p.ref.table,
            id: p.ref.id,
            title: p.title,
            state: p.state === 'trashed' ? 'trashed' : 'gone',
            ...(p.holder ? { trashId: p.holder.id } : {}),
          }))
        return {
          id: item.id,
          table: item.entityTable,
          entityId: item.entityId,
          title: item.title,
          deletedAt: item.createdAt,
          expiresAt: item.expiresAt,
          contents: countContents(item),
          parents,
          restorable: analysis.restorable(item),
        }
      })
      .sort((a, b) => b.deletedAt - a.deletedAt)
  })
}

/** How many entries are in the Trash. */
export async function countTrash(): Promise<number> {
  return db.trash.count()
}

export type RestoreOutcome =
  | {
      ok: true
      /** The entry that was asked for. */
      item: TrashItem
      /** Containers' entries brought back first, because the item lived in them (outermost first). */
      alsoRestored: TrashItem[]
      /** Containers that were gone for good and left out of a task's links ("goals", "milestones", "units"). */
      detached: ParentTable[]
      /** Puts every restored entry back in the Trash exactly as it was (same expiry). */
      undo: () => Promise<void>
    }
  | { ok: false; reason: 'missing' | 'parent-gone' | 'failed'; message: string }

/** The rows of a payload table as they should be written back (a file without real bytes is not restorable). */
function rowsToWrite(item: TrashItem, tableName: TableName): unknown[] {
  const rows = item.payload[tableName] ?? []
  if (tableName !== 'files') return rows
  return rows.filter(
    (r) => typeof Blob !== 'undefined' && (r as { blob?: unknown }).blob instanceof Blob,
  )
}

/**
 * Restores an entry from the Trash page, following one rule about containers:
 *
 *  - `moveToTrash` cascades down, so a goal's entry already holds its courses, units and tasks. An item
 *    trashed *before* its goal or course lives in an entry of its own;
 *  - restoring it **brings its container back too** (the container's whole entry, outermost first), all in
 *    one transaction, so nothing is ever restored into a goal or course that does not exist. The page says
 *    so before you click (`TrashEntry.parents`);
 *  - if a container is gone for good (purged), a **task** comes back without that link (and a scheduler
 *    chunk becomes a plain task, like a dropped chunk does); a **course or unit** cannot be restored, and
 *    the outcome says why. Nothing is written in that case.
 *
 * `undo` reverses it exactly: the restored rows are removed and the entries are back in the Trash with
 * their original expiry.
 */
export async function restoreTrashItem(
  trashId: ID,
  opts: { now?: Millis } = {},
): Promise<RestoreOutcome> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', trashTables(), async (): Promise<RestoreOutcome> => {
    const items = await db.trash.toArray()
    const target = items.find((i) => i.id === trashId)
    if (!target)
      return { ok: false, reason: 'missing', message: 'That item is no longer in the Trash.' }
    const analysis = await analyze(items)
    if (!analysis.restorable(target)) {
      return {
        ok: false,
        reason: 'parent-gone',
        message:
          'Its goal or course was deleted for good, so this can’t be restored on its own. You can delete it forever.',
      }
    }

    // Containers first (outermost first), then the item.
    const order: TrashItem[] = []
    const visit = (item: TrashItem): void => {
      for (const p of analysis.parents(item)) {
        if (p.state === 'trashed' && p.holder && !order.includes(p.holder)) visit(p.holder)
      }
      if (!order.includes(item)) order.push(item)
    }
    visit(target)

    // What a task leaves behind: the links to containers that no longer exist anywhere.
    const goneFields = new Set<string>()
    const detached = new Set<ParentTable>()
    if (target.entityTable === 'tasks') {
      const fields = parentFields('tasks')
      for (const p of analysis.parents(target)) {
        if (p.state !== 'gone') continue
        detached.add(p.ref.table)
        for (const [field, parent] of fields) if (parent === p.ref.table) goneFields.add(field)
      }
    }

    for (const item of order) {
      for (const tableName of Object.keys(item.payload) as TableName[]) {
        let rows = rowsToWrite(item, tableName)
        if (item === target && tableName === 'tasks' && goneFields.size > 0) {
          rows = rows.map((r) =>
            (r as Task).id === item.entityId ? detachTask(r as Task, goneFields, now) : r,
          )
        }
        if (rows.length > 0) await table(tableName).bulkPut(rows as Base[])
      }
      await db.trash.delete(item.id)
      emitFor(item.payload, 'restored')
    }

    const restored = [...order]
    return {
      ok: true,
      item: target,
      alsoRestored: order.filter((i) => i !== target),
      detached: [...detached],
      undo: async () => {
        await db.transaction('rw', trashTables(), async () => {
          for (const item of [...restored].reverse()) {
            for (const tableName of Object.keys(item.payload) as TableName[]) {
              await table(tableName).bulkDelete(idsOf(item.payload[tableName]))
            }
            await db.trash.put(item)
            emitFor(item.payload, 'deleted')
          }
        })
      },
    }
  })
}

/** A task with the links in `fields` cleared; a scheduler chunk that loses its unit becomes a plain task. */
function detachTask(task: Task, fields: ReadonlySet<string>, now: Millis): Task {
  const next: Task = { ...task, updatedAt: now }
  if (fields.has('goalId')) next.goalId = null
  if (fields.has('milestoneId')) next.milestoneId = null
  if (fields.has('unitId')) next.unitId = null
  if (next.source === 'schedule') {
    next.source = 'user'
    next.scheduleKey = null
    next.schedulePinned = false
  }
  return next
}

/** Deletes one entry for good, with everything in it. Returns false when it was already gone. */
export async function purgeTrashItem(trashId: ID): Promise<boolean> {
  return db.transaction('rw', db.trash, async () => {
    if (!(await db.trash.get(trashId))) return false
    await db.trash.delete(trashId)
    return true
  })
}

/** Deletes every entry for good. Returns how many there were. */
export async function emptyTrash(): Promise<number> {
  return db.transaction('rw', db.trash, async () => {
    const n = await db.trash.count()
    await db.trash.clear()
    return n
  })
}
