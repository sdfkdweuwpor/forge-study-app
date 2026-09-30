/**
 * Free time per day (pure bookkeeping for one planner run). A day's free time is its study windows,
 * minus busy blocks, minus what has been reserved so far, minus the time before the start on the first
 * day. Every placement goes through `firstFit` + `reserve`, so two items can never overlap and an item
 * never crosses the end of a window.
 */
import type { HHmm, ISODate } from '@/db/types'
import { ceilTo, dayNumber } from './capacity'
import type { BusyBlock } from './plannerTypes'
import { DAY_MINUTES, parseClock, subtractIntervals, type Interval } from './windows'

/** Busy intervals per day number (minutes after midnight). A block past midnight spills into the next day. */
export type BusyMap = Map<number, Interval[]>

export function addBusy(map: BusyMap, day: number, start: number, minutes: number): void {
  let d = day
  let s = start
  let left = minutes
  while (left > 0 && s >= 0) {
    const e = Math.min(DAY_MINUTES, s + left)
    const list = map.get(d) ?? []
    list.push([s, e])
    map.set(d, list)
    left -= e - s
    d += 1
    s = 0
  }
}

/** Busy blocks as a per-day map; malformed blocks are ignored. */
export function busyMapOf(blocks: readonly BusyBlock[] = []): BusyMap {
  const map: BusyMap = new Map()
  for (const b of blocks) addBusyAt(map, b.date, b.start, b.durationMinutes)
  return map
}

export function addBusyAt(map: BusyMap, date: ISODate, start: HHmm, minutes: number): boolean {
  const s = parseClock(start)
  if (s === null || s >= DAY_MINUTES || !Number.isFinite(minutes) || minutes <= 0) return false
  let day: number
  try {
    day = dayNumber(date)
  } catch {
    return false
  }
  addBusy(map, day, s, minutes)
  return true
}

export interface SlotBookInit {
  /** Study windows of a day after blackouts and DST. */
  dayIntervals: (day: number) => Interval[]
  busy: BusyMap
  /** Nothing is free before this day, or before `startMinute` on it. */
  startDay: number
  startMinute: number
  /** Start times are rounded up to this (minutes). */
  grain: number
}

export class SlotBook {
  private readonly free = new Map<number, Interval[]>()

  constructor(private readonly init: SlotBookInit) {}

  /** Whether the day has study windows at all (busy time does not matter): pace accrues on these days. */
  isStudyDay(day: number): boolean {
    return day >= this.init.startDay && this.init.dayIntervals(day).length > 0
  }

  freeOn(day: number): readonly Interval[] {
    const hit = this.free.get(day)
    if (hit) return hit
    let xs: Interval[] = []
    if (day >= this.init.startDay) {
      xs = this.init.dayIntervals(day)
      const busy = this.init.busy.get(day)
      if (busy) xs = subtractIntervals(xs, busy)
      if (day === this.init.startDay && this.init.startMinute > 0)
        xs = subtractIntervals(xs, [[0, this.init.startMinute]])
    }
    this.free.set(day, xs)
    return xs
  }

  /** The earliest grain-aligned start ≥ `from` where `minutes` fit inside one free interval. */
  firstFit(day: number, from: number, minutes: number): number | null {
    const g = this.init.grain
    for (const [a, b] of this.freeOn(day)) {
      if (b <= from) continue
      const s = ceilTo(Math.max(a, from), g)
      if (s + minutes <= b) return s
    }
    return null
  }

  /** Free minutes on `day` at or after `from`, counting only pieces that start on the grain. */
  freeMinutesFrom(day: number, from: number): number {
    const g = this.init.grain
    let n = 0
    for (const [a, b] of this.freeOn(day)) {
      if (b <= from) continue
      const s = ceilTo(Math.max(a, from), g)
      if (b > s) n += b - s
    }
    return n
  }

  /** Takes `[start, end)` out of the day's free time (also when it lies outside the windows). */
  reserve(day: number, start: number, end: number): void {
    this.free.set(day, subtractIntervals(this.freeOn(day), [[start, end]]))
  }
}
