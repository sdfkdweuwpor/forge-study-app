import { describe, expect, it } from 'vitest'
import { isUnlockPhrase, pickMotivation, UNLOCK_PHRASE, waitSecondsLeft } from './unlock.js'

describe('isUnlockPhrase', () => {
  it('accepts the exact phrase, tolerating surrounding whitespace only', () => {
    expect(isUnlockPhrase('I choose distraction over my goals')).toBe(true)
    expect(isUnlockPhrase('  I choose distraction over my goals \n')).toBe(true)
    expect(isUnlockPhrase(UNLOCK_PHRASE)).toBe(true)
  })

  it('rejects near misses', () => {
    expect(isUnlockPhrase('i choose distraction over my goals')).toBe(false)
    expect(isUnlockPhrase('I choose distraction over my goals.')).toBe(false)
    expect(isUnlockPhrase('I choose distraction  over my goals')).toBe(false)
    expect(isUnlockPhrase('I choose distraction over my')).toBe(false)
    expect(isUnlockPhrase('')).toBe(false)
  })
})

describe('waitSecondsLeft', () => {
  it('counts down from a deadline, rounding up, never below zero', () => {
    expect(waitSecondsLeft(60_000, 0)).toBe(60)
    expect(waitSecondsLeft(60_000, 59_100)).toBe(1)
    expect(waitSecondsLeft(60_000, 60_000)).toBe(0)
    expect(waitSecondsLeft(60_000, 90_000)).toBe(0)
  })

  it('a throttled tab that wakes up late still lands on the right number', () => {
    // The interval fired at 1s, then not again until 41s: the display must read 19, not 59.
    expect(waitSecondsLeft(60_000, 41_000)).toBe(19)
  })
})

describe('pickMotivation', () => {
  const lines = ['One.', 'Two.', 'Three.']

  it('picks by the random value and never runs off the end', () => {
    expect(pickMotivation(lines, () => 0)).toBe('One.')
    expect(pickMotivation(lines, () => 0.5)).toBe('Two.')
    expect(pickMotivation(lines, () => 0.999999)).toBe('Three.')
    expect(pickMotivation(lines, () => 1)).toBe('Three.')
  })

  it('skips blank lines and returns null for an empty list', () => {
    expect(pickMotivation(['', '  ', 'Only this.'], () => 0)).toBe('Only this.')
    expect(pickMotivation([])).toBeNull()
    expect(pickMotivation([' '])).toBeNull()
  })
})
