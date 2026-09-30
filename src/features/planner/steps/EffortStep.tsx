import type { Dispatch } from 'react'
import {
  fillBlankUnits,
  type DraftErrors,
  type PlannerAction,
  type PlannerDraft,
} from '@/logic/plannerDraft'
import { effortLabel } from '@/logic/plannerEffort'
import { draftEffort } from '@/logic/plannerDraft'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { CourseEffortCard } from '../components/EffortEditor'
import shared from '../shared.module.css'
import { EffortSettings } from './EffortSettings'

export interface EffortStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
}

export function EffortStep({ draft, dispatch, errors }: EffortStepProps) {
  const total = draftEffort(draft).totalMinutes
  const blanks = draft.courses.some(
    (c) => c.units.some((u) => u.minutes === null) && errors[`course:${c.key}`] !== undefined,
  )

  if (draft.courses.length === 0) {
    return (
      <EmptyState
        title="Nothing to estimate yet"
        description="Go back to the first step and add a template, a course list or a goal."
        action={
          <Button onClick={() => dispatch({ type: 'go', step: 0 })}>Back to the start</Button>
        }
      />
    )
  }

  return (
    <div className={shared.stack}>
      <p className={shared.lead}>
        How long will each course take? Use its hours, or its competency units times your hours per
        CU, then say how well you already know it.
      </p>
      <EffortSettings
        multiplier={draft.cuMultiplier}
        onMultiplier={(cuMultiplier) => dispatch({ type: 'patch', patch: { cuMultiplier } })}
        bufferPct={draft.bufferPct}
        onBufferPct={(bufferPct) => dispatch({ type: 'patch', patch: { bufferPct } })}
      />
      {blanks ? (
        <div className={shared.section}>
          <p className={shared.hint}>
            Some courses have units but no hours. Give each unit a starting point of 3 h and adjust
            below?
          </p>
          <Button
            size="sm"
            onClick={() => dispatch({ type: 'replaceDraft', draft: fillBlankUnits(draft, 3) })}
          >
            Set 3 h for each blank unit
          </Button>
        </div>
      ) : null}
      <div>
        {draft.courses.map((course) => (
          <CourseEffortCard
            key={course.key}
            course={course}
            draft={draft}
            dispatch={dispatch}
            error={errors[`course:${course.key}`]}
          />
        ))}
      </div>
      <p className={shared.hint} aria-live="polite">
        In all: <strong className={shared.num}>{effortLabel(total)}</strong> of study before slack.
      </p>
    </div>
  )
}
