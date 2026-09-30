import { describe, expect, it } from 'vitest'
import { buildOnboardingTasks, STARTER_TAG } from './onboardingTasks'

const TODAY = '2026-09-29'

describe('buildOnboardingTasks', () => {
  const tasks = buildOnboardingTasks(TODAY)

  it('makes exactly three tasks: two for today and one for tomorrow', () => {
    expect(tasks.map((t) => t.title)).toEqual([
      'Take a 25-minute focus session',
      'Add your first real task with Q',
      'Look around My World',
    ])
    expect(tasks.map((t) => t.doDate)).toEqual([TODAY, TODAY, '2026-09-30'])
  })

  it('marks them as onboarding tasks with stable, distinct ids and a shared tag', () => {
    expect(tasks.every((t) => t.source === 'onboarding')).toBe(true)
    expect(tasks.every((t) => t.tags?.includes(STARTER_TAG))).toBe(true)
    const ids = tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(3)
    expect(buildOnboardingTasks(TODAY).map((t) => t.id)).toEqual(ids)
  })

  it('keeps the two tasks for today in a fixed order', () => {
    expect(tasks.slice(0, 2).map((t) => t.orderInDay)).toEqual([0, 1])
  })

  it('gives every task a note that says how to do it', () => {
    for (const t of tasks) expect((t.notes ?? []).length).toBeGreaterThan(0)
  })

  it('dates tomorrow across a month end', () => {
    expect(buildOnboardingTasks('2026-10-31')[2]?.doDate).toBe('2026-11-01')
  })
})
