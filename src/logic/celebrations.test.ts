import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CELEBRATION_WINDOW_MS,
  createCelebrationQueue,
  mergeCelebrations,
  type Celebration,
  type ToastRequest,
} from './celebrations'

const streakXp: Celebration = {
  id: 'streak:7:2026-09-23',
  title: '7-day streak · +100 XP 🔥',
  mergeKey: 'streak:7',
  order: 0,
}
const streakBadge: Celebration = {
  id: 'badge:streak-7',
  title: 'Badge unlocked · 7-Day Streak 🔥',
  joinAs: 'Badge unlocked',
  description: 'Focused 7 days in a row.',
  mergeKey: 'streak:7',
  order: 1,
}
const dailyGoal: Celebration = { id: 'dailyGoal:2026-09-29', title: 'Daily goal hit · +25 XP' }

describe('mergeCelebrations', () => {
  it('joins a streak milestone and its badge into one toast', () => {
    expect(mergeCelebrations([streakXp, streakBadge])).toEqual([
      {
        id: 'streak:7:2026-09-23',
        title: '7-day streak · +100 XP 🔥 · Badge unlocked',
        description: 'Focused 7 days in a row.',
      },
    ])
  })

  it('reads the same whichever arrives first', () => {
    expect(mergeCelebrations([streakBadge, streakXp])).toEqual(
      mergeCelebrations([streakXp, streakBadge]),
    )
  })

  it('leaves celebrations with no key, or different keys, alone and in arrival order', () => {
    const otherBadge: Celebration = { ...streakBadge, id: 'badge:streak-30', mergeKey: 'streak:30' }
    expect(mergeCelebrations([dailyGoal, streakXp, otherBadge]).map((t) => t.id)).toEqual([
      dailyGoal.id,
      streakXp.id,
      otherBadge.id,
    ])
  })

  it('keeps two keyless celebrations apart even when their titles match', () => {
    const again: Celebration = { ...dailyGoal, id: 'dailyGoal:2026-09-30' }
    expect(mergeCelebrations([dailyGoal, again])).toHaveLength(2)
  })

  it('takes the first description that exists and adds nothing when there is none', () => {
    expect(mergeCelebrations([streakXp])).toEqual([{ id: streakXp.id, title: streakXp.title }])
  })

  it('joins three under one key, in order, using each one’s short form', () => {
    const third: Celebration = { id: 'x', title: 'Level 8', joinAs: 'Level 8', mergeKey: 'streak:7', order: 2 }
    expect(mergeCelebrations([third, streakBadge, streakXp])[0]?.title).toBe(
      '7-day streak · +100 XP 🔥 · Badge unlocked · Level 8',
    )
  })

  it('returns nothing for nothing', () => {
    expect(mergeCelebrations([])).toEqual([])
  })
})

describe('celebration queue', () => {
  let shown: ToastRequest[]
  const show = (t: ToastRequest) => {
    shown.push(t)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    shown = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits the window, then shows one merged toast for a milestone and its badge', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    q.push(streakXp)
    vi.advanceTimersByTime(120)
    q.push(streakBadge)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS - 121)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(2)
    expect(shown.map((t) => t.title)).toEqual(['7-day streak · +100 XP 🔥 · Badge unlocked'])
  })

  it('merges when the badge arrives first', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    q.push(streakBadge)
    q.push(streakXp)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe('7-day streak · +100 XP 🔥 · Badge unlocked')
  })

  it('shows a lone celebration by itself after the window', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    q.push(dailyGoal)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS - 1)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(1)
    expect(shown).toEqual([{ id: dailyGoal.id, title: dailyGoal.title }])
  })

  it('does not merge a badge that arrives after the window closed', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    q.push(streakXp)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS + 1)
    q.push(streakBadge)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    expect(shown.map((t) => t.id)).toEqual([streakXp.id, streakBadge.id])
  })

  it('replaces a waiting celebration that has the same id', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    q.push(dailyGoal)
    q.push({ ...dailyGoal, title: 'Daily goal hit · +30 XP' })
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    expect(shown.map((t) => t.title)).toEqual(['Daily goal hit · +30 XP'])
  })

  it('defers everything while the level-up moment holds, then shows it in arrival order', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    const release = q.hold()
    q.push(dailyGoal)
    q.push(streakXp)
    vi.advanceTimersByTime(5_000)
    expect(shown).toEqual([])
    release()
    expect(shown.map((t) => t.id)).toEqual([dailyGoal.id, streakXp.id])
  })

  it('still merges a badge that arrives while the moment holds its milestone back', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    const release = q.hold()
    q.push(streakXp)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS + 100)
    q.push(streakBadge)
    release()
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe('7-day streak · +100 XP 🔥 · Badge unlocked')
  })

  it('shows nothing until every hold is released, and a double release counts once', () => {
    const q = createCelebrationQueue()
    q.attach(show)
    const first = q.hold()
    const second = q.hold()
    q.push(dailyGoal)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    first()
    first()
    expect(shown).toEqual([])
    second()
    expect(shown).toHaveLength(1)
  })

  it('keeps toasts until a host attaches, then shows each once', () => {
    const q = createCelebrationQueue()
    q.push(dailyGoal)
    q.push(streakXp)
    q.push(streakBadge)
    vi.advanceTimersByTime(2_000)
    expect(shown).toEqual([])
    const detach = q.attach(show)
    expect(shown.map((t) => t.id)).toEqual([dailyGoal.id, streakXp.id])
    detach()
    q.attach(show)
    expect(shown).toHaveLength(2)
  })

  it('stops showing after the host detaches and resumes for the next one', () => {
    const q = createCelebrationQueue()
    const detach = q.attach(show)
    detach()
    q.push(dailyGoal)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    expect(shown).toEqual([])
    q.attach(show)
    expect(shown).toHaveLength(1)
  })

  it('a moment that closes while no host is mounted still lets the toasts through once one is', () => {
    const q = createCelebrationQueue()
    const release = q.hold()
    q.push(dailyGoal)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    release()
    expect(shown).toEqual([])
    q.attach(show)
    expect(shown).toHaveLength(1)
  })

  it('reset forgets what is waiting', () => {
    const q = createCelebrationQueue()
    q.push(dailyGoal)
    q.reset()
    q.attach(show)
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    expect(shown).toEqual([])
  })

  it('drops the oldest waiting toasts rather than growing without a host', () => {
    const q = createCelebrationQueue()
    for (let i = 0; i < 30; i += 1) q.push({ id: `n${i}`, title: `Toast ${i}` })
    vi.advanceTimersByTime(CELEBRATION_WINDOW_MS)
    q.attach(show)
    expect(shown.length).toBeLessThanOrEqual(12)
    expect(shown.at(-1)?.id).toBe('n29')
  })
})
