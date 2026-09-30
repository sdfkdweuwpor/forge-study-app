import { Check, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Favicon } from '@/features/blocker'
import type { SiteChip } from '@/logic/onboarding'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Skeleton } from '@/ui/Skeleton'
import chipStyles from './SitesStep.module.css'
import styles from './steps.module.css'

export type SitesStatus = 'loading' | 'error' | 'ready'

export interface SitesStepProps {
  status: SitesStatus
  chips: readonly SiteChip[]
  onToggle: (domain: string) => void
  /** Adds what was typed. Resolves to `null` when it was added, or to a message for the field. */
  onAdd: (text: string) => string | null
  onRetry: () => void
}

/** Step 2: the sites to keep out of the way, as chips that switch on and off, and a field for more. */
export function SitesStep({ status, chips, onToggle, onAdd, onRetry }: SitesStepProps) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  function add() {
    const result = onAdd(text)
    setProblem(result)
    if (result === null) setText('')
  }

  if (status === 'loading') {
    return (
      <div
        className={chipStyles.chips}
        role="status"
        aria-busy="true"
        aria-label="Loading your sites"
      >
        {Array.from({ length: 11 }, (_, i) => (
          <Skeleton key={i} variant="block" width={96 + ((i * 17) % 40)} height={32} />
        ))}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={styles.section} role="alert">
        <p className={styles.error}>
          Couldn’t load your blocklist. Your data is safe on this device.
        </p>
        <div>
          <Button iconLeft={<RefreshCw />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const picked = chips.filter((c) => c.selected).length
  return (
    <div className={styles.step}>
      <div className={styles.section}>
        <div className={chipStyles.chips} role="group" aria-label="Sites to block">
          {chips.map((chip) => (
            <button
              key={chip.domain}
              type="button"
              className={chipStyles.chip}
              aria-pressed={chip.selected}
              onClick={() => onToggle(chip.domain)}
            >
              <Favicon domain={chip.domain} size={16} />
              <span className={chipStyles.name}>{chip.domain}</span>
              <Check className={chipStyles.check} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className={styles.hint} role="status">
          {picked === 0
            ? 'Nothing will be blocked. You can still add sites any time on the Blocker page.'
            : `${picked} of ${chips.length} ${chips.length === 1 ? 'site' : 'sites'} will be blocked while you focus.`}
        </p>
      </div>

      <section className={styles.section} aria-labelledby="onboarding-add-site">
        <h2 id="onboarding-add-site" className={styles.sectionTitle}>
          Add another site
        </h2>
        <div className={chipStyles.add}>
          <Input
            className={chipStyles.field}
            aria-label="Site to add"
            placeholder="hulu.com"
            value={text}
            error={problem}
            hint="A full address works too. Subdomains are included."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="url"
            onChange={(e) => {
              setText(e.target.value)
              if (problem) setProblem(null)
            }}
            onKeyDown={(e) => {
              // Enter adds the site here; it must not continue to the next step.
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button variant="secondary" iconLeft={<Plus />} onClick={add}>
            Add
          </Button>
        </div>
      </section>
    </div>
  )
}
