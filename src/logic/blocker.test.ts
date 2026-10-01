import { describe, expect, it } from 'vitest'
import type { BlocklistEntry } from '@/db/types'
import { isBlockerConfig } from '@ext/protocol'
import {
  buildBlockerConfig,
  checkAllowPattern,
  checkBlockDomain,
  cleanDays,
  cleanMotivationLines,
  cleanSchedule,
  describeDays,
  isValidExtensionId,
  normalizeAllowPattern,
  normalizeBlockDomain,
  parseExtensionId,
  splitPattern,
  toSessionState,
  toggleDay,
  windowProblem,
} from './blocker'

const row = (domain: string, over: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
  id: domain,
  createdAt: 0,
  updatedAt: 0,
  kind: 'block',
  domain,
  pattern: null,
  enabled: true,
  isDefault: false,
  note: null,
  ...over,
})

describe('normalizeBlockDomain', () => {
  it('strips the scheme, www, path, query and case', () => {
    expect(normalizeBlockDomain('https://www.Instagram.com/explore?x=1')).toBe('instagram.com')
    expect(normalizeBlockDomain('  WWW.Reddit.com  ')).toBe('reddit.com')
    expect(normalizeBlockDomain('twitch.tv/directory')).toBe('twitch.tv')
    expect(normalizeBlockDomain('*.pinterest.com')).toBe('pinterest.com')
    expect(normalizeBlockDomain('netflix.com:443')).toBe('netflix.com')
  })

  it('keeps other subdomains, they are a real choice', () => {
    expect(normalizeBlockDomain('m.youtube.com')).toBe('m.youtube.com')
    expect(normalizeBlockDomain('old.reddit.com')).toBe('old.reddit.com')
  })

  it('rejects what is not a site', () => {
    for (const bad of [
      '',
      '   ',
      'reddit',
      'not a site',
      'a b.com',
      'http://',
      '.com',
      'foo..com',
    ]) {
      expect(normalizeBlockDomain(bad), bad).toBeNull()
    }
  })

  it('does not strip a "www" that is the whole name', () => {
    expect(normalizeBlockDomain('www.com')).toBe('www.com')
  })
})

describe('checkBlockDomain', () => {
  const rows = [
    { domain: 'youtube.com', enabled: true },
    { domain: 'reddit.com', enabled: false },
  ]

  it('accepts a new site and returns it normalised', () => {
    expect(checkBlockDomain('https://www.tiktok.com/@x', rows)).toEqual({
      ok: true,
      value: 'tiktok.com',
    })
  })

  it('says what is wrong, in words for the field', () => {
    expect(checkBlockDomain('  ', rows)).toMatchObject({ ok: false, problem: 'empty' })
    expect(checkBlockDomain('nope', rows)).toMatchObject({ ok: false, problem: 'invalid' })
    expect(checkBlockDomain('YouTube.com', rows)).toMatchObject({
      ok: false,
      problem: 'duplicate',
      message: 'youtube.com is already on the list.',
    })
  })

  it('a repeat is caught even when its row is switched off', () => {
    expect(checkBlockDomain('reddit.com', rows)).toMatchObject({ ok: false, problem: 'duplicate' })
  })

  it('a switched-on parent covers a subdomain, a switched-off one does not', () => {
    expect(checkBlockDomain('m.youtube.com', rows)).toMatchObject({
      ok: false,
      problem: 'covered',
      message: 'youtube.com already blocks m.youtube.com.',
    })
    expect(checkBlockDomain('old.reddit.com', rows)).toEqual({ ok: true, value: 'old.reddit.com' })
  })

  it('refuses to block Forge itself or the local dev server', () => {
    expect(checkBlockDomain('forge-study-app.netlify.app', [])).toMatchObject({
      ok: false,
      problem: 'self',
    })
    expect(checkBlockDomain('netlify.app', [])).toMatchObject({ ok: false, problem: 'self' })
    expect(checkBlockDomain('sdfkdweuwpor.github.io', [])).toMatchObject({
      ok: false,
      problem: 'self',
    })
    expect(checkBlockDomain('github.io', [])).toMatchObject({ ok: false, problem: 'self' })
    expect(checkBlockDomain('http://127.0.0.1:5173', [])).toMatchObject({
      ok: false,
      problem: 'self',
    })
    expect(checkBlockDomain('localhost', [])).toMatchObject({ ok: false, problem: 'invalid' })
    // A sibling site on the same host is fine.
    expect(checkBlockDomain('other.github.io', [])).toEqual({ ok: true, value: 'other.github.io' })
    expect(checkBlockDomain('other.netlify.app', [])).toEqual({
      ok: true,
      value: 'other.netlify.app',
    })
  })

  it('does not treat a lookalike as covered (notyoutube.com is not under youtube.com)', () => {
    expect(checkBlockDomain('notyoutube.com', rows)).toEqual({ ok: true, value: 'notyoutube.com' })
  })
})

describe('allow patterns', () => {
  it('reduces an address to host + path, keeping the path as typed', () => {
    expect(normalizeAllowPattern('https://www.YouTube.com/watch?v=aBc123#t=30')).toEqual({
      domain: 'youtube.com',
      pattern: 'youtube.com/watch?v=aBc123',
    })
    expect(normalizeAllowPattern('youtube.com/@CS50')).toEqual({
      domain: 'youtube.com',
      pattern: 'youtube.com/@CS50',
    })
    expect(normalizeAllowPattern('youtube.com')).toEqual({
      domain: 'youtube.com',
      pattern: 'youtube.com',
    })
  })

  it('rejects wildcards, spaces and junk', () => {
    expect(normalizeAllowPattern('youtube.com/*')).toBeNull()
    expect(normalizeAllowPattern('you tube.com')).toBeNull()
    expect(normalizeAllowPattern('nothing')).toBeNull()
  })

  it('checkAllowPattern explains and catches repeats', () => {
    expect(checkAllowPattern('', [])).toMatchObject({ ok: false, problem: 'empty' })
    expect(checkAllowPattern('youtube.com/*', [])).toMatchObject({ ok: false, problem: 'invalid' })
    expect(checkAllowPattern('nope', [])).toMatchObject({ ok: false, problem: 'invalid' })
    expect(
      checkAllowPattern('https://www.youtube.com/@CS50', [{ pattern: 'youtube.com/@CS50' }]),
    ).toMatchObject({ ok: false, problem: 'duplicate' })
    expect(checkAllowPattern('youtube.com/@CS50', [{ pattern: 'youtube.com/@Other' }])).toEqual({
      ok: true,
      value: { domain: 'youtube.com', pattern: 'youtube.com/@CS50' },
    })
  })

  it('splits a pattern for display', () => {
    expect(splitPattern('youtube.com/watch?v=abc')).toEqual({
      host: 'youtube.com',
      path: '/watch?v=abc',
    })
    expect(splitPattern('youtube.com')).toEqual({ host: 'youtube.com', path: '' })
  })
})

describe('schedule helpers', () => {
  it('puts days in Monday-first order and toggles them', () => {
    expect(cleanDays([0, 5, 1, 1, 9])).toEqual([1, 5, 0])
    expect(toggleDay([1, 2], 3)).toEqual([1, 2, 3])
    expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3])
    expect(toggleDay([0], 6)).toEqual([6, 0])
  })

  it('names the problem with a window', () => {
    expect(windowProblem({ days: [], start: '09:00', end: '17:00' })).toBe('Pick at least one day.')
    expect(windowProblem({ days: [1], start: '', end: '17:00' })).toBe(
      'Pick a start and an end time.',
    )
    expect(windowProblem({ days: [1], start: '09:00', end: '09:00' })).toMatch(/empty/)
    expect(windowProblem({ days: [1], start: '09:00', end: '17:00' })).toBeNull()
  })

  it('an overnight window is fine', () => {
    expect(windowProblem({ days: [2], start: '22:00', end: '06:00' })).toBeNull()
  })

  it('cleanSchedule keeps valid windows and orders their days', () => {
    expect(
      cleanSchedule([
        { days: [5, 1], start: '09:00', end: '17:00' },
        { days: [], start: '09:00', end: '17:00' },
        { days: [1], start: '10:00', end: '10:00' },
      ]),
    ).toEqual([{ days: [1, 5], start: '09:00', end: '17:00' }])
  })

  it('describes days the way people say them', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(describeDays([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(describeDays([6, 0])).toBe('Sat, Sun')
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(describeDays([])).toBe('No days')
    expect(describeDays([1, 2, 3, 5, 6])).toBe('Mon–Wed, Fri, Sat')
  })
})

describe('motivation lines', () => {
  it('trims, collapses spaces, drops blanks and repeats', () => {
    expect(
      cleanMotivationLines(['  Keep   going ', '', 'keep going', 'One unit at a time.']),
    ).toEqual(['Keep going', 'One unit at a time.'])
  })

  it('cuts a line to what the extension accepts', () => {
    const [line] = cleanMotivationLines(['x'.repeat(900)])
    expect(line).toHaveLength(500)
  })
})

describe('extension id', () => {
  it('accepts 32 letters a to p', () => {
    expect(isValidExtensionId('gpinhblnpebjbiodblihfpjbffacipbd')).toBe(true)
    expect(isValidExtensionId('gpinhblnpebjbiodblihfpjbffacipbz')).toBe(false)
    expect(isValidExtensionId('short')).toBe(false)
  })

  it('empty resets to the default, junk is rejected with a message', () => {
    expect(parseExtensionId('  ')).toEqual({ ok: true, id: null })
    expect(parseExtensionId(' GPINHBLNPEBJBIODBLIHFPJBFFACIPBD ')).toEqual({
      ok: true,
      id: 'gpinhblnpebjbiodblihfpjbffacipbd',
    })
    expect(parseExtensionId('nope')).toMatchObject({ ok: false })
  })
})

describe('buildBlockerConfig', () => {
  const blocker = {
    mode: 'schedule' as const,
    schedule: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
    motivation: ['One unit at a time.', ''],
  }

  it('sends switched-on rows only, as the extension reads them', () => {
    const config = buildBlockerConfig(
      [
        row('instagram.com'),
        row('reddit.com', { enabled: false }),
        row('www.youtube.com'),
        row('m.youtube.com'),
        row('youtube.com/@CS50', {
          kind: 'allow',
          domain: 'youtube.com',
          pattern: 'https://www.youtube.com/@CS50',
        }),
        row('x.com', { kind: 'allow', domain: 'x.com', pattern: 'x.com/a', enabled: false }),
      ],
      blocker,
    )
    expect(config).toEqual({
      mode: 'schedule',
      // m.youtube.com is covered by youtube.com, the extension would drop it anyway.
      blocklist: ['instagram.com', 'youtube.com'],
      allowlist: ['youtube.com/@CS50'],
      schedule: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
      motivation: ['One unit at a time.'],
    })
    expect(isBlockerConfig(config)).toBe(true)
  })

  it('"off" is a focus-only blocker with nothing to block', () => {
    const config = buildBlockerConfig([row('instagram.com')], { ...blocker, mode: 'off' })
    expect(config.mode).toBe('focus')
    expect(config.blocklist).toEqual([])
    expect(isBlockerConfig(config)).toBe(true)
  })

  it('drops invalid schedule windows so the extension never rejects the whole sync', () => {
    const config = buildBlockerConfig([], {
      ...blocker,
      schedule: [
        { days: [], start: '09:00', end: '17:00' },
        { days: [1], start: '25:00', end: '17:00' },
        { days: [2], start: '22:00', end: '06:00' },
      ],
    })
    expect(config.schedule).toEqual([{ days: [2], start: '22:00', end: '06:00' }])
    expect(isBlockerConfig(config)).toBe(true)
  })
})

describe('toSessionState', () => {
  const base = {
    kind: 'focus' as const,
    status: 'running' as const,
    startedAt: 1_000_000,
    plannedMinutes: 25 as number | null,
    pausedMs: 0,
    pausedAt: null as number | null,
  }

  it('a running focus session ends at its planned end, plus the pauses so far', () => {
    expect(toSessionState(base, 'Read chapter 4')).toEqual({
      active: true,
      endsAt: 1_000_000 + 25 * 60_000,
      taskTitle: 'Read chapter 4',
    })
    expect(toSessionState({ ...base, pausedMs: 60_000 }, null)?.endsAt).toBe(
      1_000_000 + 26 * 60_000,
    )
  })

  it('a stopwatch has no end', () => {
    expect(toSessionState({ ...base, plannedMinutes: null }, null)).toEqual({
      active: true,
      endsAt: null,
      taskTitle: null,
    })
  })

  it('a paused focus session still blocks, with no end in sight', () => {
    expect(toSessionState({ ...base, status: 'paused', pausedAt: 1_500_000 }, 'C182')).toEqual({
      active: true,
      endsAt: null,
      taskTitle: 'C182',
    })
  })

  it('nothing to block for: no session, a break, or one that is over', () => {
    expect(toSessionState(null, null)).toBeNull()
    expect(toSessionState({ ...base, kind: 'break' }, null)).toBeNull()
    expect(toSessionState({ ...base, status: 'completed' }, null)).toBeNull()
    expect(toSessionState({ ...base, status: 'abandoned' }, null)).toBeNull()
  })

  it('cleans the task title', () => {
    expect(toSessionState(base, '  Two \n lines  ')?.taskTitle).toBe('Two lines')
    expect(toSessionState(base, '   ')?.taskTitle).toBeNull()
    expect(toSessionState(base, 'x'.repeat(900))?.taskTitle).toHaveLength(500)
  })
})
