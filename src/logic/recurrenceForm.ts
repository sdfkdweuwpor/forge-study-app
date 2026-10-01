/**
 * The "Repeat" picker's model (pure): the presets in its menu, and the small form behind "Custom…".
 * A rule is stored as a `RecurrenceRule`; the form is what a person edits ("every 2 weeks on Mon, Wed").
 */
import type { RecurrenceRule } from '@/db/types'
import { deepEqual } from './deepEqual'
import { WEEKDAY_NAMES } from './recurrence'

export interface RecurrencePreset {
  id: 'none' | 'daily' | 'weekdays' | 'weekly'
  label: string
  /** `null` = does not repeat. */
  rule: RecurrenceRule | null
}

/** The quick choices. The weekly one repeats on `weekday` (0 = Sunday), usually the task's due weekday. */
export function recurrencePresets(weekday: number): RecurrencePreset[] {
  const day = Math.min(6, Math.max(0, Math.floor(weekday)))
  return [
    { id: 'none', label: 'Does not repeat', rule: null },
    { id: 'daily', label: 'Every day', rule: { freq: 'daily', interval: 1, byWeekday: [] } },
    {
      id: 'weekdays',
      label: 'Every weekday',
      rule: { freq: 'weekdays', interval: 1, byWeekday: [] },
    },
    {
      id: 'weekly',
      label: `Every ${WEEKDAY_NAMES[day] ?? 'week'}`,
      rule: { freq: 'weekly', interval: 1, byWeekday: [day] },
    },
  ]
}

/** Which preset a rule is exactly, or `null` when it needs the custom form. */
export function presetOf(
  rule: RecurrenceRule | null,
  weekday: number,
): RecurrencePreset['id'] | null {
  return recurrencePresets(weekday).find((p) => deepEqual(p.rule, rule))?.id ?? null
}

export interface RecurrenceForm {
  every: number
  unit: 'day' | 'week'
  /** Weekdays (0 = Sunday) for a weekly unit; empty means "the same weekday as the due date". */
  days: number[]
}

export const MAX_INTERVAL = 99

const clampInterval = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_INTERVAL, Math.max(1, Math.floor(n))) : 1

/**
 * The interval a typed string means, once it is committed (blur or Enter): a whole number from 1 to 99.
 * Text that is empty or not a number keeps `current`, so a half-typed field never changes the rule.
 */
export function parseInterval(text: string, current: number): number {
  const trimmed = text.trim()
  if (trimmed === '') return current
  const n = Number(trimmed)
  return Number.isFinite(n) ? clampInterval(Math.round(n)) : current
}

/** The form for an existing rule (or the default, "every 1 week", for none). */
export function formFromRule(rule: RecurrenceRule | null): RecurrenceForm {
  if (!rule) return { every: 1, unit: 'week', days: [] }
  const days = [
    ...new Set(rule.byWeekday.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b)
  switch (rule.freq) {
    case 'daily':
      return { every: clampInterval(rule.interval), unit: 'day', days: [] }
    case 'weekdays':
      return { every: 1, unit: 'week', days: [1, 2, 3, 4, 5] }
    case 'weekly':
      return { every: clampInterval(rule.interval), unit: 'week', days }
    case 'custom':
      return days.length > 0
        ? { every: clampInterval(rule.interval), unit: 'week', days }
        : { every: clampInterval(rule.interval), unit: 'day', days: [] }
  }
}

/** The rule a form describes. Weekdays are ignored for a daily unit. */
export function ruleFromForm(form: RecurrenceForm): RecurrenceRule {
  const interval = clampInterval(form.every)
  if (form.unit === 'day') return { freq: 'daily', interval, byWeekday: [] }
  const days = [...new Set(form.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  )
  return { freq: 'weekly', interval, byWeekday: days }
}

/** Adds or removes a weekday from a form's selection. */
export function toggleDay(days: readonly number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b)
}
