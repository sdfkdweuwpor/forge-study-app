import { describe, expect, it } from 'vitest'
import type { Redemption, Reward } from '@/db/types'
import {
  MAX_REWARD_PRICE,
  canAfford,
  cleanRewardTitle,
  formatPrice,
  formatXpNumber,
  groupRedemptionsByMonth,
  nextRewardOrder,
  parseRewardPrice,
  redemptionTotals,
  reorderPlan,
  shopRewards,
  sortRedemptions,
  toGoLabel,
  xpToGo,
} from './rewards'

const reward = (id: string, order: number, over: Partial<Reward> = {}): Reward => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  title: id,
  icon: '🎁',
  price: 100,
  description: '',
  archived: false,
  order,
  ...over,
})

const redemption = (id: string, over: Partial<Redemption> = {}): Redemption => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  rewardId: 'r',
  rewardTitle: '30 min gaming',
  price: 300,
  at: 1,
  day: '2026-09-29',
  refundedAt: null,
  ...over,
})

describe('parseRewardPrice', () => {
  it('reads plain, grouped and suffixed prices', () => {
    expect(parseRewardPrice('300')).toBe(300)
    expect(parseRewardPrice(' 1,500 ')).toBe(1500)
    expect(parseRewardPrice('1 500')).toBe(1500)
    expect(parseRewardPrice('300 XP')).toBe(300)
    expect(parseRewardPrice('300xp')).toBe(300)
  })

  it('refuses anything that is not a whole number of XP from 1 up', () => {
    for (const bad of [
      '',
      '0',
      '-5',
      '12.5',
      'abc',
      '3e3',
      '1,5,00x',
      String(MAX_REWARD_PRICE + 1),
    ]) {
      expect(parseRewardPrice(bad), bad).toBeNull()
    }
    expect(parseRewardPrice(String(MAX_REWARD_PRICE))).toBe(MAX_REWARD_PRICE)
  })
})

describe('cleanRewardTitle', () => {
  it('collapses whitespace, trims and cuts to length', () => {
    expect(cleanRewardTitle('  Order   takeout ')).toBe('Order takeout')
    expect(cleanRewardTitle('   ')).toBe('')
    expect(cleanRewardTitle('x'.repeat(200))).toHaveLength(80)
  })
})

describe('formatting', () => {
  it('groups thousands', () => {
    expect(formatXpNumber(1500)).toBe('1,500')
    expect(formatPrice(300)).toBe('300 XP')
    expect(formatPrice(1500)).toBe('1,500 XP')
  })
})

describe('affordability', () => {
  it('compares price to balance', () => {
    expect(canAfford(300, 300)).toBe(true)
    expect(canAfford(300, 299)).toBe(false)
    expect(xpToGo(300, 60)).toBe(240)
    expect(xpToGo(300, 900)).toBe(0)
  })

  it('words what is missing, and says nothing once it is affordable', () => {
    expect(toGoLabel(1500, 260)).toBe('1,240 XP to go')
    expect(toGoLabel(300, 300)).toBeNull()
  })
})

describe('shop order', () => {
  it('lists active rewards by order, oldest first on a tie', () => {
    const list = [
      reward('c', 30),
      reward('gone', 5, { archived: true }),
      reward('b', 20, { createdAt: 5 }),
      reward('a', 20, { createdAt: 2 }),
    ]
    expect(shopRewards(list).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('appends after the highest order, archived included', () => {
    expect(nextRewardOrder([])).toBe(0)
    expect(nextRewardOrder([reward('a', 0), reward('b', 2048, { archived: true })])).toBe(3072)
  })
})

describe('reorderPlan', () => {
  it('moves the positions, not the numbers, and writes only what changed', () => {
    const list = [reward('a', 0), reward('b', 1024), reward('c', 2048)]
    expect(reorderPlan(list, ['a', 'c', 'b'])).toEqual([
      { id: 'c', order: 1024 },
      { id: 'b', order: 2048 },
    ])
    expect(reorderPlan(list, ['a', 'b', 'c'])).toEqual([])
  })

  it('leaves archived rewards where they were', () => {
    const list = [
      reward('a', 0),
      reward('gone', 1024, { archived: true }),
      reward('b', 2048),
      reward('c', 3072),
    ]
    const plan = reorderPlan(list, ['c', 'a', 'b'])
    expect(plan).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 2048 },
      { id: 'b', order: 3072 },
    ])
    expect(plan.some((p) => p.id === 'gone')).toBe(false)
  })

  it('renumbers when two positions are equal, and ignores unknown or repeated ids', () => {
    const list = [reward('a', 5), reward('b', 5), reward('c', 5)]
    expect(reorderPlan(list, ['c', 'b', 'a', 'a', 'zzz'])).toEqual([
      { id: 'c', order: 0 },
      { id: 'b', order: 1024 },
      { id: 'a', order: 2048 },
    ])
  })
})

describe('sortRedemptions', () => {
  it('puts the newest first', () => {
    const list = [
      redemption('old', { at: 10 }),
      redemption('new', { at: 30 }),
      redemption('mid', { at: 20 }),
    ]
    expect(sortRedemptions(list).map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })
})

describe('redemptionTotals', () => {
  it('counts this month and all time, and never counts a refund', () => {
    const list = [
      redemption('a', { price: 300, day: '2026-09-29' }),
      redemption('b', { price: 1500, day: '2026-09-02' }),
      redemption('c', { price: 500, day: '2026-08-30' }),
      redemption('d', { price: 300, day: '2026-09-15', refundedAt: 99 }),
    ]
    expect(redemptionTotals(list, '2026-09-30')).toEqual({
      spentThisMonth: 1800,
      spentAllTime: 2300,
      redeemedCount: 3,
      redeemedThisMonth: 2,
    })
  })

  it('is all zero with no redemptions', () => {
    expect(redemptionTotals([], '2026-09-30')).toEqual({
      spentThisMonth: 0,
      spentAllTime: 0,
      redeemedCount: 0,
      redeemedThisMonth: 0,
    })
  })

  it('does not mix the same month of another year', () => {
    const list = [redemption('a', { price: 300, day: '2025-09-29' })]
    expect(redemptionTotals(list, '2026-09-30').spentThisMonth).toBe(0)
  })
})

describe('groupRedemptionsByMonth', () => {
  it('cuts a newest-first list into months and totals what stands', () => {
    const list = [
      redemption('a', { price: 300, day: '2026-09-29' }),
      redemption('b', { price: 500, day: '2026-09-02', refundedAt: 5 }),
      redemption('c', { price: 1500, day: '2026-08-30' }),
      redemption('d', { price: 300, day: '2026-08-01' }),
      redemption('e', { price: 300, day: '2025-12-25' }),
    ]
    expect(
      groupRedemptionsByMonth(list).map((g) => [g.month, g.items.map((i) => i.id), g.spent]),
    ).toEqual([
      ['2026-09', ['a', 'b'], 300],
      ['2026-08', ['c', 'd'], 1800],
      ['2025-12', ['e'], 300],
    ])
  })

  it('is empty for no redemptions', () => {
    expect(groupRedemptionsByMonth([])).toEqual([])
  })
})
