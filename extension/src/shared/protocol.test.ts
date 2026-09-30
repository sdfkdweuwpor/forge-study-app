import { describe, expect, it } from 'vitest'
import {
  isAppMessage,
  isBlockEvent,
  isBlockerConfig,
  isScheduleWindow,
  isSessionState,
  isTimeOfDay,
  LIMITS,
  PROTOCOL_VERSION,
} from './protocol.js'

const config = {
  mode: 'schedule',
  blocklist: ['instagram.com', 'youtube.com'],
  allowlist: ['youtube.com/watch?v=abc'],
  schedule: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
  motivation: ['C182 will not study itself.'],
}

describe('isAppMessage', () => {
  it('accepts every message type in its documented shape', () => {
    expect(isAppMessage({ v: PROTOCOL_VERSION, type: 'ping' })).toBe(true)
    expect(isAppMessage({ v: 1, type: 'sync', config })).toBe(true)
    expect(isAppMessage({ v: 1, type: 'session', session: null })).toBe(true)
    expect(
      isAppMessage({
        v: 1,
        type: 'session',
        session: { active: true, endsAt: 1_700_000_000_000, taskTitle: 'C182 Unit 3 practice' },
      }),
    ).toBe(true)
    expect(
      isAppMessage({
        v: 1,
        type: 'session',
        session: { active: false, endsAt: null, taskTitle: null },
      }),
    ).toBe(true)
    expect(isAppMessage({ v: 1, type: 'getEvents', since: 0 })).toBe(true)
  })

  it('rejects the wrong version, unknown types and non-objects', () => {
    expect(isAppMessage({ v: 2, type: 'ping' })).toBe(false)
    expect(isAppMessage({ type: 'ping' })).toBe(false)
    expect(isAppMessage({ v: 1, type: 'unknown_type' })).toBe(false)
    expect(isAppMessage(null)).toBe(false)
    expect(isAppMessage(undefined)).toBe(false)
    expect(isAppMessage('ping')).toBe(false)
    expect(isAppMessage(123)).toBe(false)
    expect(isAppMessage([])).toBe(false)
  })

  it('rejects a sync whose config is malformed, so it cannot corrupt storage', () => {
    const sync = (c: unknown) => ({ v: 1, type: 'sync', config: c })
    expect(isAppMessage(sync(undefined))).toBe(false)
    expect(isAppMessage(sync(null))).toBe(false)
    expect(isAppMessage(sync({ ...config, mode: 'sometimes' }))).toBe(false)
    expect(isAppMessage(sync({ ...config, blocklist: 'instagram.com' }))).toBe(false)
    expect(isAppMessage(sync({ ...config, blocklist: ['instagram.com', 7] }))).toBe(false)
    expect(isAppMessage(sync({ ...config, allowlist: [null] }))).toBe(false)
    expect(isAppMessage(sync({ ...config, motivation: [{ text: 'hi' }] }))).toBe(false)
    expect(isAppMessage(sync({ ...config, schedule: 'always' }))).toBe(false)
    expect(isAppMessage(sync({ ...config, schedule: [{ days: [7], start: '09:00', end: '17:00' }] }))).toBe(false)
    const { motivation: _omitted, ...withoutMotivation } = config
    expect(isAppMessage(sync(withoutMotivation))).toBe(false)
  })

  it('rejects a session with the wrong field types', () => {
    const session = (s: unknown) => ({ v: 1, type: 'session', session: s })
    expect(isAppMessage(session(undefined))).toBe(false)
    expect(isAppMessage(session({ active: 'yes', endsAt: null, taskTitle: null }))).toBe(false)
    expect(isAppMessage(session({ active: true, endsAt: '123', taskTitle: null }))).toBe(false)
    expect(isAppMessage(session({ active: true, endsAt: Number.NaN, taskTitle: null }))).toBe(false)
    expect(isAppMessage(session({ active: true, endsAt: null, taskTitle: 5 }))).toBe(false)
    expect(isAppMessage(session({ active: true, endsAt: null }))).toBe(false)
  })

  it('requires `since` to be a non-negative finite number', () => {
    expect(isAppMessage({ v: 1, type: 'getEvents', since: '0' })).toBe(false)
    expect(isAppMessage({ v: 1, type: 'getEvents', since: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isAppMessage({ v: 1, type: 'getEvents', since: -1 })).toBe(false)
    expect(isAppMessage({ v: 1, type: 'getEvents' })).toBe(false)
  })
})

describe('isBlockerConfig', () => {
  it('accepts empty lists and all three modes', () => {
    for (const mode of ['focus', 'schedule', 'always']) {
      expect(isBlockerConfig({ mode, blocklist: [], allowlist: [], schedule: [], motivation: [] })).toBe(true)
    }
  })

  it('caps list sizes', () => {
    const tooMany = Array.from({ length: LIMITS.blocklist + 1 }, (_, i) => `site${i}.com`)
    expect(isBlockerConfig({ ...config, blocklist: tooMany })).toBe(false)
    expect(isBlockerConfig({ ...config, blocklist: ['x'.repeat(LIMITS.entryLength + 1)] })).toBe(false)
  })
})

describe('isScheduleWindow', () => {
  it('validates days 0-6 and HH:mm times', () => {
    expect(isScheduleWindow({ days: [0, 6], start: '00:00', end: '23:59' })).toBe(true)
    expect(isScheduleWindow({ days: [], start: '09:00', end: '17:00' })).toBe(true)
    expect(isScheduleWindow({ days: [-1], start: '09:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [7], start: '09:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [1.5], start: '09:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: ['1'], start: '09:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [1], start: '9:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [1], start: '24:00', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [1], start: '09:60', end: '17:00' })).toBe(false)
    expect(isScheduleWindow({ days: [1], start: '09:00' })).toBe(false)
  })

  it('isTimeOfDay is strict about the format', () => {
    expect(isTimeOfDay('07:05')).toBe(true)
    expect(isTimeOfDay('7:05')).toBe(false)
    expect(isTimeOfDay('07:05:00')).toBe(false)
    expect(isTimeOfDay(705)).toBe(false)
  })
})

describe('isSessionState / isBlockEvent', () => {
  it('accepts a session and rejects extra-type junk', () => {
    expect(isSessionState({ active: true, endsAt: 5, taskTitle: 'x' })).toBe(true)
    expect(isSessionState([])).toBe(false)
    expect(isSessionState(null)).toBe(false)
  })

  it('validates events, including the optional unlockMinutes', () => {
    expect(isBlockEvent({ id: 'e1', at: 10, kind: 'blocked', domain: 'x.com' })).toBe(true)
    expect(isBlockEvent({ id: 'e2', at: 10, kind: 'unlock', domain: 'x.com', unlockMinutes: 5 })).toBe(true)
    expect(isBlockEvent({ id: '', at: 10, kind: 'blocked', domain: 'x.com' })).toBe(false)
    expect(isBlockEvent({ id: 'e3', at: 10, kind: 'visited', domain: 'x.com' })).toBe(false)
    expect(isBlockEvent({ id: 'e4', at: '10', kind: 'blocked', domain: 'x.com' })).toBe(false)
    expect(isBlockEvent({ id: 'e5', at: 10, kind: 'unlock', domain: 'x.com', unlockMinutes: '5' })).toBe(false)
  })
})
