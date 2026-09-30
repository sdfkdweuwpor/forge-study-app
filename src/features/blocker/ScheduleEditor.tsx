import { Plus, X } from 'lucide-react'
import type { BlockWindow } from '@/db/types'
import {
  DAY_LONG,
  DAY_ORDER,
  DAY_SHORT,
  DEFAULT_BLOCK_WINDOW,
  describeDays,
  toggleDay,
  windowProblem,
} from '@/logic/blocker'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import styles from './ScheduleEditor.module.css'

interface Props {
  windows: readonly BlockWindow[]
  onChange: (windows: BlockWindow[]) => void
}

/**
 * The times the blocker is on in Scheduled mode: each window is some days plus a start and an end.
 * A window that ends before it starts runs overnight (22:00 to 06:00 covers the small hours of the
 * next day). A window that would block nothing says why and is not saved until it is fixed.
 */
export function ScheduleEditor({ windows, onChange }: Props) {
  const set = (i: number, patch: Partial<BlockWindow>) =>
    onChange(windows.map((w, k) => (k === i ? { ...w, ...patch } : w)))

  return (
    <div className={styles.root}>
      {windows.length === 0 ? (
        <p className={styles.empty}>No times yet, so nothing is blocked. Add a window to start.</p>
      ) : null}
      {windows.map((w, i) => {
        const problem = windowProblem(w)
        const name = `Window ${i + 1}`
        return (
          <div
            key={i}
            className={styles.window}
            role="group"
            aria-label={`${name}, ${describeDays(w.days)}`}
          >
            <div className={styles.days} role="group" aria-label={`${name} days`}>
              {DAY_ORDER.map((day) => {
                const on = w.days.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    className={styles.day}
                    aria-pressed={on}
                    aria-label={DAY_LONG[day]}
                    onClick={() => set(i, { days: toggleDay(w.days, day) })}
                  >
                    {DAY_SHORT[day]?.slice(0, 1)}
                  </button>
                )
              })}
            </div>
            <div className={styles.times}>
              <Input
                size="sm"
                type="time"
                aria-label={`${name} start`}
                value={w.start}
                invalid={problem !== null}
                className={styles.time}
                onChange={(e) => set(i, { start: e.target.value })}
              />
              <span className={styles.to} aria-hidden="true">
                to
              </span>
              <Input
                size="sm"
                type="time"
                aria-label={`${name} end`}
                value={w.end}
                invalid={problem !== null}
                className={styles.time}
                onChange={(e) => set(i, { end: e.target.value })}
              />
              <IconButton
                size="sm"
                label={`Remove ${name.toLowerCase()}`}
                icon={<X />}
                onClick={() => onChange(windows.filter((_, k) => k !== i))}
              />
            </div>
            {problem !== null ? (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            ) : null}
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<Plus />}
        className={styles.add}
        onClick={() =>
          onChange([...windows, { ...DEFAULT_BLOCK_WINDOW, days: [...DEFAULT_BLOCK_WINDOW.days] }])
        }
      >
        Add a window
      </Button>
    </div>
  )
}
