/**
 * The ticking view of the running session. A tiny external store (not React state) so the 250 ms
 * heartbeat does not re-render anything: it only notifies when what is on screen changes, which is once
 * per displayed second, or when the session or the draft task changes. Screens read it through
 * `useTimer()` (`useSyncExternalStore`).
 *
 * Nothing here keeps time. The snapshot is always recomputed from the session row's timestamps and the
 * `now` it is given (`@/logic/timer`), so a refresh, a sleeping laptop or a late tick cannot skew it.
 */
import type { ID, Millis, Session } from '@/db/types'
import { clockOf, displaySeconds, progress } from '@/logic/timer'

export type TimerStatus = 'loading' | 'idle' | 'running' | 'paused'

export interface TimerSnapshot {
  /** `loading` until the first read of the active session lands. */
  status: TimerStatus
  /** The running or paused row, or `null`. */
  session: Session | null
  /** The whole seconds on screen: a countdown while planned, elapsed for a stopwatch; 0 when idle. */
  seconds: number
  /** Ring fill, 0 to 1 (a stopwatch fills toward the minute it starts to count). */
  progress: number
  /** The task picked for the next session, or `null` for none. Cleared when a session starts. */
  draftTaskId: ID | null
}

const LOADING: TimerSnapshot = {
  status: 'loading',
  session: null,
  seconds: 0,
  progress: 0,
  draftTaskId: null,
}

/** The snapshot of `session` at `now`. `undefined` = still loading, `null` = nothing is running. */
export function buildSnapshot(
  session: Session | null | undefined,
  now: Millis,
  draftTaskId: ID | null,
): TimerSnapshot {
  if (session === undefined) return { ...LOADING, draftTaskId }
  if (session === null || (session.status !== 'running' && session.status !== 'paused')) {
    return { status: 'idle', session: null, seconds: 0, progress: 0, draftTaskId }
  }
  const clock = clockOf(session)
  return {
    status: session.status,
    session,
    seconds: displaySeconds(clock, now),
    progress: progress(clock, now),
    draftTaskId,
  }
}

const same = (a: TimerSnapshot, b: TimerSnapshot): boolean =>
  a.status === b.status &&
  a.session === b.session &&
  a.seconds === b.seconds &&
  a.draftTaskId === b.draftTaskId

export class TimerStore {
  private session: Session | null | undefined = undefined
  private now: Millis = 0
  private draft: ID | null = null
  private snapshot: TimerSnapshot = LOADING
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TimerSnapshot => this.snapshot

  /** The active session row as the store last heard of it (`undefined` while loading). */
  getSession(): Session | null | undefined {
    return this.session
  }

  setSession(session: Session | null | undefined, now: Millis): void {
    this.session = session
    this.now = now
    this.refresh()
  }

  /** One heartbeat. Notifies only if the displayed second changed. */
  tick(now: Millis): void {
    this.now = now
    this.refresh()
  }

  setDraftTask(taskId: ID | null): void {
    this.draft = taskId
    this.refresh()
  }

  private refresh(): void {
    const next = buildSnapshot(this.session, this.now, this.draft)
    if (same(this.snapshot, next)) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
