/**
 * The last-write-wins stamp clock of one tab (PLAN §4.7.4): `max(now, last + 1, maxSeen + 1)`, a hybrid
 * clock. It never repeats or goes back in this tab, and an edit made after seeing another device's change
 * always carries a larger stamp than that change, whatever the two devices' clocks say. The rule itself
 * is pure (`logic/syncTables.nextStamp`); this holds the state. The tracking middleware owns one per
 * database, seeded when the database opens and told about remote stamps by the sync engine.
 */
import { nextStamp } from '@/logic/syncTables'
import type { Millis } from '../types'

/** A usable stamp: a finite number (not NaN, not ±Infinity). */
export const isStamp = (v: unknown): v is Millis => typeof v === 'number' && Number.isFinite(v)

export class StampClock {
  private last = 0
  private seen = 0

  constructor(private readonly clock: () => Millis) {}

  /** The next stamp. */
  next(): Millis {
    this.last = nextStamp(this.clock(), this.last, this.seen)
    return this.last
  }

  /**
   * Makes every later stamp larger than both: the newest remote stamp seen, the newest stamp written.
   * A value that is not a finite number is ignored: `Math.max` with NaN is NaN, and one bad value would
   * make every later stamp NaN, so every later edit would silently lose last-write-wins.
   */
  seed(stamps: { maxSeenStamp?: Millis; lastStamp?: Millis }): void {
    if (isStamp(stamps.maxSeenStamp)) this.seen = Math.max(this.seen, stamps.maxSeenStamp)
    if (isStamp(stamps.lastStamp)) this.last = Math.max(this.last, stamps.lastStamp)
  }
}
