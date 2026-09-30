import { useCallback, useEffect, useRef, useState } from 'react'
import { recordError } from '@/app/reportError'
import type { Block } from '@/db/types'
import { BlockEditor } from '@/ui/BlockEditor'

/** Saving while you type would rewrite the row on every keystroke; wait for a pause. */
const SAVE_DELAY_MS = 600

export interface NotesEditorProps {
  /** The stored notes when the page opened. The editor owns the document while it is mounted. */
  initial: readonly Block[]
  /** Writes the whole document. Called after a pause in typing, and on every way of leaving. */
  onSave: (blocks: Block[]) => Promise<unknown>
  /** Accessible name. */
  label: string
  placeholder?: string
  className?: string
}

/**
 * Free-form notes for a goal or a course (BRIEF §5.4): the shared block editor with its slash menu,
 * saved after a short pause and flushed when the tab is hidden, the page is left, or the editor unmounts
 * (the same rules as a task's notes). Render it with `key={rowId}` so another row starts fresh.
 */
export function NotesEditor({ initial, onSave, label, placeholder, className }: NotesEditorProps) {
  const [blocks, setBlocks] = useState<readonly Block[]>(initial)
  const pending = useRef<Block[] | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const save = useRef(onSave)
  useEffect(() => {
    save.current = onSave
  })

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const unsaved = pending.current
    if (!unsaved) return
    pending.current = null
    try {
      await save.current(unsaved)
    } catch (error) {
      recordError(error, 'saveGoalNotes')
    }
  }, [])

  useEffect(() => {
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
      void flush()
    }
  }, [flush])

  return (
    <BlockEditor
      value={blocks}
      placeholder={placeholder ?? 'Add notes, or type / for blocks'}
      aria-label={label}
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
