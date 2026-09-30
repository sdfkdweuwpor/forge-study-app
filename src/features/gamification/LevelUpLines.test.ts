import { describe, expect, it } from 'vitest'
import { LEVEL_UP_LINES, levelUpLine } from './LevelUpLines'

describe('levelUpLine', () => {
  it('starts with the brief’s line at level 2', () => {
    expect(levelUpLine(2)).toBe('You’re building something real.')
  })

  it('is the same for the same level and moves on for the next', () => {
    expect(levelUpLine(8)).toBe(levelUpLine(8))
    expect(levelUpLine(9)).not.toBe(levelUpLine(8))
  })

  it('always returns a line, whatever the level', () => {
    for (const level of [-3, 0, 1, 2, 7, 99, 1000, 2.5, NaN, Infinity]) {
      expect(LEVEL_UP_LINES).toContain(levelUpLine(level))
    }
  })

  it('never scolds: no line mentions missing, losing or failing', () => {
    for (const line of LEVEL_UP_LINES) expect(line).not.toMatch(/miss|lose|lost|fail|behind|guilt/i)
  })
})
