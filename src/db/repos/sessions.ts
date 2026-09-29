/**
 * Focus and break sessions (PLAN §1.3, BRIEF §5.2). A running or paused timer is one `sessions` row;
 * the time on screen is always computed from its timestamps (`@/logic/timer`), so a refresh, a closed
 * tab or a sleeping laptop cannot lose or bend it. Breaks are rows too (`kind: 'break'`), which is what
 * lets the whole pomodoro cycle survive a reload. Stats filter on `kind = 'focus'`.
 *
 * Rules the repo enforces:
 * - At most one row is `running` or `paused` at a time (`startSession` throws `SessionActiveError`).
 * - Finishing a focus session settles it once: whole minutes, the anti-cheat rule (counts from 80% of
 *   the plan, or 10 minutes for a stopwatch) and the XP (1 per minute, only when counted) are written
 *   in the same transaction, so the session and its XP commit or fail together. The XP is idempotent
 *   per session (`session:<id>`).
 * - `session.started` and `session.ended` are emitted for focus sessions only; breaks are bookkeeping.
 *   `session.ended` carries `counted`, and fires for a finished session that did not count too.
 */
import { newId } from '@/lib/ids'
import { dayOf } from '@/logic/dates'
import {
  clockOf,
  elapsedMs,
  isDue,
  pauseClock,
  plannedEndAt,
  resumeClock,
  settleSession,
} from '@/logic/timer'
import { db } from '../db'
import { emit } from '../events'
import type { ID, Millis, Session, SessionKind, SessionMode } from '../types'
import type { RepoOptions } from './tasks'
import { awardXp } from './xp'

/** The longest a planned session may be: one day. */
export const MAX_PLANNED_MINUTES = 24 * 60

/** Thrown by `startSession` while another session is running or paused. */
export class SessionActiveError extends Error {
  readonly active: Session
  constructor(active: Session) {
    super('A session is already running')
    this.name = 'SessionActiveError'
    this.active = active
  }
}

const isActive = (s: Session): boolean => s.status === 'running' || s.status === 'paused'

function newest(rows: readonly Session[]): Session | null {
  return rows.reduce<Session | null>((a, b) => (a === null || b.startedAt >= a.startedAt ? b : a), null)
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The session that is running or paused, or `null`. If data ever holds several, the newest wins. */
export async function getActiveSession(): Promise<Session | null> {
  return newest(await db.sessions.where('status').anyOf('running', 'paused').toArray())
}

/** The most recent session that ended, finished or thrown away (what the pomodoro cycle continues from). */
export async function getLastFinishedSession(): Promise<Session | null> {
  return (
    (await db.sessions
      .orderBy('startedAt')
      .reverse()
      .filter((s) => s.status === 'completed' || s.status === 'abandoned')
      .first()) ?? null
  )
}

/** Counted pomodoro focus sessions that started on `day`: the rounds already done. */
async function countedRounds(day: string): Promise<number> {
  return db.sessions
    .where('[kind+day]')
    .equals(['focus', day])
    .filter((s) => s.mode === 'pomodoro' && s.status === 'completed' && s.counted)
    .count()
}

// ─── Start ──────────────────────────────────────────────────────────────────

export interface StartSessionInput {
  mode: SessionMode
  kind: SessionKind
  /** Whole minutes. Required for pomodoro and custom; ignored for a stopwatch (no plan). */
  plannedMin?: number | null
  taskId?: ID | null
  /**
   * The focus round this session is (focus) or follows (break). Defaults to the next round of the day
   * for a pomodoro focus session (counted rounds today + 1), else 1.
   */
  round?: number
}

/**
 * Starts a session now. The goal and course of the task are copied onto the row (denormalised, as the
 * stats read them without joining), and a task that no longer exists is simply not linked. Throws
 * `SessionActiveError` while another session is running or paused, and `RangeError` for a bad plan.
 */
export async function startSession(
  input: StartSessionInput,
  opts: RepoOptions = {},
): Promise<Session> {
  const now = opts.now ?? Date.now()
  const { mode, kind } = input
  if (mode === 'stopwatch' && kind === 'break') {
    throw new RangeError('A break cannot be a stopwatch')
  }
  let plannedMinutes: number | null = null
  if (mode !== 'stopwatch') {
    const planned = input.plannedMin
    if (
      planned === undefined ||
      planned === null ||
      !Number.isFinite(planned) ||
      Math.round(planned) < 1 ||
      Math.round(planned) > MAX_PLANNED_MINUTES
    ) {
      throw new RangeError(`A session needs a length of 1 to ${MAX_PLANNED_MINUTES} minutes`)
    }
    plannedMinutes = Math.round(planned)
  }
  const day = dayOf(now)

  return db.transaction('rw', db.sessions, db.tasks, async () => {
    const running = newest((await db.sessions.where('status').anyOf('running', 'paused').toArray()))
    if (running) throw new SessionActiveError(running)

    const task = input.taskId ? await db.tasks.get(input.taskId) : undefined
    const round =
      input.round ?? (mode === 'pomodoro' && kind === 'focus' ? (await countedRounds(day)) + 1 : 1)
    const session: Session = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      kind,
      mode,
      status: 'running',
      taskId: task?.id ?? null,
      goalId: task?.goalId ?? null,
      milestoneId: task?.milestoneId ?? null,
      day,
      startedAt: now,
      endedAt: null,
      plannedMinutes,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: null,
      round: Math.max(1, Math.floor(round)),
      interrupted: false,
      counted: false,
      note: null,
    }
    await db.sessions.add(session)
    if (kind === 'focus') emit({ type: 'session.started', sessionId: session.id })
    return session
  })
}

// ─── Pause / resume ─────────────────────────────────────────────────────────

/**
 * Pauses a running session. Pausing a paused one changes nothing; a session whose time is already up is
 * left running for the tick to finish, so a late press cannot stretch it. `null` when there is no such
 * active session.
 */
export async function pauseSession(id: ID, opts: RepoOptions = {}): Promise<Session | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(id)
    if (!s || !isActive(s)) return null
    const clock = clockOf(s)
    if (s.status === 'paused' || isDue(clock, now)) return s
    const paused = pauseClock(clock, now)
    await db.sessions.update(id, { status: 'paused', pausedAt: paused.pausedAt })
    return (await db.sessions.get(id)) ?? null
  })
}

/** Resumes a paused session: the pause is added to `pausedMs`, so the end moves later by as much. */
export async function resumeSession(id: ID, opts: RepoOptions = {}): Promise<Session | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(id)
    if (!s || !isActive(s)) return null
    if (s.status === 'running') return s
    const resumed = resumeClock(clockOf(s), now)
    await db.sessions.update(id, {
      status: 'running',
      pausedMs: resumed.pausedMs,
      pausedAt: null,
    })
    return (await db.sessions.get(id)) ?? null
  })
}

// ─── Finish / cancel ────────────────────────────────────────────────────────

export interface FinishOptions extends RepoOptions {
  /** Ended before the plan, by the user. Default false. */
  interrupted?: boolean
  /** When it ended, if not now (the planned end of a session finished late). */
  at?: Millis
}

export interface FinishResult {
  /** The session after finishing. */
  session: Session
  /** XP this call paid out: whole minutes when it counted, else 0. */
  xp: number
}

/** Settles an active session inside a transaction that already covers `sessions` and `xpEvents`. */
async function settleRow(s: Session, endedAtRaw: Millis, interrupted: boolean): Promise<FinishResult> {
  const endedAt = Math.max(endedAtRaw, s.startedAt)
  // An open pause ends with the session: it never counts as focus time.
  const closed = resumeClock(clockOf(s), endedAt)
  const outcome = settleSession({
    kind: s.kind,
    plannedMinutes: s.plannedMinutes,
    elapsedMs: elapsedMs(closed, endedAt),
  })
  await db.sessions.update(s.id, {
    status: 'completed',
    endedAt,
    pausedMs: closed.pausedMs,
    pausedAt: null,
    actualMinutes: outcome.actualMinutes,
    counted: outcome.counted,
    interrupted,
  })
  let xp = 0
  if (outcome.xp > 0) {
    const award = await awardXp({
      source: 'session',
      amount: outcome.xp,
      key: `session:${s.id}`,
      refId: s.id,
      at: endedAt,
      // The day the session belongs to, so "XP today" and "pomodoros today" agree.
      day: s.day,
    })
    xp = award?.amount ?? 0
  }
  if (s.kind === 'focus') emit({ type: 'session.ended', sessionId: s.id, day: s.day, counted: outcome.counted })
  const session = await db.sessions.get(s.id)
  if (!session) throw new Error('Session disappeared while finishing')
  return { session, xp }
}

/**
 * Ends a running or paused session and settles it: status `completed`, `endedAt`, whole minutes, the
 * anti-cheat verdict and the XP, in one transaction. `null` when it is missing or already over, so a
 * second tab finishing the same session does nothing.
 */
export async function finishSession(
  id: ID,
  opts: FinishOptions = {},
): Promise<FinishResult | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.sessions, db.xpEvents, async () => {
    const s = await db.sessions.get(id)
    if (!s || !isActive(s)) return null
    return settleRow(s, opts.at ?? now, opts.interrupted ?? false)
  })
}

/**
 * Throws a session away (`abandoned`): no XP, not counted, no event. For a mistaken start, and for
 * skipping a break. `null` when it is missing or already over.
 */
export async function cancelSession(id: ID, opts: RepoOptions = {}): Promise<Session | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(id)
    if (!s || !isActive(s)) return null
    const endedAt = Math.max(now, s.startedAt)
    const closed = resumeClock(clockOf(s), endedAt)
    await db.sessions.update(id, {
      status: 'abandoned',
      endedAt,
      pausedMs: closed.pausedMs,
      pausedAt: null,
      actualMinutes: Math.floor(elapsedMs(closed, endedAt) / 60_000),
      counted: false,
      interrupted: true,
    })
    return (await db.sessions.get(id)) ?? null
  })
}

/**
 * Finishes a running session whose planned end has passed, at that end (`startedAt + planned +
 * pausedMs`), not at `now`. It covers a tab that was closed or asleep at the end, and is what the tick
 * calls at the end of a phase. A paused session, a stopwatch and a session not yet due are left alone
 * (`null`). The end is re-checked inside the transaction, so it is safe to call from several tabs.
 */
export async function reconcileRunning(now: Millis = Date.now()): Promise<FinishResult | null> {
  return db.transaction('rw', db.sessions, db.xpEvents, async () => {
    const s = newest(await db.sessions.where('status').anyOf('running', 'paused').toArray())
    if (!s || s.status !== 'running') return null
    const end = plannedEndAt(clockOf(s))
    if (end === null || end > now) return null
    return settleRow(s, end, false)
  })
}

// ─── Edits ──────────────────────────────────────────────────────────────────

/** Saves the note of a session (also after it ended); an empty note clears it. `null` if missing. */
export async function logNote(id: ID, note: string): Promise<Session | null> {
  const text = note.trim()
  return db.transaction('rw', db.sessions, async () => {
    if (!(await db.sessions.get(id))) return null
    await db.sessions.update(id, { note: text === '' ? null : text })
    return (await db.sessions.get(id)) ?? null
  })
}

/** Links a session to a task (or unlinks it), copying the task's goal and course. `null` if missing. */
export async function setSessionTask(id: ID, taskId: ID | null): Promise<Session | null> {
  return db.transaction('rw', db.sessions, db.tasks, async () => {
    if (!(await db.sessions.get(id))) return null
    const task = taskId ? await db.tasks.get(taskId) : undefined
    await db.sessions.update(id, {
      taskId: task?.id ?? null,
      goalId: task?.goalId ?? null,
      milestoneId: task?.milestoneId ?? null,
    })
    return (await db.sessions.get(id)) ?? null
  })
}
