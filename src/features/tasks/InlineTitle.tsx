import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { cx } from '@/ui/internal/cx'
import styles from './InlineTitle.module.css'

interface InlineTitleProps {
  value: string
  /** Called with the trimmed new text; never with an empty or unchanged value. */
  onCommit: (next: string) => void
  /** Controlled, so a shortcut (`e`) can start editing from outside. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Accessible name of the field and of the button that starts editing. */
  label: string
  /** Turns editing off (a coarse pointer opens the task instead, so a tap does not raise the keyboard). */
  editable?: boolean
  /** Called instead of editing when `editable` is false. */
  onActivate?: () => void
  /** Drawn struck through in a quiet colour. Becoming done sweeps the line across the text. */
  done?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * A title you edit where it stands: click to edit, Enter commits, Esc puts the old text back, leaving
 * the field commits. Renders as a real button (so keyboard and screen readers can start editing) that
 * becomes a text input in place, at the same size, without the row shifting.
 */
export function InlineTitle({
  value,
  onCommit,
  editing,
  onEditingChange,
  label,
  editable = true,
  onActivate,
  done = false,
  className,
  style,
}: InlineTitleProps) {
  const [draft, setDraft] = useState(value)
  // Editing can start from outside (the `e` shortcut, the row menu), not only from a click on the
  // button, so the draft is refreshed whenever editing turns on, whoever turned it on.
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) setDraft(value)
  }
  const input = useRef<HTMLTextAreaElement | null>(null)
  // Enter and Esc end editing themselves; the blur that follows must not commit a second time.
  const finished = useRef(false)

  useEffect(() => {
    if (!editing) return
    finished.current = false
    const el = input.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  function begin() {
    if (!editable) {
      onActivate?.()
      return
    }
    onEditingChange(true)
  }

  function finish(commit: boolean) {
    if (finished.current) return
    finished.current = true
    const next = draft.replace(/\s+/g, ' ').trim()
    if (commit && next !== '' && next !== value) onCommit(next)
    onEditingChange(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Esc reverts here; it must not also close the peek panel or clear the selection.
      e.stopPropagation()
      finish(false)
    }
  }

  if (editing) {
    return (
      // The wrapper's text mirror (see the stylesheet) sizes the textarea to what it holds.
      <span className={cx(styles.root, className)} style={style} data-editing="" data-value={draft}>
        {/* A textarea, so a long title wraps instead of scrolling sideways; Enter still commits. */}
        <textarea
          ref={input}
          className={styles.input}
          value={draft}
          rows={1}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true)}
        />
      </span>
    )
  }

  return (
    <span className={cx(styles.root, className)} style={style}>
      <button
        type="button"
        className={styles.display}
        data-drag-through=""
        data-done={done || undefined}
        aria-label={`${value}. Edit ${label.toLowerCase()}`}
        onClick={begin}
      >
        <span className={styles.text}>{value}</span>
      </button>
    </span>
  )
}
