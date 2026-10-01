import { useCallback, useEffect, useRef, useState } from 'react'
import { recordError } from '@/app/reportError'
import { updateTask } from '@/db/repos/tasks'
import type { Block, Task } from '@/db/types'
import { BlockEditor } from '@/ui/BlockEditor'
import { registerNotesFlush } from './notesSave'

/** Saving while you type would rewrite the task on every keystroke; wait for a pause. */
const SAVE_DELAY_MS = 600

/**
 * The task's notes: the shared block editor (slash menu, headings, to-dos, callouts), saved after a
 * short pause and flushed when the panel closes, another task opens, the tab is hidden or the page is
 * left, and before the task is trashed. Render it with `key={task.id}`.
 *
 * The field owns the document while it is open: `blocks` is what was typed last, so a parent that
 * re-renders before the first save lands hands the editor its own text back, not the stale stored one.
 */
export function NotesField({
  task,
  className,
}: {
  task: Pick<Task, 'id' | 'notes'>
  className?: string
}) {
  const { id } = task
  const [blocks, setBlocks] = useState<readonly Block[]>(task.notes)
  const pending = useRef<Block[] | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const unsaved = pending.current
    if (!unsaved) return
    pending.current = null
    try {
      await updateTask(id, { notes: unsaved })
    } catch (error) {
      recordError(error, 'saveNotes')
    }
  }, [id])

  useEffect(() => {
    const unregister = registerNotesFlush(id, flush)
    // A hidden tab may never come back, and a page being left will not wait for the timer.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      unregister()
      void flush()
    }
  }, [flush, id])

  return (
    <BlockEditor
      value={blocks}
      placeholder="Add notes, or type / for blocks"
      aria-label="Notes"
      className={className}
      onChange={(next) => {
        setBlocks(next)
        pending.current = next
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
      }}
    />
  )
}
