import { Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from '@/app/router'
import { recordError } from '@/app/reportError'
import { useSettings } from '@/db/hooks/useSettings'
import { updateSettings } from '@/db/repos/settings'
import type { TimeWindow } from '@/db/types'
import { everydayWindowsOf } from '@/logic/everydaySlots'
import { DAY_NAMES, nextWindow, windowProblem, WEEK_ORDER } from '@/logic/plannerAvailability'
import { defaultTaskWindows } from '@/logic/schemaV2'
import { Button, IconButton, Input, Skeleton, Toggle } from '@/ui'
import { EVERYDAY_HOURS_SECTION } from './taskUrls'
import styles from './EverydayHours.module.css'

const DEFAULT_EVERYDAY_WINDOW: TimeWindow = { start: '18:00', end: '21:00' }

const same = (a: readonly (readonly TimeWindow[])[], b: readonly (readonly TimeWindow[])[]) =>
  JSON.stringify(a) === JSON.stringify(b)

/** The first thing wrong with the week's windows, or `null` when it can be saved. */
function weekProblem(week: readonly (readonly TimeWindow[])[]): string | null {
  for (const day of week) {
    for (const w of day) {
      const p = windowProblem(w)
      if (p !== null) return p
    }
  }
  return null
}

/**
 * Settings section (slot `settings.sections`): the hours Forge may suggest times for tasks with a deadline
 * (`settings.scheduling.taskWindows`). Goal study time has its own windows on each goal; these are for
 * everyday tasks only. A change is saved as soon as every window is valid.
 */
export function EverydayHoursSection() {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement | null>(null)
  const pathname = usePathname()
  const settings = useSettings()
  const saved = settings ? everydayWindowsOf(settings.scheduling.taskWindows) : null
  /** What is on screen while it cannot be saved yet (a half-typed time) or has not come back from the database. */
  const [edits, setEdits] = useState<TimeWindow[][] | null>(null)
  const [status, setStatus] = useState('')
  const savedKey = JSON.stringify(saved)
  const [seen, setSeen] = useState(savedKey)
  if (savedKey !== seen) {
    setSeen(savedKey)
    if (saved !== null && edits !== null && same(edits, saved)) setEdits(null)
  }

  // Arrived from the "No open time" hint: bring this section into view.
  const arrived = pathname === `/settings/${EVERYDAY_HOURS_SECTION}`
  useEffect(() => {
    if (!arrived) return
    heading.current?.scrollIntoView({ block: 'start' })
    heading.current?.focus()
  }, [arrived])

  if (saved === null) {
    return (
      <section className={styles.section} aria-labelledby={headingId} aria-busy="true">
        <h2 id={headingId} className={styles.heading}>
          Everyday task hours
        </h2>
        <Skeleton lines={3} />
      </section>
    )
  }

  const week = edits ?? saved
  const problem = weekProblem(week)

  async function change(next: TimeWindow[][]) {
    setEdits(next)
    if (weekProblem(next) !== null) {
      setStatus('')
      return
    }
    try {
      await updateSettings({ scheduling: { taskWindows: next } })
      setStatus('Saved.')
    } catch (error) {
      recordError(error, 'everydayHours')
      setStatus('Couldn’t save that. Try again.')
    }
  }

  const setDay = (weekday: number, windows: TimeWindow[]) =>
    void change(week.map((d, i) => (i === weekday ? windows : d.map((w) => ({ ...w })))))

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.heading}>
        Everyday task hours
      </h2>
      <p className={styles.help}>
        When Forge may suggest a time for a task that has a deadline. Study sessions for your goals
        use each goal’s own windows.
      </p>
      <ul className={styles.days}>
        {WEEK_ORDER.map((weekday) => {
          const name = DAY_NAMES[weekday] ?? ''
          const windows = week[weekday] ?? []
          return (
            <li key={weekday} className={styles.day}>
              <Toggle
                size="sm"
                label={name}
                checked={windows.length > 0}
                onCheckedChange={(on) =>
                  setDay(weekday, on ? [{ ...DEFAULT_EVERYDAY_WINDOW }] : [])
                }
              />
              {windows.length === 0 ? (
                <span className={styles.off}>No suggestions</span>
              ) : (
                <div className={styles.windows}>
                  {windows.map((w, i) => {
                    const p = windowProblem(w)
                    const set = (patch: Partial<TimeWindow>) =>
                      setDay(
                        weekday,
                        windows.map((x, k) => (k === i ? { ...x, ...patch } : x)),
                      )
                    return (
                      <div key={i} className={styles.window}>
                        <Input
                          size="sm"
                          type="time"
                          aria-label={`${name} window ${i + 1} start`}
                          value={w.start}
                          invalid={p !== null}
                          className={styles.time}
                          onChange={(e) => set({ start: e.target.value })}
                        />
                        <span className={styles.to} aria-hidden="true">
                          to
                        </span>
                        <Input
                          size="sm"
                          type="time"
                          aria-label={`${name} window ${i + 1} end`}
                          value={w.end}
                          invalid={p !== null}
                          className={styles.time}
                          onChange={(e) => set({ end: e.target.value })}
                        />
                        <IconButton
                          size="sm"
                          label={`Remove ${name} window ${i + 1}`}
                          icon={<X />}
                          onClick={() =>
                            setDay(
                              weekday,
                              windows.filter((_, k) => k !== i),
                            )
                          }
                        />
                        {p !== null ? (
                          <span className={styles.problem} role="alert">
                            {p}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Plus />}
                      onClick={() => setDay(weekday, [...windows, nextWindow(windows)])}
                    >
                      Add a window on {name}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={same(week, defaultTaskWindows())}
          onClick={() => void change(defaultTaskWindows())}
        >
          Reset to the defaults
        </Button>
      </div>
      <p className={styles.status} role="status">
        {problem !== null ? 'Fix the highlighted window to save it.' : status}
      </p>
    </section>
  )
}
