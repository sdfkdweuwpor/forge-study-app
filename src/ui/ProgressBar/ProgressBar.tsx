import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../internal/cx'
import styles from './ProgressBar.module.css'

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger' | 'xp'

export interface ProgressBarProps extends Omit<ComponentProps<'div'>, 'role' | 'children'> {
  /** Omit for an indeterminate bar (work of unknown length). */
  value?: number
  max?: number
  /** accent: progress (default). xp: the gold XP bar, for XP and rewards only. */
  tone?: ProgressTone
  /** sm = 4px, md = 6px, lg = 8px. */
  size?: 'sm' | 'md' | 'lg'
  /** Accessible name, e.g. "C182 progress". */
  label: string
  /** Spoken value, e.g. "1,240 of 1,800 XP". Defaults to a percentage. */
  valueText?: string
}

export function clampFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(Math.max(value / max, 0), 1)
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'accent',
  size = 'md',
  label,
  valueText,
  className,
  style,
  ...rest
}: ProgressBarProps) {
  const indeterminate = value === undefined
  const fraction = indeterminate ? 0 : clampFraction(value, max)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : Math.min(Math.max(value, 0), max)}
      aria-valuetext={indeterminate ? undefined : (valueText ?? `${Math.round(fraction * 100)}%`)}
      className={cx(styles.track, className)}
      data-tone={tone}
      data-size={size}
      data-indeterminate={indeterminate || undefined}
      style={{ ...style, '--p': fraction } as CSSProperties}
      {...rest}
    >
      <span className={styles.fill} data-motion={indeterminate ? 'opacity' : undefined} />
    </div>
  )
}
