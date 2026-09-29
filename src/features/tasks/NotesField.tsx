import { useCallback, useEffect, useRef } from 'react'
import { recordError } from '@/app/reportError'
import { updateTask } from '@/db/repos/tasks'
import type { Block, Task } from '@/db/types'
import { BlockEditor } from '@/ui/BlockEditor'

/** Saving while you type would rewrite the task on every keystroke; wait for a pause. */
const SAVE_DELAY_MS = 600

/**
 * The task's notes: the shared block editor (slash menu, headings, to-dos, callouts), saved after a
 * short pause and flushed when the panel closes or another task opens. Render it with `key={task.id}`.
 */
export function NotesField({
  task,
  className,
}: {
  task: Pick<Task, 'id' | 'notes'>
  className?: string
}) {
  const { id } = task
  const pending = useRef<Block[] | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const blocks = pending.current
    if (!blocks) return
    pending.current = null
    updateTask(id, { notes: blocks }).catch((error: unknown) => recordError(error, 'saveNotes'))
  }, [id])

  useEffect(() => flush, [flush])

  return (
    <BlockEditor
      value={task.notes}
      placeholder="Add notes, or type / for blocks"
      aria-label="Notes"
      className={className}
      onChange={(blocks) => {
        pending.current = blocks
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
      }}
    />
  )
}
