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
 * The sentence under the estimate chart: "You finish 62% of tasks within ±20% of your estimate."
 * `null` with nothing to say. Neutral either way; a low share is not a problem, just a fact.
 */
export function accuracySentence(
  accuracy: Pick<EstimateAccuracy, 'share' | 'points'>,
): string | null {
  if (accuracy.share === null) return null
  const pct = Math.round(accuracy.share * 100)
  const n = accuracy.points.length
  return `You finish ${pct}% of tasks within ±20% of your estimate (${n} finished ${n === 1 ? 'task' : 'tasks'}).`
}
