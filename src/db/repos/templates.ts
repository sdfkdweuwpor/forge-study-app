/**
 * Routine task templates (BRIEF §5.11, Phase 11i, the small part the daily rituals use): a named set of
 * tasks saved as a `Template` row with `kind: 'task'`, added to a day in one click. The payload is
 * `unknown` in the database and is validated with Zod (`@/logic/routines`) whenever it is written or used,
 * so a row that has been hand-edited or imported never crashes a screen; a row that cannot be read is
 * listed as such and can still be deleted.
 *
 * Goal templates (`kind: 'goal'`) are the wizard's business and are never touched here.
 *
 * Every removal and every addition returns an `undo()`.
 */
import { newId } from '@/lib/ids'
import {
  ROUTINE_DEFAULT_ICON,
  cleanRoutineName,
  parseRoutinePayload,
  routineTaskDrafts,
  type RoutinePayload,
} from '@/logic/routines'
import { UndoRefusedError } from '@/logic/undo'
import { db } from '../db'
import { emit } from '../events'
import type { ID, ISODate, Task, Template } from '../types'
import { createTask, type RepoOptions, type Undoable } from './tasks'

/** A saved routine, with its payload when it can be read. */
export interface RoutineRow {
  template: Template
  /** `null` when the stored payload is not a valid routine. */
  payload: RoutinePayload | null
}

/** Saved routines, oldest first. */
export async function listRoutineRows(): Promise<RoutineRow[]> {
  const rows = await db.templates.where('kind').equals('task').toArray()
  return rows
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .map((template) => ({ template, payload: parseRoutinePayload(template.payload) }))
}

export interface RoutineInput {
  name: string
  payload: unknown
  icon?: string
}

export interface CreatedRoutine extends Undoable {
  template: Template
}

/**
 * Saves a routine. Throws `RangeError` for a blank name or a payload that is not a valid routine (a
 * title on each task, 1 to 30 tasks). `undo()` deletes it again.
 */
export async function createRoutine(
  input: RoutineInput,
  opts: RepoOptions = {},
): Promise<CreatedRoutine> {
  const now = opts.now ?? Date.now()
  const name = cleanRoutineName(input.name)
  if (name === '') throw new RangeError('A routine needs a name')
  const payload = parseRoutinePayload(input.payload)
  if (!payload) throw new RangeError('A routine needs 1 to 30 tasks, each with a title')
  const template: Template = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    kind: 'task',
    name,
    icon: input.icon?.trim() || ROUTINE_DEFAULT_ICON,
    payload,
  }
  await db.templates.add(template)
  return { template, undo: async () => void (await db.templates.delete(template.id)) }
}

/** Renames a routine. `null` when it is gone or the name is blank. `undo()` puts the old name back. */
export async function renameRoutine(
  id: ID,
  name: string,
  opts: RepoOptions = {},
): Promise<Undoable | null> {
  const now = opts.now ?? Date.now()
  const clean = cleanRoutineName(name)
  if (clean === '') return null
  return db.transaction('rw', db.templates, async () => {
    const before = await db.templates.get(id)
    if (!before || before.kind !== 'task') return null
    if (before.name === clean) return { undo: async () => undefined }
    await db.templates.update(id, { name: clean, updatedAt: now })
    return {
      undo: async () => {
        await db.transaction('rw', db.templates, async () => {
          if (await db.templates.get(id)) {
            await db.templates.update(id, { name: before.name, updatedAt: Date.now() })
          }
        })
      },
    }
  })
}

/** Deletes a routine. `null` when it is already gone. `undo()` puts the row back exactly as it was. */
export async function deleteRoutine(id: ID): Promise<Undoable | null> {
  return db.transaction('rw', db.templates, async () => {
    const row = await db.templates.get(id)
    if (!row || row.kind !== 'task') return null
    await db.templates.delete(id)
    return {
      undo: async () => {
        await db.templates.put(row)
      },
    }
  })
}

export interface AppliedRoutine extends Undoable {
  /** The new tasks, in the routine's order. */
  tasks: Task[]
}

/**
 * Adds a routine's tasks to `day`, in its order, in one transaction. Each task is an ordinary task
 * (source `template`, planned for `day`, with the routine's time, length and goal; a goal that no longer
 * exists is dropped). `undo()` removes them again, but only while none of them has been edited or finished
 * since: then it throws `UndoRefusedError` and changes nothing (they are yours now).
 */
export async function applyRoutine(
  payload: RoutinePayload,
  day: ISODate,
  opts: RepoOptions = {},
): Promise<AppliedRoutine> {
  const now = opts.now ?? Date.now()
  const goalIds = new Set<ID>(
    (
      await db.goals.bulkGet([
        ...new Set(payload.tasks.flatMap((t) => (t.goalId ? [t.goalId] : []))),
      ])
    )
      .filter((g) => g !== undefined)
      .map((g) => g.id),
  )
  const drafts = routineTaskDrafts(payload, day, goalIds)
  const tasks = await db.transaction('rw', db.tasks, async () => {
    const made: Task[] = []
    for (const [i, draft] of drafts.entries()) {
      // A rising `order` keeps the routine's own order among tasks that tie on everything else.
      made.push(await createTask({ ...draft, source: 'template', order: now + i }, { now }))
    }
    return made
  })
  return {
    tasks,
    undo: async () => {
      const kept = await db.transaction('rw', db.tasks, async () => {
        const current: Task[] = []
        for (const original of tasks) {
          const row = await db.tasks.get(original.id)
          if (row) current.push(row)
        }
        // Something you edited or finished is yours now: refuse, and change nothing.
        const changed = current.filter((row) => {
          const original = tasks.find((t) => t.id === row.id)
          return row.status !== 'todo' || row.updatedAt !== original?.updatedAt
        })
        if (changed.length > 0) return changed.length
        for (const row of current) {
          await db.tasks.delete(row.id)
          emit({ type: 'task.deleted', taskId: row.id })
        }
        return 0
      })
      if (kept > 0) {
        // The toast says this as it is and offers no Retry: trying again would find the same thing.
        throw new UndoRefusedError(
          kept === 1
            ? 'One of these tasks has been edited or finished since, so they all stay.'
            : `${kept} of these tasks have been edited or finished since, so they all stay.`,
        )
      }
    },
  }
}
