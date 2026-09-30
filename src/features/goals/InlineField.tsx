import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '@/ui/internal/cx'
import styles from './InlineField.module.css'

export interface InlineFieldProps {
  value: string
  /** Called with the trimmed text when it changed and passed `accept`. */
  onCommit: (next: string) => void
  /** Accessible name: "Code", "Estimated hours". Also names the button that starts editing. */
  label: string
  /** What the button shows; defaults to the value, or the placeholder when it is empty. */
  display?: ReactNode
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
  maxLength?: number
  /** Return false to refuse the text: the field goes back to the old value without committing. */
  accept?: (next: string) => boolean
  /** Width of the field while editing, in `ch`. */
  size?: number
  align?: 'start' | 'end'
  className?: string
}

/**
 * A value you edit where it stands (BRIEF §3.7): click (or Enter on the button) to edit, Enter or leaving
 * commits, Esc puts the old text back. Reads as plain text until hovered.
 */
export function InlineField({
  value,
  onCommit,
  label,
  display,
  placeholder = 'Empty',
  inputMode = 'text',
  maxLength,
  accept,
  size = 10,
  align = 'start',
  className,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement | null>(null)
  // Enter and Esc end editing themselves; the blur that follows must not commit a second time.
  const finished = useRef(false)

  useEffect(() => {
    if (!editing) return
    finished.current = false
    input.current?.focus()
    input.current?.select()
  }, [editing])

  function begin() {
    setDraft(value)
    setEditing(true)
  }

  function finish(commit: boolean) {
    if (finished.current) return
    finished.current = true
    const next = draft.replace(/\s+/g, ' ').trim()
    setEditing(false)
    if (commit && next !== value && (accept ? accept(next) : true)) onCommit(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={input}
        className={cx(styles.input, className)}
        style={{ width: `${size}ch` }}
        data-align={align}
        aria-label={label}
        inputMode={inputMode}
        maxLength={maxLength}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(true)}
      />
    )
  }

  const empty = value === ''
  return (
    <button
      type="button"
      className={cx(styles.display, className)}
      data-empty={empty || undefined}
      data-align={align}
      aria-label={`${label}: ${empty ? 'empty' : value}. Edit`}
      onClick={begin}
    >
      {display ?? (empty ? placeholder : value)}
    </button>
  )
}
