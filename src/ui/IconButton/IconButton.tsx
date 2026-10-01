import type { ComponentProps, ReactNode } from 'react'
import { isMac } from '@/lib/platform'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { ariaKeyShortcuts } from '../Kbd'
import { Tooltip, type Side } from '../Tooltip'
import styles from './IconButton.module.css'

export type IconButtonSize = 'xs' | 'sm' | 'md'
export type IconButtonVariant = 'ghost' | 'secondary' | 'primary'

export interface IconButtonProps
  extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'>, ForceProps {
  /** Required accessible name (aria-label). Also the tooltip text. */
  label: string
  /** A lucide icon element, e.g. `<MoreHorizontal />`. */
  icon: ReactNode
  /** xs = 24px (row handles), sm = 28px (toolbars, default), md = 32px (next to a md Button). */
  size?: IconButtonSize
  variant?: IconButtonVariant
  /** Toggle buttons (pin, mute): sets aria-pressed and the pressed look. */
  pressed?: boolean
  /** Shortcut shown in the tooltip and exposed as aria-keyshortcuts, e.g. 'mod+\\'. */
  shortcut?: string
  /** Shows `label` (and `shortcut`) in a Tooltip. Default true. */
  tooltip?: boolean
  tooltipSide?: Side
}

export function IconButton({
  label,
  icon,
  size = 'sm',
  variant = 'ghost',
  pressed,
  shortcut,
  tooltip = true,
  tooltipSide = 'top',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      className={cx(styles.iconButton, className)}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut, isMac()) : undefined}
      data-size={size}
      data-variant={variant}
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  )
  if (!tooltip) return button
  // The tooltip repeats the accessible name, so it does not also describe the button.
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} describe={false}>
      {button}
    </Tooltip>
  )
}
