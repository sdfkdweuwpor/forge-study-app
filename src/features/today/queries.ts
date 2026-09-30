/**
 * Reads that only the Today screen needs. This is the one file in the feature that may import the
 * Dexie instance. Every hook returns `undefined` only while its first query is loading.
 *
 * `useTodayPomodoros` reads `sessions`; `useStreak` and `useHeatmap` read the streak engine's data
 * (`streakDays` rows kept by the progress feature, freezes computed by `computeStreak`).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useStreak as useStreakState } from '@/db/hooks/useStreak'
import { loadStreak } from '@/db/repos/progress'
import type { ID, ISODate } from '@/db/types'
import { addDays, startOfWeekISO } from '@/logic/dates'
import { timePerGoal, type GoalTime } from '@/logic/timeLogged'
import {
  buildHeatmap,
  pomodorosDone,
  upcomingTargets,
  type Countdown,
  type Heatmap,
} from '@/logic/todayStats'
import { useSettings } from '@/db/hooks/useSettings'

/** What a task's chip needs to name its course. */
export interface CourseLabel {
  id: ID
  /** "C779", or null for a milestone without a code. */
  code: string | null
  title: string
  goalTitle: string | null
}

/** Courses by id (with their goal's title), for the Now card's chip. */
export function useCourseLabels(): ReadonlyMap<ID, CourseLabel> | undefined {
  return useLiveQuery(async () => {
    const [milestones, goals] = await Promise.all([db.milestones.toArray(), db.goals.toArray()])
    const goalTitle = new Map(goals.map((g) => [g.id, g.title]))
    return new Map<ID, CourseLabel>(
      milestones.map((m) => [
        m.id,
        { id: m.id, code: m.code, title: m.title, goalTitle: goalTitle.get(m.goalId) ?? null },
      ]),
    )
  })
}

/** Whether any goal exists (the empty state offers "Create a goal" only when none does). */
export function useHasGoals(): boolean | undefined {
  return useLiveQuery(async () => (await db.goals.count()) > 0)
}

/** XP each task earned today, by task id (reversals net out), for the "Completed today" rows. */
export function useTaskXpToday(today: ISODate): ReadonlyMap<ID, number> | undefined {
  return useLiveQuery(async () => {
    const events = await db.xpEvents.where('day').equals(today).toArray()
    const map = new Map<ID, number>()
    for (const e of events) {
      if (e.source === 'task' && e.refId) map.set(e.refId, (map.get(e.refId) ?? 0) + e.amount)
    }
    return map
  }, [today])
}

/**
 * Pomodoros finished today, from the `sessions` table (Phase 4 writes it; until then this is 0).
 * `pomodoroMinutes` is the pomodoro length from settings, used to turn custom and stopwatch sessions
 * into pomodoros.
 */
export function useTodayPomodoros(today: ISODate, pomodoroMinutes: number): number | undefined {
  return useLiveQuery(async () => {
    const rows = await db.sessions.where('[kind+day]').equals(['focus', today]).toArray()
    return pomodorosDone(rows, today, pomodoroMinutes)
  }, [today, pomodoroMinutes])
}

/**
 * The current streak in days, from the streak engine: qualifying days in the running streak, with the
 * weekly freeze carrying it over a day off and today still open never ending it. 0 when none is running.
 */
export function useStreak(today: ISODate): number | undefined {
  return useStreakState(today)?.current
}

/**
 * The last 14 days for the mini heatmap: focused minutes per day from the `streakDays` rows (counted
 * focus sessions), and as the fallback until there are any, the tasks finished each day. Days a streak
 * freeze covered come back with `frozen` and are drawn with a ❄️.
 */
export function useHeatmap(today: ISODate, length = 14): Heatmap | undefined {
  return useLiveQuery(async () => {
    const from = addDays(today, -(length - 1))
    const [rows, streak] = await Promise.all([
      db.streakDays.where('id').between(from, today, true, true).toArray(),
      loadStreak(today),
    ])
    const focusMinutes = new Map<ISODate, number>(rows.map((r) => [r.day, r.focusMinutes]))
    const tasksDone = new Map<ISODate, number>(rows.map((r) => [r.day, r.tasksDone]))
    const frozenDays = new Set<ISODate>(
      streak.days.filter((d) => d.status === 'frozen' && d.day >= from).map((d) => d.day),
    )
    return buildHeatmap({ today, length, focusMinutes, tasksDone, frozenDays })
  }, [today, length])
}

/** The next target dates (courses, milestones, goals) for the countdown card. */
export function useUpcomingTargets(today: ISODate, limit = 3): Countdown[] | undefined {
  return useLiveQuery(async () => {
    const [goals, milestones] = await Promise.all([db.goals.toArray(), db.milestones.toArray()])
    return upcomingTargets(goals, milestones, today, limit)
  }, [today, limit])
}

export { useNowTask } from './nowTask'

export interface GoalLabel {
  title: string
  icon: string
}

export interface TimeLogged {
  today: GoalTime[]
  week: GoalTime[]
  /** Titles and icons of the goals in the rows. */
  goals: ReadonlyMap<ID, GoalLabel>
}

/**
 * Focus minutes per goal for today and for the week so far. Each goal reads its own sessions through
 * the `[goalId+day]` index; sessions without a goal come from the `day` index and count as "Other".
 */
export function useTimeLogged(today: ISODate): TimeLogged | undefined {
  const settings = useSettings()
  const weekStartsOn = settings?.weekStartsOn
  return useLiveQuery(async () => {
    if (weekStartsOn === undefined) return undefined
    const weekStart = startOfWeekISO(today, weekStartsOn)
    const goals = (await db.goals.toArray()).sort(
      (a, b) => a.order - b.order || a.createdAt - b.createdAt,
    )
    const [perGoal, loose] = await Promise.all([
      Promise.all(
        goals.map((g) =>
          db.sessions
            .where('[goalId+day]')
            .between([g.id, weekStart], [g.id, today], true, true)
            .toArray(),
        ),
      ),
      db.sessions
        .where('day')
        .between(weekStart, today, true, true)
        .filter((s) => s.goalId === null || !goals.some((g) => g.id === s.goalId))
        .toArray(),
    ])
    const sessions = [...perGoal.flat(), ...loose]
    const order = goals.map((g) => g.id)
    return {
      today: timePerGoal(sessions, order, today, today),
      week: timePerGoal(sessions, order, weekStart, today),
      goals: new Map(goals.map((g) => [g.id, { title: g.title, icon: g.icon }])),
    }
  }, [today, weekStartsOn])
}
