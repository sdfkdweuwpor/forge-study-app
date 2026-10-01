import type { Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import type { DraftErrors, PlannerAction, PlannerDraft } from '@/logic/plannerDraft'
import { AvailabilityEditor } from '../components/AvailabilityEditor'
import shared from '../shared.module.css'

export interface AvailabilityStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
}

export function AvailabilityStep({ draft, dispatch, errors, today }: AvailabilityStepProps) {
  return (
    <div className={shared.stack}>
      <p className={shared.lead}>
        Tell Forge when you can really study. It only ever plans inside these windows.
      </p>
      <AvailabilityEditor
        value={draft.availability}
        errors={errors}
        today={today}
        onChange={(availability) => dispatch({ type: 'availability', availability })}
      />
    </div>
  )
}
