import { useLiveQuery } from 'dexie-react-hooks'
import type { StreakDayStatus, StreakResult } from '@/logic/streaks'
import { loadStreak } from '../repos/progress'
import type { ISODate } from '../types'

export type {
  StreakDayEntry,
  StreakDayStatus,
  StreakMilestoneReached,
  StreakResult,
} from '@/logic/streaks'

/** The streak as the screens read it: the engine's result plus the two facts every widget wants. */
export interface StreakState extends StreakResult {
  /** How `today` stands: `qualified` once a session counted, `today-open` until then. */
  todayStatus: StreakDayStatus
  /** Alias of `freezeAvailableThisWeek`: this week's automatic freeze has not been used yet. */
  freezeAvailable: boolean
}

/**
 * The live streak: `current`, `best`, `currentStart`, the day-by-day `days` (❄️ = `frozen`),
 * `freezeAvailable`, `freezesUsed`, the milestones reached and `todayStatus`. It follows the
 * `streakDays` rows and the week-start setting, so it updates the moment a session counts. Pass the
 * app's `today` (`useToday()`) so it rolls over at midnight. `undefined` only while the first read is
 * loading; a failed read throws to the nearest error boundary, like every live query.
 */
export function useStreak(today: ISODate): StreakState | undefined {
  return useLiveQuery(async () => {
    const streak = await loadStreak(today)
    return {
      ...streak,
      todayStatus: streak.days.find((d) => d.day === today)?.status ?? 'today-open',
      freezeAvailable: streak.freezeAvailableThisWeek,
    }
  }, [today])
}
