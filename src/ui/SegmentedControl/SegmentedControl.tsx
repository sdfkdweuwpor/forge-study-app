import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { nextIndex } from '../internal/roving'
import { useControllable } from '../internal/useControllable'
import { useIndicator } from '../internal/useIndicator'
import styles from './SegmentedControl.module.css'

export interface SegmentOption<V extends string> {
  value: V
  label?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  /** Required for icon-only segments. */
  'aria-label'?: string
}

export interface SegmentedControlProps<V extends string>
  extends Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue' | 'role'>,
    ForceProps {
  options: readonly SegmentOption<V>[]
  value?: V
  defaultValue?: V
  onValueChange?: (value: V) => void
  /** Accessible name of the group, e.g. "Timer mode". */
  label: string
  /** md = 32px, sm = 28px. */
  size?: 'sm' | 'md'
  /** Stretch to the container, segments share the width equally. */
  fullWidth?: boolean
  disabled?: boolean
}

/**
 * A small set of mutually exclusive options (Pomodoro / Custom / Stopwatch). Radiogroup semantics:
 * one Tab stop, arrow keys move and select, Home/End jump. A thumb slides under the selection.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
  'data-force': force,
  ...rest
}: SegmentedControlProps<V>) {
  const [selected, setSelected] = useControllable<V | undefined>(
    value,
    defaultValue,
    onValueChange as ((v: V | undefined) => void) | undefined,
  )
  const groupRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLSpanElement | null>(null)
  useIndicator(groupRef, thumbRef, '[aria-checked="true"]', `${selected}|${options.length}`)

  const isDisabled = options.map((o) => disabled || !!o.disabled)
  const selectedIndex = options.findIndex((o) => o.value === selected)
  const tabStop = selectedIndex >= 0 ? selectedIndex : isDisabled.indexOf(false)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(e.key, index, isDisabled)
    const option = next === null ? undefined : options[next]
    if (next === null || !option) return
    e.preventDefault()
    setSelected(option.value)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx(styles.group, className)}
      data-size={size}
      data-full={fullWidth || undefined}
      data-force={force}
      {...rest}
    >
      <span ref={thumbRef} className={styles.thumb} aria-hidden="true" />
      {options.map((o, i) => {
        const checked = i === selectedIndex
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o['aria-label']}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={isDisabled[i]}
            className={styles.item}
            data-icon-only={(o.label == null && o.icon != null) || undefined}
            onClick={() => setSelected(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon != null && (
              <span className={styles.icon} aria-hidden="true">
                {o.icon}
              </span>
            )}
            {o.label != null && <span className={styles.text}>{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
