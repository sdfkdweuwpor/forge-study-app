/**
 * Reads that only the Today screen needs. This is the one file in the feature that may import the
 * Dexie instance. Every hook returns `undefined` only while its first query is loading.
 *
 * Phase 4 fills `sessions` and Phase 7 fills `streakDays`: `useTodayPomodoros`, `useStreak` and
 * `useHeatmap` are the seams. Swap what they read and the Today widgets follow.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '@/db/db'
import { useTasks } from '@/db/hooks/useTasks'
import type { ID, ISODate, Task } from '@/db/types'
import { addDays } from '@/logic/dates'
import { pickNow } from '@/logic/today'
import {
  buildHeatmap,
  currentStreak,
  pomodorosDone,
  upcomingTargets,
  type Countdown,
  type Heatmap,
} from '@/logic/todayStats'
import { useToday } from '@/app/hooks/useToday'

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
 * The current streak in days. Reads the `streakDays` rows Phase 7 maintains; with none, it is 0.
 * Phase 7 can replace the body with its own `useStreak` (freezes included).
 */
export function useStreak(today: ISODate): number | undefined {
  return useLiveQuery(async () => {
    const rows = await db.streakDays.toArray()
    return currentStreak(rows, today)
  }, [today])
}

/**
 * The last 14 days for the mini heatmap: focused minutes from finished, counted focus sessions and,
 * as the fallback until there are any, the number of tasks finished each day. Phase 7 can swap the
 * source for `streakDays.focusMinutes` and keep the return shape.
 */
export function useHeatmap(today: ISODate, length = 14): Heatmap | undefined {
  return useLiveQuery(async () => {
    const from = addDays(today, -(length - 1))
    const [sessions, done] = await Promise.all([
      db.sessions.where('day').between(from, today, true, true).toArray(),
      db.tasks.where('completedDay').between(from, today, true, true).toArray(),
    ])
    const focusMinutes = new Map<ISODate, number>()
    for (const s of sessions) {
      if (s.kind !== 'focus' || s.status !== 'completed' || !s.counted) continue
      focusMinutes.set(s.day, (focusMinutes.get(s.day) ?? 0) + (s.actualMinutes ?? 0))
    }
    const tasksDone = new Map<ISODate, number>()
    for (const t of done) {
      if (t.status === 'done' && t.completedDay) {
        tasksDone.set(t.completedDay, (tasksDone.get(t.completedDay) ?? 0) + 1)
      }
    }
    return buildHeatmap({ today, length, focusMinutes, tasksDone })
  }, [today, length])
}

/** The next target dates (courses, milestones, goals) for the countdown card. */
export function useUpcomingTargets(today: ISODate, limit = 3): Countdown[] | undefined {
  return useLiveQuery(async () => {
    const [goals, milestones] = await Promise.all([db.goals.toArray(), db.milestones.toArray()])
    return upcomingTargets(goals, milestones, today, limit)
  }, [today, limit])
}

/**
 * The single task to do next (`pickNow`), live. `null` when nothing is actionable, `undefined` while
 * loading. Other features (Phase 4's Start focus shortcut, a sidebar timer) can read it through the
 * `@/features/today` index.
 */
export function useNowTask(): Task | null | undefined {
  const tasks = useTasks()
  const today = useToday()
  return useMemo(() => (tasks ? pickNow(tasks, { today }) : undefined), [tasks, today])
}
