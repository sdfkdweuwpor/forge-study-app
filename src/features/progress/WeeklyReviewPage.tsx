/**
 * `/review/:weekStart?`: the weekly review (BRIEF §5.7). A look back at one week (Monday to Sunday by
 * default; the setting decides), then a look ahead:
 *
 * wins → the week in numbers (focus time, tasks, days shown up, freezes ❄️, streak) → hours per goal →
 * "what got in the way?" (autosaved) → next week's plan (seven day columns, linked to the Week view) →
 * "Mark review done" (+10 XP, once per week).
 *
 * The words are kind and specific: nothing here compares a week unfavourably with another, a missed day
 * is never called that, and a freeze is a neutral count. Each part reads its data once for the page
 * (`useWeeklyReview`); loading, an empty (quiet) week and a failed read each have their own state, and a
 * failed read leaves the header and the week picker in place.
 */
import { format } from 'date-fns'
import { CalendarCheck, ChevronLeft, ChevronRight, CircleCheck } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { celebrate } from '@/app/celebrate'
import { navigate, useParams } from '@/app/router'
import { recordError } from '@/app/reportError'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { completeWeeklyReview } from '@/db/repos/reviews'
import type { ISODate } from '@/db/types'
import { windowLabel } from '@/logic/calendarWeek'
import { eachDay } from '@/logic/dates'
import { durationText } from '@/logic/statsLabels'
import { formatXp } from '@/logic/taskDisplay'
import {
  isReviewDay,
  nextReviewWeek,
  previousReviewWeek,
  resolveReviewWeek,
  reviewWeekEnd,
  reviewXpKey,
  type WeeklyReview,
} from '@/logic/weeklyReview'
import { Button } from '@/ui/Button'
import { HBarList } from '@/ui/charts'
import { IconButton } from '@/ui/IconButton'
import { useToast } from '@/ui/Toast'
import { useStoredReview, useWeeklyReview } from './WeeklyReviewData'
import { WeeklyReviewNextWeek } from './WeeklyReviewNextWeek'
import { WeeklyReviewNote } from './WeeklyReviewNote'
import { WeeklyReviewError, WeeklyReviewQuiet, WeeklyReviewSkeleton } from './WeeklyReviewStates'
import styles from './WeeklyReviewPage.module.css'

// ─── Week picker ────────────────────────────────────────────────────────────

/** This week's address is `/review`, so the page stays on "this week" across midnight. */
function goToWeek(weekStart: ISODate, currentWeek: ISODate): void {
  if (weekStart === currentWeek) navigate('weeklyReview')
  else navigate('weeklyReview', { weekStart })
}

interface PickerProps {
  weekStart: ISODate
  previous: ISODate
  next: ISODate | null
  currentWeek: ISODate
  caption: string
}

function WeekPicker({ weekStart, previous, next, currentWeek, caption }: PickerProps) {
  const days = eachDay(weekStart, reviewWeekEnd(weekStart))
  return (
    <nav className={styles.picker} aria-label="Choose a week">
      <IconButton
        label="Previous week"
        shortcut="["
        icon={<ChevronLeft />}
        size="md"
        onClick={() => goToWeek(previous, currentWeek)}
      />
      <div className={styles.pickerLabel}>
        <span className={styles.range} data-testid="review-range" aria-live="polite">
          {windowLabel(days)}
        </span>
        {caption ? <span className={styles.caption}>{caption}</span> : null}
      </div>
      <IconButton
        label="Next week"
        shortcut="]"
        icon={<ChevronRight />}
        size="md"
        disabled={next === null}
        onClick={() => next !== null && goToWeek(next, currentWeek)}
      />
      {weekStart !== currentWeek ? (
        <Button variant="ghost" size="sm" onClick={() => goToWeek(currentWeek, currentWeek)}>
          This week
        </Button>
      ) : null}
    </nav>
  )
}

// ─── The numbers ────────────────────────────────────────────────────────────

function Figure({ label, children, hint }: { label: string; children: string; hint?: string }) {
  return (
    <div className={styles.figure}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={styles.figureValue}>{children}</dd>
      {hint ? <dd className={styles.figureHint}>{hint}</dd> : null}
    </div>
  )
}

/** Under the streak: the best when this run is shorter, otherwise a kind word. */
function streakHint(streak: WeeklyReview['streak']): string | undefined {
  if (streak.best > streak.current)
    return `Best: ${streak.best} ${streak.best === 1 ? 'day' : 'days'}`
  return streak.best > 0 ? 'Your best yet' : undefined
}

function Numbers({ review }: { review: WeeklyReview }) {
  const { streak } = review
  return (
    <section className={styles.section} aria-label="The week in numbers" data-section="numbers">
      <dl className={styles.figures}>
        <Figure label="Focus time">{durationText(review.focusMinutes)}</Figure>
        <Figure label="Tasks done">{String(review.tasksDone)}</Figure>
        <Figure label="Showed up">
          {`${review.qualifiedDays} ${review.qualifiedDays === 1 ? 'day' : 'days'}`}
        </Figure>
        <Figure label="Freezes used">
          {review.freezesUsed > 0 ? `❄️ ${review.freezesUsed}` : '0'}
        </Figure>
        <Figure label="Streak" hint={streakHint(streak)}>
          {`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
        </Figure>
      </dl>
    </section>
  )
}

// ─── Finishing ──────────────────────────────────────────────────────────────

function DoneRow({
  weekStart,
  completedAt,
  wins,
}: {
  weekStart: ISODate
  completedAt: number | null
  wins: readonly string[]
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const markDone = useCallback(async () => {
    setBusy(true)
    try {
      const { xp } = await completeWeeklyReview(weekStart, wins)
      if (xp) {
        celebrate({
          id: reviewXpKey(weekStart),
          title: `Weekly review done · ${formatXp(xp.amount)}`,
        })
      }
    } catch (error) {
      recordError(error, 'completeWeeklyReview')
      toast.error('Couldn’t save your review. Try again.')
    } finally {
      setBusy(false)
    }
  }, [weekStart, wins, toast])

  useShortcutHandler('weeklyReview.done', () => void markDone(), completedAt === null && !busy)

  if (completedAt !== null) {
    return (
      <p className={styles.done} data-testid="review-done">
        <CircleCheck aria-hidden="true" />
        <span>
          Review done · {format(completedAt, 'EEE, MMM d')}
          <span className={styles.xp}> · {formatXp(10)}</span>
        </span>
      </p>
    )
  }
  return (
    <div className={styles.doneRow}>
      <Button
        variant="primary"
        iconLeft={<CalendarCheck />}
        loading={busy}
        onClick={() => void markDone()}
        aria-keyshortcuts="Shift+D"
      >
        Mark review done
      </Button>
      <p className={styles.sub}>
        A small ritual to close the week: {formatXp(10)}, once per week.
      </p>
    </div>
  )
}

// ─── The page ───────────────────────────────────────────────────────────────

function ReviewBody({ weekStart }: { weekStart: ISODate }) {
  const today = useToday()
  const review = useWeeklyReview(weekStart, today)
  const stored = useStoredReview(weekStart)

  if (review === undefined || stored === undefined) return <WeeklyReviewSkeleton />
  const quiet = review.sessions === 0 && review.tasksDone === 0

  return (
    <>
      {quiet ? (
        <WeeklyReviewQuiet isOver={review.isOver} />
      ) : (
        <>
          <section className={styles.section} aria-labelledby="review-wins" data-section="wins">
            <h2 className={styles.heading} id="review-wins">
              Wins
            </h2>
            <ul className={styles.wins}>
              {review.wins.map((win) => (
                <li key={win}>{win}</li>
              ))}
            </ul>
          </section>
          <Numbers review={review} />
          <section className={styles.chartSection} aria-label="Hours per goal" data-section="goals">
            <HBarList
              title="Hours per goal"
              titleAs="h2"
              subtitle={review.focusMinutes > 0 ? durationText(review.focusMinutes) : undefined}
              items={review.hoursPerGoal.map((r) => ({
                id: r.id ?? 'other',
                label: r.title,
                value: r.minutes,
                color: r.color,
              }))}
              format={durationText}
              labelHeader="Goal"
              valueHeader="Focus time"
              empty={
                <p className={styles.note}>
                  Time you focus is split by goal here. Link a session to a task and it counts
                  toward that goal.
                </p>
              }
            />
          </section>
        </>
      )}
      <WeeklyReviewNote key={weekStart} weekStart={weekStart} initial={stored?.blockers ?? ''} />
      <WeeklyReviewNextWeek days={review.nextWeek} />
      <DoneRow weekStart={weekStart} completedAt={stored?.completedAt ?? null} wins={review.wins} />
    </>
  )
}

export default function WeeklyReviewPage() {
  useShortcutScope('progress')
  const today = useToday()
  const settings = useSettings()
  const { weekStart: param } = useParams<'weeklyReview'>()
  const weekStartsOn = settings?.weekStartsOn ?? 1
  const currentWeek = resolveReviewWeek(undefined, today, weekStartsOn)
  const weekStart = resolveReviewWeek(param, today, weekStartsOn)
  const previous = previousReviewWeek(weekStart)
  const next = nextReviewWeek(weekStart, today, weekStartsOn)

  useShortcutHandler('weeklyReview.previous', () => goToWeek(previous, currentWeek))
  useShortcutHandler(
    'weeklyReview.next',
    () => next !== null && goToWeek(next, currentWeek),
    next !== null,
  )

  const caption =
    weekStart === currentWeek
      ? isReviewDay(today, weekStartsOn)
        ? 'This week ends today'
        : 'This week so far'
      : ''

  return (
    <div className={styles.page} data-testid="weekly-review-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Weekly review</h1>
        <p className={styles.lede}>
          What went well, what got in the way, and a look at the week ahead.
        </p>
      </header>
      {settings === undefined ? (
        <WeeklyReviewSkeleton />
      ) : (
        <>
          <WeekPicker
            weekStart={weekStart}
            previous={previous}
            next={next}
            currentWeek={currentWeek}
            caption={caption}
          />
          <ErrorBoundary
            resetKey={weekStart}
            fallback={(_error, reset) => <WeeklyReviewError onRetry={reset} />}
          >
            <ReviewBody weekStart={weekStart} />
          </ErrorBoundary>
        </>
      )}
    </div>
  )
}
