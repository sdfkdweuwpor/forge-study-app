/**
 * Words for the Progress charts (pure): day and week labels, axis text and the sentences that go under
 * a chart. English only, like the rest of the app; nothing here scolds.
 */
import { format } from 'date-fns'
import type { ISODate } from '@/db/types'
import { fromISODate, startOfWeekISO, type WeekStart } from './dates'
import type { DayMinutes, EstimateAccuracy, WeekCount } from './stats'

/** A chart datum before it becomes a bar: same shape as the UI's `BarDatum`. */
export interface LabelledValue {
  key: string
  label: string
  value: number
  tick?: string
}

/** "Tue, Sep 29" */
export const dayName = (day: ISODate): string => format(fromISODate(day), 'EEE, MMM d')

/** The 30-day chart's bars: full day name for the tooltip, "Sep 29" on the axis. */
export function dayBars(days: readonly DayMinutes[]): LabelledValue[] {
  return days.map((d) => ({
    key: d.day,
    label: dayName(d.day),
    value: d.minutes,
    tick: format(fromISODate(d.day), 'MMM d'),
  }))
}

/** The weekly chart's bars; the week that holds `today` says it is still filling up. */
export function weekBars(
  weeks: readonly WeekCount[],
  today: ISODate,
  weekStartsOn: WeekStart,
): LabelledValue[] {
  const current = startOfWeekISO(today, weekStartsOn)
  return weeks.map((w) => {
    const name = format(fromISODate(w.weekStart), 'MMM d')
    return {
      key: w.weekStart,
      label: w.weekStart === current ? `Week of ${name} (so far)` : `Week of ${name}`,
      value: w.count,
      tick: name,
    }
  })
}

/** "0", "30m", "1h", "1.5h": a y-axis label for minutes. */
export function minutesTick(minutes: number): string {
  if (minutes <= 0) return '0'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours}h`
}

/** "45 min", "1 h 25 min", "2 h": a duration for tooltips and rows. */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`
}

/** Lifetime focus for a stat: "142 h", "8.5 h", "45 min". */
export function hoursText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const hours = m / 60
  return hours < 10 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(hours)} h`
}

/**
 * The estimate chart's takeaway, in counts rather than a percentage: "43 of 72 finished tasks took about
 * as long as you planned." (within ±20 %, which the chart's key says). `null` with nothing to say.
 * Neutral either way: tasks outside the band "ran longer or shorter", never "missed" or "wrong".
 */
export function accuracySentence(
  accuracy: Pick<EstimateAccuracy, 'share' | 'points'>,
): string | null {
  if (accuracy.share === null) return null
  const n = accuracy.points.length
  const within = Math.round(accuracy.share * n)
  if (n === 1) {
    return within === 1
      ? 'Your finished task took about as long as you planned.'
      : 'Your finished task ran longer or shorter than planned. The dot shows which way.'
  }
  if (within === 0)
    return `Your ${n} finished tasks ran longer or shorter than planned. The dots show which way.`
  if (within === n) return `All ${n} finished tasks took about as long as you planned.`
  return `${within.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} finished tasks took about as long as you planned.`
}
