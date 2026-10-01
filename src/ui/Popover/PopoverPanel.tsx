import type { ComponentProps } from 'react'
import { cx } from '../internal/cx'
import styles from './Popover.module.css'

interface PopoverPanelProps extends ComponentProps<'div'> {
  /** Render in normal flow, fully visible, without animation. For /design specimens. */
  inline?: boolean
}

/**
 * The floating surface shared by Popover and Dropdown: elevated background, 10px radius,
 * `--shadow-pop`, enter/exit animation keyed on `data-state`. Positioned by FloatingLayer.
 * Enter and exit build their movement from `--shift-*` / `--scale-in`, so reduced motion leaves a
 * plain fade; `data-motion="opacity"` keeps that fade alive (motion.css).
 */
export function PopoverPanel({ className, inline, ...rest }: PopoverPanelProps) {
  return (
    <div
      data-motion="opacity"
      data-inline={inline || undefined}
      className={cx(styles.panel, className)}
      {...rest}
    />
  )
}
