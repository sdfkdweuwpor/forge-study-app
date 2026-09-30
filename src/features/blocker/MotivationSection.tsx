import { Plus, RotateCcw, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { recordError } from '@/app/reportError'
import { DEFAULT_MOTIVATION } from '@/db/defaults'
import { resetMotivationLines, setMotivationLines } from '@/db/repos/blocker'
import { cleanMotivationLine } from '@/logic/blocker'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Skeleton } from '@/ui/Skeleton'
import { useBlockerSettings } from './queries'
import { Section } from './Section'
import styles from './MotivationSection.module.css'

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((line, i) => line === b[i])

/** The lines the blocked page picks from at random. Edit in place; changes save when you leave a line. */
export function MotivationSection() {
  const settings = useBlockerSettings()
  return (
    <Section
      id="motivation"
      title="Motivation lines"
      description="The blocked page shows one of these each time, at random. Write what you’d like to hear."
    >
      {settings === undefined ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading motivation lines"
        >
          <Skeleton width="70%" />
          <Skeleton width="55%" />
          <Skeleton width="62%" />
        </div>
      ) : (
        <Lines lines={settings.motivation} />
      )}
    </Section>
  )
}

function Lines({ lines }: { lines: readonly string[] }) {
  const [draft, setDraft] = useState('')

  const save = (next: readonly string[]) => {
    setMotivationLines(next).catch((e: unknown) => recordError(e, 'blocker.motivation'))
  }

  function add(e: FormEvent) {
    e.preventDefault()
    const line = cleanMotivationLine(draft)
    if (line === '') return
    save([...lines, line])
    setDraft('')
  }

  return (
    <div className={styles.body}>
      {lines.length === 0 ? (
        <p className={styles.hint}>
          No lines yet. The blocked page will show its own short reminder.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Motivation lines">
          {lines.map((line, i) => (
            <li key={`${i}-${line}`} className={styles.row}>
              {/* The wrapper mirrors the text in a hidden ::after, so the field grows with long lines. */}
              <div className={styles.grow} data-value={line}>
                <textarea
                  className={styles.line}
                  rows={1}
                  defaultValue={line}
                  maxLength={500}
                  aria-label={`Motivation line ${i + 1}`}
                  onInput={(e) => {
                    const box = e.currentTarget.parentElement
                    if (box) box.dataset['value'] = e.currentTarget.value
                  }}
                  onBlur={(e) => {
                    const next = cleanMotivationLine(e.target.value)
                    if (next === line) return
                    save(
                      next === ''
                        ? lines.filter((_, k) => k !== i)
                        : lines.map((l, k) => (k === i ? next : l)),
                    )
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                />
              </div>
              <IconButton
                size="sm"
                className={styles.remove}
                label={`Remove line ${i + 1}`}
                icon={<X />}
                onClick={() => save(lines.filter((_, k) => k !== i))}
              />
            </li>
          ))}
        </ul>
      )}

      <form className={styles.add} onSubmit={add}>
        <Input
          className={styles.addInput}
          aria-label="Add a motivation line"
          placeholder="Add a line, like “C182 is one unit at a time.”"
          value={draft}
          maxLength={500}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          iconLeft={<Plus />}
          disabled={cleanMotivationLine(draft) === ''}
        >
          Add
        </Button>
      </form>

      {!same(lines, DEFAULT_MOTIVATION) ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<RotateCcw />}
            onClick={() => {
              resetMotivationLines().catch((e: unknown) =>
                recordError(e, 'blocker.motivationReset'),
              )
            }}
          >
            Restore the default lines
          </Button>
        </div>
      ) : null}
    </div>
  )
}
