import type { Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import { formatDay, plural } from '@/logic/goalDisplay'
import { formatHours } from '@/logic/goalDisplay'
import { weeklyWindowMinutes } from '@/logic/plannerAvailability'
import { draftEffort, type DraftErrors, type PlannerAction, type PlannerDraft } from '@/logic/plannerDraft'
import { Input } from '@/ui/Input'
import shared from '../shared.module.css'
import styles from './ConfirmStep.module.css'

export interface ConfirmStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
  /** Creating failed: nothing was saved. */
  failed: boolean
}

/** The last look: name it, see what will be created, then create it. Undo is one click away afterwards. */
export function ConfirmStep({ draft, dispatch, errors, today, failed }: ConfirmStepProps) {
  const units = draft.courses.reduce((n, c) => n + c.units.length, 0)
  const assessments = draft.courses.reduce((n, c) => n + c.assessments.length, 0)
  const study = draftEffort(draft).totalMinutes
  const rows: Array<[string, string]> = [
    [
      'Made of',
      [
        plural(draft.courses.length, 'course'),
        units > 0 ? plural(units, 'unit') : null,
        assessments > 0 ? plural(assessments, 'assessment') : null,
      ]
        .filter((s) => s !== null)
        .join(', '),
    ],
    ['Study time', `${formatHours(study)} h, plus ${Math.round(draft.bufferPct * 100)}% slack`],
    [
      'Starts',
      formatDay(draft.startDate, today),
    ],
    [
      'Finish',
      draft.targetMode === 'asap' || !draft.targetDate
        ? 'As fast as possible'
        : formatDay(draft.targetDate, today),
    ],
    [
      'Study windows',
      `≈ ${formatHours(weeklyWindowMinutes(draft.availability))} h a week, ${draft.availability.sessionMinutes}-minute sessions`,
    ],
  ]
  return (
    <div className={shared.stack}>
      <p className={shared.lead}>
        Creating the goal adds its courses and units, then schedules study sessions, reviews and
        practice tests inside your windows. You can undo it right after, and change anything later.
      </p>
      <Input
        label="Goal name"
        value={draft.title}
        maxLength={120}
        error={errors.title}
        onChange={(e) => dispatch({ type: 'patch', patch: { title: e.target.value } })}
      />
      <dl className={styles.facts}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.fact}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {failed ? (
        <p className={shared.error} role="alert">
          Couldn’t create the goal. Nothing was saved. Try again, or go back and check the dates.
        </p>
      ) : null}
    </div>
  )
}
