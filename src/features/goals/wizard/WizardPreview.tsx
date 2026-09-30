import { useMemo } from 'react'
import { formatHours, plural, summarizeFinish } from '@/logic/goalDisplay'
import { parseCus, previewPlan, type DraftGoal } from '@/logic/goalDraft'
import type { DateRange, ISODate } from '@/db/types'
import styles from './wizard.module.css'

/**
 * The last step: when the plan finishes if you follow it, in plain words. (The Gantt timeline and the
 * fuller feasibility check belong to the goal breakdown planner that replaces this flow.)
 */
export function WizardPreview({
  draft,
  today,
  globalDaysOff,
}: {
  draft: DraftGoal
  today: ISODate
  globalDaysOff: readonly DateRange[]
}) {
  const plan = useMemo(
    () => previewPlan(draft, today, globalDaysOff),
    [draft, today, globalDaysOff],
  )
  const summary = summarizeFinish(
    {
      projection: { ...plan.projection, computedAt: 0 },
      targetDate: draft.targetDate,
      status: 'active',
    },
    today,
  )
  const cus = draft.courses.reduce((sum, c) => {
    const parsed = parseCus(c.cus)
    return sum + (parsed.ok ? (parsed.value ?? 0) : 0)
  }, 0)
  const required = plan.catchUp?.requiredMinutesPerStudyDay ?? null

  return (
    <div className={styles.step}>
      <div className={styles.preview} data-tone={summary.tone}>
        <p className={styles.previewLead}>
          {summary.end !== null
            ? `At this pace you’d finish around ${summary.end}.`
            : summary.headline}
        </p>
        {summary.slip !== null ? <p className={styles.previewLine}>{summary.slip}.</p> : null}
        {summary.kind === 'behind' && required !== null ? (
          <p className={styles.previewLine}>
            Studying about {formatHours(required)} h on each study day would reach your target.
          </p>
        ) : null}
        {summary.note !== null ? <p className={styles.previewLine}>{summary.note}</p> : null}
        {summary.target !== null ? <p className={styles.previewMuted}>{summary.target}</p> : null}
      </div>
      <p className={styles.hint}>
        {plural(draft.courses.length, 'course')}
        {cus > 0 ? ` · ${cus} CUs` : ''} · {formatHours(plan.work.totalMinutes)} h of study. Forge
        turns it into daily blocks of 25 to 90 minutes and moves them if a day slips.
      </p>
    </div>
  )
}
