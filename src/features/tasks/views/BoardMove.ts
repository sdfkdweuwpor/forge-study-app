import { useCallback } from 'react'
import { recordError } from '@/app/reportError'
import { completeTask, moveTask, setTaskStatus, uncompleteTask } from '@/db/repos/tasks'
import type { ID, Task } from '@/db/types'
import { columnLabel, type BoardColumnId } from '@/logic/boardColumns'
import { formatXp, relativeDay } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'
import { useTaskEnv } from '../TaskActions'

/** One drop on the board, after it has been resolved to a column and two neighbours. */
export interface BoardMove {
  id: ID
  from: BoardColumnId
  to: BoardColumnId
  /** The cards it now sits between in the target column (the fractional `boardOrder`). */
  above: ID | null
  below: ID | null
  /** Write the new position too (only in the manual sort, and never in Done, which is newest first). */
  reorder: boolean
}

function shorten(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * Applies a board move through the repos, so XP, Undo and recurrence work exactly as elsewhere:
 * Done is `completeTask` (XP toast with Undo), leaving Done is `uncompleteTask` (to To do or Doing), To do ⇄ Doing is
 * `setTaskStatus`, and the position is `moveTask` on `boardOrder`. One toast Undo reverses all of it.
 * Resolves `false` when a write failed (an error toast is already shown).
 */
export function useBoardMove(): (task: Task, move: BoardMove) => Promise<boolean> {
  const toast = useToast()
  const { today } = useTaskEnv()

  return useCallback(
    async (task, move) => {
      const undos: Array<() => Promise<void>> = []
      const label = shorten(task.title)
      let title = `Moved “${label}” to ${columnLabel(move.to)}`
      let description: string | undefined
      let variant: 'default' | 'xp' | 'success' = 'default'
      try {
        if (move.from !== move.to) {
          if (move.to === 'done') {
            const result = await completeTask(task.id)
            undos.push(result.undo)
            title = `Completed “${label}”`
            variant = result.xp > 0 ? 'xp' : 'success'
            const parts = [
              result.xp > 0 ? formatXp(result.xp) : null,
              result.next?.dueDate ? `Next: ${relativeDay(result.next.dueDate, today)}` : null,
            ].filter((part): part is string => part !== null)
            if (parts.length > 0) description = parts.join(' · ')
          } else if (move.from === 'done') {
            // Out of Done to To do or Doing: one write that takes the XP back and sets the status.
            const result = await uncompleteTask(task.id, { to: move.to })
            undos.push(result.undo)
            if (result.xp < 0) description = formatXp(result.xp)
          } else {
            const result = await setTaskStatus(task.id, move.to)
            if (result) undos.push(result.undo)
          }
        }
        if (move.reorder) {
          const result = await moveTask(task.id, {
            reorder: { above: move.above, below: move.below, key: 'boardOrder' },
          })
          if (result) undos.push(result.undo)
        }
      } catch (error) {
        recordError(error, 'moveTask')
        // A half-applied move (the status changed, the position did not) is put back.
        for (const undo of [...undos].reverse()) await undo().catch(() => undefined)
        toast.error('Couldn’t move the task', { description: 'Nothing was changed. Try again.' })
        return false
      }
      if (move.from !== move.to) {
        toast.show({
          title,
          variant,
          ...(description ? { description } : {}),
          undo: async () => {
            for (const undo of [...undos].reverse()) await undo()
          },
        })
      }
      return true
    },
    [toast, today],
  )
}
