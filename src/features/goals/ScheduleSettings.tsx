import { useReducer, useState } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { newId } from '@/lib/ids'
import type { Goal } from '@/db/types'
import { draftFromGoal, draftSchedule, validateSchedule } from '@/logic/goalDraft'
import { initialWizard, wizardReducer } from '@/logic/goalWizard'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { Modal } from '@/ui/Modal'
import { useGoalActions } from './actions'
import { AvailabilityEditor } from './wizard/AvailabilityEditor'
import styles from './wizard/wizard.module.css'

export interface ScheduleSettingsProps {
  goal: Goal
  open: boolean
  onClose: () => void
}

/**
 * Change when a goal is due and when you study: target date, hours per weekday, days off, WGU term. The
 * same form as the wizard's availability step. Saving re-plans the goal. Mount it with a fresh `key` each
 * time it opens, so it starts from the goal as it is now.
 */
export function ScheduleSettings({ goal, open, onClose }: ScheduleSettingsProps) {
  const today = useToday()
  const actions = useGoalActions()
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => ({
    ...initialWizard(today),
    draft: draftFromGoal(goal, today, newId),
  }))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const { draft } = state

  const errors = attempted ? validateSchedule(draft, today) : {}

  async function save() {
    if (Object.keys(validateSchedule(draft, today)).length > 0) {
      setAttempted(true)
      return
    }
    setSaving(true)
    const schedule = draftSchedule(draft, goal.terms[0]?.id ?? newId())
    const ok = await actions.updateGoal(goal.id, schedule)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule settings"
      description="Changing these re-plans the goal from today."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save and re-plan
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Target end date</span>
          <DatePicker
            label="Target end date"
            value={draft.targetDate}
            today={today}
            min={today}
            error={errors.targetDate}
            onChange={(targetDate) => dispatch({ type: 'patch', patch: { targetDate } })}
          />
        </div>
        <AvailabilityEditor draft={draft} dispatch={dispatch} errors={errors} today={today} />
      </div>
    </Modal>
  )
}
