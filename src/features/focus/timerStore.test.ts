import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/db/types'
import { TimerStore, buildSnapshot } from './timerStore'

const MIN = 60_000
const T0 = Date.parse('2026-09-29T09:30:00-04:00')

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    createdAt: T0,
    updatedAt: T0,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'running',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day: '2026-09-29',
    startedAt: T0,
    endedAt: null,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: null,
    round: 1,
    interrupted: false,
    counted: false,
    note: null,
    ...over,
  }
}

describe('buildSnapshot', () => {
  it('is loading while the first read is pending, idle with nothing running', () => {
    expect(buildSnapshot(undefined, T0, null).status).toBe('loading')
    expect(buildSnapshot(null, T0, 't1')).toEqual({
      status: 'idle',
      session: null,
      seconds: 0,
      progress: 0,
      draftTaskId: 't1',
    })
  })

  it('counts a planned session down and a stopwatch up', () => {
    const planned = buildSnapshot(session(), T0 + 10 * MIN, null)
    expect(planned).toMatchObject({ status: 'running', seconds: 15 * 60 })
    expect(planned.progress).toBeCloseTo(0.4)

    const watch = buildSnapshot(session({ mode: 'stopwatch', plannedMinutes: null }), T0 + 4 * MIN, null)
    expect(watch.seconds).toBe(4 * 60)
  })

  it('a paused session shows the frozen time, however late it is read', () => {
    const paused = session({ status: 'paused', pausedAt: T0 + 5 * MIN })
    expect(buildSnapshot(paused, T0 + 5 * MIN, null).seconds).toBe(20 * 60)
    expect(buildSnapshot(paused, T0 + 5 * 60 * MIN, null)).toMatchObject({
      status: 'paused',
      seconds: 20 * 60,
    })
  })

  it('treats a finished row as idle', () => {
    expect(buildSnapshot(session({ status: 'completed' }), T0, null).status).toBe('idle')
  })
})

describe('TimerStore', () => {
  it('notifies once per displayed second, not on every 250 ms tick', () => {
    const store = new TimerStore()
    store.setSession(session(), T0)
    const listener = vi.fn()
    store.subscribe(listener)
    for (const offset of [250, 500, 750]) store.tick(T0 + offset)
    expect(listener).toHaveBeenCalledTimes(0)
    store.tick(T0 + 1000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().seconds).toBe(25 * 60 - 1)
    for (const offset of [1250, 1500, 1750]) store.tick(T0 + offset)
    expect(listener).toHaveBeenCalledTimes(1)
    store.tick(T0 + 2000)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps the same snapshot object while nothing on screen changed', () => {
    const store = new TimerStore()
    store.setSession(session(), T0)
    const first = store.getSnapshot()
    store.tick(T0 + 400)
    expect(store.getSnapshot()).toBe(first)
  })

  it('notifies when the session changes (pause, finish) and when the draft task changes', () => {
    const store = new TimerStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.setSession(null, T0)
    expect(store.getSnapshot().status).toBe('idle')
    store.setDraftTask('t1')
    expect(store.getSnapshot().draftTaskId).toBe('t1')
    store.setSession(session(), T0)
    store.setSession(session({ status: 'paused', pausedAt: T0 + MIN }), T0 + MIN)
    expect(store.getSnapshot().status).toBe('paused')
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('resuming after a long pause reads the right time at once, not the stale now', () => {
    const store = new TimerStore()
    store.setSession(session({ status: 'paused', pausedAt: T0 + 5 * MIN }), T0 + 5 * MIN)
    // Ten minutes later the row comes back running, with the pause folded in.
    const later = T0 + 15 * MIN
    store.setSession(session({ status: 'running', pausedMs: 10 * MIN }), later)
    expect(store.getSnapshot().seconds).toBe(20 * 60)
  })

  it('stops notifying an unsubscribed listener', () => {
    const store = new TimerStore()
    store.setSession(session(), T0)
    const listener = vi.fn()
    const off = store.subscribe(listener)
    off()
    store.tick(T0 + 5000)
    expect(listener).not.toHaveBeenCalled()
  })
})
