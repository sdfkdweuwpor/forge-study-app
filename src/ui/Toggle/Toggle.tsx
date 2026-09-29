import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { useControllable } from '../internal/useControllable'
import styles from './Toggle.module.css'

export interface ToggleProps
  extends Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'children' | 'role'>, ForceProps {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  /** md = 32×18 (settings rows), sm = 26×14 (dense lists). */
  size?: 'sm' | 'md'
  /** Visible label; clicking it toggles too. Without it, pass aria-label or aria-labelledby. */
  label?: ReactNode
  labelPosition?: 'start' | 'end'
}

/** On/off switch: a <button role="switch" aria-checked>, so Space and Enter toggle it. */
export function Toggle({
  checked,
  defaultChecked = false,
  onCheckedChange,
  size = 'md',
  label,
  labelPosition = 'end',
  className,
  onClick,
  disabled,
  type = 'button',
  'data-force': force,
  ...rest
}: ToggleProps) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange)
  const toggle = (
    <button
      type={type}
      role="switch"
      aria-checked={on}
      className={cx(styles.toggle, label == null && className)}
      data-size={size}
      data-force={force}
      disabled={disabled}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOn(!on)
      }}
      {...rest}
    >
      <span className={styles.thumb} />
    </button>
  )
  if (label == null) return toggle
  return (
    <label
      className={cx(styles.row, className)}
      data-position={labelPosition}
      data-disabled={disabled || undefined}
    >
      {labelPosition === 'start' && <span className={styles.label}>{label}</span>}
      {toggle}
      {labelPosition === 'end' && <span className={styles.label}>{label}</span>}
    </label>
  )
}
