import type { Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import { addDays, addMonths } from '@/logic/dates'
import { termEndFor } from '@/logic/goalDraft'
import { formatDay, plural } from '@/logic/goalDisplay'
import {
  assessmentsBeforeStart,
  shiftTemplateDates,
  templateShiftDays,
  type DraftErrors,
  type DraftPatch,
  type PlannerAction,
  type PlannerDraft,
} from '@/logic/plannerDraft'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Tag } from '@/ui/Tag'
import { Toggle } from '@/ui/Toggle'
import { useToast } from '@/ui/Toast'
import shared from '../shared.module.css'
import styles from './WhenStep.module.css'

export interface WhenStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
}

export function WhenStep({ draft, dispatch, errors, today }: WhenStepProps) {
  const toast = useToast()
  const patch = (p: DraftPatch) => dispatch({ type: 'patch', patch: p })
  const shiftDays = templateShiftDays(draft)
  const early = assessmentsBeforeStart(draft)
  const firstEarly = early[0]

  function shiftTemplate() {
    const previous = draft
    dispatch({ type: 'replaceDraft', draft: shiftTemplateDates(draft) })
    toast.show({
      title: `Moved the template’s dates ${plural(Math.abs(shiftDays), 'day')} ${shiftDays > 0 ? 'later' : 'earlier'}`,
      undo: () => dispatch({ type: 'replaceDraft', draft: previous }),
    })
  }
  const quick: Array<{ label: string; date: ISODate }> = [
    { label: 'In 3 months', date: addDays(addMonths(draft.startDate, 3), -1) },
    { label: 'In 6 months (a WGU term)', date: termEndFor(draft.startDate) },
    { label: 'In a year', date: addDays(addMonths(draft.startDate, 12), -1) },
  ]
  const hasCus = draft.courses.some((c) => c.cus !== null)

  return (
    <div className={shared.stack}>
      <section aria-labelledby="when-finish" className={shared.section}>
        <h2 id="when-finish" className={shared.sectionTitle}>
          When do you want to be done?
        </h2>
        <SegmentedControl
          label="Finish"
          value={draft.targetMode}
          onValueChange={(targetMode) => patch({ targetMode })}
          options={[
            { value: 'date', label: 'By a date' },
            { value: 'asap', label: 'As fast as possible' },
          ]}
        />
        {draft.targetMode === 'date' ? (
          <>
            <DatePicker
              label="Target finish date"
              value={draft.targetDate}
              today={today}
              min={draft.startDate}
              clearable={false}
              error={errors.targetDate}
              onChange={(targetDate) => patch({ targetDate })}
            />
            <div className={styles.quick} role="group" aria-label="Quick dates">
              {quick.map((q) => (
                <Tag
                  key={q.label}
                  shape="pill"
                  pressed={draft.targetDate === q.date}
                  onClick={() => patch({ targetDate: q.date })}
                >
                  {q.label}
                </Tag>
              ))}
            </div>
            <p className={shared.hint}>
              {draft.targetDate
                ? `Forge paces the work to finish ${formatDay(draft.targetDate, today)}, with a little slack at the end. If it can’t fit, you’ll choose what to change.`
                : 'Pick a date, or plan at full speed instead.'}
            </p>
          </>
        ) : (
          <p className={shared.hint}>
            Forge fills every study window and tells you when you’d finish. You can add a date later
            from Plan settings.
          </p>
        )}
      </section>

      <section aria-labelledby="when-start" className={shared.section}>
        <h2 id="when-start" className={shared.sectionTitle}>
          When do you start?
        </h2>
        <DatePicker
          label="Start date"
          value={draft.startDate}
          today={today}
          min={today}
          clearable={false}
          error={errors.startDate}
          onChange={(v) => v && patch({ startDate: v })}
        />
        <p className={shared.hint}>Today, unless your term or course starts later.</p>
        {shiftDays !== 0 && draft.templateStart !== null ? (
          <div className={styles.notice} role="status">
            <p className={shared.hint}>
              The template’s finish and exam dates were set for a start on{' '}
              {formatDay(draft.templateStart, today)}.
            </p>
            <Button size="sm" onClick={shiftTemplate}>
              {shiftDays > 0
                ? `Shift template dates by ${plural(shiftDays, 'day')}`
                : `Shift template dates ${plural(-shiftDays, 'day')} earlier`}
            </Button>
          </div>
        ) : null}
        {firstEarly ? (
          <div className={styles.notice} role={errors.assessmentDates ? 'alert' : 'status'}>
            <p className={shared.error}>
              {early.length === 1
                ? `“${firstEarly.title}” is dated ${formatDay(firstEarly.date, today)}, before your start date.`
                : `${early.length} assessments are dated before your start date, the first on ${formatDay(firstEarly.date, today)}.`}{' '}
              Move the start earlier, or change those dates on the review step, to continue.
            </p>
            <Button size="sm" onClick={() => dispatch({ type: 'go', step: 4 })}>
              Review the dates
            </Button>
          </div>
        ) : null}
      </section>

      {hasCus && draft.targetMode === 'date' ? (
        <section className={shared.section}>
          <Toggle
            label="Save this as a WGU term"
            checked={draft.wguTerm}
            onCheckedChange={(wguTerm) => patch({ wguTerm })}
          />
          <p className={shared.hint}>
            Adds a “CUs completed this term” bar to the goal, from your start date to your finish
            date.
          </p>
        </section>
      ) : null}
    </div>
  )
}
