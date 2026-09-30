import { useId } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { recordError } from '@/app/reportError'
import { useShortcutHandler } from '@/app/shortcuts'
import { saveCheckIn } from '@/db/repos/checkins'
import type { ID } from '@/db/types'
import { SegmentedControl, type SegmentOption } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/Toast'
import { MOODS, RATINGS, type Rating } from './moods'
import { useCheckIn } from './queries'
import styles from './CheckInPrompt.module.css'

const OPTIONS: readonly SegmentOption<string>[] = RATINGS.map((n) => ({
  value: String(n),
  label: String(n),
  'aria-label': `${n} of 5`,
}))

/** Binds one rating key (a hook per key, so each is its own component). */
function RateKey({ n, onRate }: { n: Rating; onRate: (n: Rating) => void }) {
  useShortcutHandler(`checkins.rate.${n}`, () => onRate(n))
  return null
}

/**
 * Slot `focus.afterSession`: "How was your focus?", 1 to 5, and once rated an optional mood. Always
 * optional and never repeated: skip it and nothing is asked again. Rating saves at once (and again if you
 * change your mind), so there is no button to press. Keys 1 to 5 work while the dialog is open.
 */
export function CheckInPrompt({ sessionId }: { sessionId: ID }) {
  return (
    <ErrorBoundary
      fallback={() => <p className={styles.quiet}>Couldn’t load the check-in. You can skip it.</p>}
    >
      <CheckInBody sessionId={sessionId} />
    </ErrorBoundary>
  )
}

function CheckInBody({ sessionId }: { sessionId: ID }) {
  const toast = useToast()
  const checkIn = useCheckIn(sessionId)
  const labelId = useId()

  const focus = checkIn?.focus ?? null
  const mood = checkIn?.mood ?? null

  const save = async (nextFocus: Rating, nextMood: string | null): Promise<void> => {
    try {
      await saveCheckIn({ sessionId, focus: nextFocus, mood: nextMood })
    } catch (error) {
      recordError(error, 'save the check-in')
      toast.error('Couldn’t save that', { description: 'Nothing was changed. Try again.' })
    }
  }
  const rate = (n: Rating): void => void save(n, mood)

  if (checkIn === undefined) {
    return (
      <div className={styles.section} role="status" aria-busy="true" aria-label="Loading check-in">
        <Skeleton variant="block" height={32} />
      </div>
    )
  }

  return (
    <section className={styles.section} aria-labelledby={labelId} data-testid="checkin">
      {RATINGS.map((n) => (
        <RateKey key={n} n={n} onRate={rate} />
      ))}
      <div className={styles.row}>
        <span id={labelId} className={styles.label}>
          How was your focus?
        </span>
        <SegmentedControl<string>
          label="How was your focus?"
          size="sm"
          options={OPTIONS}
          value={focus === null ? '' : String(focus)}
          onValueChange={(v) => rate(Number(v) as Rating)}
        />
      </div>
      {focus === null ? (
        <p className={styles.hint}>Optional. 1 is scattered, 5 is fully in the zone.</p>
      ) : (
        <>
          <div className={styles.moods} role="group" aria-label="Mood, optional">
            {MOODS.map((m) => (
              <Tag
                key={m.emoji}
                size="md"
                shape="pill"
                pressed={mood === m.emoji}
                onClick={() => void save(focus, mood === m.emoji ? null : m.emoji)}
              >
                <span role="img" aria-label={m.name} className={styles.mood}>
                  {m.emoji}
                </span>
              </Tag>
            ))}
          </div>
          <p className={styles.hint} role="status">
            Saved. This helps Forge find your best hours.
          </p>
        </>
      )}
    </section>
  )
}
