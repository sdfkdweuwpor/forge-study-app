import { BUFFER_CHOICES } from '../buffer'
import { NumberField } from '../components/NumberField'
import { SegmentedControl } from '@/ui/SegmentedControl'
import shared from '../shared.module.css'

export interface EffortSettingsProps {
  multiplier: number
  onMultiplier: (n: number) => void
  bufferPct: number
  onBufferPct: (n: number) => void
}

/** Hours per CU and the slack kept at the end: the two numbers that apply to the whole plan. */
export function EffortSettings({
  multiplier,
  onMultiplier,
  bufferPct,
  onBufferPct,
}: EffortSettingsProps) {
  const choices = BUFFER_CHOICES.some((c) => c.value === String(bufferPct))
    ? BUFFER_CHOICES
    : [...BUFFER_CHOICES, { value: String(bufferPct), label: `${Math.round(bufferPct * 100)}%` }]
  return (
    <div className={shared.actions} style={{ gap: 'var(--space-8)', alignItems: 'flex-start' }}>
      <div className={shared.field}>
        <span className={shared.fieldLabel}>Hours per CU</span>
        <NumberField
          label="Hours per competency unit"
          value={multiplier}
          unit="h"
          above={0}
          max={60}
          invalidText="Try 12 or 7.5"
          onCommit={(n) => {
            if (n !== null) onMultiplier(n)
          }}
        />
        <p className={shared.hint}>A 3-CU course is about {Math.round(multiplier * 3)} h.</p>
      </div>
      <div className={shared.field}>
        <span className={shared.fieldLabel}>Slack at the end</span>
        <SegmentedControl
          size="sm"
          label="Buffer"
          value={String(bufferPct)}
          onValueChange={(v) => onBufferPct(Number(v))}
          options={choices}
        />
        <p className={shared.hint}>Kept free after the last session, for the days that slip.</p>
      </div>
    </div>
  )
}
