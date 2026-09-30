import { Plus, X } from 'lucide-react'
import type { TimeWindow } from '@/db/types'
import { nextWindow, windowProblem } from '@/logic/plannerAvailability'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import styles from './Windows.module.css'

export interface WindowsListProps {
  windows: readonly TimeWindow[]
  onChange: (windows: TimeWindow[]) => void
  /** Names the fields: "Monday window 1 start". */
  name: string
  /** An add button under the list (otherwise the caller adds windows). */
  addLabel?: string
  /** Message per window index (from `validateAvailability`), shown when set. */
  errors?: Readonly<Record<number, string | undefined>>
  /** Shown instead of the list when it is empty. */
  empty?: string
}

/** A list of `HH:mm` to `HH:mm` study windows: add, edit and remove. */
export function WindowsList({ windows, onChange, name, addLabel, errors, empty }: WindowsListProps) {
  const set = (i: number, patch: Partial<TimeWindow>) =>
    onChange(windows.map((w, k) => (k === i ? { ...w, ...patch } : w)))
  return (
    <div className={styles.list}>
      {windows.length === 0 && empty ? <p className={styles.empty}>{empty}</p> : null}
      {windows.map((w, i) => {
        const problem = errors?.[i] ?? windowProblem(w)
        return (
          <div key={i} className={styles.window}>
            <Input
              size="sm"
              type="time"
              aria-label={`${name} window ${i + 1} start`}
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
              aria-label={`${name} window ${i + 1} end`}
              value={w.end}
              invalid={problem !== null}
              className={styles.time}
              onChange={(e) => set(i, { end: e.target.value })}
            />
            <IconButton
              size="sm"
              label={`Remove ${name} window ${i + 1}`}
              icon={<X />}
              onClick={() => onChange(windows.filter((_, k) => k !== i))}
            />
            {problem !== null && errors?.[i] !== undefined ? (
              <span className={styles.problem} role="alert">
                {problem}
              </span>
            ) : null}
          </div>
        )
      })}
      {addLabel ? (
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Plus />}
          className={styles.add}
          onClick={() => onChange([...windows, nextWindow(windows)])}
        >
          {addLabel}
        </Button>
      ) : null}
    </div>
  )
}
