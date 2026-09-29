import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '@/logic/quickAdd'
import { buildChips, courseFor, describeChips, tokenColor } from './chips'
import type { QuickAddCourse } from './queries'

/** Tuesday 2026-09-29, 09:30 local. */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const BRIEF = 'Read chapter 4 tomorrow 2p #C182 !high ~2'
const COURSES: QuickAddCourse[] = [
  { id: 'm1', goalId: 'g1', code: 'C182', title: 'Introduction to IT' },
  { id: 'm2', goalId: 'g1', code: 'D278', title: 'Scripting and Programming' },
]

describe('buildChips', () => {
  it("shows the brief's example as Tomorrow, 2:00 PM, #C182, High priority, 2 pomodoros", () => {
    const parsed = parseQuickAdd(BRIEF, { now: NOW })
    expect(buildChips(parsed, undefined, undefined).map((c) => [c.kind, c.label])).toEqual([
      ['date', 'Tomorrow'],
      ['time', '2:00 PM'],
      ['tag', '#C182'],
      ['priority', 'High priority'],
      ['estimate', '2 pomodoros'],
    ])
  })

  it('adds a course chip when the code matches a known course', () => {
    const parsed = parseQuickAdd(BRIEF, { now: NOW, knownCourseCodes: ['C182'] })
    const chips = buildChips(parsed, courseFor(parsed, COURSES), undefined)
    expect(chips.at(-1)).toMatchObject({ kind: 'course', label: 'Introduction to IT' })
    expect(chips).toHaveLength(6)
  })

  it('has no course chip without a match', () => {
    const parsed = parseQuickAdd('Review #C999', { now: NOW, knownCourseCodes: ['C182'] })
    expect(courseFor(parsed, COURSES)).toBeUndefined()
    expect(buildChips(parsed, undefined, undefined).map((c) => c.kind)).toEqual(['tag'])
  })

  it('matches the course case-insensitively', () => {
    const parsed = parseQuickAdd('Review #c182', { now: NOW, knownCourseCodes: ['C182'] })
    expect(courseFor(parsed, COURSES)?.id).toBe('m1')
  })

  it('shows a recurrence chip and gives quoted literals none', () => {
    const parsed = parseQuickAdd('Call "tomorrow" bakery every weekday', { now: NOW })
    expect(buildChips(parsed, undefined, undefined).map((c) => [c.kind, c.label])).toEqual([
      ['recurrence', 'Every weekday'],
    ])
  })

  it('is empty for a plain title', () => {
    expect(buildChips(parseQuickAdd('Read chapter 4', { now: NOW }), undefined, undefined)).toEqual(
      [],
    )
  })

  it('keys chips by position so they survive edits elsewhere', () => {
    const a = buildChips(parseQuickAdd('x tomorrow', { now: NOW }), undefined, undefined)
    const b = buildChips(parseQuickAdd('xy tomorrow', { now: NOW }), undefined, undefined)
    expect(a[0]?.key).not.toBe(b[0]?.key) // it moved
    // A token typed after it does not change its key.
    const later = buildChips(parseQuickAdd('x tomorrow 2p', { now: NOW }), undefined, undefined)
    expect(later[0]?.key).toBe(a[0]?.key)
  })
})

describe('colours', () => {
  it('scales priority from gray to red', () => {
    const color = (input: string) => {
      const parsed = parseQuickAdd(input, { now: NOW })
      const token = parsed.tokens[0]
      return token ? tokenColor(token, parsed, undefined) : null
    }
    expect(color('x !low')).toBe('gray')
    expect(color('x !med')).toBe('yellow')
    expect(color('x !high')).toBe('orange')
    expect(color('x !urgent')).toBe('red')
  })

  it('takes a tag colour from the settings override', () => {
    const parsed = parseQuickAdd('x #C182', { now: NOW })
    const token = parsed.tokens[0]
    expect(token && tokenColor(token, parsed, { C182: 'pink' })).toBe('pink')
  })
})

describe('describeChips', () => {
  it('reads the chips as a sentence for a live region', () => {
    const parsed = parseQuickAdd(BRIEF, { now: NOW })
    expect(describeChips(buildChips(parsed, undefined, undefined))).toBe(
      'Due date Tomorrow, Due time 2:00 PM, Tag #C182, Priority High priority, Estimate 2 pomodoros',
    )
    expect(describeChips([])).toBe('')
  })
})
