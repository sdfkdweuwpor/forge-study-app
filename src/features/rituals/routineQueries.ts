/**
 * Reads for the routine screens (the picker, the save dialog, Settings). They live apart from `queries.ts`
 * on purpose: the routine repo and its Zod schema are only needed by those lazy screens, and `queries.ts`
 * is imported by the cards on Today, which are in the first paint.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { listRoutineRows, type RoutineRow } from '@/db/repos/templates'
import { STARTER_ROUTINES, type RoutineEntry } from '@/logic/routines'

/** Saved routines (including any that cannot be read). */
export function useRoutineRows(): RoutineRow[] | undefined {
  return useLiveQuery(() => listRoutineRows(), [])
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
