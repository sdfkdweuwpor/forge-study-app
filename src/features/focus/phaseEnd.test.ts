import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  finishSession,
  getActiveSession,
  startSession,
  type FinishResult,
} from '@/db/repos/sessions'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { handlePhaseEnd } from './phaseEnd'
import { registerRuntime, type FocusRuntime } from './runtime'
import { TimerStore } from './timerStore'

const MIN = 60_000
const T0 = new Date(2026, 8, 29, 9, 30).getTime()

let openEndDialog: ReturnType<typeof vi.fn>
let announce: ReturnType<typeof vi.fn>
let toastShow: ReturnType<typeof vi.fn>
let unregister: () => void

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 + 25 * MIN)
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  const store = new TimerStore()
  openEndDialog = vi.fn()
  announce = vi.fn()
  toastShow = vi.fn()
  const runtime: FocusRuntime = {
    announce: announce as unknown as FocusRuntime['announce'],
    toast: {
      show: toastShow as unknown as FocusRuntime['toast']['show'],
      success: vi.fn(),
      error: vi.fn(),
      xp: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    openEndDialog: openEndDialog as unknown as FocusRuntime['openEndDialog'],
    closeEndDialog: () => undefined,
    soundEnabled: () => false,
    snapshot: store.getSnapshot,
    setDraftTask: () => undefined,
  }
  unregister = registerRuntime(runtime)
})

afterEach(async () => {
  unregister()
  await settleDomainEvents()
  vi.useRealTimers()
})

async function ended(
  kind: 'focus' | 'break',
  round: number,
  minutes: number,
): Promise<FinishResult> {
  const s = await startSession({ mode: 'pomodoro', kind, plannedMin: minutes, round }, { now: T0 })
  const result = await finishSession(s.id, { now: T0 + minutes * MIN })
  if (!result) throw new Error('did not finish')
  return result
}

describe('the end of a focus round', () => {
  it('opens the dialog, and starts nothing while auto-start is off', async () => {
    const result = await ended('focus', 1, 25)
    await handlePhaseEnd(result, false)
    expect(openEndDialog).toHaveBeenCalledWith(result.session.id)
    expect(await getActiveSession()).toBeNull()
    expect(announce).not.toHaveBeenCalled()
  })

  it('starts the break by itself when settings say so: short after round 1, long after round 4', async () => {
    await updateSettings({ timer: { autoStartBreaks: true } })
    await handlePhaseEnd(await ended('focus', 1, 25), false)
    expect(await getActiveSession()).toMatchObject({ kind: 'break', round: 1, plannedMinutes: 5 })
    // Nobody pressed anything, so the live region says a break began.
    expect(announce).toHaveBeenCalledWith('Short break started. 5 min.')

    await db.sessions.clear()
    await handlePhaseEnd(await ended('focus', 4, 25), false)
    expect(await getActiveSession()).toMatchObject({ kind: 'break', round: 4, plannedMinutes: 15 })
  })

  it('never auto-starts a break after a custom or stopwatch session', async () => {
    await updateSettings({ timer: { autoStartBreaks: true } })
    const s = await startSession({ mode: 'custom', kind: 'focus', plannedMin: 30 }, { now: T0 })
    const result = await finishSession(s.id, { now: T0 + 30 * MIN })
    await handlePhaseEnd(result as FinishResult, false)
    expect(await getActiveSession()).toBeNull()
  })

  it('a phase that ended while the app was closed only queues the dialog: nothing starts on its own', async () => {
    await updateSettings({ timer: { autoStartBreaks: true } })
    const result = await ended('focus', 1, 25)
    await handlePhaseEnd(result, true)
    expect(openEndDialog).toHaveBeenCalledTimes(1)
    expect(await getActiveSession()).toBeNull()
  })

  it('does not start a second session when one is already running (another tab got there first)', async () => {
    await updateSettings({ timer: { autoStartBreaks: true } })
    const result = await ended('focus', 1, 25)
    const other = await startSession({ mode: 'pomodoro', kind: 'break', plannedMin: 5, round: 1 })
    await handlePhaseEnd(result, false)
    expect((await getActiveSession())?.id).toBe(other.id)
    expect(await db.sessions.count()).toBe(2)
  })
})

describe('the end of a break', () => {
  it('shows a toast, no dialog, and starts nothing while auto-start is off', async () => {
    await handlePhaseEnd(await ended('break', 1, 5), false)
    expect(openEndDialog).not.toHaveBeenCalled()
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Break over', description: 'Ready for round 2 of 4?' }),
    )
    expect(await getActiveSession()).toBeNull()
  })

  it('starts the next round when settings say so', async () => {
    await updateSettings({ timer: { autoStartFocus: true } })
    await handlePhaseEnd(await ended('break', 2, 5), false)
    expect(await getActiveSession()).toMatchObject({ kind: 'focus', round: 3, plannedMinutes: 25 })
    expect(announce).toHaveBeenCalledWith('Focus started. 25 min.')
  })

  it('is quiet when it ended long ago', async () => {
    await updateSettings({ timer: { autoStartFocus: true } })
    await handlePhaseEnd(await ended('break', 2, 5), true)
    expect(toastShow).not.toHaveBeenCalled()
    expect(await getActiveSession()).toBeNull()
  })
})
