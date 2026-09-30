import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  InsufficientXpError,
  RewardUnavailableError,
  STARTER_REWARDS,
  archiveReward,
  createReward,
  listRedemptions,
  listRewards,
  listShopRewards,
  redeemReward,
  refundRedemption,
  reorderRewards,
  seedStarterRewards,
  unarchiveReward,
  updateReward,
} from '@/db/repos/rewards'
import { ensureSettings, getSettings } from '@/db/repos/settings'
import { appendXpEvent, getXpSummary } from '@/db/repos/xp'
import { levelFromLifetimeXp } from '@/logic/xp'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'
const MIN = 60_000

let emitted: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  emitted = []
  onDomainEvent('redemption.changed', (e) => void emitted.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

/** Gives the user `amount` lifetime XP in one event. */
async function earn(amount: number, key = `test:${amount}:${Math.random()}`): Promise<void> {
  await appendXpEvent({ source: 'task', amount, key, at: NOW - 60 * MIN })
}

describe('createReward', () => {
  it('adds a reward at the end with a cleaned title', async () => {
    const a = await createReward(
      { title: '  30 min   gaming ', price: 300, icon: '🎮' },
      { now: NOW },
    )
    const b = await createReward({ title: 'Order takeout', price: 1500 }, { now: NOW })
    expect(a).toMatchObject({
      title: '30 min gaming',
      price: 300,
      icon: '🎮',
      archived: false,
      createdAt: NOW,
    })
    expect(b.icon).toBe('🎁')
    expect(b.order).toBeGreaterThan(a.order)
    expect((await listRewards()).map((r) => r.title)).toEqual(['30 min gaming', 'Order takeout'])
  })

  it('refuses an empty title and a price that is not whole XP from 1', async () => {
    await expect(createReward({ title: '   ', price: 100 })).rejects.toThrow(RangeError)
    await expect(createReward({ title: 'x', price: 0 })).rejects.toThrow(RangeError)
    await expect(createReward({ title: 'x', price: 12.5 })).rejects.toThrow(RangeError)
    await expect(createReward({ title: 'x', price: -1 })).rejects.toThrow(RangeError)
    expect(await db.rewards.count()).toBe(0)
  })
})

describe('updateReward', () => {
  it('edits title, price and icon, and does not rewrite history', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500, icon: '☕' }, { now: NOW })
    await earn(1000)
    const { redemption } = await redeemReward(r.id, NOW)

    const updated = await updateReward(
      r.id,
      { title: 'Café date', price: 800, icon: '🥐' },
      { now: NOW + 1 },
    )
    expect(updated).toMatchObject({
      title: 'Café date',
      price: 800,
      icon: '🥐',
      updatedAt: NOW + 1,
    })

    const stored = (await listRedemptions())[0]
    expect(stored).toMatchObject({ id: redemption.id, rewardTitle: 'Coffee out', price: 500 })
  })

  it('writes nothing when nothing changed', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 }, { now: NOW })
    const same = await updateReward(r.id, { title: 'Coffee out', price: 500 }, { now: NOW + 5 })
    expect(same.updatedAt).toBe(NOW)
  })

  it('rejects a bad edit and a missing reward', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await expect(updateReward(r.id, { title: ' ' })).rejects.toThrow(RangeError)
    await expect(updateReward(r.id, { price: 0 })).rejects.toThrow(RangeError)
    await expect(updateReward('nope', { title: 'x' })).rejects.toBeInstanceOf(
      RewardUnavailableError,
    )
    expect((await listRewards())[0]).toMatchObject({ title: 'Coffee out', price: 500 })
  })
})

describe('archiveReward', () => {
  it('takes a reward off the shop, keeps the row, and can be undone in place', async () => {
    const a = await createReward({ title: 'A', price: 100 })
    const b = await createReward({ title: 'B', price: 100 })
    const c = await createReward({ title: 'C', price: 100 })

    const { undo } = await archiveReward(b.id)
    expect((await listShopRewards()).map((r) => r.title)).toEqual(['A', 'C'])
    expect(await db.rewards.get(b.id)).toMatchObject({ archived: true })
    expect((await listRewards()).map((r) => r.id)).toEqual([a.id, b.id, c.id])

    await undo()
    expect((await listShopRewards()).map((r) => r.title)).toEqual(['A', 'B', 'C'])
  })

  it('cannot be redeemed while archived, and history survives it', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await earn(1000)
    await redeemReward(r.id, NOW)
    await archiveReward(r.id)

    await expect(redeemReward(r.id, NOW + 1)).rejects.toMatchObject({
      name: 'RewardUnavailableError',
      reason: 'archived',
    })
    expect(await listRedemptions()).toHaveLength(1)

    await unarchiveReward(r.id)
    await expect(redeemReward(r.id, NOW + 2)).resolves.toBeDefined()
  })

  it('throws for a missing reward', async () => {
    await expect(archiveReward('nope')).rejects.toBeInstanceOf(RewardUnavailableError)
  })
})

describe('reorderRewards', () => {
  it('saves the new arrangement and leaves archived rewards alone', async () => {
    const a = await createReward({ title: 'A', price: 100 })
    const gone = await createReward({ title: 'Gone', price: 100 })
    const b = await createReward({ title: 'B', price: 100 })
    const c = await createReward({ title: 'C', price: 100 })
    await archiveReward(gone.id)
    const goneOrder = (await db.rewards.get(gone.id))?.order

    await reorderRewards([c.id, a.id, b.id])
    expect((await listShopRewards()).map((r) => r.title)).toEqual(['C', 'A', 'B'])
    expect((await db.rewards.get(gone.id))?.order).toBe(goneOrder)
  })
})

describe('redeemReward', () => {
  it('spends XP: balance drops, lifetime XP does not, and the row snapshots title and price', async () => {
    const r = await createReward({ title: '30 min gaming', price: 300 })
    await earn(1000)

    const { redemption } = await redeemReward(r.id, NOW)
    expect(redemption).toMatchObject({
      rewardId: r.id,
      rewardTitle: '30 min gaming',
      price: 300,
      at: NOW,
      day: TODAY,
      refundedAt: null,
    })

    const summary = await getXpSummary(TODAY)
    expect(summary).toMatchObject({ lifetime: 1000, spent: 300, balance: 700 })
    // Spending is not an XP event, so it can never lower a level.
    expect(await db.xpEvents.count()).toBe(1)
    expect(summary.level).toEqual(levelFromLifetimeXp(1000))
  })

  it('allows spending the exact balance', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await earn(500)
    await expect(redeemReward(r.id, NOW)).resolves.toBeDefined()
    expect((await getXpSummary(TODAY)).balance).toBe(0)
  })

  it('throws InsufficientXpError and writes nothing when the balance is short', async () => {
    const r = await createReward({ title: 'Order takeout', price: 1500 })
    await earn(1260)

    const error = await redeemReward(r.id, NOW).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InsufficientXpError)
    expect(error).toMatchObject({ price: 1500, balance: 1260, shortBy: 240 })
    expect(await db.redemptions.count()).toBe(0)
    await settleDomainEvents()
    expect(emitted).toEqual([])
  })

  it('counts earlier purchases against the balance', async () => {
    const r = await createReward({ title: '30 min gaming', price: 300 })
    await earn(700)
    await redeemReward(r.id, NOW)
    await redeemReward(r.id, NOW + 1)
    await expect(redeemReward(r.id, NOW + 2)).rejects.toBeInstanceOf(InsufficientXpError)
    expect((await getXpSummary(TODAY)).balance).toBe(100)
  })

  it('cannot overspend when two purchases race', async () => {
    const r = await createReward({ title: '30 min gaming', price: 300 })
    await earn(500)
    const results = await Promise.allSettled([redeemReward(r.id, NOW), redeemReward(r.id, NOW + 1)])
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await db.redemptions.count()).toBe(1)
  })

  it('throws for a reward that does not exist', async () => {
    await earn(1000)
    await expect(redeemReward('nope', NOW)).rejects.toMatchObject({ reason: 'missing' })
  })

  it('emits redemption.changed after commit', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await earn(500)
    const { redemption } = await redeemReward(r.id, NOW)
    await settleDomainEvents()
    expect(emitted).toEqual([{ type: 'redemption.changed', redemptionId: redemption.id }])
  })
})

describe('undo and refundRedemption', () => {
  it('undo gives the XP back, keeps the row as refunded, and can run twice', async () => {
    const r = await createReward({ title: '30 min gaming', price: 300 })
    await earn(1000)
    const { redemption, undo } = await redeemReward(r.id, NOW)
    expect((await getXpSummary(TODAY)).balance).toBe(700)

    await undo()
    expect(await getXpSummary(TODAY)).toMatchObject({ lifetime: 1000, spent: 0, balance: 1000 })
    const stored = await db.redemptions.get(redemption.id)
    expect(stored?.refundedAt).not.toBeNull()

    await undo()
    expect(await db.redemptions.count()).toBe(1)
  })

  it('refundRedemption stamps the time once and returns null for an unknown id', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await earn(500)
    const { redemption } = await redeemReward(r.id, NOW)

    const first = await refundRedemption(redemption.id, NOW + MIN)
    expect(first?.refundedAt).toBe(NOW + MIN)
    const second = await refundRedemption(redemption.id, NOW + 2 * MIN)
    expect(second?.refundedAt).toBe(NOW + MIN)
    expect(await refundRedemption('nope')).toBeNull()
  })

  it('a refunded purchase can be bought again with the XP it returned', async () => {
    const r = await createReward({ title: 'Order takeout', price: 1500 })
    await earn(1500)
    const first = await redeemReward(r.id, NOW)
    await expect(redeemReward(r.id, NOW + 1)).rejects.toBeInstanceOf(InsufficientXpError)
    await first.undo()
    await expect(redeemReward(r.id, NOW + 2)).resolves.toBeDefined()
  })

  it('emits redemption.changed for the refund, and not for a repeat', async () => {
    const r = await createReward({ title: 'Coffee out', price: 500 })
    await earn(500)
    const { redemption, undo } = await redeemReward(r.id, NOW)
    await settleDomainEvents()
    emitted = []
    await undo()
    await undo()
    await settleDomainEvents()
    expect(emitted).toEqual([{ type: 'redemption.changed', redemptionId: redemption.id }])
  })
})

describe('redemption history', () => {
  it('lists newest first, refunded ones included, whatever order they were written in', async () => {
    const r = await createReward({ title: 'Coffee out', price: 100 })
    await earn(1000)
    const a = await redeemReward(r.id, NOW)
    const b = await redeemReward(r.id, NOW + 3 * MIN)
    const c = await redeemReward(r.id, NOW + MIN)
    await b.undo()

    const list = await listRedemptions()
    expect(list.map((x) => x.id)).toEqual([b.redemption.id, c.redemption.id, a.redemption.id])
    expect(list.map((x) => x.refundedAt !== null)).toEqual([true, false, false])
  })
})

describe('seedStarterRewards', () => {
  it('adds the three starter rewards once, when the shop is empty', async () => {
    await ensureSettings()
    expect(await seedStarterRewards({ now: NOW })).toBe(3)
    const shop = await listShopRewards()
    expect(shop.map((r) => [r.title, r.price])).toEqual([
      ['30 min gaming', 300],
      ['Coffee out', 500],
      ['Order takeout', 1500],
    ])
    expect(STARTER_REWARDS).toHaveLength(3)
    expect((await getSettings()).rewardsSeeded).toBe(true)
    expect(await seedStarterRewards({ now: NOW })).toBe(0)
    expect(await db.rewards.count()).toBe(3)
  })

  it('never brings them back once the user has removed them', async () => {
    await ensureSettings()
    await seedStarterRewards({ now: NOW })
    await db.rewards.clear()
    expect(await seedStarterRewards({ now: NOW + 1 })).toBe(0)
    expect(await db.rewards.count()).toBe(0)
  })

  it('does not seed a shop that already has rewards, and does not seed later either', async () => {
    await ensureSettings()
    await createReward({ title: 'Movie night', price: 900 })
    expect(await seedStarterRewards({ now: NOW })).toBe(0)
    await db.rewards.clear()
    expect(await seedStarterRewards({ now: NOW })).toBe(0)
    expect(await db.rewards.count()).toBe(0)
  })

  it('is safe when two visits race', async () => {
    await ensureSettings()
    await Promise.all([seedStarterRewards({ now: NOW }), seedStarterRewards({ now: NOW })])
    expect(await db.rewards.count()).toBe(3)
  })

  it('works before the settings row exists', async () => {
    expect(await seedStarterRewards({ now: NOW })).toBe(3)
  })
})
