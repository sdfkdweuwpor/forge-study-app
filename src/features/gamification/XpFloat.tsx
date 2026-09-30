import type { AnimationEvent } from 'react'
import { formatXp } from '@/logic/taskDisplay'
import styles from './XpFloat.module.css'

export interface XpFloatProps {
  /** XP earned; a negative amount is a takeback and reads "−15 XP". */
  amount: number
  /**
   * `float` (default): a gold pill that rises from where it sits and fades, once. Position it inside a
   * `position: relative` parent (it is `position: absolute`). `chip`: the same gold pill, still, for
   * inside a dialog or a row.
   */
  variant?: 'float' | 'chip'
  /** Called when the float has finished fading, so the caller can remove it. */
  onDone?: () => void
  className?: string
}

/**
 * "+25 XP" in gold. The float is the same one a finished task shows (BRIEF §3.5), made reusable for
 * the focus session's end and the daily goal. It is decoration: the amount is announced by the toast or
 * dialog that comes with it, so it is hidden from assistive tech. With reduced motion it only fades.
 */
export function XpFloat({ amount, variant = 'float', onDone, className }: XpFloatProps) {
  const finish = (e: AnimationEvent<HTMLSpanElement>) => {
    if (e.animationName.includes('xpFloat')) onDone?.()
  }
  return (
    <span
      className={className ? `${styles.pill} ${className}` : styles.pill}
      data-variant={variant}
      data-testid="xp-float"
      // Its rise is built from --shift-*, so with reduced motion it is a fade. Opting out of the blanket
      // reduced-motion rule keeps that fade (and its end event) instead of an instant jump.
      data-motion="opacity"
      aria-hidden="true"
      onAnimationEnd={finish}
    >
      {formatXp(amount)}
    </span>
  )
}
