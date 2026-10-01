/**
 * Focus time logged per goal (pure). Sessions come from the `sessions` table; a session with no goal (or
 * one whose goal was deleted) counts as "Other". Nothing here scolds: a day with no time is just empty.
 */
import type { ID, ISODate, Session } from '@/db/types'

export type LoggedSession = Pick<Session, 'goalId' | 'day' | 'kind' | 'status' | 'actualMinutes'>

/** A finished (or stopped) focus session with real minutes on it. Breaks and running timers do not count. */
export function countsAsLogged(s: LoggedSession): boolean {
  return (
    s.kind === 'focus' &&
    (s.status === 'completed' || s.status === 'abandoned') &&
    (s.actualMinutes ?? 0) > 0
  )
}

export interface GoalTime {
  /** `null` = Other. */
  goalId: ID | null
  minutes: number
}

/**
 * Minutes per goal for the sessions between `from` and `to` (inclusive days). Most time first, ties in
 * `goalOrder`; "Other" is always last. Goals with no time are left out.
 */
export function timePerGoal(
  sessions: readonly LoggedSession[],
  goalOrder: readonly ID[],
  from: ISODate,
  to: ISODate,
): GoalTime[] {
  const known = new Set(goalOrder)
  const totals = new Map<ID | null, number>()
  for (const s of sessions) {
    if (!countsAsLogged(s) || s.day < from || s.day > to) continue
    const key = s.goalId !== null && known.has(s.goalId) ? s.goalId : null
    totals.set(key, (totals.get(key) ?? 0) + Math.round(s.actualMinutes ?? 0))
  }
  const order = (id: ID | null): number => (id === null ? Infinity : goalOrder.indexOf(id))
  return [...totals.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([goalId, minutes]) => ({ goalId, minutes }))
    .sort((a, b) => {
      if ((a.goalId === null) !== (b.goalId === null)) return a.goalId === null ? 1 : -1
      return b.minutes - a.minutes || order(a.goalId) - order(b.goalId)
    })
}

/** "45 min", "1 h 25 min", "2 h". */
export function formatLogged(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}
