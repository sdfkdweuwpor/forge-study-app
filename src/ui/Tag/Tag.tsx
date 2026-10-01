import type { ComponentProps, MouseEventHandler, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import styles from './Tag.module.css'

/** Notion's nine tag hues (mirrors `TagColor` in src/db/types.ts; ui must not import db). */
export type TagColor =
  'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export const TAG_COLORS: readonly TagColor[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]

export interface TagProps extends Omit<ComponentProps<'span'>, 'onClick'>, ForceProps {
  color?: TagColor
  /** tag: 4px corners (Notion tags). pill: fully round (filter chips, quick-add chips). */
  shape?: 'tag' | 'pill'
  size?: 'sm' | 'md'
  /** Leading icon or dot, e.g. `<Hash />`. */
  icon?: ReactNode
  /** Makes the tag a button (filter by tag). */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** Adds a remove button with its own accessible name. */
  onRemove?: () => void
  /** Accessible name of the remove button. Defaults to "Remove <text>" when children is a string. */
  removeLabel?: string
  /** For toggle chips: sets aria-pressed on the tag button. */
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}

export function Tag({
  color = 'gray',
  shape = 'tag',
  size = 'md',
  icon,
  onClick,
  onRemove,
  removeLabel,
  pressed,
  disabled,
  className,
  children,
  ...rest
}: TagProps) {
  const content = (
    <>
      {icon != null && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.text}>{children}</span>
    </>
  )
  const name = removeLabel ?? (typeof children === 'string' ? `Remove ${children}` : 'Remove tag')
  return (
    <span
      className={cx(styles.tag, className)}
      data-color={color}
      data-shape={shape}
      data-size={size}
      data-interactive={onClick ? '' : undefined}
      data-removable={onRemove ? '' : undefined}
      data-disabled={disabled || undefined}
      {...rest}
    >
      {onClick ? (
        <button
          type="button"
          className={styles.main}
          onClick={onClick}
          aria-pressed={pressed}
          disabled={disabled}
        >
          {content}
        </button>
      ) : (
        <span className={styles.main}>{content}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={name}
          disabled={disabled}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
