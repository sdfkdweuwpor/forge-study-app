/**
 * Daily rituals (BRIEF §5.11, Phase 11g): one `rituals` row per kind and day (`id` = `morning:<day>` or
 * `evening:<day>`) holding the top 3 task ids, the one-line reflection and the moment it was completed.
 *
 * - The morning plan stores the top 3 (`setTop3`, or with `completeMorning`). It pays no XP.
 * - The evening shutdown (`completeEvening`) pays +10 XP once a day under the key `ritual:evening:<day>`,
 *   in the same transaction as the row. Completing again, from another tab, or after an undo, never pays
 *   twice: an award is skipped while the key's net is positive, and undoing appends the negative event
 *   (the log is append-only), after which completing pays once more, so the day's net is never above +10.
 * - `moveTasksToDay` moves tasks to another day in one transaction and returns an `undo` that puts back
 *   the exact do date, do time and pin each one had. Which tasks are "undone today" is not worked out
 *   here: `loadTodayGroups` runs the Today screen's own `groupToday` over the rows Today reads.
 *
 * Every write takes an injected clock (`{ now }`) and returns an `undo()` when it can be reversed.
 */
import { addDays } from '@/logic/dates'
import { totalCountedMinutes } from '@/logic/stats'
import {
  XP_EVENING,
  cleanReflection,
  eveningXpKey,
  movableIds,
  normalizeTop3,
  openTodayItems,
  recentReflections,
  ritualId,
  type RitualKind,
  type TodayItem,
} from '@/logic/rituals'
import { groupToday, type TodayGroups } from '@/logic/today'
import { db } from '../db'
import type { HHmm, ID, ISODate, Millis, Ritual, XpEvent } from '../types'
import { updateTask, type RepoOptions, type Undoable } from './tasks'
import { awardXp, reverseXp } from './xp'

const noop = async (): Promise<void> => undefined

// ─── The row ────────────────────────────────────────────────────────────────

/** The stored ritual of a kind and day, or `undefined` when nothing was written for it yet. */
export function getRitual(kind: RitualKind, day: ISODate): Promise<Ritual | undefined> {
  return db.rituals.get(ritualId(kind, day))
}

function blankRitual(kind: RitualKind, day: ISODate, now: Millis): Ritual {
  return {
    id: ritualId(kind, day),
    createdAt: now,
    updatedAt: now,
    day,
    kind,
    top3: [],
    reflection: '',
    completedAt: null,
  }
}

/** The ritual of a kind and day, creating an empty one on first use. */
export async function getOrCreateRitual(
  kind: RitualKind,
  day: ISODate,
  opts: RepoOptions = {},
): Promise<Ritual> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.rituals, async () => {
    const existing = await db.rituals.get(ritualId(kind, day))
    if (existing) return existing
    const row = blankRitual(kind, day, now)
    await db.rituals.add(row)
    return row
  })
}

export interface RitualChange extends Undoable {
  ritual: Ritual
}

/** Puts a row back the way it was (or removes it when it did not exist), in the caller's transaction. */
async function restoreRow(id: string, before: Ritual | undefined): Promise<void> {
  if (before === undefined) await db.rituals.delete(id)
  else await db.rituals.put({ ...before, updatedAt: Date.now() })
}

// ─── Morning ────────────────────────────────────────────────────────────────

/**
 * Stores today's top 3: task ids, repeats dropped, the order you picked kept, at most three. `undo()`
 * puts the earlier list back.
 */
export async function setTop3(
  day: ISODate,
  ids: readonly ID[],
  opts: RepoOptions = {},
): Promise<RitualChange> {
  const now = opts.now ?? Date.now()
  const id = ritualId('morning', day)
  return db.transaction('rw', db.rituals, async () => {
    const before = await db.rituals.get(id)
    const ritual: Ritual = {
      ...(before ?? blankRitual('morning', day, now)),
      top3: normalizeTop3(ids),
      updatedAt: now,
    }
    await db.rituals.put(ritual)
    return {
      ritual,
      undo: async () => {
        await db.transaction('rw', db.rituals, () => restoreRow(id, before))
      },
    }
  })
}

/**
 * Marks the morning plan done for `day`, storing `top3` when given. Idempotent: a second call keeps the
 * first `completedAt`. `undo()` puts the row back as it was before this call.
 */
export async function completeMorning(
  day: ISODate,
  opts: RepoOptions & { top3?: readonly ID[] } = {},
): Promise<RitualChange> {
  const now = opts.now ?? Date.now()
  const id = ritualId('morning', day)
  return db.transaction('rw', db.rituals, async () => {
    const before = await db.rituals.get(id)
    const ritual: Ritual = {
      ...(before ?? blankRitual('morning', day, now)),
      ...(opts.top3 !== undefined ? { top3: normalizeTop3(opts.top3) } : {}),
      completedAt: before?.completedAt ?? now,
      updatedAt: now,
    }
    await db.rituals.put(ritual)
    return {
      ritual,
      undo: async () => {
        await db.transaction('rw', db.rituals, () => restoreRow(id, before))
      },
    }
  })
}

// ─── Evening ────────────────────────────────────────────────────────────────

/**
 * Saves the one-line reflection for `day` (whitespace tidied, at most 280 characters; empty is fine).
 * Nothing else on the row changes, so it is safe to call on every pause in typing, before or after the
 * shutdown is completed.
 */
export async function saveReflection(
  day: ISODate,
  text: string,
  opts: RepoOptions = {},
): Promise<Ritual> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.rituals, async () => {
    const before = await db.rituals.get(ritualId('evening', day))
    const ritual: Ritual = {
      ...(before ?? blankRitual('evening', day, now)),
      reflection: cleanReflection(text),
      updatedAt: now,
    }
    await db.rituals.put(ritual)
    return ritual
  })
}

export interface EveningResult extends Undoable {
  ritual: Ritual
  /** The XP event paid by this call, or `null` when the day had already paid it. */
  xp: XpEvent | null
}

/**
 * Completes the evening shutdown for `day`: stores the reflection when given, keeps the first
 * `completedAt`, and pays +10 XP once (`ritual:evening:<day>`), all in one transaction. Calling it again
 * pays nothing more. `undo()` is `reopenEvening`: it takes the XP back, and completing again pays once
 * more.
 */
export async function completeEvening(
  day: ISODate,
  opts: RepoOptions & { reflection?: string } = {},
): Promise<EveningResult> {
  const now = opts.now ?? Date.now()
  const id = ritualId('evening', day)
  const { ritual, xp } = await db.transaction('rw', [db.rituals, db.xpEvents], async () => {
    const before = await db.rituals.get(id)
    const row: Ritual = {
      ...(before ?? blankRitual('evening', day, now)),
      ...(opts.reflection !== undefined ? { reflection: cleanReflection(opts.reflection) } : {}),
      completedAt: before?.completedAt ?? now,
      updatedAt: now,
    }
    await db.rituals.put(row)
    const award = await awardXp({
      source: 'ritual',
      amount: XP_EVENING,
      key: eveningXpKey(day),
      note: 'Evening shutdown',
      at: now,
      day,
    })
    return { ritual: row, xp: award }
  })
  return { ritual, xp, undo: async () => void (await reopenEvening(day)) }
}

/**
 * Reopens a completed evening shutdown: clears `completedAt` (the reflection stays) and appends the
 * negative XP event. `null` when there was nothing to reopen.
 */
export async function reopenEvening(
  day: ISODate,
  opts: RepoOptions = {},
): Promise<{ ritual: Ritual; xp: XpEvent | null } | null> {
  const now = opts.now ?? Date.now()
  const id = ritualId('evening', day)
  return db.transaction('rw', [db.rituals, db.xpEvents], async () => {
    const before = await db.rituals.get(id)
    if (!before || before.completedAt === null) return null
    const ritual: Ritual = { ...before, completedAt: null, updatedAt: now }
    await db.rituals.put(ritual)
    const xp = await reverseXp(eveningXpKey(day), { at: now, note: 'Evening shutdown undone' })
    return { ritual, xp }
  })
}

// ─── Today's list ───────────────────────────────────────────────────────────

/**
 * What the Today screen groups for `today`: open work (todo and doing, one read each: the `status`
 * index) plus what was finished today (the `completedDay` index), run through `groupToday`. Both
 * rituals read Today's list from here.
 */
export async function loadTodayGroups(today: ISODate): Promise<TodayGroups> {
  const [todo, doing, finished] = await Promise.all([
    db.tasks.where('status').equals('todo').toArray(),
    db.tasks.where('status').equals('doing').toArray(),
    db.tasks.where('completedDay').equals(today).toArray(),
  ])
  return groupToday([...todo, ...doing, ...finished.filter((t) => t.status === 'done')], { today })
}

/** Today's open items (planned for today, then carried over), as the morning and evening show them. */
export async function listOpenToday(today: ISODate): Promise<TodayItem[]> {
  return openTodayItems(await loadTodayGroups(today), { today })
}

/** Counted focus minutes of a day, for the evening's "Done today". */
export async function focusMinutesOn(day: ISODate): Promise<number> {
  const sessions = await db.sessions.where('[kind+day]').equals(['focus', day]).toArray()
  return totalCountedMinutes(sessions)
}

// ─── Moving work on ─────────────────────────────────────────────────────────

/** What one task looked like before a move. */
interface Before {
  id: ID
  doDate: ISODate | null
  doTime: HHmm | null
  schedulePinned: boolean
}

export interface MoveResult extends Undoable {
  /** The tasks that actually moved (finished, missing and already-there ones are skipped). */
  moved: ID[]
}

/**
 * Plans the given tasks for `day` in one transaction (`updateTask` for each, so a scheduled task is
 * pinned there like any drag or "Plan for tomorrow"). A task that is done, gone, or already planned for
 * `day` is left alone. `undo()` puts back each task's exact do date, do time and pin in one transaction;
 * a task that has been moved somewhere else since is left where it is.
 */
export async function moveTasksToDay(
  ids: readonly ID[],
  day: ISODate,
  opts: RepoOptions = {},
): Promise<MoveResult> {
  const before = await db.transaction('rw', db.tasks, async () => {
    const seen: Before[] = []
    for (const id of new Set(ids)) {
      const task = await db.tasks.get(id)
      if (!task || task.status === 'done' || task.doDate === day) continue
      const result = await updateTask(id, { doDate: day }, opts)
      if (result) {
        seen.push({
          id,
          doDate: task.doDate,
          doTime: task.doTime,
          schedulePinned: task.schedulePinned,
        })
      }
    }
    return seen
  })
  if (before.length === 0) return { moved: [], undo: noop }
  return {
    moved: before.map((b) => b.id),
    undo: async () => {
      await db.transaction('rw', db.tasks, async () => {
        for (const b of before) {
          const current = await db.tasks.get(b.id)
          if (!current || current.doDate !== day) continue
          await updateTask(b.id, {
            doDate: b.doDate,
            doTime: b.doTime,
            schedulePinned: b.schedulePinned,
          })
        }
      })
    },
  }
}

/**
 * The evening's one click: moves everything still open on Today (planned for today, in progress, or
 * carried over) to tomorrow, except the ids in `leave`. Which tasks those are is decided inside the
 * transaction, from Today's own list, so it is exactly what Today shows at that moment.
 */
export async function moveUndoneToTomorrow(
  today: ISODate,
  opts: RepoOptions & { leave?: readonly ID[] } = {},
): Promise<MoveResult> {
  return db.transaction('rw', db.tasks, async () => {
    const items = await listOpenToday(today)
    const ids = movableIds(items, today, new Set(opts.leave ?? []))
    return moveTasksToDay(ids, addDays(today, 1), opts)
  })
}

// ─── Reflections ────────────────────────────────────────────────────────────

/** The newest one-line reflections (evening rows with some words), newest first. */
export async function listReflections(limit = 30): Promise<Ritual[]> {
  return recentReflections(await db.rituals.where('kind').equals('evening').toArray(), limit)
}
