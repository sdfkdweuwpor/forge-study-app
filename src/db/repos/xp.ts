/**
 * XP is an append-only log (`xpEvents`); nothing here updates or deletes a row. Totals are derived on
 * read (`@/logic/xp`), so they can never drift. An award is idempotent per `key` (skipped while that
 * key's net is already positive), and an undo appends a negative event with the same key.
 *
 * Every function joins a surrounding transaction when there is one, so a task's completion and its XP
 * commit (or fail) together; `xp.changed` is emitted after that commit.
 */
import { newId } from '@/lib/ids'
import { dayOf } from '@/logic/dates'
import { levelFromLifetimeXp, lifetimeXp, spentXp, type LevelInfo } from '@/logic/xp'
import { db } from '../db'
import { emit } from '../events'
import type { ID, ISODate, Millis, XpEvent, XpSource } from '../types'

export interface XpEventInput {
  source: XpSource
  /** Positive for an award, negative for a reversal. */
  amount: number
  /** e.g. `'task:<id>'`, `'dailyGoal:<day>'`. Awards are idempotent per key. */
  key: string
  refId?: ID | null
  note?: string | null
  /** Defaults to now. */
  at?: Millis
  /** The day the XP is attributed to; defaults to the day of `at`. */
  day?: ISODate
}

/** Adds one event to the log and emits `xp.changed`. No idempotency check: see `awardXp`. */
export async function appendXpEvent(input: XpEventInput): Promise<XpEvent> {
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new RangeError('An XP event needs a non-zero amount')
  }
  const at = input.at ?? Date.now()
  const day = input.day ?? dayOf(at)
  const event: XpEvent = {
    id: newId(),
    createdAt: at,
    updatedAt: at,
    at,
    day,
    source: input.source,
    amount: Math.round(input.amount),
    key: input.key,
    refId: input.refId ?? null,
    note: input.note ?? null,
  }
  return db.transaction('rw', db.xpEvents, async () => {
    await db.xpEvents.add(event)
    emit({ type: 'xp.changed', day, source: event.source, amount: event.amount })
    return event
  })
}

/** The sum of every event recorded under `key`: > 0 while the award stands, 0 once it is reversed. */
export async function xpNetForKey(key: string): Promise<number> {
  const events = await db.xpEvents.where('key').equals(key).toArray()
  return lifetimeXp(events)
}

/**
 * Awards XP once per key. Returns the new event, or `null` when the key's net is already positive
 * (an award that stands) or the amount is not positive.
 */
export async function awardXp(input: XpEventInput): Promise<XpEvent | null> {
  if (!(input.amount > 0)) return null
  return db.transaction('rw', db.xpEvents, async () => {
    if ((await xpNetForKey(input.key)) > 0) return null
    return appendXpEvent(input)
  })
}

/**
 * Cancels whatever `key` still stands for by appending its negative. Returns the reversal event, or
 * `null` when there is nothing to reverse. The reversal is attributed to the day of the events it
 * cancels, so that day's total nets out; `at` is when it actually happened.
 */
export async function reverseXp(
  key: string,
  opts: { at?: Millis; note?: string | null } = {},
): Promise<XpEvent | null> {
  return db.transaction('rw', db.xpEvents, async () => {
    const events = await db.xpEvents.where('key').equals(key).toArray()
    const net = lifetimeXp(events)
    if (net <= 0) return null
    const latest = events.reduce((a, b) => (b.at >= a.at ? b : a))
    return appendXpEvent({
      source: latest.source,
      amount: -net,
      key,
      refId: latest.refId,
      note: opts.note ?? 'Reversed',
      at: opts.at,
      day: latest.day,
    })
  })
}

export interface XpSummary {
  /** Σ every event: what levels are computed from. */
  lifetime: number
  /** Σ price of redemptions that have not been refunded. */
  spent: number
  /** Spendable: lifetime − spent. */
  balance: number
  /** XP attributed to `today`, reversals included. */
  today: number
  level: LevelInfo
}

/** Lifetime, balance and today's XP, derived from the log and the redemptions. */
export async function getXpSummary(today: ISODate): Promise<XpSummary> {
  const [events, redemptions, todays] = await Promise.all([
    db.xpEvents.toArray(),
    db.redemptions.toArray(),
    db.xpEvents.where('day').equals(today).toArray(),
  ])
  const lifetime = lifetimeXp(events)
  const spent = spentXp(redemptions)
  return {
    lifetime,
    spent,
    balance: lifetime - spent,
    today: lifetimeXp(todays),
    level: levelFromLifetimeXp(lifetime),
  }
}
