import { BUFFER_CHOICES } from '../buffer'
import { Input } from '@/ui/Input'
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
        <Input
          size="sm"
          aria-label="Hours per competency unit"
          inputMode="decimal"
          value={String(multiplier)}
          trailing={<span className={shared.unit}>h</span>}
          className={shared.hours}
          onChange={(e) => {
            const n = Number(e.target.value.replace(',', '.'))
            if (Number.isFinite(n) && n > 0 && n <= 60) onMultiplier(n)
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
