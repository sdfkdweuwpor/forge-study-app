/**
 * The rewards shop (BRIEF §5.5), pure. Prices and titles are cleaned here, the shop's list order is
 * decided here, and the History totals are derived here. Spent XP comes from the redemptions table
 * (`spentXp` in `./xp`), never from XP events: a redemption that is refunded stops counting.
 */
import type { ID, ISODate, Redemption, Reward } from '@/db/types'
import { evenOrders } from './order'
import { spentXp } from './xp'

// ─── Input ──────────────────────────────────────────────────────────────────

export const MAX_REWARD_PRICE = 1_000_000
export const MAX_REWARD_TITLE_LENGTH = 80
export const DEFAULT_REWARD_ICON = '🎁'

/** Whitespace collapsed, trimmed and cut to `MAX_REWARD_TITLE_LENGTH`. Empty means "not a title". */
export function cleanRewardTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_REWARD_TITLE_LENGTH).trim()
}

/**
 * A price as typed: `300`, `1,500`, `1 500`, `300 XP`. Whole XP from 1 to `MAX_REWARD_PRICE`; anything
 * else (empty, zero, a fraction, a negative, a word) is `null`.
 */
export function parseRewardPrice(text: string): number | null {
  const compact = text
    .trim()
    .replace(/\s*xp$/i, '')
    .replace(/[,\s_]/g, '')
  if (!/^\d+$/.test(compact)) return null
  const value = Number(compact)
  return value >= 1 && value <= MAX_REWARD_PRICE ? value : null
}

const NUMBER = new Intl.NumberFormat('en-US')

/** `1500` → `"1,500"`. */
export function formatXpNumber(amount: number): string {
  return NUMBER.format(Math.round(amount))
}

/** `1500` → `"1,500 XP"`. */
export function formatPrice(amount: number): string {
  return `${formatXpNumber(amount)} XP`
}

// ─── Affordability ──────────────────────────────────────────────────────────

/** Whether `balance` covers `price`. */
export function canAfford(price: number, balance: number): boolean {
  return balance >= price
}

/** XP still missing to afford `price` (0 when it is affordable). */
export function xpToGo(price: number, balance: number): number {
  return Math.max(0, price - balance)
}

/** `"240 XP to go"` while unaffordable, `null` once it is. */
export function toGoLabel(price: number, balance: number): string | null {
  const missing = xpToGo(price, balance)
  return missing > 0 ? `${formatXpNumber(missing)} XP to go` : null
}

// ─── Order ──────────────────────────────────────────────────────────────────

type OrderedReward = Pick<Reward, 'id' | 'order' | 'createdAt'>

const byOrder = (a: OrderedReward, b: OrderedReward): number =>
  a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/** Every reward in the order the user arranged them (ties: oldest first). */
export function sortRewards<T extends OrderedReward>(rewards: readonly T[]): T[] {
  return [...rewards].sort(byOrder)
}

/** The shop's list: rewards that are not archived, in the order the user arranged them. */
export function shopRewards<T extends OrderedReward & Pick<Reward, 'archived'>>(
  rewards: readonly T[],
): T[] {
  return sortRewards(rewards.filter((r) => !r.archived))
}

/** `order` for a reward added after every existing one (archived rewards keep their place). */
export function nextRewardOrder(rewards: readonly Pick<Reward, 'order'>[]): number {
  let max = -Infinity
  for (const r of rewards) max = Math.max(max, r.order)
  return max === -Infinity ? 0 : Math.floor(max) + 1024
}

/**
 * The new `order` of each reward after the shop list is rearranged to `orderedIds`: the rewards
 * take, in the new sequence, the positions the moved ones already held. Archived rewards and anything
 * not listed keep their numbers, and only rewards that actually changed are returned. If two of the
 * held positions are equal the listed rewards are renumbered 0, 1024, 2048 … instead.
 */
export function reorderPlan(
  rewards: readonly OrderedReward[],
  orderedIds: readonly ID[],
): { id: ID; order: number }[] {
  const byId = new Map(rewards.map((r) => [r.id, r]))
  const ids = orderedIds.filter((id, i) => byId.has(id) && orderedIds.indexOf(id) === i)
  const slots = ids.map((id) => (byId.get(id) as OrderedReward).order).sort((a, b) => a - b)
  const crowded = slots.some((slot, i) => i > 0 && slot === slots[i - 1])
  const targets = crowded ? evenOrders(ids.length) : slots
  const changes: { id: ID; order: number }[] = []
  ids.forEach((id, i) => {
    const order = targets[i] as number
    if ((byId.get(id) as OrderedReward).order !== order) changes.push({ id, order })
  })
  return changes
}

// ─── History ────────────────────────────────────────────────────────────────

/** Newest first. Equal instants keep a stable order (later-created first). */
export function sortRedemptions<T extends Pick<Redemption, 'id' | 'at' | 'createdAt'>>(
  redemptions: readonly T[],
): T[] {
  return [...redemptions].sort(
    (a, b) => b.at - a.at || b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  )
}

export interface RedemptionMonth<T> {
  /** `'YYYY-MM'`. */
  month: string
  items: T[]
  /** XP spent in the month, refunds excluded. */
  spent: number
}

/** Newest-first redemptions cut into calendar months (by the local day they were bought). */
export function groupRedemptionsByMonth<T extends Pick<Redemption, 'price' | 'day' | 'refundedAt'>>(
  sorted: readonly T[],
): RedemptionMonth<T>[] {
  const months: RedemptionMonth<T>[] = []
  for (const item of sorted) {
    const month = item.day.slice(0, 7)
    let group = months.at(-1)
    if (group?.month !== month) {
      group = { month, items: [], spent: 0 }
      months.push(group)
    }
    group.items.push(item)
    if (item.refundedAt === null) group.spent += item.price
  }
  return months
}

export interface RedemptionTotals {
  /** XP spent in the month of `today`, refunds excluded. */
  spentThisMonth: number
  /** XP spent so far, refunds excluded. */
  spentAllTime: number
  /** How many redemptions stand (not refunded). */
  redeemedCount: number
  redeemedThisMonth: number
}

/** The History header: what was spent this month and in all. Refunded redemptions count for nothing. */
export function redemptionTotals(
  redemptions: readonly Pick<Redemption, 'price' | 'day' | 'refundedAt'>[],
  today: ISODate,
): RedemptionTotals {
  const month = today.slice(0, 7)
  const standing = redemptions.filter((r) => r.refundedAt === null)
  const thisMonth = standing.filter((r) => r.day.startsWith(month))
  return {
    spentThisMonth: spentXp(thisMonth),
    spentAllTime: spentXp(redemptions),
    redeemedCount: standing.length,
    redeemedThisMonth: thisMonth.length,
  }
}
