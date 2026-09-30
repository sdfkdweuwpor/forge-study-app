import { useState } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { savePlanSettings } from '@/db/repos/planSettings'
import type { Goal } from '@/db/types'
import { newId } from '@/lib/ids'
import { toGoalAvailability } from '@/logic/plannerAvailability'
import { settingsFromGoal, validateSettings, type PlanSettingsDraft } from '@/logic/plannerDraft'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { Modal } from '@/ui/Modal'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/Toast'
import { AvailabilityEditor } from '../components/AvailabilityEditor'
import { EffortSettings } from '../steps/EffortSettings'
import shared from '../shared.module.css'

export interface PlanSettingsDialogProps {
  goal: Goal
  open: boolean
  onClose: () => void
}

/**
 * Plan settings: the finish date (or as fast as possible), study windows, shift pattern, session length,
 * days off, the buffer and the hours per CU. The same editors as the planner's steps. Saving re-plans the
 * goal from today (`rebalanceGoal`, reason `edit`). Mount it with a fresh `key` each time it opens.
 */
export function PlanSettingsDialog({ goal, open, onClose }: PlanSettingsDialogProps) {
  const today = useToday()
  const toast = useToast()
  const [s, setS] = useState<PlanSettingsDraft>(() => settingsFromGoal(goal, newId))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const errors = attempted ? validateSettings(s, today) : {}
  const patch = (p: Partial<PlanSettingsDraft>) => setS((prev) => ({ ...prev, ...p }))

  async function save() {
    if (Object.keys(validateSettings(s, today)).length > 0) {
      setAttempted(true)
      return
    }
    setSaving(true)
    try {
      const stored = toGoalAvailability(s.availability)
      const r = await savePlanSettings(goal.id, {
        targetDate: s.targetMode === 'asap' ? null : s.targetDate,
        asap: s.targetMode === 'asap',
        availability: stored.availability,
        planning: stored.planning,
        bufferPct: s.bufferPct,
        cuHoursMultiplier: s.cuMultiplier,
      })
      if (r === null) {
        toast.error('This goal no longer exists')
      } else if (r.planError !== null) {
        recordError(r.planError, 'planSettings')
        toast.error('Saved, but the plan could not be rebuilt', { description: 'Try Re-plan again from the goal.' })
        onClose()
      } else {
        toast.success('Plan settings saved', { description: 'The goal was re-planned from today.' })
        onClose()
      }
    } catch (error) {
      recordError(error, 'savePlanSettings')
      toast.error('Couldn’t save that', { description: 'Nothing was changed. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plan settings"
      description="Saving re-plans the goal from today. Finished work stays finished."
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
      <div className={shared.stack}>
        <section className={shared.section} aria-labelledby="ps-finish">
          <h3 id="ps-finish" className={shared.sectionTitle}>
            Finish
          </h3>
          <SegmentedControl
            label="Finish"
            value={s.targetMode}
            onValueChange={(targetMode) => patch({ targetMode })}
            options={[
              { value: 'date', label: 'By a date' },
              { value: 'asap', label: 'As fast as possible' },
            ]}
          />
          {s.targetMode === 'date' ? (
            <DatePicker
              label="Target finish date"
              value={s.targetDate}
              today={today}
              min={today}
              clearable={false}
              error={errors.targetDate}
              onChange={(targetDate) => patch({ targetDate })}
            />
          ) : null}
        </section>
        <section className={shared.section} aria-labelledby="ps-effort">
          <h3 id="ps-effort" className={shared.sectionTitle}>
            Effort
          </h3>
          <EffortSettings
            multiplier={s.cuMultiplier}
            onMultiplier={(cuMultiplier) => patch({ cuMultiplier })}
            bufferPct={s.bufferPct}
            onBufferPct={(bufferPct) => patch({ bufferPct })}
          />
        </section>
        <AvailabilityEditor
          value={s.availability}
          errors={errors}
          today={today}
          onChange={(availability) => patch({ availability })}
        />
      </div>
    </Modal>
  )
}
