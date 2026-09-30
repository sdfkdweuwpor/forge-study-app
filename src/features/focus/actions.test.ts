import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  finishSession,
  getActiveSession,
  getLastFinishedSession,
  startSession,
} from '@/db/repos/sessions'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { createTask } from '@/db/repos/tasks'
import type { Session } from '@/db/types'
import {
  beginFocus,
  finishNow,
  keepGoing,
  skipBreak,
  skipPhase,
  startUpNext,
  togglePause,
} from './actions'
import { registerRuntime, type FocusRuntime } from './runtime'
import { TimerStore } from './timerStore'

const MIN = 60_000
const T0 = new Date(2026, 8, 29, 9, 30).getTime()

let store: TimerStore
let openEndDialog: ReturnType<typeof vi.fn>
let unregister: () => void

const toast = { show: vi.fn(), success: vi.fn(), error: vi.fn(), xp: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn() }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  store = new TimerStore()
  store.setSession(null, T0)
  openEndDialog = vi.fn()
  const runtime: FocusRuntime = {
    announce: vi.fn(),
    toast,
    openEndDialog: openEndDialog as unknown as FocusRuntime['openEndDialog'],
    snapshot: store.getSnapshot,
    setDraftTask: (id) => store.setDraftTask(id),
  }
  unregister = registerRuntime(runtime)
  Object.values(toast).forEach((fn) => fn.mockClear())
})

afterEach(async () => {
  unregister()
  await settleDomainEvents()
  vi.useRealTimers()
})

const at = (minutes: number) => vi.setSystemTime(T0 + minutes * MIN)

describe('beginFocus', () => {
  it('starts a pomodoro of the length in settings, linked to the task', async () => {
    await updateSettings({ timer: { pomodoroMin: 30 } })
    const task = await createTask({ title: 'C779 · Unit 3' })
    const session = await beginFocus({ taskId: task.id, mode: 'pomodoro', go: false })
    expect(session).toMatchObject({ kind: 'focus', mode: 'pomodoro', plannedMinutes: 30, taskId: task.id })
    expect(await getActiveSession()).toMatchObject({ id: session?.id })
  })

  it('a stopwatch has no plan; a custom session uses the custom length', async () => {
    await updateSettings({ timer: { customMin: 45 } })
    const custom = await beginFocus({ mode: 'custom', go: false })
    expect(custom?.plannedMinutes).toBe(45)
    await finishNow()
    at(1)
    const watch = await beginFocus({ mode: 'stopwatch', go: false })
    expect(watch).toMatchObject({ mode: 'stopwatch', plannedMinutes: null })
  })

  it('uses the task picked on the Focus page when none is given, and clears the pick', async () => {
    const task = await createTask({ title: 'D278 · Ch. 4' })
    store.setDraftTask(task.id)
    const session = await beginFocus({ mode: 'pomodoro', go: false })
    expect(session?.taskId).toBe(task.id)
    expect(store.getSnapshot().draftTaskId).toBeNull()
  })

  it('does not start a second session; it links the task when the running one has none', async () => {
    const first = await beginFocus({ mode: 'pomodoro', go: false })
    const task = await createTask({ title: 'Email mentor' })
    const again = await beginFocus({ taskId: task.id, mode: 'pomodoro', go: false })
    expect(again?.id).toBe(first?.id)
    expect(await db.sessions.count()).toBe(1)
    expect((await getActiveSession())?.taskId).toBe(task.id)
  })

  it('throws away a running break to start focus', async () => {
    const brk = await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 })
    const session = await beginFocus({ mode: 'pomodoro', go: false })
    expect(session?.kind).toBe('focus')
    expect(await db.sessions.get(brk.id)).toMatchObject({ status: 'abandoned' })
  })
})

describe('togglePause', () => {
  it('pauses a running session and resumes it', async () => {
    await beginFocus({ mode: 'pomodoro', go: false })
    at(5)
    await togglePause()
    expect(await getActiveSession()).toMatchObject({ status: 'paused', pausedAt: T0 + 5 * MIN })
    at(9)
    await togglePause()
    expect(await getActiveSession()).toMatchObject({ status: 'running', pausedMs: 4 * MIN })
  })
})

describe('finishNow', () => {
  it('a slip of the finger under a minute is thrown away and not logged', async () => {
    await beginFocus({ mode: 'pomodoro', go: false })
    at(0.5)
    expect(await finishNow()).toBeNull()
    expect(await getActiveSession()).toBeNull()
    expect(await getLastFinishedSession()).toMatchObject({ status: 'abandoned' })
    expect(openEndDialog).not.toHaveBeenCalled()
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Session discarded' }))
  })

  it('stopped at half of a 50-minute plan: interrupted, not counted, no XP, and the dialog opens', async () => {
    await beginFocus({ mode: 'custom', plannedMin: 50, go: false })
    at(25)
    const result = await finishNow()
    expect(result?.xp).toBe(0)
    expect(result?.session).toMatchObject({ actualMinutes: 25, interrupted: true, counted: false })
    expect(await db.xpEvents.count()).toBe(0)
    expect(openEndDialog).toHaveBeenCalledWith(result?.session.id)
  })

  it('a stopwatch finished after 12 minutes counts, is not "interrupted", and pays 12 XP', async () => {
    await beginFocus({ mode: 'stopwatch', go: false })
    at(12)
    const result = await finishNow()
    expect(result?.session).toMatchObject({ actualMinutes: 12, interrupted: false, counted: true })
    expect(result?.xp).toBe(12)
  })

  it('ending a break just skips it: no dialog, no log', async () => {
    await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 })
    at(2)
    expect(await finishNow()).toBeNull()
    expect(await getLastFinishedSession()).toMatchObject({ kind: 'break', status: 'abandoned' })
    expect(openEndDialog).not.toHaveBeenCalled()
  })
})

/** A counted, finished pomodoro round, ended two minutes ago. */
async function finishedRound(round: number): Promise<Session> {
  const s = await startSession(
    { mode: 'pomodoro', kind: 'focus', plannedMin: 25, round },
    { now: T0 - 27 * MIN },
  )
  const result = await finishSession(s.id, { now: T0 - 2 * MIN })
  if (!result) throw new Error('the round did not finish')
  return result.session
}

describe('the cycle', () => {
  it('after a counted round the next start is its break; after that break, the next round', async () => {
    const round = await finishedRound(1)
    await startUpNext()
    const brk = await getActiveSession()
    expect(brk).toMatchObject({ kind: 'break', round: 1, plannedMinutes: 5, taskId: round.taskId })

    at(5)
    await finishSession(brk?.id ?? '', { now: T0 + 5 * MIN })
    await startUpNext()
    expect(await getActiveSession()).toMatchObject({ kind: 'focus', round: 2, plannedMinutes: 25 })
  })

  it('the fourth round is followed by the long break', async () => {
    await finishedRound(4)
    await startUpNext()
    expect(await getActiveSession()).toMatchObject({ kind: 'break', round: 4, plannedMinutes: 15 })
  })

  it('with nothing to continue, it starts a fresh focus session', async () => {
    await startUpNext()
    expect(await getActiveSession()).toMatchObject({ kind: 'focus', round: 1 })
  })

  it('skipping the break offered next records a skipped break and moves on to the next round', async () => {
    await finishedRound(1)
    await skipBreak()
    expect(await getActiveSession()).toBeNull()
    expect(await getLastFinishedSession()).toMatchObject({ kind: 'break', status: 'abandoned', round: 1 })
    await startUpNext()
    expect(await getActiveSession()).toMatchObject({ kind: 'focus', round: 2 })
  })

  it('skipping a running break ends it', async () => {
    await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 })
    await skipBreak()
    expect(await getActiveSession()).toBeNull()
  })

  it('skip-to-next-phase finishes a focus session and skips a break', async () => {
    await beginFocus({ mode: 'stopwatch', go: false })
    at(11)
    await skipPhase()
    expect(await getLastFinishedSession()).toMatchObject({ kind: 'focus', status: 'completed', counted: true })
    await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 + 12 * MIN })
    at(13)
    await skipPhase()
    expect(await getLastFinishedSession()).toMatchObject({ kind: 'break', status: 'abandoned' })
  })
})

describe('keepGoing', () => {
  it('starts another round like the finished one, on the same task', async () => {
    const task = await createTask({ title: 'C182 · Operating systems' })
    const s = await startSession(
      { mode: 'custom', kind: 'focus', plannedMin: 40, taskId: task.id },
      { now: T0 - 45 * MIN },
    )
    const done = await finishSession(s.id, { now: T0 - 5 * MIN })
    await keepGoing(done?.session as Session)
    expect(await getActiveSession()).toMatchObject({ mode: 'custom', plannedMinutes: 40, taskId: task.id })
  })

  it('replaces a break the timer had already started on its own', async () => {
    const done = await finishedRound(1)
    await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 - MIN })
    await keepGoing(done)
    expect(await getActiveSession()).toMatchObject({ kind: 'focus', mode: 'pomodoro', plannedMinutes: 25 })
  })
})
