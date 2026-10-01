import { beforeEach, describe, expect, it } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { DEFAULT_BLOCKED_DOMAINS } from '@/db/defaults'
import { listBlocklist } from '@/db/repos/blocker'
import { ensureSettings, getSettings } from '@/db/repos/settings'
import { initialChips, toggleChip, addChip } from '@/logic/onboarding'
import {
  addStarterTasks,
  finishOnboarding,
  loadBlocklist,
  markOnboarded,
  saveBlocklist,
  saveProfile,
} from './actions'
import { hasStarterTasks, hasUserData } from './queries'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
})

const blocked = async () =>
  (await listBlocklist()).filter((r) => r.kind === 'block' && r.enabled).map((r) => r.domain)

describe('saveProfile', () => {
  it('stores a cleaned name and a daily goal in range', async () => {
    await saveProfile({ name: '  Maya   Chen ', dailyGoal: 8 })
    const settings = await getSettings()
    expect(settings.profile.name).toBe('Maya Chen')
    expect(settings.dailyGoalPomodoros).toBe(8)
    await saveProfile({ name: '', dailyGoal: 99 })
    expect((await getSettings()).profile.name).toBe('')
    expect((await getSettings()).dailyGoalPomodoros).toBe(16)
  })
})

describe('the blocklist step', () => {
  it('loads the eleven defaults, adding them when nothing has yet', async () => {
    const rows = await loadBlocklist()
    expect(rows.map((r) => r.domain)).toEqual([...DEFAULT_BLOCKED_DOMAINS])
    expect(await loadBlocklist()).toHaveLength(11)
  })

  it('makes the list match the chips: removes what was switched off, adds what is new', async () => {
    let chips = initialChips(await loadBlocklist(), DEFAULT_BLOCKED_DOMAINS)
    chips = toggleChip(chips, 'twitch.tv')
    chips = toggleChip(chips, 'pinterest.com')
    chips = addChip(chips, { kind: 'add', domain: 'discord.com' })
    await saveBlocklist(chips)
    const domains = await blocked()
    expect(domains).toHaveLength(10)
    expect(domains).toContain('discord.com')
    expect(domains).not.toContain('twitch.tv')
    expect(domains).not.toContain('pinterest.com')
  })

  it('does the same thing twice without duplicating anything', async () => {
    let chips = initialChips(await loadBlocklist(), DEFAULT_BLOCKED_DOMAINS)
    chips = addChip(chips, { kind: 'add', domain: 'discord.com' })
    await saveBlocklist(chips)
    const once = await listBlocklist()
    await saveBlocklist(chips)
    expect(await listBlocklist()).toEqual(once)
  })

  it('shows a replay what is on the list now, custom sites included', async () => {
    let chips = initialChips(await loadBlocklist(), DEFAULT_BLOCKED_DOMAINS)
    chips = toggleChip(chips, 'reddit.com')
    chips = addChip(chips, { kind: 'add', domain: 'discord.com' })
    await saveBlocklist(chips)
    const again = initialChips(await loadBlocklist(), DEFAULT_BLOCKED_DOMAINS)
    expect(again.find((c) => c.domain === 'reddit.com')?.selected).toBe(false)
    expect(again.find((c) => c.domain === 'discord.com')).toEqual({
      domain: 'discord.com',
      selected: true,
      custom: true,
    })
  })
})

describe('starter tasks', () => {
  it('adds the three tasks once', async () => {
    expect(await hasStarterTasks()).toBe(false)
    expect(await addStarterTasks(TODAY, NOW)).toBe(3)
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(3)
    expect(tasks.every((t) => t.source === 'onboarding' && t.status === 'todo')).toBe(true)
    expect(tasks.map((t) => t.doDate).sort()).toEqual([TODAY, TODAY, '2026-09-30'])
    expect(await addStarterTasks(TODAY, NOW + 1000)).toBe(0)
    expect(await db.tasks.count()).toBe(3)
  })

  it('does not add them again after one was finished or deleted', async () => {
    await addStarterTasks(TODAY, NOW)
    const [first] = await db.tasks.toArray()
    await db.tasks.update(first?.id ?? '', { status: 'done' })
    expect(await addStarterTasks(TODAY, NOW)).toBe(0)
    expect(await db.tasks.count()).toBe(3)
  })
})

describe('finishOnboarding', () => {
  it('on the first run adds the starter tasks and records the date', async () => {
    expect(await hasUserData()).toBe(false)
    const result = await finishOnboarding({ firstRun: true, today: TODAY, now: NOW })
    expect(result.starterTasks).toBe(3)
    expect((await getSettings()).onboardedAt).toBe(NOW)
    expect(await hasUserData()).toBe(true)
  })

  it('running it again changes nothing', async () => {
    await finishOnboarding({ firstRun: true, today: TODAY, now: NOW })
    const result = await finishOnboarding({ firstRun: true, today: TODAY, now: NOW + 60_000 })
    expect(result.starterTasks).toBe(0)
    expect(await db.tasks.count()).toBe(3)
    expect((await getSettings()).onboardedAt).toBe(NOW)
  })

  it('a replay adds no tasks and keeps the first date', async () => {
    await markOnboarded(NOW)
    const result = await finishOnboarding({ firstRun: false, today: TODAY, now: NOW + 86_400_000 })
    expect(result.starterTasks).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    expect((await getSettings()).onboardedAt).toBe(NOW)
  })
})

describe('markOnboarded', () => {
  it('only sets the date while it is empty', async () => {
    await markOnboarded(NOW)
    await markOnboarded(NOW + 5)
    expect((await getSettings()).onboardedAt).toBe(NOW)
  })
})

describe('hasUserData', () => {
  it('is true for a task and false for an empty database', async () => {
    expect(await hasUserData()).toBe(false)
    await addStarterTasks(TODAY, NOW)
    expect(await hasUserData()).toBe(true)
  })
})
