/**
 * Schedule windows in local time. A window belongs to the day it STARTS on, and one that ends
 * before it starts (22:00 to 06:00) runs overnight into the next day: a Tuesday 22:00-06:00 window
 * covers Wednesday 04:30. Everything is computed from concrete local start/end instants, so a
 * daylight-saving change inside a window just makes it an hour shorter or longer.
 */
import type { ScheduleWindow } from './protocol.js'

export interface Interval {
  /** Epoch ms, inclusive. */
  start: number
  /** Epoch ms, exclusive. */
  end: number
}

/** 'HH:mm' to minutes after midnight, or null when malformed. */
export function minutesOfDay(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * Every concrete interval that STARTS on a local day between `fromOffset` and `toOffset` days
 * from `now`'s day (0 = today), sorted by start.
 */
function intervalsStartingBetween(
  schedule: readonly ScheduleWindow[],
  now: number,
  fromOffset: number,
  toOffset: number,
): Interval[] {
  const today = new Date(now)
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  const out: Interval[] = []
  for (let offset = fromOffset; offset <= toOffset; offset += 1) {
    const day = new Date(y, m, d + offset)
    for (const window of schedule) {
      if (!window.days.includes(day.getDay())) continue
      const from = minutesOfDay(window.start)
      const to = minutesOfDay(window.end)
      if (from === null || to === null || from === to) continue
      const endsNextDay = to < from
      out.push({
        start: new Date(y, m, d + offset, 0, from).getTime(),
        end: new Date(y, m, d + offset + (endsNextDay ? 1 : 0), 0, to).getTime(),
      })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** True when `now` is inside a window that started today, or yesterday and runs past midnight. */
export function isScheduleActive(schedule: readonly ScheduleWindow[], now: number): boolean {
  return intervalsStartingBetween(schedule, now, -1, 0).some((i) => i.start <= now && now < i.end)
}

/** The next moment (after `now`) at which a window opens or closes, or null when nothing is scheduled. */
export function nextScheduleBoundary(
  schedule: readonly ScheduleWindow[],
  now: number,
): number | null {
  let best: number | null = null
  for (const { start, end } of intervalsStartingBetween(schedule, now, -1, 8)) {
    for (const t of [start, end]) {
      if (t > now && (best === null || t < best)) best = t
    }
  }
  return best
}
