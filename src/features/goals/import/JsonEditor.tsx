import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
} from 'react'
import styles from './JsonEditor.module.css'

export interface JsonEditorHandle {
  /** Selects the whole of a 1-based line and scrolls it into view. */
  jumpToLine(line: number): void
  focus(): void
}

export interface JsonEditorProps {
  value: string
  onChange(value: string): void
  /** Visible label (the field's accessible name). */
  label: string
  /** 1-based lines with a problem: they get a marker in the gutter and a tinted band. */
  errorLines?: readonly number[]
  /** Id of the element that describes this field (the problems list). */
  describedBy?: string
  placeholder?: string
  /** Runs on Ctrl/Cmd+Enter. */
  onSubmit?(): void
  ref?: Ref<JsonEditorHandle>
}

/** Rows shown even when the text is shorter, so an empty editor still looks like a place to paste. */
const MIN_ROWS = 14

/**
 * A plain textarea with a line-number gutter (BRIEF §5.4). Lines never wrap, so the gutter stays aligned
 * with the text: one row is `--editor-line` tall in both. The gutter and the error bands are moved with
 * the textarea's scroll position by transform, without re-rendering.
 */
export function JsonEditor({
  value,
  onChange,
  label,
  errorLines = [],
  describedBy,
  placeholder,
  onSubmit,
  ref,
}: JsonEditorProps) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement | null>(null)
  const gutter = useRef<HTMLDivElement | null>(null)
  const bands = useRef<HTMLDivElement | null>(null)

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const rows = Math.max(lineCount, MIN_ROWS)
  const errors = useMemo(() => new Set(errorLines), [errorLines])
  const digits = String(rows).length

  const syncScroll = (): void => {
    const el = area.current
    if (!el) return
    const move = `translateY(${-el.scrollTop}px)`
    if (gutter.current) gutter.current.style.transform = move
    if (bands.current) bands.current.style.transform = move
  }
  // Text changes (a paste can shrink the content and move the scroll position without a scroll event).
  useLayoutEffect(syncScroll, [value])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => area.current?.focus(),
      jumpToLine(line: number) {
        const el = area.current
        if (!el) return
        const lines = el.value.split('\n')
        const n = Math.max(1, Math.min(line, lines.length))
        const start = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0)
        el.focus()
        el.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0))
        // Put the line a third of the way down, so the lines above it give context.
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
        el.scrollTop = Math.max(0, (n - 1) * lineHeight - el.clientHeight / 3)
        syncScroll()
      },
    }),
    [],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Stops the global "quick add" on the same keys from also firing.
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div
        className={styles.editor}
        data-invalid={errors.size > 0 || undefined}
        style={{ '--digits': digits } as CSSProperties}
      >
        <div className={styles.gutter} aria-hidden="true">
          <div ref={gutter} className={styles.gutterInner}>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={styles.num} data-error={errors.has(i + 1) || undefined}>
                {errors.has(i + 1) ? <span className={styles.marker} /> : null}
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.bands} aria-hidden="true">
            <div ref={bands} className={styles.bandsInner}>
              {[...errors].map((line) => (
                <div key={line} className={styles.band} style={{ '--line-no': line } as CSSProperties} />
              ))}
            </div>
          </div>
          <textarea
            ref={area}
            id={id}
            className={styles.input}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            aria-invalid={errors.size > 0 || undefined}
            aria-describedby={describedBy}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  )
}
