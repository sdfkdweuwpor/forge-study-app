import { describe, expect, it } from 'vitest'
import { closestMatch, editDistance } from './suggest'

describe('editDistance', () => {
  it('counts single edits, ignoring case', () => {
    expect(editDistance('C182', 'c182')).toBe(0)
    expect(editDistance('C183', 'C182')).toBe(1)
    expect(editDistance('estimatedHour', 'estimatedHours')).toBe(1)
    expect(editDistance('', 'abc')).toBe(3)
  })
})

describe('closestMatch', () => {
  const keys = ['code', 'name', 'prerequisites', 'estimatedHours', 'targetDate']
  it('finds a near typo', () => {
    expect(closestMatch('estimatedHour', keys)).toBe('estimatedHours')
    expect(closestMatch('nmae', keys)).toBe('name')
  })
  it('finds an abbreviation by its shared start', () => {
    expect(closestMatch('prereqs', keys)).toBe('prerequisites')
    expect(closestMatch('prerequisite', keys)).toBe('prerequisites')
  })
  it('stays quiet when nothing is close', () => {
    expect(closestMatch('banana', keys)).toBeUndefined()
    expect(closestMatch('pre', keys)).toBeUndefined()
  })
})
