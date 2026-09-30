import { describe, expect, it } from 'vitest'
import { isTabSwitch, pageKeyOf } from './pageKey'

describe('pageKeyOf', () => {
  it('keys a page that has no params by its route, so it stays mounted', () => {
    expect(pageKeyOf({ name: 'progress', params: {} }, '/progress')).toBe('progress')
  })

  it('keys a page with params by its path, so another goal, course or task remounts', () => {
    expect(pageKeyOf({ name: 'goal', params: { goalId: 'goal-a' } }, '/goals/goal-a')).toBe(
      '/goals/goal-a',
    )
    expect(pageKeyOf({ name: 'goal', params: { goalId: 'goal-b' } }, '/goals/goal-b')).not.toBe(
      pageKeyOf({ name: 'goal', params: { goalId: 'goal-a' } }, '/goals/goal-a'),
    )
  })

  it('keeps Rewards and Settings mounted when the tab or section in the address changes', () => {
    expect(pageKeyOf({ name: 'rewards', params: { tab: 'badges' } }, '/rewards/badges')).toBe(
      pageKeyOf({ name: 'rewards', params: {} }, '/rewards'),
    )
    expect(pageKeyOf({ name: 'rewards', params: { tab: 'history' } }, '/rewards/history')).toBe(
      'rewards',
    )
    expect(pageKeyOf({ name: 'settings', params: { section: 'data' } }, '/settings/data')).toBe(
      'settings',
    )
  })

  it('still remounts a task list, whose param is which list to show', () => {
    expect(pageKeyOf({ name: 'tasks', params: { list: 'all' } }, '/tasks/all')).toBe('/tasks/all')
  })
})

describe('isTabSwitch', () => {
  it('is true only for a change between two tabs of the same tabbed page', () => {
    expect(isTabSwitch('rewards', 'rewards')).toBe(true)
    expect(isTabSwitch('today', 'rewards')).toBe(false)
    expect(isTabSwitch('rewards', 'today')).toBe(false)
  })

  it('leaves the other pages with params to announce as before', () => {
    expect(isTabSwitch('settings', 'settings')).toBe(false)
    expect(isTabSwitch('goal', 'goal')).toBe(false)
  })
})
