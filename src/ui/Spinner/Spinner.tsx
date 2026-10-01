import type { ComponentProps } from 'react'
import { cx } from '../internal/cx'
import styles from './Spinner.module.css'

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Diameter in px (defaults to 16). */
  size?: number
  /** Accessible text. Omit when the surrounding control already says it is busy (aria-busy). */
  label?: string
}

/**
 * Indeterminate activity indicator in currentColor. Spins normally; with reduced motion it
 * pulses its opacity instead (the svg opts out of the motion.css safety net via data-motion).
 */
export function Spinner({ size = 16, label, className, style, ...rest }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, className)}
      style={{ width: size, height: size, ...style }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <svg viewBox="0 0 16 16" fill="none" className={styles.svg} data-motion="opacity">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.75" opacity="0.25" />
        <path
          d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
