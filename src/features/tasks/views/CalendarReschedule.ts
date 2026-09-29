import { useCallback, useRef } from 'react'
import { recordError } from '@/app/reportError'
import { moveTask } from '@/db/repos/tasks'
import type { ID, Task } from '@/db/types'
import type { Slot } from '@/logic/calendarWeek'
import { formatDayLong, formatTimeOfDay } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'
import { useTaskEnv } from '../TaskActions'

const TOAST_ID = 'calendar-move'
/** Nudges of the same task this close together are one Undo. */
const SERIES_MS = 4_000

function shorten(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * Moves a task to a day and time (a drop, or a keyboard nudge) through `moveTask`, which pins a scheduled
 * task so a rebalance leaves it where you put it. One toast says where it went (a polite live region, so
 * it is also the screen-reader announcement) and offers Undo. Repeated nudges of one task update the same
 * toast, and Undo goes back to where the series began. Resolves `false` when the write failed.
 */
export function useReschedule(): (task: Task, slot: Slot) => Promise<boolean> {
  const toast = useToast()
  const { today } = useTaskEnv()
  const series = useRef<{ id: ID; at: number; undos: Array<() => Promise<void>> } | null>(null)

  return useCallback(
    async (task, slot) => {
      try {
        const result = await moveTask(task.id, { dueDate: slot.dueDate, dueTime: slot.dueTime })
        if (!result) {
          toast.error('Couldn’t move the task', { description: 'It no longer exists.' })
          return false
        }
        const now = Date.now()
        const previous = series.current
        const undos =
          previous && previous.id === task.id && now - previous.at < SERIES_MS
            ? [...previous.undos, result.undo]
            : [result.undo]
        series.current = { id: task.id, at: now, undos }

        const when = `${formatDayLong(slot.dueDate, today)}${
          slot.dueTime ? `, ${formatTimeOfDay(slot.dueTime)}` : ', all day'
        }`
        toast.show({
          id: TOAST_ID,
          title: `Moved “${shorten(task.title)}”`,
          description:
            task.source === 'schedule' ? `${when}. Pinned: a rebalance will leave it here.` : when,
          undo: async () => {
            for (const undo of [...undos].reverse()) await undo()
            series.current = null
          },
        })
        return true
      } catch (error) {
        recordError(error, 'moveTask')
        toast.error('Couldn’t move the task', { description: 'Nothing was changed. Try again.' })
        return false
      }
    },
    [toast, today],
  )
}
