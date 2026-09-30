import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  SessionActiveError,
  cancelSession,
  finishSession,
  getActiveSession,
  getLastFinishedSession,
  logNote,
  pauseSession,
  reconcileRunning,
  reopenSession,
  resumeSession,
  setSessionTask,
  startSession,
} from '@/db/repos/sessions'
import { createTask } from '@/db/repos/tasks'
import { getXpSummary } from '@/db/repos/xp'

const MIN = 60_000
const T0 = new Date(2026, 8, 29, 9, 30).getTime() // Tue 2026-09-29 09:30 local
const TODAY = '2026-09-29'

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  onDomainEvent('session.started', (e) => void events.push(e))
  onDomainEvent('session.ended', (e) => void events.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const xpEvents = () => db.xpEvents.toArray()

describe('startSession', () => {
  it('starts a running pomodoro with the plan, the day and round 1', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    expect(s).toMatchObject({
      kind: 'focus',
      mode: 'pomodoro',
      status: 'running',
      day: TODAY,
      startedAt: T0,
      endedAt: null,
      plannedMinutes: 25,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: null,
      round: 1,
      interrupted: false,
      counted: false,
      taskId: null,
      note: null,
    })
    expect(await db.sessions.get(s.id)).toEqual(s)
    expect(await getActiveSession()).toEqual(s)
    await settleDomainEvents()
    expect(events).toEqual([{ type: 'session.started', sessionId: s.id }])
  })

  it('copies the task, its goal and its course onto the row', async () => {
    const task = await createTask(
      { title: 'C779 · Unit 3', goalId: 'g1', milestoneId: 'm1' },
      { now: T0 },
    )
    const s = await startSession(
      { mode: 'custom', kind: 'focus', plannedMin: 50, taskId: task.id },
      { now: T0 },
    )
    expect(s).toMatchObject({
      taskId: task.id,
      goalId: 'g1',
      milestoneId: 'm1',
      plannedMinutes: 50,
    })
  })

  it('does not link a task that no longer exists', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus', taskId: 'gone' }, { now: T0 })
    expect(s.taskId).toBeNull()
  })

  it('a stopwatch has no plan, whatever length is passed', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus', plannedMin: 30 }, { now: T0 })
    expect(s.plannedMinutes).toBeNull()
  })

  it('allows only one running or paused session', async () => {
    const first = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 },
    )
    const clash = startSession({ mode: 'custom', kind: 'focus', plannedMin: 50 }, { now: T0 + MIN })
    await expect(clash).rejects.toBeInstanceOf(SessionActiveError)
    await expect(clash).rejects.toMatchObject({ active: { id: first.id } })
    expect(await db.sessions.count()).toBe(1)

    // A paused session still blocks a new one.
    await pauseSession(first.id, { now: T0 + 2 * MIN })
    await expect(
      startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5 }, { now: T0 + 3 * MIN }),
    ).rejects.toBeInstanceOf(SessionActiveError)

    // Once it is over, another may start.
    await finishSession(first.id, { now: T0 + 4 * MIN })
    await expect(
      startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5 }, { now: T0 + 5 * MIN }),
    ).resolves.toMatchObject({ kind: 'break' })
  })

  it('numbers pomodoro rounds by the counted rounds of the day', async () => {
    for (let i = 0; i < 2; i++) {
      const s = await startSession(
        { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
        { now: T0 + i * 40 * MIN },
      )
      expect(s.round).toBe(i + 1)
      await finishSession(s.id, { now: T0 + i * 40 * MIN + 25 * MIN })
    }
    // A stopped-early round did not count, so the next start is the same round again.
    const short = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 + 90 * MIN },
    )
    expect(short.round).toBe(3)
    await finishSession(short.id, { now: T0 + 100 * MIN, interrupted: true })
    const retry = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 + 110 * MIN },
    )
    expect(retry.round).toBe(3)
  })

  it('takes an explicit round, and a break follows the round it comes after', async () => {
    const s = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 15, round: 4 },
      { now: T0 },
    )
    expect(s.round).toBe(4)
  })

  it('rejects a bad plan, and a stopwatch break', async () => {
    await expect(startSession({ mode: 'pomodoro', kind: 'focus' })).rejects.toThrow(RangeError)
    await expect(startSession({ mode: 'custom', kind: 'focus', plannedMin: 0 })).rejects.toThrow(
      RangeError,
    )
    await expect(
      startSession({ mode: 'custom', kind: 'focus', plannedMin: Number.NaN }),
    ).rejects.toThrow(RangeError)
    await expect(
      startSession({ mode: 'custom', kind: 'focus', plannedMin: 24 * 60 + 1 }),
    ).rejects.toThrow(RangeError)
    await expect(startSession({ mode: 'stopwatch', kind: 'break' })).rejects.toThrow(RangeError)
    expect(await db.sessions.count()).toBe(0)
  })
})

describe('pause and resume', () => {
  it('pausing stamps pausedAt; resuming moves the pause into pausedMs', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const paused = await pauseSession(s.id, { now: T0 + 10 * MIN })
    expect(paused).toMatchObject({ status: 'paused', pausedAt: T0 + 10 * MIN, pausedMs: 0 })
    const resumed = await resumeSession(s.id, { now: T0 + 16 * MIN })
    expect(resumed).toMatchObject({ status: 'running', pausedAt: null, pausedMs: 6 * MIN })
  })

  it('is idempotent, and does nothing for a missing or finished session', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await pauseSession(s.id, { now: T0 + 5 * MIN })
    const again = await pauseSession(s.id, { now: T0 + 9 * MIN })
    expect(again?.pausedAt).toBe(T0 + 5 * MIN)
    await resumeSession(s.id, { now: T0 + 10 * MIN })
    expect((await resumeSession(s.id, { now: T0 + 12 * MIN }))?.pausedMs).toBe(5 * MIN)
    expect(await pauseSession('missing')).toBeNull()
    await finishSession(s.id, { now: T0 + 20 * MIN })
    expect(await pauseSession(s.id, { now: T0 + 21 * MIN })).toBeNull()
    expect(await resumeSession(s.id, { now: T0 + 21 * MIN })).toBeNull()
  })

  it('will not pause a session whose time is already up, so a late press cannot stretch it', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const result = await pauseSession(s.id, { now: T0 + 25 * MIN + 100 })
    expect(result?.status).toBe('running')
  })
})

describe('finishSession and XP', () => {
  it('a full pomodoro counts, earns 1 XP per minute and emits session.ended', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 25 * MIN })
    expect(result?.xp).toBe(25)
    expect(result?.session).toMatchObject({
      status: 'completed',
      endedAt: T0 + 25 * MIN,
      actualMinutes: 25,
      counted: true,
      interrupted: false,
      pausedAt: null,
    })

    const log = await xpEvents()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      source: 'session',
      amount: 25,
      key: `session:${s.id}`,
      refId: s.id,
      day: TODAY,
    })
    expect((await getXpSummary(TODAY)).today).toBe(25)
    await settleDomainEvents()
    expect(events).toContainEqual({
      type: 'session.ended',
      sessionId: s.id,
      day: TODAY,
      counted: true,
    })
  })

  it('anti-cheat: a session stopped at 50% of the plan is not counted and earns no XP', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 50 }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 25 * MIN, interrupted: true })
    expect(result?.xp).toBe(0)
    expect(result?.session).toMatchObject({ actualMinutes: 25, counted: false, interrupted: true })
    expect(await xpEvents()).toHaveLength(0)
    await settleDomainEvents()
    expect(events).toContainEqual({
      type: 'session.ended',
      sessionId: s.id,
      day: TODAY,
      counted: false,
    })
  })

  it('anti-cheat: counts from exactly 80% (20 of 25) and not a second earlier', async () => {
    const a = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const under = await finishSession(a.id, { now: T0 + 20 * MIN - 1000, interrupted: true })
    expect(under?.session).toMatchObject({ actualMinutes: 19, counted: false })
    expect(under?.xp).toBe(0)

    const b = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 + 30 * MIN },
    )
    const exact = await finishSession(b.id, { now: T0 + 50 * MIN, interrupted: true })
    expect(exact?.session).toMatchObject({ actualMinutes: 20, counted: true, interrupted: true })
    expect(exact?.xp).toBe(20)
  })

  it('a stopwatch counts from 10 minutes and pays for every whole minute', async () => {
    const short = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    const r1 = await finishSession(short.id, { now: T0 + 9 * MIN + 59_000 })
    expect(r1?.session).toMatchObject({ actualMinutes: 9, counted: false })
    expect(r1?.xp).toBe(0)

    const long = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 + 20 * MIN })
    const r2 = await finishSession(long.id, { now: T0 + 20 * MIN + 47 * MIN })
    expect(r2?.session).toMatchObject({ actualMinutes: 47, counted: true })
    expect(r2?.xp).toBe(47)
  })

  it('pauses are not focus time: 25 minutes with a 10-minute pause is 25 minutes, not 35', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await pauseSession(s.id, { now: T0 + 10 * MIN })
    await resumeSession(s.id, { now: T0 + 20 * MIN })
    const result = await finishSession(s.id, { now: T0 + 35 * MIN })
    expect(result?.session).toMatchObject({ actualMinutes: 25, pausedMs: 10 * MIN, counted: true })
    expect(result?.xp).toBe(25)
  })

  it('finishing while paused closes the pause and counts only the time before it', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await pauseSession(s.id, { now: T0 + 22 * MIN })
    const result = await finishSession(s.id, { now: T0 + 60 * MIN, interrupted: true })
    expect(result?.session).toMatchObject({
      actualMinutes: 22,
      pausedMs: 38 * MIN,
      pausedAt: null,
      counted: true,
    })
  })

  it('a break never earns XP, counts, or emits session.ended', async () => {
    const b = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 },
      { now: T0 },
    )
    const result = await finishSession(b.id, { now: T0 + 5 * MIN })
    expect(result?.xp).toBe(0)
    expect(result?.session).toMatchObject({ status: 'completed', actualMinutes: 5, counted: false })
    expect(await xpEvents()).toHaveLength(0)
    await settleDomainEvents()
    expect(events).toEqual([])
  })

  it('is idempotent: a second finish does nothing and the XP is paid once', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await finishSession(s.id, { now: T0 + 25 * MIN })
    expect(await finishSession(s.id, { now: T0 + 30 * MIN })).toBeNull()
    expect(await xpEvents()).toHaveLength(1)
  })

  it('a planned session finished late ends at its planned end, not at now', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 40 * MIN })
    expect(result?.session).toMatchObject({
      endedAt: T0 + 25 * MIN,
      actualMinutes: 25,
      counted: true,
      interrupted: false,
    })
    expect(result?.xp).toBe(25)

    // With a pause behind it, the planned end has moved later by the pause.
    const p = await startSession(
      { mode: 'custom', kind: 'focus', plannedMin: 50 },
      { now: T0 + 60 * MIN },
    )
    await pauseSession(p.id, { now: T0 + 70 * MIN })
    await resumeSession(p.id, { now: T0 + 75 * MIN })
    const late = await finishSession(p.id, { now: T0 + 300 * MIN })
    expect(late?.session).toMatchObject({
      endedAt: T0 + 60 * MIN + 50 * MIN + 5 * MIN,
      pausedMs: 5 * MIN,
      actualMinutes: 50,
    })
    expect(late?.xp).toBe(50)
  })

  it('a stopwatch has no plan to cap at, and a finish at an earlier time is kept', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 30 * MIN })
    expect(result?.session.endedAt).toBe(T0 + 30 * MIN)
    const early = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 + 40 * MIN },
    )
    const r = await finishSession(early.id, { now: T0 + 50 * MIN, interrupted: true })
    expect(r?.session.endedAt).toBe(T0 + 50 * MIN)
  })

  it('a stopwatch left running for a day pays for 4 hours, not 24', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 24 * 60 * MIN })
    expect(result?.session).toMatchObject({ actualMinutes: 240, counted: true })
    expect(result?.xp).toBe(240)
    expect((await xpEvents())[0]?.amount).toBe(240)
  })

  it('anti-cheat compares the exact time: 9:59 of a 12-minute plan counts', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 12 }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 9 * MIN + 59_000, interrupted: true })
    expect(result?.session).toMatchObject({ actualMinutes: 9, counted: true, interrupted: true })
    expect(result?.xp).toBe(9)
  })

  it('never ends before it started', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 - 5 * MIN })
    expect(result?.session.endedAt).toBe(T0)
    expect(result?.session.actualMinutes).toBe(0)
  })

  it('writes the session and its XP in one transaction: if the XP fails, the session stays running', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    vi.spyOn(db.xpEvents, 'add').mockRejectedValueOnce(new Error('disk full'))
    await expect(finishSession(s.id, { now: T0 + 25 * MIN })).rejects.toThrow('disk full')
    expect(await db.sessions.get(s.id)).toMatchObject({
      status: 'running',
      endedAt: null,
      counted: false,
    })
    expect(await xpEvents()).toHaveLength(0)
    await settleDomainEvents()
    expect(events.filter((e) => e.type === 'session.ended')).toEqual([])
  })
})

describe('reopenSession', () => {
  it('takes back a finish that did not count: it runs again, and the wait is not focus time', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await finishSession(s.id, { now: T0 + 10 * MIN, interrupted: true })
    expect(await getActiveSession()).toBeNull()

    const back = await reopenSession(s.id, { now: T0 + 12 * MIN })
    expect(back).toMatchObject({
      status: 'running',
      endedAt: null,
      actualMinutes: null,
      counted: false,
      interrupted: false,
      pausedAt: null,
      pausedMs: 2 * MIN,
    })
    expect((await getActiveSession())?.id).toBe(s.id)
    // It picks up where it stopped: 10 of 25 minutes were done, so the end is 15 minutes after the undo.
    const done = await reconcileRunning(T0 + 12 * MIN + 15 * MIN)
    expect(done?.session).toMatchObject({
      endedAt: T0 + 27 * MIN,
      actualMinutes: 25,
      counted: true,
    })
    expect(done?.xp).toBe(25)
    // The XP is paid once, for the finished session (the early stop paid nothing).
    expect(await xpEvents()).toHaveLength(1)
  })

  it('keeps the pauses already taken', async () => {
    const s = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    await pauseSession(s.id, { now: T0 + 3 * MIN })
    await finishSession(s.id, { now: T0 + 5 * MIN })
    const back = await reopenSession(s.id, { now: T0 + 6 * MIN })
    // 2 minutes of pause up to the finish (which closed it) plus 1 minute before the undo.
    expect(back?.pausedMs).toBe(3 * MIN)
  })

  it('does nothing for a session that counted (its XP is paid), a break, a missing one or a running one', async () => {
    const counted = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 },
    )
    await finishSession(counted.id, { now: T0 + 24 * MIN, interrupted: true })
    expect(await reopenSession(counted.id, { now: T0 + 25 * MIN })).toBeNull()
    expect((await db.sessions.get(counted.id))?.status).toBe('completed')
    expect(await xpEvents()).toHaveLength(1)

    const brk = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 },
      { now: T0 + 30 * MIN },
    )
    await finishSession(brk.id, { now: T0 + 31 * MIN })
    expect(await reopenSession(brk.id, { now: T0 + 32 * MIN })).toBeNull()
    expect(await reopenSession('missing', { now: T0 })).toBeNull()

    const early = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 50 },
      { now: T0 + 40 * MIN },
    )
    await finishSession(early.id, { now: T0 + 45 * MIN, interrupted: true })
    const other = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 + 46 * MIN },
    )
    expect(await reopenSession(early.id, { now: T0 + 47 * MIN })).toBeNull()
    expect((await getActiveSession())?.id).toBe(other.id)
    expect(await reopenSession(other.id, { now: T0 + 48 * MIN })).toBeNull()
  })
})

describe('cancelSession', () => {
  it('throws a session away: abandoned, no XP, not counted, no session.ended', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const gone = await cancelSession(s.id, { now: T0 + 20 * 1000 })
    expect(gone).toMatchObject({
      status: 'abandoned',
      counted: false,
      interrupted: true,
      actualMinutes: 0,
    })
    expect(await getActiveSession()).toBeNull()
    expect(await xpEvents()).toHaveLength(0)
    await settleDomainEvents()
    expect(events.filter((e) => e.type === 'session.ended')).toEqual([])
    expect(await cancelSession(s.id)).toBeNull()
  })

  it('cancels a running break so the next round can start', async () => {
    const b = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 },
      { now: T0 },
    )
    await cancelSession(b.id, { now: T0 + MIN })
    await expect(
      startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 + MIN }),
    ).resolves.toMatchObject({ status: 'running' })
  })
})

describe('reconcileRunning', () => {
  it('finishes a session whose end passed while the tab was closed, at the planned end', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    const result = await reconcileRunning(T0 + 3 * 60 * MIN)
    expect(result?.session.id).toBe(s.id)
    expect(result?.session).toMatchObject({
      status: 'completed',
      endedAt: T0 + 25 * MIN,
      actualMinutes: 25,
      counted: true,
      interrupted: false,
    })
    expect(result?.xp).toBe(25)
    expect((await xpEvents())[0]).toMatchObject({ amount: 25, at: T0 + 25 * MIN, day: TODAY })
    await settleDomainEvents()
    expect(events).toContainEqual({
      type: 'session.ended',
      sessionId: s.id,
      day: TODAY,
      counted: true,
    })
  })

  it('the end moves later by the pauses: it finishes at startedAt + planned + pausedMs', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await pauseSession(s.id, { now: T0 + 10 * MIN })
    await resumeSession(s.id, { now: T0 + 14 * MIN })
    expect(await reconcileRunning(T0 + 28 * MIN)).toBeNull() // end is at 29 minutes
    const result = await reconcileRunning(T0 + 5 * 60 * MIN)
    expect(result?.session).toMatchObject({
      endedAt: T0 + 29 * MIN,
      actualMinutes: 25,
      pausedMs: 4 * MIN,
    })
  })

  it('leaves a session that is not due, a paused one, and a stopwatch alone', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    expect(await reconcileRunning(T0 + 24 * MIN)).toBeNull()
    await pauseSession(s.id, { now: T0 + 5 * MIN })
    expect(await reconcileRunning(T0 + 10 * 60 * MIN)).toBeNull()
    expect((await getActiveSession())?.status).toBe('paused')

    await cancelSession(s.id, { now: T0 + 11 * 60 * MIN })
    await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 + 12 * 60 * MIN })
    expect(await reconcileRunning(T0 + 48 * 60 * MIN)).toBeNull()
  })

  it('does nothing with no session, and is safe to run twice', async () => {
    expect(await reconcileRunning(T0)).toBeNull()
    await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 }, { now: T0 })
    expect(await reconcileRunning(T0 + 10 * MIN)).not.toBeNull()
    expect(await reconcileRunning(T0 + 10 * MIN)).toBeNull()
  })
})

describe('notes and links', () => {
  it('logNote saves, trims and clears a note, also after the session ended', async () => {
    const s = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await finishSession(s.id, { now: T0 + 25 * MIN })
    expect((await logNote(s.id, '  Finished the CSS grid unit  '))?.note).toBe(
      'Finished the CSS grid unit',
    )
    expect((await logNote(s.id, '   '))?.note).toBeNull()
    expect(await logNote('missing', 'x')).toBeNull()
  })

  it('setSessionTask links, re-links and unlinks a running session', async () => {
    const task = await createTask(
      { title: 'D278 · Ch. 4', goalId: 'g1', milestoneId: 'm2' },
      { now: T0 },
    )
    const s = await startSession({ mode: 'stopwatch', kind: 'focus' }, { now: T0 })
    expect(await setSessionTask(s.id, task.id)).toMatchObject({
      taskId: task.id,
      goalId: 'g1',
      milestoneId: 'm2',
    })
    expect(await setSessionTask(s.id, null)).toMatchObject({
      taskId: null,
      goalId: null,
      milestoneId: null,
    })
    expect(await setSessionTask('missing', null)).toBeNull()
  })
})

describe('getLastFinishedSession', () => {
  it('is the latest ended session, finished or abandoned, and never a running one', async () => {
    expect(await getLastFinishedSession()).toBeNull()
    const a = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 })
    await finishSession(a.id, { now: T0 + 25 * MIN })
    const b = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 },
      { now: T0 + 26 * MIN },
    )
    expect((await getLastFinishedSession())?.id).toBe(a.id)
    await cancelSession(b.id, { now: T0 + 27 * MIN })
    expect(await getLastFinishedSession()).toMatchObject({ id: b.id, status: 'abandoned' })
    await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 }, { now: T0 + 28 * MIN })
    expect((await getLastFinishedSession())?.id).toBe(b.id)
  })
})
