import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { Spinner } from '../Spinner'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ComponentProps<'button'>, ForceProps {
  /** primary: the one main action on a surface. secondary: default. ghost: toolbars, rows. danger: destructive. */
  variant?: ButtonVariant
  /** md = 32px, sm = 28px. Coarse pointers get a 44px hit area either way. */
  size?: ButtonSize
  /** Shows a spinner, keeps the width, blocks clicks and sets aria-busy (focus is kept). */
  loading?: boolean
  /** A lucide icon element, e.g. `<Play />`. Sized by the button. */
  iconLeft?: ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
}

const blockClick = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault()

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-full={fullWidth || undefined}
      data-icon-only={(children == null && !(iconLeft && iconRight)) || undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? blockClick : onClick}
      {...rest}
    >
      {iconLeft != null && (
        <span className={styles.icon} aria-hidden="true">
          {iconLeft}
        </span>
      )}
      {children != null && <span className={styles.label}>{children}</span>}
      {iconRight != null && (
        <span className={styles.icon} aria-hidden="true">
          {iconRight}
        </span>
      )}
      {loading && <Spinner className={styles.spinner} size={size === 'sm' ? 14 : 16} />}
    </button>
  )
}
