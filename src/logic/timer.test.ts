import { describe, expect, it } from 'vitest'
import { dayOf } from './dates'
import {
  ANNOUNCE_MARKS_MIN,
  UP_NEXT_WINDOW_MS,
  breakAfter,
  clockOf,
  crossedMark,
  cyclePosition,
  displaySeconds,
  earnedXp,
  elapsedMs,
  focusPhase,
  formatClock,
  formatMinutes,
  formatSpan,
  isDue,
  nextPhase,
  normalizeCycle,
  pauseClock,
  plannedEndAt,
  progress,
  remainingMs,
  resumeClock,
  settleSession,
  shouldDiscard,
  spokenClock,
  phaseLabel,
  upNext,
  variantOf,
  type CycleConfig,
  type LastPhase,
  type TimerClock,
} from './timer'

const MIN = 60_000
const at = (iso: string): number => Date.parse(iso)

const CYCLE: CycleConfig = { pomodoroMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 }

const run = (startedAt: number, minutes: number | null): TimerClock => ({
  startedAt,
  plannedMs: minutes === null ? null : minutes * MIN,
  pausedMs: 0,
  pausedAt: null,
})

describe('elapsed and remaining', () => {
  const start = at('2026-09-29T09:30:00-04:00')

  it('counts down from the plan', () => {
    const c = run(start, 25)
    expect(elapsedMs(c, start)).toBe(0)
    expect(remainingMs(c, start)).toBe(25 * MIN)
    expect(remainingMs(c, start + 10 * MIN)).toBe(15 * MIN)
    expect(remainingMs(c, start + 25 * MIN)).toBe(0)
  })

  it('never goes negative, past the end or when the system clock steps back', () => {
    const c = run(start, 25)
    expect(remainingMs(c, start + 3 * 60 * MIN)).toBe(0)
    expect(elapsedMs(c, start - 5 * MIN)).toBe(0)
  })

  it('a stopwatch has elapsed time and no remaining time', () => {
    const c = run(start, null)
    expect(remainingMs(c, start + 12 * MIN)).toBeNull()
    expect(elapsedMs(c, start + 12 * MIN)).toBe(12 * MIN)
    expect(plannedEndAt(c)).toBeNull()
    expect(isDue(c, start + 10 * 60 * MIN)).toBe(false)
  })

  it('subtracts finished pauses and freezes at the pause in progress', () => {
    const c: TimerClock = { startedAt: start, plannedMs: 25 * MIN, pausedMs: 4 * MIN, pausedAt: null }
    expect(elapsedMs(c, start + 14 * MIN)).toBe(10 * MIN)
    const paused: TimerClock = { ...c, pausedAt: start + 14 * MIN }
    expect(elapsedMs(paused, start + 14 * MIN)).toBe(10 * MIN)
    expect(elapsedMs(paused, start + 5 * 60 * MIN)).toBe(10 * MIN)
  })

  it('matches the PLAN formula: planned − (now − startedAt − pausedMs − (now − pausedAt))', () => {
    const c: TimerClock = { startedAt: start, plannedMs: 25 * MIN, pausedMs: 2 * MIN, pausedAt: start + 9 * MIN }
    const now = start + 20 * MIN
    const formula = 25 * MIN - (now - c.startedAt - c.pausedMs - (now - (c.pausedAt ?? now)))
    expect(remainingMs(c, now)).toBe(formula)
  })
})

describe('planned end and due', () => {
  const start = at('2026-09-29T09:30:00-04:00')

  it('the end is start + plan + pauses, and it moves later with every pause', () => {
    expect(plannedEndAt(run(start, 25))).toBe(start + 25 * MIN)
    const c: TimerClock = { startedAt: start, plannedMs: 25 * MIN, pausedMs: 7 * MIN, pausedAt: null }
    expect(plannedEndAt(c)).toBe(start + 32 * MIN)
  })

  it('is due at the end and after, never before', () => {
    const c = run(start, 25)
    expect(isDue(c, start + 25 * MIN - 1)).toBe(false)
    expect(isDue(c, start + 25 * MIN)).toBe(true)
    expect(isDue(c, start + 26 * MIN)).toBe(true)
  })

  it('a paused session has no end and is never due, however late it is', () => {
    const paused = pauseClock(run(start, 25), start + 10 * MIN)
    expect(plannedEndAt(paused)).toBeNull()
    expect(isDue(paused, start + 24 * 60 * MIN)).toBe(false)
  })
})

describe('pause and resume', () => {
  const start = at('2026-09-29T09:30:00-04:00')

  it('pausing twice keeps the first pause; resuming a running clock changes nothing', () => {
    const c = run(start, 25)
    const paused = pauseClock(c, start + 5 * MIN)
    expect(pauseClock(paused, start + 9 * MIN)).toBe(paused)
    expect(resumeClock(c, start + 9 * MIN)).toBe(c)
  })

  it('resume folds the pause into pausedMs and the timer carries on where it stopped', () => {
    const paused = pauseClock(run(start, 25), start + 5 * MIN)
    const resumed = resumeClock(paused, start + 20 * MIN)
    expect(resumed).toEqual({ startedAt: start, plannedMs: 25 * MIN, pausedMs: 15 * MIN, pausedAt: null })
    expect(remainingMs(resumed, start + 20 * MIN)).toBe(20 * MIN)
    expect(plannedEndAt(resumed)).toBe(start + 40 * MIN)
  })

  it('several pauses add up', () => {
    let c = run(start, 25)
    c = resumeClock(pauseClock(c, start + 5 * MIN), start + 8 * MIN)
    c = resumeClock(pauseClock(c, start + 10 * MIN), start + 14 * MIN)
    expect(c.pausedMs).toBe(7 * MIN)
    expect(elapsedMs(c, start + 20 * MIN)).toBe(13 * MIN)
  })
})

describe('daylight-saving changes (TZ=America/New_York)', () => {
  it('a session running through the November fall-back is exactly as long as planned', () => {
    // 01:50 EDT. The wall clock reads 01:00–02:00 twice; 25 real minutes end at 01:15 EST.
    const start = at('2026-11-01T01:50:00-04:00')
    const c = run(start, 25)
    expect(plannedEndAt(c)).toBe(at('2026-11-01T01:15:00-05:00'))
    expect(remainingMs(c, at('2026-11-01T01:05:00-05:00'))).toBe(10 * MIN)
    expect(dayOf(start)).toBe('2026-11-01')
    expect(dayOf(plannedEndAt(c) ?? 0)).toBe('2026-11-01')
  })

  it('pause and resume across the fall-back use real elapsed time, not the wall clock', () => {
    const start = at('2026-11-01T01:50:00-04:00')
    const pausedAt = at('2026-11-01T01:55:00-04:00') // 5 real minutes in
    // The wall clock now reads 01:10, an "earlier" time, but 15 real minutes have passed.
    const resumeAt = at('2026-11-01T01:10:00-05:00')
    expect(resumeAt - pausedAt).toBe(15 * MIN)

    const paused = pauseClock(run(start, 25), pausedAt)
    expect(remainingMs(paused, resumeAt)).toBe(20 * MIN)
    const resumed = resumeClock(paused, resumeAt)
    expect(resumed.pausedMs).toBe(15 * MIN)
    expect(plannedEndAt(resumed)).toBe(at('2026-11-01T01:30:00-05:00'))
    expect(isDue(resumed, at('2026-11-01T01:29:59-05:00'))).toBe(false)
    expect(isDue(resumed, at('2026-11-01T01:30:00-05:00'))).toBe(true)
  })

  it('pause and resume across the March spring-forward skip the missing hour', () => {
    const start = at('2027-03-14T01:50:00-05:00')
    const pausedAt = at('2027-03-14T01:55:00-05:00')
    // 01:55 EST to 03:10 EDT reads as 75 minutes on the wall, but only 15 minutes passed.
    const resumeAt = at('2027-03-14T03:10:00-04:00')
    expect(resumeAt - pausedAt).toBe(15 * MIN)

    const resumed = resumeClock(pauseClock(run(start, 25), pausedAt), resumeAt)
    expect(resumed.pausedMs).toBe(15 * MIN)
    expect(remainingMs(resumed, resumeAt)).toBe(20 * MIN)
    expect(plannedEndAt(resumed)).toBe(at('2027-03-14T03:30:00-04:00'))
  })
})

describe('a refresh', () => {
  const start = at('2026-09-29T09:30:00-04:00')

  it('mid-pause: the stored row reads back the same, however long the tab was closed', () => {
    const row = {
      startedAt: start,
      plannedMinutes: 25,
      pausedMs: 0,
      pausedAt: start + 10 * MIN,
    }
    const before = clockOf(row)
    // Reloaded three hours later, from nothing but the row.
    const after = clockOf({ ...row })
    const later = start + 3 * 60 * MIN
    expect(remainingMs(after, later)).toBe(remainingMs(before, start + 10 * MIN))
    expect(remainingMs(after, later)).toBe(15 * MIN)
    expect(isDue(after, later)).toBe(false)
    // Resuming then adds the whole time away as one pause.
    const resumed = resumeClock(after, later)
    expect(remainingMs(resumed, later)).toBe(15 * MIN)
    expect(plannedEndAt(resumed)).toBe(later + 15 * MIN)
  })

  it('mid-run: the remaining time comes from the row, and an end that passed while closed is due at its own instant', () => {
    const clock = clockOf({ startedAt: start, plannedMinutes: 25, pausedMs: 3 * MIN, pausedAt: null })
    expect(remainingMs(clock, start + 13 * MIN)).toBe(15 * MIN)
    const closedFor = start + 2 * 60 * MIN
    expect(isDue(clock, closedFor)).toBe(true)
    // Reconciliation finishes the session at the planned end, not at the time of the refresh.
    expect(plannedEndAt(clock)).toBe(start + 28 * MIN)
    expect(elapsedMs(clock, plannedEndAt(clock) ?? 0)).toBe(25 * MIN)
  })

  it('reads plannedMinutes: null as a stopwatch', () => {
    const clock = clockOf({ startedAt: start, plannedMinutes: null, pausedMs: 0, pausedAt: null })
    expect(clock.plannedMs).toBeNull()
  })
})

describe('display', () => {
  const start = 1_000_000

  it('a countdown rounds up, so 00:00 means time is up', () => {
    const c = run(start, 25)
    expect(displaySeconds(c, start)).toBe(25 * 60)
    expect(displaySeconds(c, start + 1)).toBe(25 * 60)
    expect(displaySeconds(c, start + 999)).toBe(25 * 60)
    expect(displaySeconds(c, start + 1000)).toBe(25 * 60 - 1)
    expect(displaySeconds(c, start + 25 * MIN - 1)).toBe(1)
    expect(displaySeconds(c, start + 25 * MIN)).toBe(0)
  })

  it('a stopwatch rounds down', () => {
    const c = run(start, null)
    expect(displaySeconds(c, start + 999)).toBe(0)
    expect(displaySeconds(c, start + 61_500)).toBe(61)
  })

  it('formats mm:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(59)).toBe('00:59')
    expect(formatClock(25 * 60)).toBe('25:00')
    expect(formatClock(59 * 60 + 59)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3600 + 5 * 60 + 9)).toBe('1:05:09')
    expect(formatClock(2 * 3600 + 45 * 60)).toBe('2:45:00')
  })

  it('formats nonsense as 00:00', () => {
    expect(formatClock(-5)).toBe('00:00')
    expect(formatClock(Number.NaN)).toBe('00:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('00:00')
  })

  it('progress is the share of the plan done; a stopwatch fills toward the minute it counts', () => {
    expect(progress(run(start, 25), start)).toBe(0)
    expect(progress(run(start, 20), start + 5 * MIN)).toBeCloseTo(0.25)
    expect(progress(run(start, 25), start + 40 * MIN)).toBe(1)
    expect(progress(run(start, null), start + 5 * MIN)).toBeCloseTo(0.5)
    expect(progress(run(start, null), start + 30 * MIN)).toBe(1)
  })

  it('speaks a time for a screen reader', () => {
    expect(spokenClock(24 * 60 + 59)).toBe('24 minutes 59 seconds')
    expect(spokenClock(60)).toBe('1 minute')
    expect(spokenClock(3600 + 60)).toBe('1 hour 1 minute')
    expect(spokenClock(0)).toBe('0 seconds')
    expect(spokenClock(1)).toBe('1 second')
  })

  it('formats minutes and a span of the day', () => {
    expect(formatMinutes(25)).toBe('25 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(65)).toBe('1 h 5 min')
    expect(formatMinutes(Number.NaN)).toBe('0 min')
    const nine = at('2026-09-29T09:30:00-04:00')
    expect(formatSpan(nine, nine + 25 * MIN)).toBe('9:30–9:55 AM')
    expect(formatSpan(at('2026-09-29T11:45:00-04:00'), at('2026-09-29T12:10:00-04:00'))).toBe(
      '11:45 AM–12:10 PM',
    )
    expect(formatSpan(nine, null)).toBe('9:30 AM – now')
  })
})

describe('announcements', () => {
  it('announces when the display passes a mark, not every second', () => {
    const planned = 25 * MIN
    expect(crossedMark(10 * 60 + 1, 10 * 60, planned)).toBe(10)
    expect(crossedMark(10 * 60, 10 * 60 - 1, planned)).toBeNull()
    expect(crossedMark(5 * 60 + 1, 5 * 60, planned)).toBe(5)
    expect(crossedMark(61, 60, planned)).toBe(1)
    expect(crossedMark(700, 699, planned)).toBeNull()
  })

  it('does not announce a mark the plan is not longer than', () => {
    // A 5-minute break has no "5 minutes left" at its start, but it does have a last minute.
    expect(crossedMark(5 * 60 + 1, 5 * 60, 5 * MIN)).toBeNull()
    expect(crossedMark(61, 60, 5 * MIN)).toBe(1)
    expect(ANNOUNCE_MARKS_MIN).toEqual([30, 15, 10, 5, 1])
  })

  it('when one jump passes several marks, the nearest one is announced', () => {
    expect(crossedMark(16 * 60, 4 * 60, 50 * MIN)).toBe(5)
  })
})

describe('the pomodoro cycle', () => {
  it('a break follows each round: short, short, short, long, then short again', () => {
    const breaks = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => breakAfter(r, CYCLE))
    expect(breaks.map((b) => b.variant)).toEqual([
      'short-break',
      'short-break',
      'short-break',
      'long-break',
      'short-break',
      'short-break',
      'short-break',
      'long-break',
    ])
    expect(breaks[0]).toEqual({ kind: 'break', variant: 'short-break', minutes: 5, round: 1 })
    expect(breaks[3]).toEqual({ kind: 'break', variant: 'long-break', minutes: 15, round: 4 })
  })

  it('takes the lengths and the interval from settings', () => {
    const cfg: CycleConfig = { pomodoroMin: 50, shortBreakMin: 10, longBreakMin: 30, longBreakEvery: 2 }
    expect(focusPhase(1, cfg).minutes).toBe(50)
    expect(breakAfter(1, cfg)).toMatchObject({ variant: 'short-break', minutes: 10 })
    expect(breakAfter(2, cfg)).toMatchObject({ variant: 'long-break', minutes: 30 })
  })

  it('chains: focus → break → the next round', () => {
    expect(nextPhase({ kind: 'focus', round: 2 }, CYCLE)).toMatchObject({ kind: 'break', round: 2 })
    expect(nextPhase({ kind: 'break', round: 2 }, CYCLE)).toEqual({
      kind: 'focus',
      variant: 'focus',
      minutes: 25,
      round: 3,
    })
    expect(nextPhase({ kind: 'break', round: 4 }, CYCLE).round).toBe(5)
  })

  it('numbers rounds inside the cycle: "Round 2 of 4", and round 5 starts over', () => {
    expect(cyclePosition(1, 4)).toEqual({ position: 1, total: 4 })
    expect(cyclePosition(4, 4)).toEqual({ position: 4, total: 4 })
    expect(cyclePosition(5, 4)).toEqual({ position: 1, total: 4 })
    expect(cyclePosition(0, 4)).toEqual({ position: 1, total: 4 })
    expect(cyclePosition(3, 0)).toEqual({ position: 1, total: 1 })
  })

  it('survives bad settings', () => {
    const bad = normalizeCycle({ pomodoroMin: 0, shortBreakMin: Number.NaN, longBreakMin: -3, longBreakEvery: 0 })
    expect(bad).toEqual({ pomodoroMin: 1, shortBreakMin: 5, longBreakMin: 1, longBreakEvery: 1 })
  })
})

describe('naming a stored phase', () => {
  it('a focus row is focus; a break is short, or long after every fourth round', () => {
    expect(variantOf({ kind: 'focus', round: 4 }, CYCLE)).toBe('focus')
    expect(variantOf({ kind: 'break', round: 3 }, CYCLE)).toBe('short-break')
    expect(variantOf({ kind: 'break', round: 4 }, CYCLE)).toBe('long-break')
    expect(variantOf({ kind: 'break', round: 8 }, CYCLE)).toBe('long-break')
    expect(variantOf({ kind: 'break', round: 2 }, { longBreakEvery: 2 })).toBe('long-break')
  })

  it('labels each phase', () => {
    expect(phaseLabel('focus')).toBe('Focus')
    expect(phaseLabel('short-break')).toBe('Short break')
    expect(phaseLabel('long-break')).toBe('Long break')
  })
})

describe('up next', () => {
  const now = at('2026-09-29T10:00:00-04:00')
  const last = (over: Partial<LastPhase> = {}): LastPhase => ({
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    round: 2,
    endedAt: now - 2 * MIN,
    counted: true,
    ...over,
  })

  it('offers the break after a counted round, and the next round after a break', () => {
    expect(upNext(last(), now, CYCLE)).toMatchObject({ kind: 'break', variant: 'short-break', round: 2 })
    expect(upNext(last({ round: 4 }), now, CYCLE)).toMatchObject({ variant: 'long-break' })
    expect(upNext(last({ kind: 'break' }), now, CYCLE)).toMatchObject({ kind: 'focus', round: 3 })
  })

  it('a skipped break also leads to the next round', () => {
    expect(upNext(last({ kind: 'break', status: 'abandoned' }), now, CYCLE)).toMatchObject({
      kind: 'focus',
      round: 3,
    })
  })

  it('offers nothing after a round that did not count, or was thrown away', () => {
    expect(upNext(last({ counted: false }), now, CYCLE)).toBeNull()
    expect(upNext(last({ status: 'abandoned' }), now, CYCLE)).toBeNull()
  })

  it('offers nothing for custom and stopwatch sessions, a running session, or a stale cycle', () => {
    expect(upNext(last({ mode: 'custom' }), now, CYCLE)).toBeNull()
    expect(upNext(last({ mode: 'stopwatch' }), now, CYCLE)).toBeNull()
    expect(upNext(last({ status: 'running', endedAt: null }), now, CYCLE)).toBeNull()
    expect(upNext(last({ endedAt: now - UP_NEXT_WINDOW_MS - 1 }), now, CYCLE)).toBeNull()
    expect(upNext(null, now, CYCLE)).toBeNull()
  })
})

describe('the outcome of a session and the anti-cheat rule (BRIEF §5.5)', () => {
  const outcome = (plannedMinutes: number | null, minutes: number, seconds = 0) =>
    settleSession({ kind: 'focus', plannedMinutes, elapsedMs: minutes * MIN + seconds * 1000 })

  it('a full pomodoro counts and earns 1 XP per minute', () => {
    expect(outcome(25, 25)).toEqual({ actualMinutes: 25, counted: true, xp: 25 })
  })

  it('counts from exactly 80% of the plan: 20 of 25 does, 19 minutes 59 seconds does not', () => {
    expect(outcome(25, 20)).toEqual({ actualMinutes: 20, counted: true, xp: 20 })
    expect(outcome(25, 19, 59)).toEqual({ actualMinutes: 19, counted: false, xp: 0 })
  })

  it('a session stopped at 50% is not counted and earns nothing', () => {
    expect(outcome(50, 25)).toEqual({ actualMinutes: 25, counted: false, xp: 0 })
    expect(outcome(25, 12, 30)).toEqual({ actualMinutes: 12, counted: false, xp: 0 })
  })

  it('applies to custom lengths too (80% of 90 is 72)', () => {
    expect(outcome(90, 72).counted).toBe(true)
    expect(outcome(90, 71, 59).counted).toBe(false)
  })

  it('a stopwatch has no plan and counts from 10 minutes', () => {
    expect(outcome(null, 10)).toEqual({ actualMinutes: 10, counted: true, xp: 10 })
    expect(outcome(null, 9, 59)).toEqual({ actualMinutes: 9, counted: false, xp: 0 })
    expect(outcome(null, 47)).toEqual({ actualMinutes: 47, counted: true, xp: 47 })
  })

  it('XP is per whole minute, so a running-over session does not round up', () => {
    expect(outcome(25, 25, 40)).toEqual({ actualMinutes: 25, counted: true, xp: 25 })
  })

  it('a break never counts and never earns XP', () => {
    expect(settleSession({ kind: 'break', plannedMinutes: 5, elapsedMs: 5 * MIN })).toEqual({
      actualMinutes: 5,
      counted: false,
      xp: 0,
    })
  })

  it('a slip of the finger under a minute is discarded, a minute is kept', () => {
    expect(shouldDiscard(0)).toBe(true)
    expect(shouldDiscard(59_999)).toBe(true)
    expect(shouldDiscard(60_000)).toBe(false)
  })

  it('reads the XP of a settled session: minutes when counted, nothing otherwise', () => {
    expect(earnedXp({ counted: true, actualMinutes: 25 })).toBe(25)
    expect(earnedXp({ counted: false, actualMinutes: 12 })).toBe(0)
    expect(earnedXp({ counted: true, actualMinutes: null })).toBe(0)
  })
})
