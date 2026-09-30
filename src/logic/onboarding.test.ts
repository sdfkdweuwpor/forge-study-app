import { describe, expect, it } from 'vitest'
import {
  addChip,
  checkNewSite,
  choiceTemplate,
  cleanName,
  clampDailyGoal,
  focusHint,
  gateDecision,
  initialChips,
  isEmptyPlan,
  isSyncSetupPath,
  isWelcomePath,
  nextStep,
  planBlocklist,
  previousStep,
  selectedDomains,
  toggleChip,
  type GateInput,
} from './onboarding'

const DEFAULTS = ['instagram.com', 'tiktok.com', 'youtube.com'] as const

const row = (
  domain: string,
  over: Partial<{ enabled: boolean; kind: 'block' | 'allow' }> = {},
) => ({
  id: `row-${domain}`,
  kind: over.kind ?? 'block',
  domain,
  enabled: over.enabled ?? true,
})

const base: GateInput = { onboardedAt: null, hasData: false, pathname: '/', bypass: false }

describe('gateDecision', () => {
  it('waits until settings are known', () => {
    expect(gateDecision({ ...base, onboardedAt: undefined })).toBe('wait')
  })

  it('lets an onboarded person through wherever they are', () => {
    expect(gateDecision({ ...base, onboardedAt: 1_700_000_000_000, hasData: false })).toBe('pass')
    expect(gateDecision({ ...base, onboardedAt: 1_700_000_000_000, pathname: '/welcome' })).toBe(
      'pass',
    )
  })

  it('does not even look for data once onboarded', () => {
    expect(gateDecision({ ...base, onboardedAt: 5, hasData: undefined })).toBe('pass')
  })

  it('waits for the data check on a first launch', () => {
    expect(gateDecision({ ...base, hasData: undefined })).toBe('wait')
  })

  it('sends a first launch on an empty database to the welcome page', () => {
    expect(gateDecision(base)).toBe('redirect')
    expect(gateDecision({ ...base, pathname: '/tasks/inbox' })).toBe('redirect')
    expect(gateDecision({ ...base, pathname: '/goals/new' })).toBe('redirect')
  })

  it('keeps someone who is already on the welcome page there', () => {
    expect(gateDecision({ ...base, pathname: '/welcome' })).toBe('pass')
    expect(gateDecision({ ...base, pathname: '/welcome/' })).toBe('pass')
  })

  it('lets a first launch stay on Settings, Sync, so a phone can set up sync before any data exists', () => {
    expect(gateDecision({ ...base, pathname: '/settings/sync' })).toBe('pass')
    expect(gateDecision({ ...base, pathname: '/settings/sync/' })).toBe('pass')
    expect(gateDecision({ ...base, pathname: '/settings/data' })).toBe('redirect')
    // Nothing is marked while the first sync brings the data in.
    expect(gateDecision({ ...base, hasData: true, pathname: '/settings/sync' })).toBe('pass')
  })

  it('marks a person with existing data as onboarded without showing the flow', () => {
    expect(gateDecision({ ...base, hasData: true })).toBe('mark')
    expect(gateDecision({ ...base, hasData: true, pathname: '/goals' })).toBe('mark')
  })

  it('does not mark or redirect on the welcome page itself, data or not', () => {
    expect(gateDecision({ ...base, hasData: true, pathname: '/welcome' })).toBe('pass')
  })

  it('a test-build bypass wins over everything', () => {
    expect(gateDecision({ ...base, bypass: true })).toBe('pass')
    expect(gateDecision({ ...base, onboardedAt: undefined, bypass: true })).toBe('pass')
  })

  it('recognises only the welcome path', () => {
    expect(isWelcomePath('/welcome')).toBe(true)
    expect(isWelcomePath('/welcome/')).toBe(true)
    expect(isWelcomePath('/welcomed')).toBe(false)
    expect(isWelcomePath('/')).toBe(false)
  })
})

describe('steps', () => {
  it('moves forward and back inside the four steps', () => {
    expect(nextStep(0)).toBe(1)
    expect(nextStep(2)).toBe(3)
    expect(nextStep(3)).toBeNull()
    expect(previousStep(3)).toBe(2)
    expect(previousStep(0)).toBeNull()
  })
})

describe('name and daily goal', () => {
  it('cleans a name', () => {
    expect(cleanName('  Maya   Chen ')).toBe('Maya Chen')
    expect(cleanName('   ')).toBe('')
    expect(cleanName('x'.repeat(80))).toHaveLength(40)
  })

  it('keeps the daily goal in range and falls back to 6', () => {
    expect(clampDailyGoal(6)).toBe(6)
    expect(clampDailyGoal(0)).toBe(1)
    expect(clampDailyGoal(99)).toBe(16)
    expect(clampDailyGoal(3.6)).toBe(4)
    expect(clampDailyGoal(Number.NaN)).toBe(6)
  })

  it('says what a day of pomodoros adds up to', () => {
    expect(focusHint(6, 25)).toBe('≈ 2.5 h of focus')
    expect(focusHint(8, 25)).toBe('≈ 3.3 h of focus')
    expect(focusHint(4, 25)).toBe('≈ 1.7 h of focus')
    expect(focusHint(2, 30)).toBe('≈ 1 h of focus')
    expect(focusHint(1, 25)).toBe('≈ 25 min of focus')
    expect(focusHint(2, 25)).toBe('≈ 50 min of focus')
  })
})

describe('site chips', () => {
  it('lists the defaults first, picked when they are on the list and switched on', () => {
    const chips = initialChips(
      [row('instagram.com'), row('youtube.com', { enabled: false }), row('khanacademy.org')],
      DEFAULTS,
    )
    expect(chips).toEqual([
      { domain: 'instagram.com', selected: true, custom: false },
      { domain: 'tiktok.com', selected: false, custom: false },
      { domain: 'youtube.com', selected: false, custom: false },
      { domain: 'khanacademy.org', selected: true, custom: true },
    ])
  })

  it('ignores allowlist exceptions', () => {
    const chips = initialChips([row('youtube.com', { kind: 'allow' })], DEFAULTS)
    expect(chips.every((c) => !c.selected)).toBe(true)
    expect(chips).toHaveLength(3)
  })

  it('toggles one chip', () => {
    const chips = initialChips([row('instagram.com')], DEFAULTS)
    const next = toggleChip(chips, 'instagram.com')
    expect(selectedDomains(next)).toEqual([])
    expect(selectedDomains(toggleChip(next, 'tiktok.com'))).toEqual(['tiktok.com'])
  })
})

describe('adding a site', () => {
  const chips = initialChips([row('instagram.com'), row('tiktok.com')], DEFAULTS)

  it('takes a full address and keeps the domain', () => {
    expect(checkNewSite('https://www.Reddit.com/r/wgu', chips)).toEqual({
      kind: 'add',
      domain: 'reddit.com',
    })
  })

  it('picks a switched-off chip again instead of adding a repeat', () => {
    expect(checkNewSite('youtube.com', chips)).toEqual({ kind: 'select', domain: 'youtube.com' })
  })

  it('explains a site that is already picked', () => {
    const result = checkNewSite('instagram.com', chips)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/already on the list/)
  })

  it('explains empty and unusable input', () => {
    expect(checkNewSite('   ', chips).kind).toBe('error')
    expect(checkNewSite('not a site', chips).kind).toBe('error')
  })

  it('refuses a site that would block Forge itself', () => {
    const result = checkNewSite('localhost', chips)
    expect(result.kind).toBe('error')
  })

  it('says when a picked site already covers the typed one', () => {
    const result = checkNewSite('music.tiktok.com', chips)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/tiktok\.com already blocks/)
  })

  it('appends a new custom chip, picked, or re-picks an existing one', () => {
    const added = addChip(chips, { kind: 'add', domain: 'reddit.com' })
    expect(added.at(-1)).toEqual({ domain: 'reddit.com', selected: true, custom: true })
    const repicked = addChip(chips, { kind: 'select', domain: 'youtube.com' })
    expect(repicked.find((c) => c.domain === 'youtube.com')?.selected).toBe(true)
    expect(addChip(chips, { kind: 'error', message: 'no' })).toEqual(chips)
  })
})

describe('planBlocklist', () => {
  it('leaves a list alone when the picks match it', () => {
    const rows = [row('instagram.com'), row('tiktok.com'), row('youtube.com')]
    const plan = planBlocklist(rows, initialChips(rows, DEFAULTS))
    expect(isEmptyPlan(plan)).toBe(true)
  })

  it('removes what was switched off, adds what is new, and switches back on what is picked', () => {
    const rows = [row('instagram.com'), row('tiktok.com', { enabled: false }), row('youtube.com')]
    let chips = initialChips(rows, DEFAULTS)
    chips = toggleChip(chips, 'youtube.com') // off
    chips = toggleChip(chips, 'tiktok.com') // on
    chips = addChip(chips, { kind: 'add', domain: 'reddit.com' })
    expect(planBlocklist(rows, chips)).toEqual({
      add: ['reddit.com'],
      remove: ['row-youtube.com'],
      enable: ['row-tiktok.com'],
    })
  })

  it('adds a default that is missing from the list when it is picked', () => {
    const chips = toggleChip(initialChips([], DEFAULTS), 'instagram.com')
    expect(planBlocklist([], chips)).toEqual({ add: ['instagram.com'], remove: [], enable: [] })
  })

  it('never touches allowlist exceptions', () => {
    const rows = [row('youtube.com', { kind: 'allow' }), row('instagram.com')]
    const chips = toggleChip(initialChips(rows, DEFAULTS), 'instagram.com')
    expect(planBlocklist(rows, chips)).toEqual({
      add: [],
      remove: ['row-instagram.com'],
      enable: [],
    })
  })

  it('is the empty plan once it has been applied', () => {
    const before = [row('instagram.com'), row('tiktok.com'), row('youtube.com')]
    let chips = initialChips(before, DEFAULTS)
    chips = toggleChip(chips, 'tiktok.com')
    const plan = planBlocklist(before, chips)
    const after = before.filter((r) => !plan.remove.includes(r.id))
    expect(isEmptyPlan(planBlocklist(after, chips))).toBe(true)
  })
})

describe('first goal', () => {
  it('maps the WGU choice to the planner template and nothing else', () => {
    expect(choiceTemplate('wgu')).toBe('wgu-term')
    expect(choiceTemplate('other')).toBeNull()
    expect(choiceTemplate('none')).toBeNull()
  })
})

describe('isSyncSetupPath', () => {
  it('is the Sync section and nothing else', () => {
    expect(isSyncSetupPath('/settings/sync')).toBe(true)
    expect(isSyncSetupPath('/settings/sync/')).toBe(true)
    expect(isSyncSetupPath('/settings')).toBe(false)
    expect(isSyncSetupPath('/settings/synchronise')).toBe(false)
    expect(isSyncSetupPath('/welcome')).toBe(false)
  })
})
