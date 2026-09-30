import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '@/ui/internal/cx'
import styles from './RewardsInline.module.css'

export interface RewardsInlineProps {
  value: string
  /** Called with the cleaned text when it changed and passed `validate`. */
  onCommit: (next: string) => void
  /** Accessible name: "Title of 30 min gaming". Also names the button that starts editing. */
  label: string
  /** What the button shows; defaults to the value. */
  display?: ReactNode
  /** Returns a message to refuse the text (the field stays open on Enter), or `null` to accept it. */
  validate?: (next: string) => string | null
  inputMode?: 'text' | 'numeric'
  maxLength?: number
  /** Width of the field while editing, in `ch`; omit to fill the row. */
  size?: number
  /** Text after the field while editing ("XP"). */
  suffix?: string
  className?: string
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * A value you edit where it stands (BRIEF §3.7): click, or Enter on the button, to edit; Enter commits,
 * Esc puts the old text back, and leaving the field commits when the text is acceptable and otherwise
 * reverts. A refused Enter keeps the field open with the reason under it.
 */
export function RewardsInline({
  value,
  onCommit,
  label,
  display,
  validate,
  inputMode = 'text',
  maxLength,
  size,
  suffix,
  className,
}: RewardsInlineProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  // After a key ends editing, focus goes back to the button so the keyboard user keeps their place.
  const restoreFocus = useRef(false)
  const errorId = useId()
  // Enter and Esc end editing themselves; the blur that follows must not commit a second time.
  const finished = useRef(false)

  useEffect(() => {
    if (!editing) return
    finished.current = false
    input.current?.focus()
    input.current?.select()
  }, [editing])

  useEffect(() => {
    if (editing || !restoreFocus.current) return
    restoreFocus.current = false
    button.current?.focus()
  }, [editing])

  function begin() {
    setDraft(value)
    setError(null)
    setEditing(true)
  }

  function stop() {
    finished.current = true
    setEditing(false)
    setError(null)
  }

  /** `strict`: a refused text keeps the field open (Enter). Otherwise it reverts (blur). */
  function commit(strict: boolean) {
    if (finished.current) return
    const next = clean(draft)
    if (strict) restoreFocus.current = true
    if (next === value) return stop()
    const problem = validate ? validate(next) : null
    if (problem !== null) {
      if (strict) {
        restoreFocus.current = false
        setError(problem)
      } else stop()
      return
    }
    stop()
    onCommit(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      restoreFocus.current = true
      stop()
    }
  }

  if (editing) {
    return (
      <span className={cx(styles.editor, className)} data-fill={size === undefined || undefined}>
        <span className={styles.line}>
          <input
            ref={input}
            className={styles.input}
            style={size === undefined ? undefined : { width: `${size}ch` }}
            aria-label={label}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? errorId : undefined}
            inputMode={inputMode}
            maxLength={maxLength}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => commit(false)}
          />
          {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
        </span>
        {error !== null ? (
          <span id={errorId} role="alert" className={styles.error}>
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <button
      ref={button}
      type="button"
      className={cx(styles.display, className)}
      aria-label={`${label}: ${value}. Edit`}
      onClick={begin}
    >
      {display ?? value}
    </button>
  )
}
