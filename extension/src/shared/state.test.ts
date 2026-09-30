import { describe, expect, it } from 'vitest'
import type { BlockEvent } from './protocol.js'
import {
  activeSession,
  appendEvent,
  defaultState,
  eventsSince,
  grantUnlock,
  hasActiveUnlock,
  isBlockedDomain,
  isBlockingNow,
  MAX_EVENTS,
  nextRefreshAt,
  normalizeState,
  pruneUnlocks,
  recordBlocked,
  UNLOCK_MINUTES,
  winsToday,
  type ExtensionState,
} from './state.js'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime()
const NOW = local(2026, 8, 30, 12, 0) // Wed Sep 30 2026, noon

const withConfig = (patch: Partial<ExtensionState['config']>): ExtensionState => {
  const s = defaultState()
  return { ...s, config: { ...s.config, ...patch } }
}

describe('normalizeState', () => {
  it('returns defaults for empty or junk storage', () => {
    expect(normalizeState({})).toEqual(defaultState())
    expect(normalizeState(undefined)).toEqual(defaultState())
    expect(normalizeState('nope')).toEqual(defaultState())
  })

  it('keeps valid parts and replaces malformed ones', () => {
    const s = normalizeState({
      config: { mode: 'banana' },
      session: { active: true, endsAt: 'soon', taskTitle: null },
      unlocks: [{ domain: 'x.com', until: NOW }, { domain: 5 }, null],
      events: [{ id: 'a', at: 1, kind: 'blocked', domain: 'x.com' }, { id: 7 }],
      dailyAttempts: { date: '2026-09-30', count: -3 },
    })
    expect(s.config).toEqual(defaultState().config)
    expect(s.session).toBeNull()
    expect(s.unlocks).toEqual([{ domain: 'x.com', until: NOW }])
    expect(s.events).toHaveLength(1)
    expect(s.dailyAttempts).toEqual({ date: '', count: 0 })
  })

  it('caps stored events at the newest MAX_EVENTS', () => {
    const many: BlockEvent[] = Array.from({ length: MAX_EVENTS + 10 }, (_, i) => ({
      id: `e${i}`,
      at: i + 1,
      kind: 'blocked',
      domain: 'x.com',
    }))
    const s = normalizeState({ events: many })
    expect(s.events).toHaveLength(MAX_EVENTS)
    expect(s.events[0]?.id).toBe('e10')
  })
})

describe('activeSession / isBlockingNow', () => {
  const session = (patch: Partial<NonNullable<ExtensionState['session']>>): ExtensionState => ({
    ...withConfig({ mode: 'focus' }),
    session: { active: true, endsAt: NOW + 60_000, taskTitle: 'C182 Unit 3 practice', ...patch },
  })

  it('focus mode blocks while a session is running', () => {
    expect(isBlockingNow(session({}), NOW)).toBe(true)
    expect(isBlockingNow(session({ endsAt: null }), NOW)).toBe(true) // open-ended
  })

  it('focus mode does not block with no session or an inactive one', () => {
    expect(isBlockingNow(withConfig({ mode: 'focus' }), NOW)).toBe(false)
    expect(isBlockingNow(session({ active: false }), NOW)).toBe(false)
  })

  it('a session whose end has passed stops blocking even if the app never said so', () => {
    expect(isBlockingNow(session({ endsAt: NOW - 1 }), NOW)).toBe(false)
    expect(isBlockingNow(session({ endsAt: NOW }), NOW)).toBe(false)
    expect(activeSession(session({ endsAt: NOW - 1000 }), NOW)).toBeNull()
  })

  it('always mode blocks regardless of the session', () => {
    expect(isBlockingNow(withConfig({ mode: 'always' }), NOW)).toBe(true)
  })

  it('schedule mode follows the windows', () => {
    const state = withConfig({ mode: 'schedule', schedule: [{ days: [3], start: '09:00', end: '17:00' }] })
    expect(isBlockingNow(state, NOW)).toBe(true)
    expect(isBlockingNow(state, local(2026, 8, 30, 18, 0))).toBe(false)
  })
})

describe('unlocks', () => {
  it('grants five minutes, logs an unlock event and replaces an earlier grant', () => {
    const first = grantUnlock(defaultState(), 'instagram.com', 'u1', NOW)
    expect(first.unlocks).toEqual([{ domain: 'instagram.com', until: NOW + UNLOCK_MINUTES * 60_000 }])
    expect(first.events).toEqual([
      { id: 'u1', at: NOW, kind: 'unlock', domain: 'instagram.com', unlockMinutes: UNLOCK_MINUTES },
    ])
    const again = grantUnlock(first, 'instagram.com', 'u2', NOW + 60_000)
    expect(again.unlocks).toHaveLength(1)
    expect(again.unlocks[0]?.until).toBe(NOW + 60_000 + UNLOCK_MINUTES * 60_000)
  })

  it('expires: active before `until`, gone at `until`, and pruned', () => {
    const state = grantUnlock(defaultState(), 'x.com', 'u1', NOW)
    const until = NOW + UNLOCK_MINUTES * 60_000
    expect(hasActiveUnlock(state, 'x.com', until - 1)).toBe(true)
    expect(hasActiveUnlock(state, 'x.com', until)).toBe(false)
    expect(hasActiveUnlock(state, 'reddit.com', NOW)).toBe(false)
    expect(pruneUnlocks(state, until).unlocks).toEqual([])
    expect(pruneUnlocks(state, until - 1)).toBe(state) // untouched: same reference
  })

  it('only known blocklist domains count as blocked', () => {
    const state = withConfig({ blocklist: ['instagram.com', 'm.youtube.com'] })
    expect(isBlockedDomain(state, 'instagram.com')).toBe(true)
    expect(isBlockedDomain(state, 'm.youtube.com')).toBe(true)
    expect(isBlockedDomain(state, 'evil.example')).toBe(false)
    expect(isBlockedDomain(state, 'www.instagram.com')).toBe(false)
  })
})

describe('appendEvent / recordBlocked', () => {
  it('makes `at` strictly increasing even when events arrive in the same millisecond', () => {
    let s = defaultState()
    s = appendEvent(s, { id: 'a', kind: 'blocked', domain: 'x.com' }, NOW)
    s = appendEvent(s, { id: 'b', kind: 'blocked', domain: 'x.com' }, NOW)
    s = appendEvent(s, { id: 'c', kind: 'blocked', domain: 'x.com' }, NOW - 5) // clock stepped back
    expect(s.events.map((e) => e.at)).toEqual([NOW, NOW + 1, NOW + 2])
  })

  it('drops the oldest events beyond the cap', () => {
    let s = defaultState()
    for (let i = 0; i < MAX_EVENTS + 3; i += 1) {
      s = appendEvent(s, { id: `e${i}`, kind: 'blocked', domain: 'x.com' }, NOW + i)
    }
    expect(s.events).toHaveLength(MAX_EVENTS)
    expect(s.events[0]?.id).toBe('e3')
  })

  it('counts wins per LOCAL day and resets after local midnight', () => {
    let s = recordBlocked(defaultState(), 'instagram.com', 'a', local(2026, 8, 29, 20, 30)) // 00:30Z next day
    s = recordBlocked(s, 'instagram.com', 'b', local(2026, 8, 29, 21, 0))
    expect(s.dailyAttempts).toEqual({ date: '2026-09-29', count: 2 }) // still the 29th at 9pm New York
    expect(winsToday(s, local(2026, 8, 29, 23, 59))).toBe(2)
    expect(winsToday(s, local(2026, 8, 30, 0, 1))).toBe(0)
    s = recordBlocked(s, 'x.com', 'c', local(2026, 8, 30, 0, 1))
    expect(s.dailyAttempts).toEqual({ date: '2026-09-30', count: 1 })
  })

  it('unlocks are logged but are not wins', () => {
    const s = grantUnlock(defaultState(), 'x.com', 'u', NOW)
    expect(s.dailyAttempts.count).toBe(0)
  })
})

describe('eventsSince', () => {
  const at = (id: string, t: number): BlockEvent => ({ id, at: t, kind: 'blocked', domain: 'x.com' })

  it('returns events after `since` and a cursor at the newest returned event', () => {
    const r = eventsSince([at('a', 10), at('b', 20), at('c', 30)], 10)
    expect(r.events.map((e) => e.id)).toEqual(['b', 'c'])
    expect(r.cursor).toBe(30)
  })

  it('keeps `since` as the cursor when there is nothing new (not the wall clock)', () => {
    expect(eventsSince([at('a', 10)], 10)).toEqual({ events: [], cursor: 10 })
    expect(eventsSince([], 500)).toEqual({ events: [], cursor: 500 })
  })

  it('a later pull with the cursor picks up an event written after the first pull', () => {
    let events = [at('a', 10), at('b', 20)]
    const first = eventsSince(events, 0)
    expect(first.cursor).toBe(20)
    events = appendEvent({ ...defaultState(), events }, { id: 'c', kind: 'blocked', domain: 'x.com' }, 20).events
    const second = eventsSince(events, first.cursor)
    expect(second.events.map((e) => e.id)).toEqual(['c']) // same millisecond as `b`, still delivered
    expect(second.cursor).toBe(21)
  })

  it('returns events sharing a timestamp together', () => {
    const r = eventsSince([at('a', 10), at('b', 10), at('c', 10)], 0)
    expect(r.events).toHaveLength(3)
    expect(r.cursor).toBe(10)
  })
})

describe('nextRefreshAt', () => {
  it('is null when nothing will change on its own', () => {
    expect(nextRefreshAt(withConfig({ mode: 'always' }), NOW)).toBeNull()
  })

  it('picks the earliest of unlock expiry, session end and schedule boundary', () => {
    const state: ExtensionState = {
      ...withConfig({ mode: 'schedule', schedule: [{ days: [3], start: '09:00', end: '17:00' }] }),
      unlocks: [{ domain: 'x.com', until: NOW + 5 * 60_000 }],
      session: { active: true, endsAt: NOW + 30 * 60_000, taskTitle: null },
    }
    expect(nextRefreshAt(state, NOW)).toBe(NOW + 5 * 60_000)
    expect(nextRefreshAt({ ...state, unlocks: [] }, NOW)).toBe(NOW + 30 * 60_000)
    expect(nextRefreshAt({ ...state, unlocks: [], session: null }, NOW)).toBe(local(2026, 8, 30, 17, 0))
  })

  it('ignores an expired unlock and an ended session', () => {
    const state: ExtensionState = {
      ...withConfig({ mode: 'focus' }),
      unlocks: [{ domain: 'x.com', until: NOW - 1 }],
      session: { active: true, endsAt: NOW - 1, taskTitle: null },
    }
    expect(nextRefreshAt(state, NOW)).toBeNull()
  })
})
