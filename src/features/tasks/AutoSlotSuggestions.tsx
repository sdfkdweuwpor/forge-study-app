import { CalendarClock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNow } from '@/app/hooks/useNow'
import { recordError } from '@/app/reportError'
import { Link } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import { acceptAutoSlots, dismissAutoSlots } from '@/db/repos/autoslot'
import { dayOf } from '@/logic/dates'
import { plural } from '@/logic/goalDisplay'
import {
  describeNoRoom,
  suggestionWhen,
  type NoRoom,
  type SlotSuggestion,
} from '@/logic/everydaySlots'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useSettleHold } from '@/ui/Settle'
import { useToast } from '@/ui/Toast'
import { useAutoSlotProposal } from './queries'
import {
  onSuggestionsRequest,
  registerSuggestionsCard,
  takePendingRequest,
} from './suggestionsCard'
import { EVERYDAY_HOURS_SECTION, openTask } from './taskUrls'
import styles from './AutoSlotSuggestions.module.css'

/**
 * "Suggested times": for tasks that have a deadline, no day of their own and Auto-schedule switched on,
 * the earliest open slot in the person's everyday hours. Nothing is placed until Accept (or Accept all);
 * Dismiss turns Auto-schedule off for that task. Each choice offers Undo. Renders nothing when there is
 * nothing to suggest, so any screen can place it (Inbox, Upcoming, Today).
 */
export function AutoSlotSuggestions({ className }: { className?: string }) {
  const toast = useToast()
  const now = useNow('minute')
  const today = dayOf(now)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const state = useAutoSlotProposal(now, attempt)
  useSettleHold(state.status === 'loading')

  const suggestions: readonly SlotSuggestion[] =
    state.status === 'ready' ? state.proposal.suggestions : []
  const noRoom: readonly NoRoom[] = state.status === 'ready' ? state.proposal.noRoom : []

  const accept = useCallback(
    async (slots: readonly SlotSuggestion[]) => {
      if (busy || slots.length === 0) return
      setBusy(true)
      try {
        const result = await acceptAutoSlots(slots)
        const taken =
          result.conflicts.length > 0
            ? `${plural(result.conflicts.length, 'time')} got taken while you looked, so Forge found new ${result.conflicts.length === 1 ? 'one' : 'ones'}.`
            : null
        const [only] = result.appliedSlots
        if (result.applied === 0) {
          toast.show({
            title: taken ? 'Those times were just taken' : 'Nothing was scheduled',
            description:
              taken ??
              'Those tasks changed since the suggestions were made, so they were left alone.',
          })
        } else {
          toast.show({
            variant: 'success',
            title:
              result.applied === 1 && only
                ? `Scheduled “${only.title}”`
                : `Scheduled ${plural(result.applied, 'task')}`,
            ...(result.applied === 1 && only
              ? { description: [suggestionWhen(only, today), taken].filter(Boolean).join('. ') }
              : taken
                ? { description: taken }
                : {}),
            undo: result.undo,
          })
        }
        // A time that was taken is worked out again from what is free now.
        if (result.conflicts.length > 0) setAttempt((n) => n + 1)
      } catch (error) {
        recordError(error, 'acceptAutoSlots')
        toast.error('Couldn’t schedule that', { description: 'Nothing was changed. Try again.' })
      } finally {
        setBusy(false)
      }
    },
    [busy, toast, today],
  )

  const dismiss = useCallback(
    async (ids: readonly string[]) => {
      if (busy || ids.length === 0) return
      setBusy(true)
      try {
        const { undo } = await dismissAutoSlots(ids)
        toast.show({
          title:
            ids.length === 1 ? 'Okay, you’ll pick a time' : `Okay, you’ll pick ${ids.length} times`,
          description: 'Auto-schedule is off for that task.',
          undo,
        })
      } catch (error) {
        recordError(error, 'dismissAutoSlots')
        toast.error('Couldn’t change that', { description: 'Nothing was changed. Try again.' })
      } finally {
        setBusy(false)
      }
    },
    [busy, toast],
  )

  // The command "Accept suggested times" asks the card to show itself when it is not on the page yet.
  const card = useRef<HTMLElement | null>(null)
  const ready = state.status !== 'loading'
  const reveal = useCallback(() => {
    if (card.current) {
      card.current.scrollIntoView({ block: 'center' })
      card.current.focus()
    } else {
      toast.show({
        title: 'No suggested times right now',
        description: 'Tasks with a deadline and Auto-schedule on show up here.',
      })
    }
  }, [toast])

  // Bound while the card is on the page, even with nothing to accept, so the key says so instead of doing nothing.
  useShortcutHandler('tasks.acceptSlots', () => {
    if (suggestions.length > 0) void accept(suggestions)
    else reveal()
  })
  useEffect(() => registerSuggestionsCard(), [])
  // A request that comes while the suggestions are still loading waits for them.
  const waiting = useRef(false)
  useEffect(
    () =>
      onSuggestionsRequest(() => {
        if (ready) reveal()
        else waiting.current = true
      }),
    [ready, reveal],
  )
  useEffect(() => {
    if (!ready) return
    const asked = waiting.current || takePendingRequest()
    waiting.current = false
    if (asked) reveal()
  }, [ready, reveal])

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <section
        ref={card}
        tabIndex={-1}
        className={`${styles.card} ${className ?? ''}`}
        aria-label="Suggested times"
      >
        <p className={styles.quiet}>Couldn’t work out suggested times.</p>
        <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </section>
    )
  }
  if (suggestions.length === 0 && noRoom.length === 0) return null

  return (
    <section
      ref={card}
      tabIndex={-1}
      className={`${styles.card} ${className ?? ''}`}
      aria-labelledby="autoslot-heading"
    >
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title} id="autoslot-heading">
            <CalendarClock size={15} aria-hidden="true" /> Suggested times
          </h2>
          <p className={styles.sub}>From your open hours. Nothing changes until you accept.</p>
        </div>
        {suggestions.length > 1 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void accept(suggestions)}
          >
            Accept all <Kbd keys="shift+a" size="sm" variant="plain" />
          </Button>
        ) : null}
      </header>

      <div className={styles.list} role="group" aria-label="Suggestions">
        {suggestions.map((s) => (
          <div key={s.taskId} className={styles.item}>
            <span className={styles.text}>
              <span className={styles.name}>{s.title}</span> <span className={styles.arrow}>→</span>{' '}
              <span className={styles.when}>
                {suggestionWhen(s, today)} ({s.minutes} min)
              </span>
            </span>
            <span className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={`Accept: ${s.title}`}
                onClick={() => void accept([s])}
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Dismiss: ${s.title}`}
                onClick={() => void dismiss([s.taskId])}
              >
                Dismiss
              </Button>
            </span>
          </div>
        ))}
        {noRoom.map((n) => (
          <div key={n.taskId} className={styles.item}>
            <span className={styles.text}>
              <span className={styles.name}>{n.title}</span>
              <span className={styles.note}>{describeNoRoom(n, today)}</span>
              {n.reason === 'noRoom' ? (
                <Link
                  to="settings"
                  params={{ section: EVERYDAY_HOURS_SECTION }}
                  className={styles.hint}
                >
                  Adjust your everyday hours
                </Link>
              ) : null}
            </span>
            <span className={styles.actions}>
              <Button variant="ghost" size="sm" onClick={() => openTask(n.taskId)}>
                Pick a time
              </Button>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
