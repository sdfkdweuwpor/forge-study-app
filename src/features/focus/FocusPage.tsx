/**
 * `/focus`: the timer (BRIEF §5.2). Calm and centred: a mode switch, a 96px tabular timer inside a
 * progress ring, the round counter, the task link, Start / Pause / Resume with Stop or Skip break, and
 * today's session log below. The `focus.aside` slot (ambient sound, later the parking lot) sits to the
 * right on wide screens. Nothing here keeps time: it reads the timer store (`useTimer`) and calls the
 * plain functions in `actions.ts`.
 */
import { CircleAlert, Maximize2, Pause, Play, SkipForward, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { BREAKPOINTS, useMediaQuery } from '@/app/hooks/useMediaQuery'
import { useNow } from '@/app/hooks/useNow'
import { useToday } from '@/app/hooks/useToday'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { Slot, useSlotCount } from '@/app/registry'
import { useQuery } from '@/app/router'
import { useShortcutScope } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { useTask } from '@/db/hooks/useTasks'
import type { Session, SessionMode, Settings } from '@/db/types'
import { STOPWATCH_MIN_MINUTES } from '@/logic/xp'
import {
  cyclePosition,
  formatClockTime,
  formatMinutes,
  normalizeCycle,
  parseCustomMinutes,
  phaseLabel,
  plannedEndAt,
  clockOf,
  upNext,
  variantOf,
  type Phase,
} from '@/logic/timer'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import { SegmentedControl, type SegmentOption } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import {
  finishNow,
  linkTask,
  primaryAction,
  setCustomMinutes,
  setMode,
  skipBreak,
  togglePause,
} from './actions'
import { useLastFinished, useSessionsOn } from './queries'
import { SessionLog } from './SessionLog'
import { TaskPicker } from './TaskPicker'
import { TimerFace } from './TimerFace'
import { useMode, useTimerStore, useTimer } from './useTimer'
import styles from './FocusPage.module.css'

const MODE_OPTIONS: readonly SegmentOption<SessionMode>[] = [
  { value: 'pomodoro', label: 'Pomodoro' },
  { value: 'custom', label: 'Custom' },
  { value: 'stopwatch', label: 'Stopwatch' },
]

const LENGTH_PRESETS = [25, 50, 90] as const

/** "Ends at 9:55 AM", "Paused", "25 min focus · 5 min break": the quiet line under the dial. */
function metaText(input: {
  session: Session | null
  mode: SessionMode
  settings: Settings
  next: Phase | null
}): string {
  const { session, mode, settings, next } = input
  const cycle = normalizeCycle(settings.timer)
  if (session) {
    if (session.status === 'paused') return 'Paused. The end moves later while you wait.'
    if (session.mode === 'stopwatch') {
      return `Started at ${formatClockTime(session.startedAt)} · counts from ${STOPWATCH_MIN_MINUTES} min`
    }
    const end = plannedEndAt(clockOf(session))
    return end === null ? '' : `Ends at ${formatClockTime(end)}`
  }
  if (next?.kind === 'break') return `${formatMinutes(next.minutes)}. Step away from the screen.`
  if (mode === 'pomodoro') {
    return `${formatMinutes(cycle.pomodoroMin)} focus · ${formatMinutes(cycle.shortBreakMin)} break`
  }
  if (mode === 'custom') return `${formatMinutes(settings.timer.customMin)} · no breaks`
  return `Open-ended · counts from ${STOPWATCH_MIN_MINUTES} min`
}

function FocusScreen() {
  useShortcutScope('focus')
  const store = useTimerStore()
  const timer = useTimer()
  const settings = useSettings()
  const today = useToday()
  const now = useNow('minute')
  const sessions = useSessionsOn(today)
  const last = useLastFinished()
  const mode = useMode()
  const overlays = useOverlays()
  const asideCount = useSlotCount('focus.aside')
  const roomy = useMediaQuery(BREAKPOINTS.tablet)
  const urlTask = useQuery().task
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)

  // `/focus?task=<id>` picks that task for the next session (it does not start one).
  useEffect(() => {
    if (urlTask) store.setDraftTask(urlTask)
  }, [store, urlTask])

  const session = timer.session
  const pickedId = session?.taskId ?? timer.draftTaskId
  const linked = useTask(pickedId ?? undefined)
  // A task that no longer exists (a stale `?task=` link, one trashed since) is shown as none.
  const linkedId = pickedId !== null && linked === null ? null : pickedId

  const cycle = settings ? normalizeCycle(settings.timer) : null
  const next = useMemo(
    () =>
      settings && last !== undefined ? upNext(last, now, normalizeCycle(settings.timer)) : null,
    [settings, last, now],
  )

  if (settings === undefined || timer.status === 'loading' || cycle === null) {
    return <FocusSkeleton roomy={roomy} />
  }

  const size = roomy ? 360 : 300
  const active = timer.status === 'running' || timer.status === 'paused'
  const paused = timer.status === 'paused'
  const inBreak = session?.kind === 'break'
  const shownMode: SessionMode = session ? session.mode : mode

  // What the dial shows: the running phase, the phase offered next, or the mode's length.
  const idleBreak = !active && next?.kind === 'break' ? next : null
  const seconds = active
    ? timer.seconds
    : idleBreak
      ? idleBreak.minutes * 60
      : mode === 'pomodoro'
        ? cycle.pomodoroMin * 60
        : mode === 'custom'
          ? settings.timer.customMin * 60
          : 0
  const label = session
    ? paused
      ? `${phaseLabel(variantOf(session, cycle))} · paused`
      : phaseLabel(variantOf(session, cycle))
    : idleBreak
      ? `${phaseLabel(idleBreak.variant)} next`
      : 'Ready'
  const tone = inBreak || idleBreak ? 'success' : 'accent'

  // "Round 2 of 4" for a pomodoro cycle; a break says which round it follows.
  const countedToday = (sessions ?? []).filter(
    (s) => s.kind === 'focus' && s.mode === 'pomodoro' && s.status === 'completed' && s.counted,
  ).length
  const pomodoro = shownMode === 'pomodoro'
  const round = session ? session.round : idleBreak ? idleBreak.round : countedToday + 1
  const { position, total } = cyclePosition(round, cycle.longBreakEvery)
  const roundText = !pomodoro
    ? ''
    : inBreak || idleBreak
      ? `After round ${position} of ${total}`
      : `Round ${position} of ${total}`

  const stopLabel = inBreak ? 'Skip break' : shownMode === 'stopwatch' ? 'Finish' : 'Stop'

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.top}>
          <SegmentedControl
            label="Timer mode"
            options={MODE_OPTIONS}
            value={shownMode}
            disabled={active}
            onValueChange={setMode}
          />
          <IconButton
            label="Full-screen focus"
            shortcut="f"
            size="md"
            variant="ghost"
            icon={<Maximize2 />}
            className={styles.fullscreen}
            data-testid="fullscreen-open"
            onClick={() => overlays.open('focusFullscreen')}
          />
        </div>

        {!active && mode === 'custom' && !idleBreak ? (
          <div className={styles.length}>
            <Input
              size="sm"
              type="number"
              inputMode="numeric"
              min={1}
              max={480}
              aria-label="Length in minutes"
              className={styles.lengthInput}
              value={lengthDraft ?? String(settings.timer.customMin)}
              onChange={(e) => setLengthDraft(e.target.value)}
              onBlur={() => {
                // An emptied or non-positive field goes back to the stored length, not to 1 minute.
                const minutes = lengthDraft === null ? null : parseCustomMinutes(lengthDraft)
                if (minutes !== null) void setCustomMinutes(minutes)
                setLengthDraft(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              trailing={<span className={styles.unit}>min</span>}
            />
            <span className={styles.presets} role="group" aria-label="Quick lengths">
              {LENGTH_PRESETS.map((m) => (
                <Tag
                  key={m}
                  size="md"
                  shape="pill"
                  pressed={m === settings.timer.customMin}
                  onClick={() => {
                    setLengthDraft(null)
                    void setCustomMinutes(m)
                  }}
                >
                  {m}
                </Tag>
              ))}
            </span>
          </div>
        ) : null}

        <p className={styles.round} data-testid="round-counter">
          {roundText}
        </p>

        <TimerFace
          seconds={seconds}
          progress={active ? timer.progress : 0}
          label={label}
          tone={tone}
          size={size}
          paused={paused}
          name={inBreak ? 'Break timer' : 'Focus timer'}
        />

        <p className={styles.meta}>{metaText({ session, mode, settings, next })}</p>

        <TaskPicker
          taskId={linkedId}
          title={
            linkedId === null ? null : linked === undefined ? undefined : (linked?.title ?? null)
          }
          onChange={(id) => void linkTask(id)}
        />

        <div className={styles.actions}>
          {active ? (
            <>
              <Button
                variant="primary"
                className={styles.primary}
                iconLeft={paused ? <Play /> : <Pause />}
                aria-keyshortcuts="Space"
                data-testid="timer-toggle"
                onClick={() => void togglePause()}
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="secondary"
                className={styles.secondary}
                iconLeft={inBreak ? <SkipForward /> : <Square />}
                aria-keyshortcuts="Enter"
                data-testid="timer-stop"
                onClick={() => void finishNow()}
              >
                {stopLabel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                className={styles.primary}
                iconLeft={<Play />}
                aria-keyshortcuts="Space"
                data-testid="timer-start"
                onClick={() => void primaryAction()}
              >
                {idleBreak ? 'Start break' : 'Start'}
              </Button>
              {idleBreak ? (
                <Button
                  variant="secondary"
                  className={styles.secondary}
                  iconLeft={<SkipForward />}
                  data-testid="timer-skip-break"
                  onClick={() => void skipBreak()}
                >
                  Skip break
                </Button>
              ) : null}
            </>
          )}
        </div>

        <p className={styles.hint} aria-hidden="true">
          <span>
            <Kbd keys="space" variant="plain" size="sm" />{' '}
            {paused ? 'resume' : active ? 'pause' : 'start'}
          </span>
          {active ? (
            <span>
              <Kbd keys="enter" variant="plain" size="sm" /> finish
            </span>
          ) : (
            <span>
              <Kbd keys="1" variant="plain" size="sm" /> <Kbd keys="2" variant="plain" size="sm" />{' '}
              <Kbd keys="3" variant="plain" size="sm" /> mode
            </span>
          )}
          <span>
            <Kbd keys="f" variant="plain" size="sm" /> full screen
          </span>
        </p>

        <SessionLog day={today} />
      </div>

      {asideCount > 0 ? (
        <aside className={styles.aside} aria-label="Session tools">
          <Slot id="focus.aside" />
        </aside>
      ) : null}
    </div>
  )
}

/** The page while settings and the running session load: the dial's footprint and the buttons. */
function FocusSkeleton({ roomy }: { roomy: boolean }) {
  return (
    <div className={styles.layout}>
      <div className={styles.main} role="status" aria-busy="true" aria-label="Loading the timer">
        <Skeleton variant="block" width={264} height={32} />
        <Skeleton variant="circle" width={roomy ? 360 : 300} />
        <Skeleton variant="block" width={160} height={44} />
      </div>
    </div>
  )
}

export default function FocusPage() {
  return (
    <div className={styles.root}>
      <h1 className="sr-only">Focus</h1>
      <ErrorBoundary
        fallback={(_error, reset) => (
          <EmptyState
            icon={<CircleAlert />}
            title="Couldn’t load the timer"
            description="Your data is safe on this device. Try again, or reload the page."
            action={
              <Button variant="secondary" onClick={reset}>
                Try again
              </Button>
            }
          />
        )}
      >
        <FocusScreen />
      </ErrorBoundary>
    </div>
  )
}
