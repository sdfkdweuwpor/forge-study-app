import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { useMergedRef } from '../internal/refs'
import styles from './Checkbox.module.css'

export interface CheckboxProps
  extends Omit<ComponentProps<'input'>, 'type' | 'size' | 'children'>, ForceProps {
  /** round: tasks (Things-style). square: settings and lists. */
  variant?: 'square' | 'round'
  /** Mixed state ("some subtasks done"). Visual only; the checked value is unchanged. */
  indeterminate?: boolean
  /** Visible label to the right. Without it, pass aria-label. */
  label?: ReactNode
  onCheckedChange?: (checked: boolean) => void
  /**
   * Completion-motion hook (Phase 3): fires when the fill-and-draw animation that follows a
   * change to checked has finished (about 300ms; at once with reduced motion). It does not fire
   * when a checkbox mounts already checked, since that plays no animation.
   */
  onCheckAnimationEnd?: () => void
}

/**
 * Checkbox on a real <input type="checkbox"> (keyboard, forms and screen readers for free), drawn
 * by a sibling box. Becoming checked plays a fill from the rim inward, then the tick draws itself.
 * Colours are overridable per instance: --cb-color (fill; e.g. a priority colour), --cb-line
 * (unchecked rim), --cb-check (tick).
 */
export function Checkbox({
  variant = 'square',
  indeterminate = false,
  label,
  checked,
  defaultChecked,
  onChange,
  onCheckedChange,
  onCheckAnimationEnd,
  className,
  style,
  disabled,
  ref,
  'data-force': force,
  ...rest
}: CheckboxProps) {
  const inner = useRef<HTMLInputElement | null>(null)
  const setRef = useMergedRef(ref, inner)
  const isControlled = checked !== undefined
  const [innerChecked, setInnerChecked] = useState(!!defaultChecked)
  const on = isControlled ? !!checked : innerChecked

  // Animate only a change to checked, never a list that mounts already done.
  const [prevOn, setPrevOn] = useState(on)
  const [animate, setAnimate] = useState(false)
  if (on !== prevOn) {
    setPrevOn(on)
    setAnimate(on)
  }

  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  }, [indeterminate])

  const state = indeterminate ? 'indeterminate' : on ? 'checked' : 'unchecked'
  const Root = label != null ? 'label' : 'span'

  return (
    <Root
      className={cx(styles.root, className)}
      style={style}
      data-variant={variant}
      data-state={state}
      data-animate={(animate && on) || undefined}
      data-disabled={disabled || undefined}
      data-force={force}
    >
      <span className={styles.control}>
        <input
          ref={setRef}
          type="checkbox"
          className={styles.input}
          checked={isControlled ? on : undefined}
          defaultChecked={isControlled ? undefined : defaultChecked}
          disabled={disabled}
          onChange={(e) => {
            if (!isControlled) setInnerChecked(e.target.checked)
            onChange?.(e)
            onCheckedChange?.(e.target.checked)
          }}
          {...rest}
        />
        <span className={styles.box} aria-hidden="true">
          <svg
            className={styles.check}
            viewBox="0 0 16 16"
            data-motion="opacity"
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) onCheckAnimationEnd?.()
            }}
          >
            <path d="M4.25 8.4 6.9 11 11.75 5.5" pathLength={1} />
          </svg>
          <svg className={styles.dash} viewBox="0 0 16 16">
            <path d="M4.75 8h6.5" />
          </svg>
        </span>
      </span>
      {label != null && <span className={styles.label}>{label}</span>}
    </Root>
  )
}
