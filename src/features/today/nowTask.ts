import { useMemo } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { useOpenTasks } from '@/db/hooks/useTasks'
import type { Task } from '@/db/types'
import { pickNow } from '@/logic/today'

/**
 * The single task to do next (`pickNow`), live. `null` when nothing is actionable, `undefined` while
 * loading. Other features (Phase 4's Start focus shortcut, a sidebar timer) can read it through the
 * `@/features/today` index.
 *
 * It lives apart from `queries.ts` because the Start focus hotkey is in the first download and the rest
 * of those queries (the heatmap, time per goal, today's stats) are only for the Today page.
 */
export function useNowTask(): Task | null | undefined {
  // Only open tasks can be next (`pickNow` drops the rest), and this runs on every page (the Start focus
  // hotkey): reading every task ever finished on each write would be wasted work.
  const tasks = useOpenTasks()
  const today = useToday()
  return useMemo(() => (tasks ? pickNow(tasks, { today }) : undefined), [tasks, today])
}
