import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '@/logic/quickAdd'
import type { QuickAddCourse } from './queries'
import { toTaskInput } from './taskInput'

/** Tuesday 2026-09-29, 09:30 local (TZ=America/New_York). */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const C182: QuickAddCourse = {
  id: 'ms-c182',
  goalId: 'goal-bscs',
  code: 'C182',
  title: 'Introduction to IT',
}

describe('toTaskInput', () => {
  it("maps the brief's example onto the task fields", () => {
    const parsed = parseQuickAdd('Read chapter 4 tomorrow 2p #C182 !high ~2', {
      now: NOW,
      knownCourseCodes: ['C182'],
    })
    expect(toTaskInput(parsed, C182)).toEqual({
      title: 'Read chapter 4',
      dueDate: '2026-09-30',
      dueTime: '14:00',
      priority: 3,
      estimatePomodoros: 2,
      tags: ['C182'],
      milestoneId: 'ms-c182',
      goalId: 'goal-bscs',
    })
  })

  it('sets nothing that was not typed', () => {
    const input = toTaskInput(parseQuickAdd('Call the registrar', { now: NOW }), undefined)
    expect(input).toEqual({ title: 'Call the registrar', priority: 0, tags: [] })
    expect(Object.keys(input)).not.toContain('dueDate')
  })

  it('carries a recurrence and its first due date', () => {
    const input = toTaskInput(parseQuickAdd('Flashcards every weekday', { now: NOW }), undefined)
    expect(input.recurrence).toEqual({ freq: 'weekdays', interval: 1, byWeekday: [] })
    expect(input.dueDate).toBe('2026-09-29')
    expect(input.dueTime).toBeUndefined()
  })

  it('keeps a tag without a course link when the code is unknown', () => {
    const input = toTaskInput(parseQuickAdd('Review #C999', { now: NOW }), undefined)
    expect(input.tags).toEqual(['C999'])
    expect(input.milestoneId).toBeUndefined()
  })
})
