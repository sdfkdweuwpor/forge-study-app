import type { ComponentProps, ReactNode } from 'react'
import type { ForceProps } from '../internal/force'
import { Field, useField } from './Field'
import styles from './Input.module.css'

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'>, ForceProps {
  /** Visible label above the input. Without it, pass aria-label. */
  label?: ReactNode
  /** One quiet line under the input. Replaced by `error` when present. */
  hint?: ReactNode
  /** Error message; also marks the input invalid (aria-invalid + danger border). */
  error?: ReactNode
  /** Invalid look and aria-invalid without a message. */
  invalid?: boolean
  /** A lucide icon element shown inside, on the left. */
  leadingIcon?: ReactNode
  /** Content inside, on the right: a Kbd hint, a unit, a clear IconButton. */
  trailing?: ReactNode
  /** md = 32px, sm = 28px. */
  size?: 'sm' | 'md'
  /** Styles the outer field wrapper. Every other prop (ref, value, onChange…) goes to the <input>. */
  className?: string
}

export function Input({
  label,
  hint,
  error,
  invalid,
  leadingIcon,
  trailing,
  size = 'md',
  className,
  id,
  disabled,
  'aria-describedby': describedByProp,
  'data-force': force,
  ...rest
}: InputProps) {
  const ids = useField({ id, hint, error, invalid, 'aria-describedby': describedByProp })
  return (
    <Field
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div
        className={styles.control}
        data-size={size}
        data-invalid={ids.isInvalid || undefined}
        data-disabled={disabled || undefined}
        data-leading={leadingIcon != null || undefined}
        data-force={force}
      >
        {leadingIcon != null && (
          <span className={styles.leading} aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <input
          id={ids.controlId}
          className={styles.input}
          disabled={disabled}
          aria-invalid={ids.isInvalid || undefined}
          aria-describedby={ids.describedBy}
          {...rest}
        />
        {trailing != null && <span className={styles.trailing}>{trailing}</span>}
      </div>
    </Field>
  )
}
