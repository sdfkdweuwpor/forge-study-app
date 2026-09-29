import type { ReactNode } from 'react'
import styles from './Stat.module.css'

export interface TodayStatProps {
  /** The leading visual: a small ring or an icon. */
  visual: ReactNode
  /** The number or short phrase: "3 of 6", "12", "+45 XP". */
  value: ReactNode
  /** What it measures, in a few words: "Daily goal", "day streak". */
  caption: string
  /** `xp` colours the value gold (XP and rewards only). */
  tone?: 'default' | 'xp'
}

/**
 * One figure of the Today stat row. Contributions to the `today.header` slot can use it so they line
 * up with the built-in ones (daily goal, streak, XP today).
 */
export function TodayStat({ visual, value, caption, tone = 'default' }: TodayStatProps) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <span className={styles.visual}>{visual}</span>
      <span className={styles.text}>
        <span className={styles.value}>{value}</span>
        <span className={styles.caption}>{caption}</span>
      </span>
    </div>
  )
}
