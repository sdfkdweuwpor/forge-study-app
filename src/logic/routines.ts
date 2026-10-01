/**
 * Routine task templates (BRIEF §5.11, Phase 11i, the small part that rituals use), pure. A routine is a
 * named set of tasks you add to a day in one click ("Study day", "Weekly reset"). It is stored as a
 * `Template` row with `kind: 'task'`; its `payload` is `unknown` in the database and is checked here
 * with Zod every time it is used, so a hand-edited or imported row can never crash the picker.
 *
 * The two built-in starters live in this file, not in the database: nothing has to be seeded, they can
 * never be lost, and they cannot be edited into something else by accident.
 */
import { z } from 'zod'
import type { HHmm, ID, ISODate, Task } from '@/db/types'
import { isHHmm } from './dates'

/** A routine holds at most this many tasks. */
export const ROUTINE_TASKS_MAX = 30
/** The longest name a routine may have. */
export const ROUTINE_NAME_MAX = 60
/** The icon a routine you save gets. */
export const ROUTINE_DEFAULT_ICON = '📋'

const routineTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  doTime: z.string().refine(isHHmm, 'Use a time like 09:00').optional(),
  goalId: z.string().min(1).optional(),
})

export const routinePayloadSchema = z.object({
  tasks: z.array(routineTaskSchema).min(1).max(ROUTINE_TASKS_MAX),
})

/** What a routine's `payload` holds: its tasks, each with a title and optionally a length, a time and a goal. */
export type RoutinePayload = z.infer<typeof routinePayloadSchema>
export type RoutineTask = RoutinePayload['tasks'][number]

/** The payload if it is valid, else `null`. */
export function parseRoutinePayload(payload: unknown): RoutinePayload | null {
  const result = routinePayloadSchema.safeParse(payload)
  return result.success ? result.data : null
}

/** A name with its whitespace collapsed, trimmed and cut at `ROUTINE_NAME_MAX`. */
export function cleanRoutineName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return clean.length <= ROUTINE_NAME_MAX ? clean : clean.slice(0, ROUTINE_NAME_MAX).trimEnd()
}

type TaskShape = Pick<Task, 'title' | 'durationMinutes' | 'estimateMinutes' | 'doTime' | 'goalId'>

/**
 * A routine's tasks from tasks you have: title, the length of the slot (else the estimate in minutes),
 * the time of day and the goal. Dates, notes, tags and status are left behind. Titles are shortened to
 * the payload's limit and at most `ROUTINE_TASKS_MAX` are kept.
 */
export function routinePayloadFromTasks(tasks: readonly TaskShape[]): RoutinePayload {
  return {
    tasks: tasks.slice(0, ROUTINE_TASKS_MAX).map((t) => {
      const minutes = t.durationMinutes ?? t.estimateMinutes
      return {
        title: t.title.slice(0, 200),
        ...(minutes !== null && minutes >= 5 && minutes <= 600
          ? { durationMinutes: Math.round(minutes) }
          : {}),
        ...(t.doTime !== null && isHHmm(t.doTime) ? { doTime: t.doTime } : {}),
        ...(t.goalId !== null ? { goalId: t.goalId } : {}),
      }
    }),
  }
}

/** What a routine becomes on a day: the fields of each new task, in order. */
export interface RoutineTaskDraft {
  title: string
  doDate: ISODate
  doTime?: HHmm
  durationMinutes?: number
  goalId?: ID
}

/**
 * The tasks a routine adds to `day`. A goal that no longer exists (`goalIds` is the set that does) is
 * dropped rather than pointing at nothing.
 */
export function routineTaskDrafts(
  payload: RoutinePayload,
  day: ISODate,
  goalIds: ReadonlySet<ID>,
): RoutineTaskDraft[] {
  return payload.tasks.map((t) => ({
    title: t.title,
    doDate: day,
    ...(t.doTime !== undefined ? { doTime: t.doTime } : {}),
    ...(t.durationMinutes !== undefined ? { durationMinutes: t.durationMinutes } : {}),
    ...(t.goalId !== undefined && goalIds.has(t.goalId) ? { goalId: t.goalId } : {}),
  }))
}

// ─── Starters ───────────────────────────────────────────────────────────────

/** A routine as the picker lists it: a saved one or a built-in starter. */
export interface RoutineEntry {
  /** A template row id, or `starter:<slug>` for a built-in. */
  id: string
  name: string
  icon: string
  builtIn: boolean
  payload: RoutinePayload
}

export const STARTER_ROUTINES: readonly RoutineEntry[] = [
  {
    id: 'starter:study-day',
    name: 'Study day',
    icon: '📚',
    builtIn: true,
    payload: {
      tasks: [
        { title: 'Read the next unit', durationMinutes: 50, doTime: '09:00' },
        { title: 'Practice questions', durationMinutes: 30, doTime: '10:15' },
        { title: 'Review flashcards', durationMinutes: 20, doTime: '11:00' },
        { title: 'Write down questions for your mentor', durationMinutes: 10 },
      ],
    },
  },
  {
    id: 'starter:weekly-reset',
    name: 'Weekly reset',
    icon: '🧹',
    builtIn: true,
    payload: {
      tasks: [
        { title: 'Review last week’s progress', durationMinutes: 15 },
        { title: 'Plan next week’s study blocks', durationMinutes: 20 },
        { title: 'Clear the Inbox', durationMinutes: 15 },
        { title: 'Check upcoming assessment dates', durationMinutes: 10 },
        { title: 'Export a backup', durationMinutes: 5 },
      ],
    },
  },
]

/** Minutes a routine plans in all (tasks without a length count as nothing). */
export function routineMinutes(payload: RoutinePayload): number {
  return payload.tasks.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0)
}
