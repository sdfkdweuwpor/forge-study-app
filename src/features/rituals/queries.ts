/**
 * Reads the ritual screens need, as live queries. Every hook returns `undefined` only while its first
 * query is loading. This is the one file in the feature that may import the Dexie instance.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '@/db/db'
import { focusMinutesOn, getRitual, listReflections, loadTodayGroups } from '@/db/repos/rituals'
import { listRoutineRows, type RoutineRow } from '@/db/repos/templates'
import type { ID, ISODate, Ritual, Task } from '@/db/types'
import { openTodayItems, type RitualKind, type TodayItem } from '@/logic/rituals'
import { STARTER_ROUTINES, type RoutineEntry } from '@/logic/routines'

/** A ritual's row for a day: `null` when nothing has been written for it yet. */
export function useRitual(kind: RitualKind, day: ISODate): Ritual | null | undefined {
  return useLiveQuery(async () => (await getRitual(kind, day)) ?? null, [kind, day])
}

export interface TodayLists {
  /** Open work: planned for today, then carried over (what Today shows). */
  open: TodayItem[]
  /** Finished today, latest first. */
  done: Task[]
}

/** Today's open and finished work, from the Today screen's own grouping. */
export function useTodayLists(today: ISODate): TodayLists | undefined {
  return useLiveQuery(async () => {
    const groups = await loadTodayGroups(today)
    return { open: openTodayItems(groups, { today }), done: groups.completedToday }
  }, [today])
}

/** These tasks, in the order asked; a task that no longer exists comes back `undefined`. */
export function useTasksByIds(ids: readonly ID[]): (Task | undefined)[] | undefined {
  const key = ids.join('|')
  return useLiveQuery(() => db.tasks.bulkGet([...ids]), [key])
}

/** The newest one-line reflections. */
export function useReflections(limit = 30): Ritual[] | undefined {
  return useLiveQuery(() => listReflections(limit), [limit])
}

/** Saved routines (including any that cannot be read). */
export function useRoutineRows(): RoutineRow[] | undefined {
  return useLiveQuery(() => listRoutineRows(), [])
}

/** Counted focus minutes of a day. */
export function useFocusMinutes(day: ISODate): number | undefined {
  return useLiveQuery(() => focusMinutesOn(day), [day])
}

/** Routines the picker offers: yours first (the ones that can be read), then the built-in starters. */
export function useRoutineEntries(): RoutineEntry[] | undefined {
  const rows = useRoutineRows()
  return useMemo(
    () =>
      rows === undefined
        ? undefined
        : [
            ...rows.flatMap(({ template, payload }) =>
              payload
                ? [
                    {
                      id: template.id,
                      name: template.name,
                      icon: template.icon,
                      builtIn: false,
                      payload,
                    },
                  ]
                : [],
            ),
            ...STARTER_ROUTINES,
          ],
    [rows],
  )
}
