/**
 * The dial: the big timer inside a progress ring. One component for the Focus page (a 96px timer) and
 * the full-screen view (larger, quieter). The digits are not inside the ring element because a
 * progressbar's children are presentational to assistive technology; the ring is decorative
 * (`aria-hidden`) and the digits are a `role="timer"`, whose changes are never announced by themselves
 * (the polite live region in `TimerProvider` speaks at sensible moments instead).
 */
import type { CSSProperties } from 'react'
import { formatClock } from '@/logic/timer'
import { ProgressRing, type ProgressRingProps } from '@/ui/ProgressRing'
import styles from './TimerFace.module.css'

export interface TimerFaceProps {
  seconds: number
  /** 0 to 1. */
  progress: number
  /** Small line under the digits: "Focus", "Paused", "Short break". */
  label: string
  tone?: NonNullable<ProgressRingProps['tone']>
  /** Ring diameter in px. */
  size: number
  stroke?: number
  /** Accessible name of the timer, e.g. "Focus timer". */
  name: string
  /** Quieter type and ring, for the full-screen view. */
  subtle?: boolean
  /** The timer is paused: the digits are drawn muted. */
  paused?: boolean
}

export function TimerFace({
  seconds,
  progress,
  label,
  tone = 'accent',
  size,
  stroke = 6,
  name,
  subtle = false,
  paused = false,
}: TimerFaceProps) {
  const hours = seconds >= 3600
  return (
    <div
      className={styles.dial}
      style={{ '--dial': `${size}px` } as CSSProperties}
      data-subtle={subtle || undefined}
      data-paused={paused || undefined}
    >
      <ProgressRing
        aria-hidden="true"
        label="Session progress"
        value={progress}
        max={1}
        size={size}
        stroke={stroke}
        tone={tone}
        className={styles.ring}
      />
      <div className={styles.face}>
        <span
          className={styles.time}
          role="timer"
          aria-label={name}
          data-testid="timer-display"
          data-long={hours || undefined}
        >
          {formatClock(seconds)}
        </span>
        <span className={styles.label} data-testid="timer-label">
          {label}
        </span>
      </div>
    </div>
  )
}
