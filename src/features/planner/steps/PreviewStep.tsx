import { CircleAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type Dispatch } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { ISODate } from '@/db/types'
import { diffDays } from '@/logic/dates'
import { formatDay, plural } from '@/logic/goalDisplay'
import {
  firstInvalidStep,
  planStats,
  previewPlanner,
  STEP_NAMES,
  unitLabel,
  withAddedTime,
  withoutUnitKeys,
  withTargetDate,
  type PlannerAction,
  type PlannerDraft,
  type PlannerStep,
} from '@/logic/plannerDraft'
import {
  checkFeasibility,
  formatDuration,
  planStudy,
  withoutUnits,
  type FeasibilityResult,
  type PlannerIssue,
  type SlotPlan,
} from '@/logic/scheduler'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { Timeline } from '../components/Timeline'
import shared from '../shared.module.css'
import styles from './PreviewStep.module.css'

export interface PreviewStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  today: ISODate
}

type Computed =
  | { draft: PlannerDraft; status: 'ready'; plan: SlotPlan; feasibility: FeasibilityResult }
  | { draft: PlannerDraft; status: 'error' }

/** The calm sentence for a planner issue about the dates the person set. */
function issueText(issue: PlannerIssue, plan: SlotPlan, today: ISODate): string | null {
  const title = (id: string): string =>
    plan.input.assessments?.find((a) => a.id === id)?.title ?? 'An assessment'
  switch (issue.code) {
    case 'ASSESSMENT_TOO_EARLY':
      return `${title(issue.assessmentId)} comes before you’d finish studying for it (until ${formatDay(issue.lastStudyDate, today)}). Move its date or the study earlier.`
    case 'ASSESSMENT_AFTER_TARGET':
      return `${title(issue.assessmentId)} is dated after your finish date.`
    case 'ASSESSMENT_IN_PAST':
      return `${title(issue.assessmentId)} has a date that has already passed.`
    case 'REVIEW_UNPLACED':
      return 'A review or practice test found no free slot before its assessment.'
    default:
      return null
  }
}

/**
 * Runs the planner on the draft and says, calmly, whether it fits: projected finish against the target,
 * hours a week, the buffer, what will be scheduled, and a compact timeline. When it does not fit, the three
 * ways to make it (add time, move the date, cut scope) each show what they would do, verified by running
 * the planner again. Choosing one changes the draft and the plan is re-run.
 */
export function PreviewStep({ draft, dispatch, today }: PreviewStepProps) {
  const settings = useSettings()
  const toast = useToast()
  const [computed, setComputed] = useState<Computed | null>(null)
  const invalid = firstInvalidStep(draft, today)
  const globalDaysOff = settings?.scheduling.globalDaysOff
  const weekStartsOn = settings?.weekStartsOn

  useEffect(() => {
    if (invalid !== null || settings === undefined) return undefined
    // Let the loading state paint first: a big plan takes a moment.
    const t = setTimeout(() => {
      try {
        const plan = previewPlanner(draft, today, {
          globalDaysOff: globalDaysOff ?? [],
          ...(weekStartsOn !== undefined ? { weekStartsOn } : {}),
        })
        setComputed({ draft, status: 'ready', plan, feasibility: checkFeasibility(plan.input) })
      } catch {
        setComputed({ draft, status: 'error' })
      }
    }, 0)
    return () => clearTimeout(t)
  }, [draft, today, invalid, settings, globalDaysOff, weekStartsOn])

  if (invalid !== null) {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title="A few things are still open"
        description={`Finish the ${STEP_NAMES[invalid]} step first, then Forge can check whether the plan fits.`}
        action={
          <Button variant="primary" onClick={() => dispatch({ type: 'go', step: invalid })}>
            Go to {STEP_NAMES[invalid]}
          </Button>
        }
      />
    )
  }
  if (computed === null || computed.draft !== draft) {
    return (
      <div className={shared.stack} aria-busy="true" aria-label="Checking the plan">
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="block" height={96} />
        <Skeleton variant="block" height={180} />
      </div>
    )
  }
  if (computed.status === 'error') {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title="Couldn’t build a preview"
        description="Nothing was saved. Check the dates and hours, or go back a step and try again."
        action={
          <Button onClick={() => dispatch({ type: 'go', step: 4 as PlannerStep })}>
            Back to the review
          </Button>
        }
      />
    )
  }

  const { plan, feasibility } = computed
  const { result } = plan
  const stats = planStats(plan, draft.startDate)
  const fits = feasibility.fits
  const asap = draft.targetMode === 'asap'
  const end = result.projectedEnd
  const target = draft.targetDate

  function choose(next: PlannerDraft, title: string, description?: string) {
    const previous = draft
    dispatch({ type: 'replaceDraft', draft: next })
    toast.show({
      title,
      ...(description ? { description } : {}),
      undo: () => dispatch({ type: 'replaceDraft', draft: previous }),
    })
  }

  const issues = result.issues.flatMap((i) => {
    const text = issueText(i, plan, today)
    return text === null ? [] : [text]
  })

  const courseLabel = new Map(plan.input.courses.map((c) => [c.id, c.code ?? c.title] as const))

  let headline: string
  let detail: string | null = null
  if (asap) {
    headline =
      end === null
        ? 'Nothing to schedule yet'
        : `At full speed you’d finish around ${formatDay(end, today)}.`
    detail =
      'No target date, so Forge fills every study window and keeps a little slack at the end.'
  } else if (fits && end !== null && target !== null) {
    const ahead = diffDays(target, end)
    headline = `This fits. You’d finish ${formatDay(end, today)}.`
    detail =
      ahead > 0
        ? `That’s ${plural(ahead, 'day')} before your ${formatDay(target, today)} target, with about ${Math.round(stats.bufferPct * 100)}% slack kept in reserve.`
        : `Right on your ${formatDay(target, today)} target, with about ${Math.round(stats.bufferPct * 100)}% slack.`
  } else {
    headline = `This doesn’t fit by ${target ? formatDay(target, today) : 'your date'} yet.`
    detail = `About ${formatDuration(Math.max(feasibility.shortfallMinutes, 5))} of work would land after it. Here are three ways to make it fit. You choose; nothing changes until you do.`
  }

  const { addTime, moveDate, cutScope } = feasibility.options

  return (
    <div className={shared.stack}>
      <section className={styles.verdict} data-tone={fits ? 'fits' : 'behind'} aria-live="polite">
        <h2 className={styles.headline}>{headline}</h2>
        {detail ? <p className={shared.hint}>{detail}</p> : null}
      </section>

      <dl className={styles.stats}>
        <Stat label="Finish" value={end ? formatDay(end, today) : '—'} />
        <Stat label="Target" value={asap || !target ? 'None' : formatDay(target, today)} />
        <Stat label="Per week" value={`${stats.hoursPerWeek} h`} />
        <Stat
          label="Slack"
          value={`${Math.round(stats.bufferPct * 100)}% · ${formatDuration(stats.bufferMinutes)}`}
        />
        <Stat label="Study sessions" value={String(stats.sessions)} />
        <Stat label="Reviews" value={String(stats.reviews)} />
        <Stat label="Practice tests" value={String(stats.practiceTests)} />
        <Stat label="Weekly milestones" value={String(stats.milestones)} />
      </dl>

      <Timeline
        fits={fits}
        start={draft.startDate}
        target={asap ? null : target}
        projectedEnd={end}
        courses={result.courseWindows.map((w) => ({
          id: w.courseId,
          label: courseLabel.get(w.courseId) ?? 'Course',
          start: w.start,
          end: w.end,
        }))}
        assessments={(plan.input.assessments ?? []).flatMap((a) =>
          a.date === null
            ? []
            : [{ id: a.id, courseId: a.courseId, title: a.title, kind: a.kind, date: a.date }],
        )}
      />

      {issues.length > 0 ? (
        <ul className={styles.issues} aria-label="Things to check">
          {issues.slice(0, 3).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}

      {!fits && !asap ? (
        <section className={styles.options} aria-labelledby="preview-options">
          <h2 id="preview-options" className={shared.sectionTitle}>
            Make it fit
          </h2>

          <div className={styles.option}>
            <div>
              <h3 className={styles.optionTitle}>Add time</h3>
              <p className={shared.hint}>
                {addTime.extraMinutesPerStudyDay === null
                  ? `${addTime.suggestion}. Try moving the date or cutting scope.`
                  : `Lengthens every study day. You’d finish around ${addTime.projectedEnd ? formatDay(addTime.projectedEnd, today) : 'the target'}.`}
              </p>
            </div>
            <Button
              disabled={addTime.extraMinutesPerStudyDay === null}
              onClick={() =>
                addTime.extraMinutesPerStudyDay !== null &&
                choose(
                  withAddedTime(draft, addTime.extraMinutesPerStudyDay),
                  `Added ${addTime.extraMinutesPerStudyDay} min to study days`,
                )
              }
            >
              Add {addTime.extraMinutesPerStudyDay ?? 0} min on study days
            </Button>
          </div>

          <div className={styles.option}>
            <div>
              <h3 className={styles.optionTitle}>Move the date</h3>
              <p className={shared.hint}>
                {moveDate.earliestFeasibleDate && target
                  ? `That’s ${plural(diffDays(moveDate.earliestFeasibleDate, target), 'day')} later than ${formatDay(target, today)}, with your slack kept.`
                  : 'No date works with these windows. Add time or cut scope.'}
              </p>
            </div>
            <Button
              disabled={!moveDate.earliestFeasibleDate}
              onClick={() =>
                moveDate.earliestFeasibleDate &&
                choose(
                  withTargetDate(draft, moveDate.earliestFeasibleDate),
                  `Moved your finish to ${formatDay(moveDate.earliestFeasibleDate, today)}`,
                )
              }
            >
              Move finish to{' '}
              {moveDate.earliestFeasibleDate
                ? formatDay(moveDate.earliestFeasibleDate, today)
                : '—'}
            </Button>
          </div>

          <CutOption
            key={cutScope.suggestedCut.join(',')}
            draft={draft}
            plan={plan}
            feasibility={feasibility}
            today={today}
            onCut={(keys, hours) =>
              choose(
                withoutUnitKeys(draft, keys),
                `Cut ${plural(keys.length, 'unit')} (${hours})`,
                'Deleted units can be added back from the review screen.',
              )
            }
          />
          <p className={shared.hint}>
            Or continue as it is: the goal will show as behind until you change something.
          </p>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd className={shared.num}>{value}</dd>
    </div>
  )
}

function CutOption({
  draft,
  plan,
  feasibility,
  today,
  onCut,
}: {
  draft: PlannerDraft
  plan: SlotPlan
  feasibility: FeasibilityResult
  today: ISODate
  onCut: (keys: string[], hours: string) => void
}) {
  const { candidates, suggestedCut } = feasibility.options.cutScope
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(suggestedCut))
  const [open, setOpen] = useState(false)
  const minutesOf = useMemo(
    () => new Map(candidates.map((c) => [c.unitId, c.minutes])),
    [candidates],
  )
  const cutMinutes = [...picked].reduce((n, id) => n + (minutesOf.get(id) ?? 0), 0)
  const hours = formatDuration(cutMinutes)
  const optionalOnly = [...picked].every(
    (id) => candidates.find((c) => c.unitId === id)?.reason === 'optional',
  )

  // Whether the chosen cut, and only it, makes the plan fit (verified with the planner).
  const verified = useMemo(() => {
    if (picked.size === 0) return null
    const r = planStudy({
      ...withoutUnits(plan.input, [...picked]),
      targetDate: plan.input.targetDate,
    })
    return { fits: r.fits, end: r.projectedEnd }
  }, [picked, plan.input])

  if (candidates.length === 0) {
    return (
      <div className={styles.option}>
        <div>
          <h3 className={styles.optionTitle}>Cut scope</h3>
          <p className={shared.hint}>
            There are no units to cut. Mark units optional on the review screen to offer them here.
          </p>
        </div>
      </div>
    )
  }
  const label = `Cut ${picked.size} ${optionalOnly ? 'optional ' : ''}${picked.size === 1 ? 'unit' : 'units'} (${hours})`
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={styles.option} data-stacked>
      <div className={styles.optionBody}>
        <div>
          <h3 className={styles.optionTitle}>Cut scope</h3>
          <p className={shared.hint}>
            {suggestedCut.length === 0
              ? 'Cutting alone would not make it fit, but you can still drop units you can live without.'
              : `Drops the least essential work first: optional units, then ones you know well. ${verified?.fits && verified.end ? `You’d finish around ${formatDay(verified.end, today)}.` : ''}`}
          </p>
          <button
            type="button"
            className={shared.link}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide the list' : 'Choose which units'}
          </button>
        </div>
        <Button disabled={picked.size === 0} onClick={() => onCut([...picked], hours)}>
          {picked.size === 0 ? 'Cut units' : label}
        </Button>
      </div>
      {open ? (
        <ul className={styles.picker} aria-label="Units to cut">
          {candidates.map((c) => (
            <li key={c.unitId}>
              <Checkbox
                label={
                  <span className={styles.pick}>
                    <span>{unitLabel(draft, c.unitId)}</span>
                    <span className={styles.pickMeta}>
                      {formatDuration(c.minutes)} · {REASON_TEXT[c.reason]}
                    </span>
                  </span>
                }
                checked={picked.has(c.unitId)}
                onCheckedChange={() => toggle(c.unitId)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {open && verified ? (
        <p className={shared.hint} aria-live="polite">
          {verified.fits
            ? `With this cut it fits${verified.end ? `, finishing around ${formatDay(verified.end, today)}` : ''}.`
            : 'With this cut alone it still does not fit.'}
        </p>
      ) : null}
    </div>
  )
}

const REASON_TEXT = {
  optional: 'optional',
  alreadyKnown: 'you know it',
  partlyKnown: 'partly known',
  lateInPlan: 'late in the plan',
} as const
