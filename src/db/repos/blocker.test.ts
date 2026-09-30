import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  BlocklistInputError,
  addAllowException,
  addBlockedDomain,
  countMissingDefaults,
  getBlockerConfig,
  listBlockEvents,
  listBlocklist,
  markBlockerSynced,
  mergeBlockEvents,
  removeBlocklistEntry,
  resetMotivationLines,
  restoreDefaultBlocklist,
  saveEventsCursor,
  seedDefaultBlocklist,
  setBlockerMode,
  setBlockerSchedule,
  setBlocklistEntryEnabled,
  setExtensionIdOverride,
  setMotivationLines,
} from '@/db/repos/blocker'
import { DEFAULT_BLOCKED_DOMAINS, DEFAULT_MOTIVATION } from '@/db/defaults'
import { ensureSettings, getSettings } from '@/db/repos/settings'
import type { BlockEvent as ExtensionEvent } from '@ext/protocol'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
})

const domains = async (kind: 'block' | 'allow' = 'block') =>
  (await listBlocklist()).filter((r) => r.kind === kind).map((r) => r.domain)

describe('seedDefaultBlocklist', () => {
  it('adds the 11 defaults once, in the brief’s order', async () => {
    expect(await seedDefaultBlocklist({ now: NOW })).toBe(11)
    expect(await domains()).toEqual([...DEFAULT_BLOCKED_DOMAINS])
    const rows = await listBlocklist()
    expect(rows.every((r) => r.enabled && r.isDefault && r.kind === 'block')).toBe(true)
    expect((await getSettings()).blocker.blocklistSeeded).toBe(true)
  })

  it('does nothing the second time, and never brings back a removed site', async () => {
    await seedDefaultBlocklist({ now: NOW })
    const youtube = (await listBlocklist()).find((r) => r.domain === 'youtube.com')
    await removeBlocklistEntry(youtube?.id ?? '')
    expect(await seedDefaultBlocklist({ now: NOW })).toBe(0)
    expect(await domains()).not.toContain('youtube.com')
    expect(await db.blocklist.count()).toBe(10)
  })

  it('does not duplicate a default the user already has', async () => {
    await addBlockedDomain('https://www.reddit.com/', { now: NOW })
    expect(await seedDefaultBlocklist({ now: NOW })).toBe(10)
    expect((await domains()).filter((d) => d === 'reddit.com')).toHaveLength(1)
  })
})

describe('restoreDefaultBlocklist', () => {
  it('puts back only the missing defaults', async () => {
    await seedDefaultBlocklist({ now: NOW })
    for (const d of ['youtube.com', 'netflix.com']) {
      const row = (await listBlocklist()).find((r) => r.domain === d)
      await removeBlocklistEntry(row?.id ?? '')
    }
    expect(await countMissingDefaults()).toBe(2)
    expect(await restoreDefaultBlocklist({ now: NOW })).toBe(2)
    expect(await countMissingDefaults()).toBe(0)
    expect((await domains()).sort()).toEqual([...DEFAULT_BLOCKED_DOMAINS].sort())
    expect(await restoreDefaultBlocklist({ now: NOW })).toBe(0)
  })

  it('leaves a switched-off default as it is', async () => {
    await seedDefaultBlocklist({ now: NOW })
    const row = (await listBlocklist()).find((r) => r.domain === 'reddit.com')
    await setBlocklistEntryEnabled(row?.id ?? '', false)
    await restoreDefaultBlocklist({ now: NOW })
    expect((await listBlocklist()).find((r) => r.domain === 'reddit.com')?.enabled).toBe(false)
  })
})

describe('addBlockedDomain', () => {
  it('stores the domain the way the extension reads it', async () => {
    const entry = await addBlockedDomain('  HTTPS://www.Khanacademy.org/math?x=1 ', { now: NOW })
    expect(entry).toMatchObject({
      kind: 'block',
      domain: 'khanacademy.org',
      pattern: null,
      enabled: true,
      isDefault: false,
    })
    expect(await domains()).toEqual(['khanacademy.org'])
  })

  it('a default domain added by hand is the default row (so restore never doubles it)', async () => {
    const entry = await addBlockedDomain('instagram.com', { now: NOW })
    expect(entry.isDefault).toBe(true)
    expect(entry.id).toBe('default:instagram.com')
    expect(await countMissingDefaults()).toBe(DEFAULT_BLOCKED_DOMAINS.length - 1)
  })

  it('rejects with a message the field can show', async () => {
    await addBlockedDomain('reddit.com', { now: NOW })
    const attempt = (raw: string) => addBlockedDomain(raw, { now: NOW }).catch((e: unknown) => e)
    const empty = await attempt('')
    expect(empty).toBeInstanceOf(BlocklistInputError)
    expect(empty).toMatchObject({ problem: 'empty' })
    expect(await attempt('nope')).toMatchObject({ problem: 'invalid' })
    expect(await attempt('WWW.Reddit.com')).toMatchObject({
      problem: 'duplicate',
      message: 'reddit.com is already on the list.',
    })
    expect(await attempt('old.reddit.com')).toMatchObject({ problem: 'covered' })
    expect(await attempt('forge-study-app.netlify.app')).toMatchObject({ problem: 'self' })
    expect(await db.blocklist.count()).toBe(1)
  })

  it('Undo removes what was just added', async () => {
    const entry = await addBlockedDomain('reddit.com', { now: NOW })
    await entry.undo()
    expect(await db.blocklist.count()).toBe(0)
  })
})

describe('allow exceptions', () => {
  it('stores host and prefix, once', async () => {
    const entry = await addAllowException('https://www.youtube.com/watch?v=aBc123#t=1', {
      now: NOW,
    })
    expect(entry).toMatchObject({
      kind: 'allow',
      domain: 'youtube.com',
      pattern: 'youtube.com/watch?v=aBc123',
      enabled: true,
    })
    await expect(addAllowException('youtube.com/watch?v=aBc123')).rejects.toMatchObject({
      problem: 'duplicate',
    })
    await addAllowException('youtube.com/@CS50', { now: NOW })
    expect(await domains('allow')).toEqual(['youtube.com', 'youtube.com'])
  })

  it('does not mix with the blocked sites', async () => {
    await addBlockedDomain('youtube.com', { now: NOW })
    await addAllowException('youtube.com/@CS50', { now: NOW })
    expect(await domains('block')).toEqual(['youtube.com'])
    // The exception's host is not a "duplicate" of the block row.
    expect(await domains('allow')).toEqual(['youtube.com'])
  })

  it('rejects wildcards', async () => {
    await expect(addAllowException('youtube.com/*')).rejects.toMatchObject({ problem: 'invalid' })
  })
})

describe('remove and toggle', () => {
  it('removes with an Undo that puts the row back once', async () => {
    const entry = await addBlockedDomain('reddit.com', { now: NOW })
    const undoable = await removeBlocklistEntry(entry.id)
    expect(await db.blocklist.count()).toBe(0)
    await undoable?.undo()
    await undoable?.undo()
    expect(await domains()).toEqual(['reddit.com'])
  })

  it('Undo does not resurrect a duplicate if the site was added again meanwhile', async () => {
    const entry = await addBlockedDomain('reddit.com', { now: NOW })
    const undoable = await removeBlocklistEntry(entry.id)
    await addBlockedDomain('reddit.com', { now: NOW })
    await undoable?.undo()
    expect(await domains()).toEqual(['reddit.com'])
  })

  it('removing something that is gone is a no-op', async () => {
    expect(await removeBlocklistEntry('nope')).toBeNull()
  })

  it('toggles a row without losing it', async () => {
    const entry = await addBlockedDomain('reddit.com', { now: NOW })
    await setBlocklistEntryEnabled(entry.id, false, { now: NOW + 1 })
    expect((await db.blocklist.get(entry.id))?.enabled).toBe(false)
    await setBlocklistEntryEnabled(entry.id, true, { now: NOW + 2 })
    expect((await db.blocklist.get(entry.id))?.enabled).toBe(true)
  })
})

describe('settings-backed edits', () => {
  it('saves the mode', async () => {
    await setBlockerMode('always')
    expect((await getSettings()).blocker.mode).toBe('always')
  })

  it('saves only valid schedule windows, days in order', async () => {
    const saved = await setBlockerSchedule([
      { days: [5, 1], start: '09:00', end: '17:00' },
      { days: [], start: '09:00', end: '17:00' },
    ])
    expect(saved).toEqual([{ days: [1, 5], start: '09:00', end: '17:00' }])
    expect((await getSettings()).blocker.schedule).toEqual(saved)
  })

  it('cleans and saves motivation lines, and restores the defaults', async () => {
    expect(await setMotivationLines(['  Keep going ', '', 'keep going', 'C182 next.'])).toEqual([
      'Keep going',
      'C182 next.',
    ])
    expect((await getSettings()).blocker.motivation).toEqual(['Keep going', 'C182 next.'])
    await resetMotivationLines()
    expect((await getSettings()).blocker.motivation).toEqual([...DEFAULT_MOTIVATION])
  })

  it('saves a valid extension id, resets on empty, rejects junk', async () => {
    expect(await setExtensionIdOverride(' ABCDEFGHIJKLMNOPabcdefghijklmnop ')).toBe(
      'abcdefghijklmnopabcdefghijklmnop',
    )
    expect((await getSettings()).blocker.extensionIdOverride).toBe(
      'abcdefghijklmnopabcdefghijklmnop',
    )
    await expect(setExtensionIdOverride('nope')).rejects.toBeInstanceOf(RangeError)
    expect((await getSettings()).blocker.extensionIdOverride).toBe(
      'abcdefghijklmnopabcdefghijklmnop',
    )
    expect(await setExtensionIdOverride('')).toBeNull()
    expect((await getSettings()).blocker.extensionIdOverride).toBeNull()
  })

  it('marks the extension as synced', async () => {
    await markBlockerSynced({ now: NOW })
    expect((await getSettings()).blocker.lastSyncedAt).toBe(NOW)
  })
})

describe('getBlockerConfig', () => {
  it('is what the extension should run: on rows, mode, schedule, lines', async () => {
    await seedDefaultBlocklist({ now: NOW })
    const reddit = (await listBlocklist()).find((r) => r.domain === 'reddit.com')
    await setBlocklistEntryEnabled(reddit?.id ?? '', false)
    await addAllowException('youtube.com/@CS50', { now: NOW })
    await setBlockerMode('schedule')
    const config = await getBlockerConfig()
    expect(config.mode).toBe('schedule')
    expect(config.blocklist).toHaveLength(10)
    expect(config.blocklist).not.toContain('reddit.com')
    expect(config.allowlist).toEqual(['youtube.com/@CS50'])
    expect(config.schedule).toEqual([{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }])
    expect(config.motivation).toEqual([...DEFAULT_MOTIVATION])
  })
})

describe('mergeBlockEvents', () => {
  const at = new Date('2026-09-29T09:41:00-04:00').getTime()
  const events: ExtensionEvent[] = [
    { id: 'a1', at, kind: 'blocked', domain: 'Instagram.com' },
    { id: 'a2', at: at + 1, kind: 'blocked', domain: 'instagram.com' },
    { id: 'u1', at: at + 2, kind: 'unlock', domain: 'reddit.com', unlockMinutes: 5 },
  ]

  it('maps blocked to attempt, keeps unlock minutes and derives the local day', async () => {
    expect(await mergeBlockEvents(events)).toBe(3)
    const rows = await listBlockEvents()
    expect(rows.map((r) => [r.id, r.kind, r.domain, r.minutes, r.day])).toEqual([
      ['a1', 'attempt', 'instagram.com', null, '2026-09-29'],
      ['a2', 'attempt', 'instagram.com', null, '2026-09-29'],
      ['u1', 'unlock', 'reddit.com', 5, '2026-09-29'],
    ])
  })

  it('is idempotent: the same events twice are the same rows', async () => {
    await mergeBlockEvents(events)
    const first = await listBlockEvents()
    expect(await mergeBlockEvents(events)).toBe(0)
    expect(await mergeBlockEvents([...events].reverse())).toBe(0)
    expect(await listBlockEvents()).toEqual(first)
    expect(await db.blockEvents.count()).toBe(3)
  })

  it('an overlapping pull only adds what is new', async () => {
    await mergeBlockEvents(events.slice(0, 2))
    expect(await mergeBlockEvents(events)).toBe(1)
    expect(await db.blockEvents.count()).toBe(3)
  })

  it('uses the local day, not UTC: 9 pm New York is still the same day', async () => {
    const night = new Date('2026-09-29T21:30:00-04:00').getTime()
    await mergeBlockEvents([{ id: 'n1', at: night, kind: 'blocked', domain: 'reddit.com' }])
    expect((await listBlockEvents())[0]?.day).toBe('2026-09-29')
  })

  it('skips malformed records and handles an empty batch', async () => {
    expect(await mergeBlockEvents([])).toBe(0)
    const junk = [
      { id: '', at, kind: 'blocked', domain: 'x.com' },
      { id: 'bad-kind', at, kind: 'nope', domain: 'x.com' },
      { id: 'no-at', kind: 'blocked', domain: 'x.com' },
    ] as unknown as ExtensionEvent[]
    expect(await mergeBlockEvents([...junk, events[0] as ExtensionEvent])).toBe(1)
    expect((await listBlockEvents()).map((r) => r.id)).toEqual(['a1'])
  })

  it('an unlock without minutes stores null', async () => {
    await mergeBlockEvents([{ id: 'u2', at, kind: 'unlock', domain: 'reddit.com' }])
    expect((await listBlockEvents())[0]?.minutes).toBeNull()
  })
})

describe('saveEventsCursor', () => {
  it('only moves forward', async () => {
    await saveEventsCursor(500)
    await saveEventsCursor(300)
    await saveEventsCursor(Number.NaN)
    expect((await getSettings()).blocker.eventsCursor).toBe(500)
    await saveEventsCursor(900)
    expect((await getSettings()).blocker.eventsCursor).toBe(900)
  })
})
