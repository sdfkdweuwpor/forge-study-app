import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ProgressTone } from '../ProgressBar'
import { ringGeometry } from './ringMath'
import styles from './ProgressRing.module.css'

export interface ProgressRingProps extends Omit<ComponentProps<'div'>, 'role' | 'children'> {
  value: number
  max?: number
  /** Outer diameter in px. */
  size?: number
  /** Stroke width in px. */
  stroke?: number
  tone?: ProgressTone
  /** Accessible name, e.g. "Daily goal". */
  label: string
  /** Spoken value, e.g. "3 of 4 pomodoros". Defaults to a percentage. */
  valueText?: string
  /** Centre content: a number, an icon. Keep it short. */
  children?: ReactNode
}

/** Circular progress (daily goal, pomodoros, course completion). Starts at 12 o'clock. */
export function ProgressRing({
  value,
  max = 100,
  size = 40,
  stroke = 4,
  tone = 'accent',
  label,
  valueText,
  children,
  className,
  style,
  ...rest
}: ProgressRingProps) {
  const g = ringGeometry(size, stroke, value, max)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={valueText ?? `${Math.round(g.fraction * 100)}%`}
      className={cx(styles.ring, className)}
      data-tone={tone}
      style={{ ...style, width: size, height: size }}
      {...rest}
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
      >
        <circle className={styles.track} cx={g.center} cy={g.center} r={g.radius} strokeWidth={stroke} />
        <circle
          className={styles.arc}
          cx={g.center}
          cy={g.center}
          r={g.radius}
          strokeWidth={stroke}
          strokeDasharray={g.circumference}
          strokeDashoffset={g.offset}
          data-empty={g.fraction === 0 || undefined}
        />
      </svg>
      {children != null && <span className={styles.center}>{children}</span>}
    </div>
  )
}
