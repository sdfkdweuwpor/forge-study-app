import { describe, expect, it } from 'vitest'
import type { RecurrenceRule } from '@/db/types'
import { describeRecurrence } from './recurrence'
import {
  formFromRule,
  presetOf,
  recurrencePresets,
  ruleFromForm,
  toggleDay,
} from './recurrenceForm'

describe('recurrencePresets', () => {
  it('offers none, daily, weekdays and weekly on the given weekday', () => {
    const presets = recurrencePresets(0)
    expect(presets.map((p) => p.id)).toEqual(['none', 'daily', 'weekdays', 'weekly'])
    expect(presets[0]?.rule).toBeNull()
    expect(presets[3]).toMatchObject({
      label: 'Every Sunday',
      rule: { freq: 'weekly', interval: 1, byWeekday: [0] },
    })
    expect(recurrencePresets(2)[3]?.label).toBe('Every Tuesday')
  })

  it('clamps a bad weekday', () => {
    expect(recurrencePresets(9)[3]?.rule?.byWeekday).toEqual([6])
    expect(recurrencePresets(-1)[3]?.rule?.byWeekday).toEqual([0])
  })

  it('labels agree with describeRecurrence', () => {
    for (const preset of recurrencePresets(1)) {
      if (preset.rule) {
        expect(describeRecurrence(preset.rule).toLowerCase()).toBe(preset.label.toLowerCase())
      }
    }
  })
})

describe('presetOf', () => {
  it('recognises a preset exactly, and only that', () => {
    expect(presetOf(null, 1)).toBe('none')
    expect(presetOf({ freq: 'daily', interval: 1, byWeekday: [] }, 1)).toBe('daily')
    expect(presetOf({ freq: 'weekly', interval: 1, byWeekday: [1] }, 1)).toBe('weekly')
    expect(presetOf({ freq: 'weekly', interval: 1, byWeekday: [1] }, 3)).toBeNull()
    expect(presetOf({ freq: 'daily', interval: 2, byWeekday: [] }, 1)).toBeNull()
  })
})

describe('formFromRule / ruleFromForm', () => {
  const rules: RecurrenceRule[] = [
    { freq: 'daily', interval: 3, byWeekday: [] },
    { freq: 'weekly', interval: 2, byWeekday: [1, 3] },
    { freq: 'weekly', interval: 1, byWeekday: [] },
  ]

  it('round-trips daily and weekly rules', () => {
    for (const rule of rules) expect(ruleFromForm(formFromRule(rule))).toEqual(rule)
  })

  it('reads weekdays and custom rules into the form', () => {
    expect(formFromRule({ freq: 'weekdays', interval: 1, byWeekday: [] })).toEqual({
      every: 1,
      unit: 'week',
      days: [1, 2, 3, 4, 5],
    })
    expect(formFromRule({ freq: 'custom', interval: 4, byWeekday: [] })).toEqual({
      every: 4,
      unit: 'day',
      days: [],
    })
    expect(formFromRule({ freq: 'custom', interval: 2, byWeekday: [5, 1, 5] })).toEqual({
      every: 2,
      unit: 'week',
      days: [1, 5],
    })
  })

  it('defaults to every week with no rule', () => {
    expect(formFromRule(null)).toEqual({ every: 1, unit: 'week', days: [] })
  })

  it('clamps the interval and cleans the weekdays', () => {
    expect(ruleFromForm({ every: 0, unit: 'day', days: [1] })).toEqual({
      freq: 'daily',
      interval: 1,
      byWeekday: [],
    })
    expect(ruleFromForm({ every: 500, unit: 'week', days: [3, 1, 3, 9, -1] })).toEqual({
      freq: 'weekly',
      interval: 99,
      byWeekday: [1, 3],
    })
    expect(ruleFromForm({ every: Number.NaN, unit: 'day', days: [] }).interval).toBe(1)
  })
})

describe('toggleDay', () => {
  it('adds in order and removes', () => {
    expect(toggleDay([1, 5], 3)).toEqual([1, 3, 5])
    expect(toggleDay([1, 3, 5], 3)).toEqual([1, 5])
    expect(toggleDay([], 0)).toEqual([0])
  })
})
