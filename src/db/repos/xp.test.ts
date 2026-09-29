import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import { appendXpEvent, awardXp, getXpSummary, reverseXp, xpNetForKey } from '@/db/repos/xp'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'
const DAY = 24 * 60 * 60 * 1000

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  onDomainEvent('xp.changed', (e) => void events.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('appendXpEvent', () => {
  it('appends one event, derives the day from `at`, and emits xp.changed', async () => {
    const event = await appendXpEvent({
      source: 'task',
      amount: 15,
      key: 'task:a',
      refId: 'a',
      at: NOW,
    })
    expect(event).toMatchObject({
      source: 'task',
      amount: 15,
      key: 'task:a',
      refId: 'a',
      note: null,
      at: NOW,
      day: TODAY,
      createdAt: NOW,
    })
    expect(await db.xpEvents.get(event.id)).toEqual(event)
    await settleDomainEvents()
    expect(events).toEqual([{ type: 'xp.changed', day: TODAY, source: 'task', amount: 15 }])
  })

  it('refuses a zero or non-finite amount', async () => {
    await expect(appendXpEvent({ source: 'task', amount: 0, key: 'k' })).rejects.toThrow(RangeError)
    await expect(appendXpEvent({ source: 'task', amount: Number.NaN, key: 'k' })).rejects.toThrow(
      RangeError,
    )
    expect(await db.xpEvents.count()).toBe(0)
  })

  it('emits nothing when the surrounding transaction aborts', async () => {
    await expect(
      db.transaction('rw', db.xpEvents, async () => {
        await appendXpEvent({ source: 'task', amount: 10, key: 'task:x', at: NOW })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await settleDomainEvents()
    expect(events).toEqual([])
    expect(await db.xpEvents.count()).toBe(0)
  })
})

describe('awardXp', () => {
  it('is idempotent per key while the award stands', async () => {
    const first = await awardXp({
      source: 'dailyGoal',
      amount: 25,
      key: 'dailyGoal:2026-09-29',
      at: NOW,
    })
    const second = await awardXp({
      source: 'dailyGoal',
      amount: 25,
      key: 'dailyGoal:2026-09-29',
      at: NOW,
    })
    expect(first?.amount).toBe(25)
    expect(second).toBeNull()
    expect(await db.xpEvents.count()).toBe(1)
    // A different key is independent.
    expect(
      await awardXp({ source: 'dailyGoal', amount: 25, key: 'dailyGoal:2026-09-30', at: NOW }),
    ).not.toBeNull()
  })

  it('awards again once the key has been reversed', async () => {
    await awardXp({ source: 'task', amount: 15, key: 'task:a', at: NOW })
    await reverseXp('task:a', { at: NOW + 1 })
    expect(await xpNetForKey('task:a')).toBe(0)
    expect(await awardXp({ source: 'task', amount: 15, key: 'task:a', at: NOW + 2 })).not.toBeNull()
    expect(await xpNetForKey('task:a')).toBe(15)
  })

  it('ignores a zero or negative amount', async () => {
    expect(await awardXp({ source: 'task', amount: 0, key: 'k' })).toBeNull()
    expect(await awardXp({ source: 'task', amount: -5, key: 'k' })).toBeNull()
    expect(await db.xpEvents.count()).toBe(0)
  })
})

describe('reverseXp', () => {
  it('appends the negative of the standing net, on the day of the award', async () => {
    await awardXp({ source: 'task', amount: 20, key: 'task:a', refId: 'a', at: NOW - DAY })
    const reversal = await reverseXp('task:a', { at: NOW })
    expect(reversal).toMatchObject({
      source: 'task',
      amount: -20,
      key: 'task:a',
      refId: 'a',
      at: NOW,
      day: '2026-09-28',
    })
    expect(await db.xpEvents.count()).toBe(2)
    expect(await xpNetForKey('task:a')).toBe(0)
  })

  it('does nothing when there is nothing to reverse', async () => {
    expect(await reverseXp('task:never')).toBeNull()
    await awardXp({ source: 'task', amount: 20, key: 'task:a', at: NOW })
    await reverseXp('task:a')
    expect(await reverseXp('task:a')).toBeNull()
    expect(await db.xpEvents.count()).toBe(2)
  })
})

describe('getXpSummary', () => {
  it('is all zero on an empty log, at level 1', async () => {
    const summary = await getXpSummary(TODAY)
    expect(summary).toMatchObject({ lifetime: 0, spent: 0, balance: 0, today: 0 })
    expect(summary.level).toMatchObject({ level: 1, intoLevel: 0, needed: 100 })
  })

  it('separates lifetime, spending and today, and counts reversals', async () => {
    await appendXpEvent({ source: 'task', amount: 100, key: 'task:a', at: NOW - 3 * DAY })
    await appendXpEvent({ source: 'session', amount: 45, key: 'session:s', at: NOW - DAY })
    await appendXpEvent({ source: 'task', amount: 15, key: 'task:b', at: NOW })
    await appendXpEvent({ source: 'dailyGoal', amount: 25, key: 'dailyGoal:2026-09-29', at: NOW })
    await reverseXp('task:b', { at: NOW })
    await db.redemptions.bulkAdd([
      {
        id: 'r1',
        rewardId: 'x',
        rewardTitle: 'Takeout',
        price: 60,
        at: NOW,
        day: TODAY,
        refundedAt: null,
      },
      {
        id: 'r2',
        rewardId: 'x',
        rewardTitle: 'Takeout',
        price: 60,
        at: NOW,
        day: TODAY,
        refundedAt: NOW,
      },
    ])

    const summary = await getXpSummary(TODAY)
    expect(summary.lifetime).toBe(100 + 45 + 25)
    expect(summary.spent).toBe(60)
    expect(summary.balance).toBe(170 - 60)
    // Today: +15 (task b) −15 (reversed) +25 (daily goal).
    expect(summary.today).toBe(25)
    expect(summary.level.level).toBe(2)
    expect(summary.level.intoLevel).toBe(70)
  })
})
