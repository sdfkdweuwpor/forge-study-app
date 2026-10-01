import { useMemo } from 'react'
import { recordError } from '@/app/reportError'
import { moveTasksToDay, type MoveResult } from '@/db/repos/rituals'
import { applyRoutine } from '@/db/repos/templates'
import type { ID, ISODate } from '@/db/types'
import type { RoutineEntry } from '@/logic/routines'
import { dayWords } from '@/logic/rituals'
import { relativeDay } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export interface RitualActions {
  /** Adds a routine's tasks to a day, with a toast that undoes it. Resolves to how many were added. */
  apply(entry: RoutineEntry, day: ISODate, today: ISODate): Promise<number>
  /**
   * Plans tasks for a day in one transaction. With `toast` it says what moved, with an Undo. Resolves to
   * the result, or `null` when the write failed (already reported, nothing changed).
   */
  move(
    ids: readonly ID[],
    day: ISODate,
    today: ISODate,
    toast?: { title: string; description?: string },
  ): Promise<MoveResult | null>
}

/** What the ritual dialogs do to tasks, each reporting failure in words and never throwing. */
export function useRitualActions(): RitualActions {
  const toast = useToast()
  return useMemo<RitualActions>(
    () => ({
      async apply(entry, day, today) {
        try {
          const { tasks, undo } = await applyRoutine(entry.payload, day)
          toast.show({
            title: `Added ${plural(tasks.length, 'task')} to ${relativeDay(day, today)}`,
            description: entry.name,
            variant: 'success',
            undo,
          })
          return tasks.length
        } catch (error) {
          recordError(error, 'applyRoutine')
          toast.error('Couldn’t add that routine', {
            description: 'Nothing was changed. Try again.',
          })
          return 0
        }
      },
      async move(ids, day, today, message) {
        try {
          const result = await moveTasksToDay(ids, day)
          if (message && result.moved.length > 0) {
            toast.show({
              title: message.title,
              description: message.description ?? `Planned for ${dayWords(day, today)}`,
              undo: result.undo,
            })
          }
          return result
        } catch (error) {
          recordError(error, 'moveTasksToDay')
          toast.error('Couldn’t move the tasks', { description: 'Nothing was changed. Try again.' })
          return null
        }
      },
    }),
    [toast],
  )
}
