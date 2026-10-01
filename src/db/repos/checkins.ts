/**
 * Focus check-ins (BRIEF §5.11): after a session the person may rate how well they focused, 1 to 5, with
 * an optional mood. One check-in belongs to one session (rating again replaces it), and it is stamped
 * with when the session began (hour, weekday, day), because that is when the focus happened and what the
 * planner can offer again. After every save `settings.scheduling.bestHour` is recomputed from all
 * check-ins, so the planner always reads the current best hour (`null` until an hour has enough ratings).
 */
import { newId } from '@/lib/ids'
import { dayOf, hourOf, weekdayOf } from '@/logic/dates'
import { topFocusHour } from '@/logic/insights'
import { db } from '../db'
import type { CheckIn, ID } from '../types'
import { updateSettings } from './settings'
import type { RepoOptions } from './tasks'

type Rating = CheckIn['focus']

export interface CheckInInput {
  /** The session it is about. `null` for a check-in that belongs to no session (stamped with now). */
  sessionId: ID | null
  focus: Rating
  /** One emoji, or `null`/omitted for none. */
  mood?: string | null
}

/** The longest a mood may be (an emoji with joiners and modifiers is a handful of code units). */
const MOOD_MAX = 16

const isRating = (n: number): n is Rating => Number.isInteger(n) && n >= 1 && n <= 5

function cleanMood(mood: string | null | undefined): string | null {
  const text = mood?.trim() ?? ''
  return text === '' ? null : text.slice(0, MOOD_MAX)
}

/** Every check-in, oldest first. */
export async function listCheckIns(): Promise<CheckIn[]> {
  return (await db.checkIns.toArray()).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
}

/** The check-in for a session, or `null`. */
export async function getCheckInForSession(sessionId: ID): Promise<CheckIn | null> {
  return (await db.checkIns.where('sessionId').equals(sessionId).first()) ?? null
}

/**
 * Saves a check-in: a new one, or the session's existing one with the new rating and mood (its hour, day
 * and time do not move). Then recomputes `settings.scheduling.bestHour`. Throws `RangeError` for a rating
 * outside 1 to 5.
 */
export async function saveCheckIn(input: CheckInInput, opts: RepoOptions = {}): Promise<CheckIn> {
  if (!isRating(input.focus)) throw new RangeError('A focus rating is 1 to 5')
  const now = opts.now ?? Date.now()
  const mood = cleanMood(input.mood)
  return db.transaction('rw', db.checkIns, db.sessions, db.settings, async () => {
    const existing =
      input.sessionId === null
        ? undefined
        : await db.checkIns.where('sessionId').equals(input.sessionId).first()
    let saved: CheckIn
    if (existing) {
      saved = { ...existing, focus: input.focus, mood, updatedAt: now }
      await db.checkIns.put(saved)
    } else {
      const session = input.sessionId === null ? undefined : await db.sessions.get(input.sessionId)
      const startedAt = session?.startedAt ?? now
      const day = session?.day ?? dayOf(now)
      saved = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        sessionId: input.sessionId,
        at: now,
        day,
        hour: hourOf(startedAt),
        weekday: weekdayOf(dayOf(startedAt)),
        focus: input.focus,
        mood,
      }
      await db.checkIns.add(saved)
    }
    await refreshBestHour()
    return saved
  })
}

/**
 * Writes the best hour to `settings.scheduling.bestHour`: the top hour of all check-ins, or `null` while
 * none has enough ratings. Changes nothing (and emits nothing) when it is already right. Runs after every
 * save; call it after anything else that changes check-ins in bulk (an import).
 */
export async function refreshBestHour(): Promise<number | null> {
  const bestHour = topFocusHour(await db.checkIns.toArray())
  await updateSettings({ scheduling: { bestHour } })
  return bestHour
}
