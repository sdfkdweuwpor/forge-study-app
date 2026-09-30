/**
 * Everything the timer can be told to do, as plain async functions: the buttons, the keyboard
 * shortcuts, the palette commands and the Today screen's "Start focus" all call these, so they behave
 * the same. Each one reads the database (not React state) for the truth, writes through the repos,
 * tells screen readers what happened, and never throws: a failure is recorded and shown as a toast.
 *
 * Starting functions call `unlock()` first, synchronously, before any `await`: they run inside a
 * click or key handler, which is the moment Safari allows sound, and the end-of-session chime needs
 * that unlock. It does nothing for someone who has sounds off, so no audio context is ever created for them.
 */
import { recordError } from '@/app/reportError'
import { navigate } from '@/app/router'
import {
  SessionActiveError,
  cancelSession,
  finishSession,
  getActiveSession,
  getLastFinishedSession,
  pauseSession,
  reopenSession,
  resumeSession,
  setSessionTask,
  startSession,
  type FinishResult,
  type StartSessionInput,
} from '@/db/repos/sessions'
import { getSettings, updateSettings } from '@/db/repos/settings'
import type { ID, Session, SessionMode, Settings } from '@/db/types'
import { unlockAudio } from '@/lib/audio/engine'
import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'
import {
  CUSTOM_MAX_MINUTES,
  CUSTOM_MIN_MINUTES,
  clockOf,
  elapsedMs,
  formatMinutes,
  phaseLabel,
  shouldDiscard,
  upNext,
  variantOf,
  type CycleConfig,
} from '@/logic/timer'
import { STOPWATCH_MIN_MINUTES } from '@/logic/xp'
import { runtime } from './runtime'

// ─── Mode (a device preference) ─────────────────────────────────────────────

export const MODES: readonly SessionMode[] = ['pomodoro', 'custom', 'stopwatch']

/** The mode picked on the Focus page, remembered on this device. Pomodoro until one is picked. */
export function getMode(): SessionMode {
  const raw = readPref(PREF_KEYS.focusMode)
  return MODES.find((m) => m === raw) ?? 'pomodoro'
}

export function setMode(mode: SessionMode): void {
  writePref(PREF_KEYS.focusMode, mode)
}

/**
 * The custom length is a setting, so it follows the user; 1 minute to 8 hours. A value that is not a
 * positive number (an emptied field) changes nothing: it never quietly becomes 1 minute.
 */
export async function setCustomMinutes(minutes: number): Promise<void> {
  if (!Number.isFinite(minutes) || minutes <= 0) return
  const customMin = Math.min(CUSTOM_MAX_MINUTES, Math.max(CUSTOM_MIN_MINUTES, Math.round(minutes)))
  try {
    await updateSettings({ timer: { customMin } })
  } catch (error) {
    fail(error, 'save the length')
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The pomodoro cycle from settings. */
export function cycleOf(settings: Settings): CycleConfig {
  const { pomodoroMin, shortBreakMin, longBreakMin, longBreakEvery } = settings.timer
  return { pomodoroMin, shortBreakMin, longBreakMin, longBreakEvery }
}

function fail(error: unknown, what: string): void {
  recordError(error, what)
  runtime()?.toast.error(`Couldn’t ${what}`, { description: 'Nothing was changed. Try again.' })
}

const say = (text: string): void => runtime()?.announce(text)

/** Unlocks audio for the end-of-session chime, only when settings have sounds on. Call it before any `await`. */
function unlock(): void {
  if (runtime()?.soundEnabled()) void unlockAudio()
}

function goToFocus(): void {
  navigate('focus')
}

/** "Focus started. 25 minutes." / "Short break started. 5 minutes." / "Stopwatch started." */
export function startedText(session: Session, settings: Settings): string {
  if (session.mode === 'stopwatch') return 'Stopwatch started.'
  const label =
    session.kind === 'focus' && session.mode === 'custom'
      ? 'Focus'
      : phaseLabel(variantOf(session, settings.timer))
  return `${label} started. ${formatMinutes(session.plannedMinutes ?? 0)}.`
}

interface Fresh {
  session: Session
  /** False when a session was already running and nothing new was started. */
  started: boolean
}

/**
 * Starts a session, first throwing away a running or paused break when a focus session is wanted. A
 * focus session already in progress is left alone and returned (`started: false`), so a second
 * "Start focus" never doubles up.
 */
async function startFresh(input: StartSessionInput): Promise<Fresh> {
  const active = await getActiveSession()
  if (active) {
    if (active.kind === 'break' && input.kind === 'focus') await cancelSession(active.id)
    else return { session: active, started: false }
  }
  try {
    return { session: await startSession(input), started: true }
  } catch (error) {
    // Another tab started one between the check and the write.
    if (error instanceof SessionActiveError) return { session: error.active, started: false }
    throw error
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

export interface BeginOptions {
  /** The task to link. Omitted: the task picked on the Focus page, if any. `null`: none. */
  taskId?: ID | null
  /** Default: the mode picked on the Focus page. */
  mode?: SessionMode
  /** Whole minutes for pomodoro and custom. Default: the length from settings. */
  plannedMin?: number
  /** Open the Focus page afterwards. Default true. */
  go?: boolean
}

/**
 * Starts a focus session (the one "Start focus" runs) and opens the Focus page. With a session already
 * running it starts nothing: it opens the page, and links the task if the running session has none.
 * A running break is thrown away first.
 */
export async function beginFocus(opts: BeginOptions = {}): Promise<Session | null> {
  unlock()
  const go = opts.go ?? true
  try {
    const settings = await getSettings()
    const mode = opts.mode ?? getMode()
    const plannedMin =
      mode === 'stopwatch'
        ? null
        : (opts.plannedMin ??
          (mode === 'pomodoro' ? settings.timer.pomodoroMin : settings.timer.customMin))
    const taskId =
      opts.taskId !== undefined ? opts.taskId : (runtime()?.snapshot().draftTaskId ?? null)

    const { session, started } = await startFresh({ mode, kind: 'focus', plannedMin, taskId })
    if (started) {
      runtime()?.setDraftTask(null)
      say(startedText(session, settings))
    } else if (taskId && !session.taskId && session.kind === 'focus') {
      await setSessionTask(session.id, taskId)
    }
    if (go) goToFocus()
    return session
  } catch (error) {
    fail(error, 'start focus')
    if (go) goToFocus()
    return null
  }
}

/** Starts the phase the cycle offers next (the break after a round, or the next round), else a fresh focus session. */
export async function startUpNext(): Promise<void> {
  unlock()
  try {
    const [settings, last] = await Promise.all([getSettings(), getLastFinishedSession()])
    const next = upNext(last, Date.now(), cycleOf(settings))
    if (!next) {
      await beginFocus({ go: false })
      return
    }
    const draft = runtime()?.snapshot().draftTaskId ?? null
    const { session, started } = await startFresh({
      mode: 'pomodoro',
      kind: next.kind,
      plannedMin: next.minutes,
      round: next.round,
      taskId: draft ?? last?.taskId ?? null,
    })
    if (started) {
      if (next.kind === 'focus') runtime()?.setDraftTask(null)
      say(startedText(session, settings))
    }
  } catch (error) {
    fail(error, 'start the timer')
  }
}

/** Starts another focus session like `finished` (same mode, length and task): the dialog's "Keep going". */
export async function keepGoing(finished: Session): Promise<void> {
  unlock()
  try {
    const settings = await getSettings()
    const mode = finished.mode
    const plannedMin =
      mode === 'stopwatch'
        ? null
        : mode === 'pomodoro'
          ? settings.timer.pomodoroMin
          : (finished.plannedMinutes ?? settings.timer.customMin)
    const { session, started } = await startFresh({
      mode,
      kind: 'focus',
      plannedMin,
      taskId: finished.taskId,
    })
    if (started) say(startedText(session, settings))
  } catch (error) {
    fail(error, 'start another round')
  }
}

// ─── Pause, finish, skip ────────────────────────────────────────────────────

/** Pauses a running session, or resumes a paused one. */
export async function togglePause(): Promise<void> {
  unlock()
  try {
    const active = await getActiveSession()
    if (!active) return
    if (active.status === 'running') {
      const paused = await pauseSession(active.id)
      if (paused?.status === 'paused') say('Paused.')
    } else if (await resumeSession(active.id)) {
      say('Resumed.')
    }
  } catch (error) {
    fail(error, 'pause the timer')
  }
}

/** The main key (Space): start when nothing runs, otherwise pause or resume. */
export async function primaryAction(): Promise<void> {
  unlock()
  const active = await getActiveSession().catch(() => null)
  if (active) await togglePause()
  else await startUpNext()
}

/**
 * Ends the session now. A break, or a focus session under a minute, is thrown away; any other focus
 * session is settled (minutes, the 80% rule, XP) and opens the "Done with this task?" dialog. Returns
 * the settled result, or `null` when nothing was logged.
 */
export async function finishNow(): Promise<FinishResult | null> {
  try {
    const active = await getActiveSession()
    if (!active) return null
    if (active.kind === 'break') {
      await cancelSession(active.id)
      say('Break skipped.')
      return null
    }
    const elapsed = elapsedMs(clockOf(active), Date.now())
    if (shouldDiscard(elapsed)) {
      await cancelSession(active.id)
      say('Session discarded.')
      runtime()?.toast.show({
        title: 'Session discarded',
        description: 'Sessions under a minute are not logged.',
      })
      return null
    }
    const planned = active.plannedMinutes
    const interrupted = planned !== null && elapsed < planned * 60_000
    const result = await finishSession(active.id, { interrupted })
    if (result) {
      say('Session finished.')
      runtime()?.openEndDialog(result.session.id)
      if (!result.session.counted) offerResume(result.session)
    }
    return result
  } catch (error) {
    fail(error, 'finish the session')
    return null
  }
}

/**
 * A focus session that ended without counting (stopped under 80% of the plan, or a stopwatch under ten
 * minutes) is one key press away from being lost, so the toast that says so can take it back. Undo
 * resumes the same session, with the wait not counted, and withdraws its "Done with this task?".
 */
function offerResume(finished: Session): void {
  runtime()?.toast.show({
    title: 'Session ended early',
    description:
      finished.plannedMinutes === null
        ? `A stopwatch counts from ${STOPWATCH_MIN_MINUTES} minutes, so this one earned no XP. Undo to keep going.`
        : 'Under 80% of the plan, so it did not count. Undo to keep going.',
    duration: 10_000,
    undo: async () => {
      const back = await reopenSession(finished.id)
      if (!back) throw new Error('The session cannot be resumed')
      runtime()?.closeEndDialog(finished.id)
      say('Session resumed.')
    },
  })
}

/** Skips a break: a running one is ended, and one that is up next is marked skipped, so the next round is offered. */
export async function skipBreak(): Promise<void> {
  try {
    const active = await getActiveSession()
    if (active) {
      if (active.kind !== 'break') return
      await cancelSession(active.id)
      say('Break skipped.')
      return
    }
    const [settings, last] = await Promise.all([getSettings(), getLastFinishedSession()])
    const next = upNext(last, Date.now(), cycleOf(settings))
    if (next?.kind !== 'break') return
    // A break thrown away the moment it starts: the cycle moves on to the next round.
    const started = await startSession({
      mode: 'pomodoro',
      kind: 'break',
      plannedMin: next.minutes,
      round: next.round,
      taskId: last?.taskId ?? null,
    })
    await cancelSession(started.id)
    say('Break skipped.')
  } catch (error) {
    fail(error, 'skip the break')
  }
}

/** Skip to the next phase: a break is skipped, a focus session is finished now. */
export async function skipPhase(): Promise<void> {
  const active = await getActiveSession().catch(() => null)
  if (active && active.kind === 'focus') {
    await finishNow()
    return
  }
  await skipBreak()
}

// ─── Task link ──────────────────────────────────────────────────────────────

/** Links a task to the running focus session, or, with none running, picks it for the next one. */
export async function linkTask(taskId: ID | null): Promise<void> {
  try {
    const active = await getActiveSession()
    if (active && active.kind === 'focus') await setSessionTask(active.id, taskId)
    else runtime()?.setDraftTask(taskId)
  } catch (error) {
    fail(error, 'link the task')
  }
}
