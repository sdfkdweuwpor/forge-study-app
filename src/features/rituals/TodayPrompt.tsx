import { Moon, Sun } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'
import { useNow } from '@/app/hooks/useNow'
import { useToday } from '@/app/hooks/useToday'
import { useSettings } from '@/db/hooks/useSettings'
import { minutesOfDay } from '@/logic/dates'
import {
  dismissedKinds,
  promptTimes,
  ritualPrompt,
  withDismissed,
  type RitualKind,
} from '@/logic/rituals'
import { PREF_KEYS, readPref, subscribePrefs, writePref } from '@/lib/localPrefs'
import { Button } from '@/ui/Button'
import { useSettleHold } from '@/ui/Settle'
import { useRitual } from './queries'
import { openRitualDialog } from './store'
import styles from './TodayPrompt.module.css'

const COPY: Record<
  RitualKind,
  { title: string; body: string; start: string; away: string; name: string }
> = {
  morning: {
    title: 'Plan your day',
    body: 'Pick your top 3 and set your goal. About two minutes.',
    start: 'Start morning plan',
    away: 'Not today',
    name: 'Morning plan',
  },
  evening: {
    title: 'Wrap up the day',
    body: 'See what got done, move the rest to tomorrow, and leave one line for yourself.',
    start: 'Start evening shutdown',
    away: 'Not tonight',
    name: 'Evening shutdown',
  },
}

/**
 * Slot `today.header`: one gentle invitation. The morning plan before noon while it is not done, the
 * evening shutdown from 17:00 while it is not done (both times are settings), and nothing in between. It
 * can be put away for the day ("Not today"), which is remembered on this device only, and it stays away
 * once the ritual is done. It has no counter, no streak and no colour of alarm: skipping costs nothing.
 */
export function RitualPrompt() {
  const today = useToday()
  const now = useNow('minute')
  const settings = useSettings()
  const morning = useRitual('morning', today)
  const evening = useRitual('evening', today)
  const stored = useSyncExternalStore(
    subscribePrefs,
    () => readPref(PREF_KEYS.ritualPromptsDismissed),
    () => null,
  )

  const dismiss = useCallback(
    (kind: RitualKind) =>
      writePref(
        PREF_KEYS.ritualPromptsDismissed,
        withDismissed(readPref(PREF_KEYS.ritualPromptsDismissed), today, kind),
      ),
    [today],
  )

  const loading = settings === undefined || morning === undefined || evening === undefined
  useSettleHold(loading)
  if (loading) return null
  const kind = ritualPrompt({
    minutes: minutesOfDay(now),
    times: promptTimes(settings.rituals),
    enabled: settings.rituals.prompts,
    morningDone: morning?.completedAt != null,
    eveningDone: evening?.completedAt != null,
    dismissed: dismissedKinds(stored, today),
  })
  if (kind === null) return null
  const copy = COPY[kind]
  const Icon = kind === 'morning' ? Sun : Moon

  return (
    <section
      className={styles.prompt}
      aria-label={copy.name}
      data-testid="ritual-prompt"
      data-kind={kind}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon />
      </span>
      <div className={styles.text}>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.body}>{copy.body}</p>
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={() => openRitualDialog(kind)}>
          {copy.start}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => dismiss(kind)}>
          {copy.away}
        </Button>
      </div>
    </section>
  )
}
