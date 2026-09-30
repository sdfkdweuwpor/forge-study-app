/**
 * Badges (BRIEF §5.5, PLAN §6 / 6C). `badges` rows are keyed by badge id and only ever inserted: earning a
 * badge is remembered for good, so reopening a course, deleting a session or importing older data never
 * takes one away (and never moves its date). What is earned is decided by the pure `evaluateBadges`
 * (`@/logic/badges`) over the history in the database; `reconcileBadges` runs it and inserts what is new.
 *
 * Reconciling is idempotent, so any event may call it: it reads, evaluates, and writes only the badges
 * that are not stored yet, in one transaction that also guards against two tabs racing.
 */
import { liveQuery } from 'dexie'
import { dayOf } from '@/logic/dates'
import { computeStreakForBadges, evaluateBadges, isBadgeId } from '@/logic/badges'
import { db } from '../db'
import type { Badge, Millis } from '../types'
import { getSettings } from './settings'

/** Every stored badge, oldest unlock first. Rows with an id this build does not know are left out. */
export async function getBadges(): Promise<Badge[]> {
  const rows = await db.badges.toArray()
  return rows.filter((b) => isBadgeId(b.id)).sort((a, b) => a.unlockedAt - b.unlockedAt)
}

/**
 * Evaluates the whole history at `now` and inserts the badges that are not stored yet. Returns the new
 * rows (empty when nothing was earned since the last run), oldest unlock first. Nothing is ever removed
 * or changed, so calling it twice, or from two tabs at once, gives the same rows as calling it once.
 */
export async function reconcileBadges(now: Millis = Date.now()): Promise<Badge[]> {
  const today = dayOf(now)
  const history = await db.transaction(
    'r',
    [db.sessions, db.milestones, db.goals, db.streakDays, db.settings],
    async () => {
      const [sessions, courses, goals, streakRows, settings] = await Promise.all([
        db.sessions.where('status').equals('completed').toArray(),
        db.milestones.toArray(),
        db.goals.toArray(),
        db.streakDays.toArray(),
        getSettings(),
      ])
      return { sessions, courses, goals, streakRows, weekStartsOn: settings.weekStartsOn }
    },
  )
  const unlocks = evaluateBadges({
    sessions: history.sessions,
    courses: history.courses,
    goals: history.goals,
    streak: computeStreakForBadges(history.streakRows, today, history.weekStartsOn),
  })
  if (unlocks.length === 0) return []

  return db.transaction('rw', db.badges, async () => {
    const stored = new Set<string>(await db.badges.toCollection().primaryKeys())
    const fresh: Badge[] = unlocks
      .filter((u) => !stored.has(u.id))
      .map((u) => ({
        id: u.id,
        unlockedAt: u.unlockedAt,
        context: u.context,
        createdAt: now,
        updatedAt: now,
      }))
    if (fresh.length > 0) await db.badges.bulkAdd(fresh)
    return fresh
  })
}

/**
 * Calls `onChange` whenever the `streakDays` table changes after this call (a day qualified, or the
 * streak engine rebuilt its rows), from this tab or another. The first read is not a change. Returns
 * the unsubscribe function. Phase 7 writes these rows in its own handlers and emits no event of its own,
 * so this is how badges notice a streak moving.
 */
export function watchStreakDays(
  onChange: () => void,
  onError?: (error: unknown) => void,
): () => void {
  let first = true
  const subscription = liveQuery(() => db.streakDays.toArray()).subscribe({
    next: () => {
      if (first) first = false
      else onChange()
    },
    error: (error: unknown) => onError?.(error),
  })
  return () => subscription.unsubscribe()
}
