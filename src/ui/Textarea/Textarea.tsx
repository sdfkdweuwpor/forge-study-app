import { useCallback, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import type { ForceProps } from '../internal/force'
import { useMergedRef } from '../internal/refs'
import { Field, useField } from '../Input'
import styles from './Textarea.module.css'

export interface TextareaProps extends ComponentProps<'textarea'>, ForceProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  invalid?: boolean
  /** Height grows with the text from `minRows`… */
  minRows?: number
  /** …up to `maxRows`, then it scrolls. Unlimited by default. */
  maxRows?: number
  /** Styles the outer field wrapper. Every other prop goes to the <textarea>. */
  className?: string
}

/**
 * Multi-line text that grows with its content. Measures scrollHeight after every change (typing,
 * a new `value`, a width change), so it works in browsers without `field-sizing: content`.
 */
export function Textarea({
  label,
  hint,
  error,
  invalid,
  minRows = 3,
  maxRows,
  className,
  id,
  disabled,
  ref,
  value,
  onInput,
  'aria-describedby': describedByProp,
  'data-force': force,
  ...rest
}: TextareaProps) {
  const ids = useField({ id, hint, error, invalid, 'aria-describedby': describedByProp })
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const setRef = useMergedRef(ref, inner)

  const resize = useCallback(() => {
    const el = inner.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 21
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const min = minRows * line + padding
    const max = maxRows ? maxRows * line + padding : Number.POSITIVE_INFINITY
    el.style.height = 'auto'
    const content = el.scrollHeight
    el.style.height = `${Math.min(Math.max(content, min), max)}px`
    el.style.overflowY = content > max ? 'auto' : 'hidden'
  }, [minRows, maxRows])

  // Controlled value changes (and the first paint).
  useLayoutEffect(resize, [resize, value])

  // Width changes rewrap the text.
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [resize])

  return (
    <Field
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      className={className}
    >
      <textarea
        ref={setRef}
        id={ids.controlId}
        className={styles.textarea}
        rows={minRows}
        value={value}
        disabled={disabled}
        aria-invalid={ids.isInvalid || undefined}
        aria-describedby={ids.describedBy}
        data-invalid={ids.isInvalid || undefined}
        data-force={force}
        onInput={(e) => {
          resize()
          onInput?.(e)
        }}
        {...rest}
      />
    </Field>
  )
}
