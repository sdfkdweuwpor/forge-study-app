import { useId, useState, type ReactNode } from 'react'
import { recordError } from '@/app/reportError'
import { useSettings } from '@/db/hooks/useSettings'
import { updateSettings } from '@/db/repos/settings'
import { parseHHmm } from '@/logic/dates'
import { promptTimes, RITUAL_DEFAULT_TIMES } from '@/logic/rituals'
import { Input } from '@/ui/Input'
import { Skeleton } from '@/ui/Skeleton'
import { Toggle } from '@/ui/Toggle'
import styles from './Settings.module.css'

type Field = 'morningUntil' | 'eveningFrom'

/**
 * Settings → Rituals (slot `settings.sections`): whether Today may offer the morning plan and the evening
 * shutdown, and when. The offer is one quiet card that can be put away for the day; nothing counts a skipped
 * ritual. The two times are `settings.rituals.morningUntil` and `eveningFrom`.
 */
export function RitualsSection() {
  const headingId = useId()
  const settings = useSettings()
  const [status, setStatus] = useState<{ tone: 'saved' | 'error'; text: string } | null>(null)

  async function save(patch: Parameters<typeof updateSettings>[0]): Promise<void> {
    try {
      await updateSettings(patch)
      setStatus({ tone: 'saved', text: 'Saved.' })
    } catch (error) {
      recordError(error, 'settings.rituals')
      setStatus({ tone: 'error', text: 'Couldn’t save that. Try again.' })
    }
  }

  if (settings === undefined) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.heading}>
          Rituals
        </h2>
        <div className={styles.loading} role="status" aria-label="Loading ritual settings">
          <Skeleton variant="block" height={44} />
          <Skeleton variant="block" height={44} />
        </div>
      </section>
    )
  }

  const times = promptTimes(settings.rituals)

  function commit(field: Field, value: string): void {
    if (value === '' || parseHHmm(value) === null) return
    const next = { ...times, [field]: value }
    if ((parseHHmm(next.eveningFrom) ?? 0) <= (parseHHmm(next.morningUntil) ?? 0)) {
      setStatus({ tone: 'error', text: 'The evening shutdown should start after the morning plan ends.' })
      return
    }
    if (value !== times[field]) void save({ rituals: { [field]: value } })
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Rituals
      </h2>
      <p className={styles.intro}>
        The morning plan and the evening shutdown are always in the command palette. On Today, Forge can
        also offer them once, gently. Skipping one costs nothing.
      </p>
      <RitualsRow label="Offer them on Today" help="A card you can put away for the day.">
        {(id) => (
          <Toggle
            aria-labelledby={id}
            checked={settings.rituals.prompts}
            onCheckedChange={(prompts) => void save({ rituals: { prompts } })}
          />
        )}
      </RitualsRow>
      <RitualsRow label="Morning plan until" help="Offered from midnight until this time.">
        {(id) => (
          <Input
            key={times.morningUntil}
            className={styles.time}
            type="time"
            aria-labelledby={id}
            defaultValue={times.morningUntil}
            disabled={!settings.rituals.prompts}
            onBlur={(e) => commit('morningUntil', e.target.value)}
          />
        )}
      </RitualsRow>
      <RitualsRow label="Evening shutdown from" help="Offered from this time until midnight.">
        {(id) => (
          <Input
            key={times.eveningFrom}
            className={styles.time}
            type="time"
            aria-labelledby={id}
            defaultValue={times.eveningFrom}
            disabled={!settings.rituals.prompts}
            onBlur={(e) => commit('eveningFrom', e.target.value)}
          />
        )}
      </RitualsRow>
      <p className={styles.status} role="status" data-tone={status?.tone}>
        {status?.text ?? ''}
      </p>
      <p className={styles.help}>
        Usual times: morning until {RITUAL_DEFAULT_TIMES.morningUntil}, evening from{' '}
        {RITUAL_DEFAULT_TIMES.eveningFrom}.
      </p>
    </section>
  )
}

function RitualsRow({
  label,
  help,
  children,
}: {
  label: string
  help: string
  children: (labelId: string) => ReactNode
}) {
  const labelId = useId()
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        <p className={styles.help}>{help}</p>
      </div>
      <div className={styles.control}>{children(labelId)}</div>
    </div>
  )
}
