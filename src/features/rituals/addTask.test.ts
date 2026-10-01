import { describe, expect, it } from 'vitest'
import { todayTaskDraft } from './addTask'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const ctx = { now: NOW, today: '2026-09-29', weekStartsOn: 1 as const }

describe('todayTaskDraft', () => {
  it('plans a plain line for today', () => {
    const draft = todayTaskDraft('  Email   mentor about term plan ', ctx)
    expect(draft?.day).toBe('2026-09-29')
    expect(draft?.input).toMatchObject({
      title: 'Email mentor about term plan',
      doDate: '2026-09-29',
      priority: 0,
      tags: [],
    })
  })

  it('reads Quick add words: length, priority, tag, pomodoros', () => {
    const draft = todayTaskDraft('Review C182 flashcards 30m !high #C182 ~2', ctx)
    expect(draft?.input).toMatchObject({
      title: 'Review C182 flashcards',
      doDate: '2026-09-29',
      durationMinutes: 30,
      priority: 3,
      estimatePomodoros: 2,
    })
    expect(draft?.input.tags).toContain('C182')
  })

  it('honours a day named in the line, and says so', () => {
    const draft = todayTaskDraft('Submit C779 project tomorrow 2p', ctx)
    expect(draft?.day).toBe('2026-09-30')
    expect(draft?.input).toMatchObject({ doDate: '2026-09-30', doTime: '14:00' })
  })

  it('keeps the words when nothing but tokens was typed', () => {
    const draft = todayTaskDraft('tomorrow', ctx)
    expect(draft?.input.title).toBe('tomorrow')
  })

  it('makes nothing of a blank line', () => {
    expect(todayTaskDraft('   ', ctx)).toBeNull()
  })
})
