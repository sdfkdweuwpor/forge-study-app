import { describe, expect, it } from 'vitest'
import { defaultState, type ExtensionState } from '../shared/state.js'
import { ALLOW_PRIORITY, buildRules, REDIRECT_PRIORITY } from './rules.js'

const EXT_URL = 'chrome-extension://gpinhblnpebjbiodblihfpjbffacipbd/'
const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo, d, h, mi).getTime()
const NOW = local(2026, 8, 30, 12, 0) // Wed Sep 30 2026, noon

function state(
  patch: Partial<ExtensionState['config']> = {},
  rest: Partial<ExtensionState> = {},
): ExtensionState {
  const base = defaultState()
  return {
    ...base,
    config: {
      ...base.config,
      mode: 'always',
      blocklist: ['x.com', 'reddit.com'],
      allowlist: ['reddit.com/r/productivity'],
      ...patch,
    },
    ...rest,
  }
}

const redirects = (rules: chrome.declarativeNetRequest.Rule[]) =>
  rules.filter((r) => r.action.type === 'redirect')
const allows = (rules: chrome.declarativeNetRequest.Rule[]) =>
  rules.filter((r) => r.action.type === 'allow')

describe('buildRules: shape', () => {
  it('runs without a `chrome` global', () => {
    expect(typeof (globalThis as { chrome?: unknown }).chrome).toBe('undefined')
    expect(() => buildRules(state(), NOW, EXT_URL)).not.toThrow()
  })

  it('builds one main-frame redirect per domain and one allow rule per prefix in always mode', () => {
    const rules = buildRules(state(), NOW, EXT_URL)
    expect(rules).toHaveLength(3)
    expect(redirects(rules)).toHaveLength(2)
    expect(allows(rules)).toHaveLength(1)
    for (const r of rules) expect(r.condition.resourceTypes).toEqual(['main_frame'])
  })

  it('redirects by requestDomains, so subdomains match, and gives every rule a unique id', () => {
    const rules = buildRules(state(), NOW, EXT_URL)
    expect(redirects(rules).map((r) => r.condition.requestDomains)).toEqual([
      ['x.com'],
      ['reddit.com'],
    ])
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length)
    expect(rules.every((r) => r.id >= 1)).toBe(true)
  })

  it('puts the original URL in the fragment, unencoded, so & and # cannot truncate it', () => {
    const [xRule] = redirects(buildRules(state(), NOW, EXT_URL))
    const substitution = xRule?.action.redirect?.regexSubstitution
    expect(substitution).toBe(`${EXT_URL}blocked.html?site=x.com#\\0`)
    expect(substitution).not.toContain('&url=')
    expect(xRule?.condition.regexFilter).toBe('^https?://.*')
  })

  it('allow rules outrank redirects and match by URL prefix', () => {
    const rules = buildRules(state(), NOW, EXT_URL)
    const allow = allows(rules)[0]
    expect(allow?.priority).toBe(ALLOW_PRIORITY)
    expect(allow?.condition.urlFilter).toBe('||reddit.com/r/productivity')
    expect(ALLOW_PRIORITY).toBeGreaterThan(REDIRECT_PRIORITY)
    expect(redirects(rules).every((r) => r.priority === REDIRECT_PRIORITY)).toBe(true)
  })

  it('normalizes entries: skips invalid and duplicate domains and unsafe allow prefixes', () => {
    const rules = buildRules(
      state({
        blocklist: ['X.com', 'x.com', 'not a domain', 'm.youtube.com', 'youtube.com'],
        allowlist: ['youtube.com/watch?v=abc', 'youtube.com/watch?v=abc', 'youtube.com/*', ''],
      }),
      NOW,
      EXT_URL,
    )
    expect(redirects(rules).map((r) => r.condition.requestDomains)).toEqual([
      ['x.com'],
      ['youtube.com'],
    ])
    expect(allows(rules).map((r) => r.condition.urlFilter)).toEqual(['||youtube.com/watch?v=abc'])
  })

  it('builds nothing for empty lists', () => {
    expect(buildRules(state({ blocklist: [], allowlist: [] }), NOW, EXT_URL)).toEqual([])
  })
})

describe('buildRules: focus mode', () => {
  const focus = (session: ExtensionState['session']) => state({ mode: 'focus' }, { session })

  it('builds no rules with no session or an inactive one', () => {
    expect(buildRules(focus(null), NOW, EXT_URL)).toEqual([])
    expect(
      buildRules(focus({ active: false, endsAt: null, taskTitle: null }), NOW, EXT_URL),
    ).toEqual([])
  })

  it('builds rules while a session is active and has time left', () => {
    const session = { active: true, endsAt: NOW + 60_000, taskTitle: 'C182 Unit 3 practice' }
    expect(buildRules(focus(session), NOW, EXT_URL).length).toBeGreaterThan(0)
  })

  it('builds rules for an open-ended active session (endsAt null)', () => {
    expect(
      buildRules(focus({ active: true, endsAt: null, taskTitle: null }), NOW, EXT_URL).length,
    ).toBeGreaterThan(0)
  })

  it('unblocks once endsAt has passed, even if the app never sent `session: null`', () => {
    const session = { active: true, endsAt: NOW - 1, taskTitle: 'C182 Unit 3 practice' }
    expect(buildRules(focus(session), NOW, EXT_URL)).toEqual([])
    expect(buildRules(focus({ ...session, endsAt: NOW }), NOW, EXT_URL)).toEqual([]) // ends exactly now
    expect(buildRules(focus({ ...session, endsAt: NOW + 1 }), NOW, EXT_URL).length).toBeGreaterThan(
      0,
    )
  })
})

describe('buildRules: schedule mode', () => {
  const schedule = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }]

  it('blocks inside a window and not outside it', () => {
    expect(buildRules(state({ mode: 'schedule', schedule }), NOW, EXT_URL).length).toBeGreaterThan(
      0,
    )
    expect(
      buildRules(state({ mode: 'schedule', schedule }), local(2026, 8, 30, 18, 0), EXT_URL),
    ).toEqual([])
    expect(
      buildRules(state({ mode: 'schedule', schedule }), local(2026, 9, 3, 12, 0), EXT_URL),
    ).toEqual([]) // Saturday
  })

  it('an overnight window blocks after midnight under the previous day', () => {
    const night = state({
      mode: 'schedule',
      schedule: [{ days: [2], start: '22:00', end: '06:00' }],
    })
    expect(buildRules(night, local(2026, 8, 30, 4, 30), EXT_URL).length).toBeGreaterThan(0) // Wed 04:30
    expect(buildRules(night, local(2026, 8, 29, 4, 30), EXT_URL)).toEqual([]) // Tue 04:30
  })

  it('an empty schedule never blocks', () => {
    expect(buildRules(state({ mode: 'schedule', schedule: [] }), NOW, EXT_URL)).toEqual([])
  })
})

describe('buildRules: emergency unlocks', () => {
  it('skips the redirect for an unlocked domain only, and only while the unlock lasts', () => {
    const s = state({}, { unlocks: [{ domain: 'x.com', until: NOW + 5000 }] })
    const domains = (t: number) =>
      redirects(buildRules(s, t, EXT_URL)).map((r) => r.condition.requestDomains?.[0])
    expect(domains(NOW)).toEqual(['reddit.com'])
    expect(domains(NOW + 4999)).toEqual(['reddit.com'])
    expect(domains(NOW + 5000)).toEqual(['x.com', 'reddit.com']) // expired: blocked again
  })

  it('keeps the allow rules while a domain is unlocked', () => {
    const s = state({}, { unlocks: [{ domain: 'reddit.com', until: NOW + 5000 }] })
    expect(allows(buildRules(s, NOW, EXT_URL))).toHaveLength(1)
  })
})
