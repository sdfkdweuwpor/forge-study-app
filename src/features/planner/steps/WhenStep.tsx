import type { Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import { addDays, addMonths } from '@/logic/dates'
import { termEndFor } from '@/logic/goalDraft'
import { formatDay } from '@/logic/goalDisplay'
import type { DraftErrors, DraftPatch, PlannerAction, PlannerDraft } from '@/logic/plannerDraft'
import { DatePicker } from '@/ui/DatePicker'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Tag } from '@/ui/Tag'
import { Toggle } from '@/ui/Toggle'
import shared from '../shared.module.css'
import styles from './WhenStep.module.css'

export interface WhenStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
}

export function WhenStep({ draft, dispatch, errors, today }: WhenStepProps) {
  const patch = (p: DraftPatch) => dispatch({ type: 'patch', patch: p })
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
