import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import type { TagColor } from '@/db/types'
import type { InputSegment, QuickAddToken } from '@/logic/quickAdd'
import styles from './QuickAdd.module.css'

export interface QuickAddFieldProps {
  value: string
  onChange: (value: string) => void
  /** `value` cut at the token boundaries; the recognised runs are tinted behind the text. */
  segments: readonly InputSegment[]
  colorOf: (token: QuickAddToken) => TagColor
  /** Enter adds and closes; Shift+Enter adds and keeps the field open for the next one. */
  onSubmit: (keepOpen: boolean) => void
  onEscape: () => void
  placeholder: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  /** The textarea, so the dialog can focus it. */
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * A one-line text field that shows what was recognised: the input is a transparent textarea laid
 * over a copy of its text in which the tokens carry a soft tint, so the caret, selection, IME and
 * paste stay native. It wraps instead of scrolling sideways (the copy could not follow), grows to a
 * few lines for a long title, and never contains a newline.
 */
export function QuickAddField({
  value,
  onChange,
  segments,
  colorOf,
  onSubmit,
  onEscape,
  placeholder,
  describedBy,
  invalid,
  disabled,
  inputRef,
}: QuickAddFieldProps) {
  const backdrop = useRef<HTMLDivElement>(null)

  // Grow with the text (up to the CSS max-height, then scroll) and keep the copy scrolled with it.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (backdrop.current) backdrop.current.scrollTop = el.scrollTop
  }, [value, inputRef])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit(e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onEscape()
    }
  }

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    // A pasted line break would make the copy and the field disagree about wrapping.
    onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))
  }

  return (
    <div className={styles.field}>
      <div ref={backdrop} className={styles.backdrop} aria-hidden="true">
        {segments.map((seg, i) =>
          seg.token ? (
            <mark
              key={i}
              className={styles.mark}
              data-kind={seg.token.kind}
              data-color={colorOf(seg.token)}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </div>
      <textarea
        ref={inputRef}
        className={styles.textarea}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label="New task"
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
        enterKeyHint="send"
        disabled={disabled}
        data-autofocus=""
        onChange={onInput}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop
        }}
      />
    </div>
  )
}
