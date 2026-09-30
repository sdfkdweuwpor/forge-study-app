/**
 * The level meter in the sidebar footer (`sidebar.footer`, BRIEF §4/§5.5): one quiet line, "Level 7" with
 * "1,240 / 1,852 XP" beside it, and a thin gold bar under both. Hovering or focusing it shows what was
 * earned in all, what is left to spend and the distance to the next level, in the Rewards page's words;
 * clicking goes to the rewards page. It shows in the desktop sidebar and the tablet drawer. Where the
 * sidebar is not on screen the same numbers come from `LevelCompact.tsx` (a ring beside the "Open
 * sidebar" button, and a row at the foot of the phone's More sheet), through the same `useXp()`.
 */
import { useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Link } from '@/app/router'
import { useXp, type XpSummary } from '@/db/hooks/useXp'
import { onDomainEvent } from '@/db/events'
import { dayOf } from '@/logic/dates'
import { ProgressBar } from '@/ui/ProgressBar'
import { Skeleton } from '@/ui/Skeleton'
import { Tooltip } from '@/ui/Tooltip'
import styles from './LevelMeter.module.css'
import { XpFloat } from './XpFloat'

const NUMBER = new Intl.NumberFormat('en-US')

/** `1240` → `"1,240"`. */
export function formatCount(n: number): string {
  return NUMBER.format(Math.round(n))
}

interface Float {
  id: number
  amount: number
}

/**
 * XP that did not come from finishing a task (a task already floats its own "+15 XP" from its row):
 * a focus session, the daily goal, a course, a streak. They float up from the meter for a moment.
 */
function useXpFloats(): { floats: Float[]; remove: (id: number) => void } {
  const [floats, setFloats] = useState<Float[]>([])
  const nextId = useRef(0)
  useEffect(
    () =>
      onDomainEvent('xp.changed', (e) => {
        if (e.amount <= 0 || e.source === 'task' || e.source === 'adjustment') return
        if (e.day !== dayOf(Date.now())) return
        nextId.current += 1
        const item = { id: nextId.current, amount: e.amount }
        setFloats((cur) => [...cur.slice(-2), item])
      }),
    [],
  )
  return { floats, remove: (id) => setFloats((cur) => cur.filter((f) => f.id !== id)) }
}

/** What hovering or focusing the level says, in the Rewards page's words. Shared with the compact level. */
export function LevelTip({ xp }: { xp: XpSummary }) {
  const { level, intoLevel, needed } = xp.level
  return (
    <span className={styles.tip}>
      <span>{formatCount(xp.lifetime)} XP earned in all</span>
      <span>{formatCount(xp.balance)} XP to spend</span>
      <span className={styles.tipMuted}>
        {formatCount(Math.max(0, needed - intoLevel))} XP to Level {level + 1}
      </span>
    </span>
  )
}

function MeterSkeleton() {
  return (
    <div
      className={styles.meter}
      data-loading=""
      aria-busy="true"
      data-testid="level-meter-loading"
    >
      <span className={styles.row}>
        <Skeleton width={56} />
        <Skeleton width={72} />
      </span>
      <Skeleton variant="block" height={4} />
    </div>
  )
}

function Meter() {
  const xp = useXp()
  const { floats, remove } = useXpFloats()
  if (xp === undefined) return <MeterSkeleton />

  const { level, intoLevel, needed } = xp.level
  const progress = `${formatCount(intoLevel)} / ${formatCount(needed)} XP`
  return (
    <Tooltip side="right" describe={false} content={<LevelTip xp={xp} />}>
      <Link
        to="rewards"
        className={styles.meter}
        data-testid="level-meter"
        aria-label={`Level ${level}, ${progress}. Open rewards`}
      >
        <span className={styles.row}>
          <span className={styles.level}>Level {level}</span>
          <span className={styles.numbers}>{progress}</span>
        </span>
        <ProgressBar
          tone="xp"
          size="sm"
          label="Progress to the next level"
          value={intoLevel}
          max={needed}
          valueText={progress}
          aria-hidden="true"
        />
        {floats.map((f) => (
          <XpFloat
            key={f.id}
            amount={f.amount}
            className={styles.float}
            onDone={() => remove(f.id)}
          />
        ))}
      </Link>
    </Tooltip>
  )
}

/** Slot `sidebar.footer`. */
export function LevelMeter() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <button type="button" className={styles.error} onClick={reset}>
          Level unavailable. Try again
        </button>
      )}
    >
      <Meter />
    </ErrorBoundary>
  )
}
