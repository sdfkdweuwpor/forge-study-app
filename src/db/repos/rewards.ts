/**
 * The rewards shop (BRIEF §5.5). A reward has an XP price; buying one writes a `redemptions` row that
 * snapshots the title and price, so renaming, repricing or archiving a reward never changes history.
 *
 * Spent XP is derived from redemptions that have not been refunded (`spentXp` in `@/logic/xp`) and
 * lifetime XP is untouched, so levels never drop when you buy something (DECISIONS: `xpEvents` is
 * append-only; balance = lifetime − unrefunded redemptions). Nothing here writes an XP event.
 * Undoing a purchase sets `refundedAt` on the row.
 *
 * Components call these; they never touch `db.rewards` or `db.redemptions`.
 */
import { newId } from '@/lib/ids'
import { dayOf } from '@/logic/dates'
import {
  DEFAULT_REWARD_ICON,
  MAX_REWARD_PRICE,
  cleanRewardTitle,
  nextRewardOrder,
  reorderPlan,
  shopRewards,
  sortRedemptions,
  sortRewards,
} from '@/logic/rewards'
import { balance } from '@/logic/xp'
import { db } from '../db'
import { emit } from '../events'
import type { ID, Millis, Redemption, Reward } from '../types'
import { getSettings, updateSettings } from './settings'

export interface RepoOptions {
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: Millis
}

/** Thrown by `redeemReward` when the balance does not cover the price. Nothing is written. */
export class InsufficientXpError extends Error {
  readonly price: number
  readonly balance: number
  constructor(price: number, available: number) {
    super(`Not enough XP: ${price} needed, ${available} available`)
    this.name = 'InsufficientXpError'
    this.price = price
    this.balance = available
  }
  /** XP still missing. */
  get shortBy(): number {
    return this.price - this.balance
  }
}

/** Thrown when a reward does not exist, or (for `redeemReward`) has been archived. */
export class RewardUnavailableError extends Error {
  readonly rewardId: ID
  readonly reason: 'missing' | 'archived'
  constructor(rewardId: ID, reason: 'missing' | 'archived') {
    super(reason === 'missing' ? 'That reward no longer exists' : 'That reward is archived')
    this.name = 'RewardUnavailableError'
    this.rewardId = rewardId
    this.reason = reason
  }
}

// ─── Read ───────────────────────────────────────────────────────────────────

/** Every reward, archived ones included, in shop order. */
export async function listRewards(): Promise<Reward[]> {
  return sortRewards(await db.rewards.toArray())
}

/** The rewards on sale: not archived, in the order the user arranged them. */
export async function listShopRewards(): Promise<Reward[]> {
  return shopRewards(await db.rewards.toArray())
}

export async function getReward(id: ID): Promise<Reward | null> {
  return (await db.rewards.get(id)) ?? null
}

/** Every redemption, newest first. Refunded ones are included (they carry `refundedAt`). */
export async function listRedemptions(): Promise<Redemption[]> {
  return sortRedemptions(await db.redemptions.toArray())
}

// ─── Write ──────────────────────────────────────────────────────────────────

export interface RewardInput {
  title: string
  /** Whole XP, 1 to `MAX_REWARD_PRICE`. */
  price: number
  icon?: string
  description?: string
}

function assertPrice(price: number): void {
  if (!Number.isInteger(price) || price < 1 || price > MAX_REWARD_PRICE) {
    throw new RangeError(`A reward's price is a whole number of XP from 1 to ${MAX_REWARD_PRICE}`)
  }
}

const cleanIcon = (icon: string | undefined): string => {
  const trimmed = icon?.trim()
  return trimmed ? trimmed : DEFAULT_REWARD_ICON
}

/** Adds a reward at the end of the shop. Throws a `RangeError` for an empty title or a bad price. */
export async function createReward(input: RewardInput, opts: RepoOptions = {}): Promise<Reward> {
  const now = opts.now ?? Date.now()
  const title = cleanRewardTitle(input.title)
  if (title === '') throw new RangeError('A reward needs a title')
  assertPrice(input.price)
  return db.transaction('rw', db.rewards, async () => {
    const reward: Reward = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      title,
      icon: cleanIcon(input.icon),
      price: input.price,
      description: input.description?.trim() ?? '',
      archived: false,
      order: nextRewardOrder(await db.rewards.toArray()),
    }
    await db.rewards.add(reward)
    return reward
  })
}

export type RewardPatch = Partial<Pick<Reward, 'title' | 'price' | 'icon' | 'description'>>

/**
 * Edits title, price, icon or description. Past redemptions keep the title and price they were bought
 * at. Throws `RewardUnavailableError` for a missing reward and `RangeError` for an empty title or bad price.
 */
export async function updateReward(
  id: ID,
  patch: RewardPatch,
  opts: RepoOptions = {},
): Promise<Reward> {
  const now = opts.now ?? Date.now()
  const changes: Partial<Reward> = {}
  if (patch.title !== undefined) {
    const title = cleanRewardTitle(patch.title)
    if (title === '') throw new RangeError('A reward needs a title')
    changes.title = title
  }
  if (patch.price !== undefined) {
    assertPrice(patch.price)
    changes.price = patch.price
  }
  if (patch.icon !== undefined) changes.icon = cleanIcon(patch.icon)
  if (patch.description !== undefined) changes.description = patch.description.trim()

  return db.transaction('rw', db.rewards, async () => {
    const current = await db.rewards.get(id)
    if (!current) throw new RewardUnavailableError(id, 'missing')
    const next: Reward = { ...current, ...changes }
    const same =
      next.title === current.title &&
      next.price === current.price &&
      next.icon === current.icon &&
      next.description === current.description
    if (same) return current
    next.updatedAt = now
    await db.rewards.put(next)
    return next
  })
}

/** Takes a reward off the shop. History keeps what was bought. The returned `undo` puts it back where it was. */
export async function archiveReward(
  id: ID,
  opts: RepoOptions = {},
): Promise<{ reward: Reward; undo: () => Promise<void> }> {
  const now = opts.now ?? Date.now()
  const reward = await setArchived(id, true, now)
  return { reward, undo: () => setArchived(id, false, Date.now()).then(() => undefined) }
}

/** Puts an archived reward back on the shop, in the place it had. */
export async function unarchiveReward(id: ID, opts: RepoOptions = {}): Promise<Reward> {
  return setArchived(id, false, opts.now ?? Date.now())
}

async function setArchived(id: ID, archived: boolean, now: Millis): Promise<Reward> {
  return db.transaction('rw', db.rewards, async () => {
    const current = await db.rewards.get(id)
    if (!current) throw new RewardUnavailableError(id, 'missing')
    if (current.archived === archived) return current
    const next: Reward = { ...current, archived, updatedAt: now }
    await db.rewards.put(next)
    return next
  })
}

/**
 * Saves a new arrangement of the shop list (all ids of the rewards on sale, in order). Rewards take
 * the positions the moved ones held, so archived rewards stay where they were and only rewards that
 * moved are written.
 */
export async function reorderRewards(
  orderedIds: readonly ID[],
  opts: RepoOptions = {},
): Promise<void> {
  const now = opts.now ?? Date.now()
  await db.transaction('rw', db.rewards, async () => {
    const changes = reorderPlan(await db.rewards.toArray(), orderedIds)
    for (const { id, order } of changes) await db.rewards.update(id, { order, updatedAt: now })
  })
}

// ─── Buy ────────────────────────────────────────────────────────────────────

export interface Redeemed {
  redemption: Redemption
  /** Refunds this purchase (the toast's Undo). Safe to call more than once. */
  undo: () => Promise<void>
}

/**
 * Buys a reward with XP. In one transaction: the reward must exist and not be archived, and the balance
 * (lifetime XP − unrefunded redemptions) must cover the price, else `InsufficientXpError` and nothing is
 * written. Two rapid calls cannot overspend, because the second reads the first's redemption.
 */
export async function redeemReward(id: ID, now: Millis = Date.now()): Promise<Redeemed> {
  const redemption = await db.transaction(
    'rw',
    db.rewards,
    db.redemptions,
    db.xpEvents,
    async () => {
      const reward = await db.rewards.get(id)
      if (!reward) throw new RewardUnavailableError(id, 'missing')
      if (reward.archived) throw new RewardUnavailableError(id, 'archived')
      const [events, redemptions] = await Promise.all([
        db.xpEvents.toArray(),
        db.redemptions.toArray(),
      ])
      const available = balance(events, redemptions)
      if (available < reward.price) throw new InsufficientXpError(reward.price, available)
      const row: Redemption = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        rewardId: reward.id,
        rewardTitle: reward.title,
        price: reward.price,
        at: now,
        day: dayOf(now),
        refundedAt: null,
      }
      await db.redemptions.add(row)
      emit({ type: 'redemption.changed', redemptionId: row.id })
      return row
    },
  )
  return { redemption, undo: () => refundRedemption(redemption.id).then(() => undefined) }
}

/**
 * Gives the XP of a redemption back: sets `refundedAt` (the row stays, so History shows it as refunded).
 * Returns the updated row; a second refund changes nothing. `null` when the redemption does not exist.
 */
export async function refundRedemption(
  id: ID,
  now: Millis = Date.now(),
): Promise<Redemption | null> {
  return db.transaction('rw', db.redemptions, async () => {
    const current = await db.redemptions.get(id)
    if (!current) return null
    if (current.refundedAt !== null) return current
    const next: Redemption = { ...current, refundedAt: now, updatedAt: now }
    await db.redemptions.put(next)
    emit({ type: 'redemption.changed', redemptionId: id })
    return next
  })
}

// ─── First visit ────────────────────────────────────────────────────────────

/** What a new shop starts with (BRIEF §5.5 examples). */
export const STARTER_REWARDS: readonly { title: string; icon: string; price: number }[] = [
  { title: '30 min gaming', icon: '🎮', price: 300 },
  { title: 'Coffee out', icon: '☕', price: 500 },
  { title: 'Order takeout', icon: '🥡', price: 1500 },
]

/**
 * Adds the starter rewards on the first visit to the shop, when there are none. Guarded by
 * `settings.rewardsSeeded`, which is set on that first run (also when the shop was not empty), so
 * rewards the user removed never come back. Returns how many were added; safe to call on every visit.
 */
export async function seedStarterRewards(opts: RepoOptions = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.settings, db.rewards, async () => {
    if ((await getSettings()).rewardsSeeded) return 0
    const empty = (await db.rewards.count()) === 0
    if (empty) {
      await db.rewards.bulkAdd(
        STARTER_REWARDS.map((r, i) => ({
          id: newId(),
          createdAt: now,
          updatedAt: now,
          title: r.title,
          icon: r.icon,
          price: r.price,
          description: '',
          archived: false,
          order: i * 1024,
        })),
      )
    }
    await updateSettings({ rewardsSeeded: true })
    return empty ? STARTER_REWARDS.length : 0
  })
}
