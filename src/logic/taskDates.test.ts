import { describe, expect, it } from 'vitest'
import { kindForSource, planDay, planTime, TASK_V2_DEFAULTS } from './taskDates'

describe('task dates (schema v2)', () => {
  it('plans a task for its do date, else its deadline', () => {
    expect(planDay({ doDate: '2026-09-30', dueDate: '2026-10-02' })).toBe('2026-09-30')
    expect(planDay({ doDate: null, dueDate: '2026-10-02' })).toBe('2026-10-02')
    expect(planDay({ doDate: null, dueDate: null })).toBeNull()
  })

  it('a do time only counts with a do date', () => {
    expect(planTime({ doDate: '2026-09-30', doTime: '06:00' })).toBe('06:00')
    expect(planTime({ doDate: null, doTime: '06:00' })).toBeNull()
  })

  it('knows the kind a source implies and the unplanned defaults', () => {
    expect(kindForSource('schedule')).toBe('study')
    expect(kindForSource('flashcards')).toBe('review')
    expect(kindForSource('user')).toBe('task')
    expect(TASK_V2_DEFAULTS).toMatchObject({
      doDate: null,
      autoSlot: false,
      kind: 'task',
      sync: null,
    })
  })
})
