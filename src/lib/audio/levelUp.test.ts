import { describe, expect, it } from 'vitest'
import { LEVEL_UP_PARTIALS, levelUpEnvelope, levelUpLength, levelUpSchedule } from './levelUp'

describe('levelUpSchedule', () => {
  it('is a rising three-note arpeggio', () => {
    const notes = levelUpSchedule(0.6)
    expect(notes).toHaveLength(3)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]?.freq).toBeGreaterThan(notes[i - 1]?.freq ?? Infinity)
      expect(notes[i]?.start).toBeGreaterThan(notes[i - 1]?.start ?? Infinity)
    }
  })

  it('finishes within about a second and a half, so it never outstays the moment', () => {
    const length = levelUpLength(levelUpSchedule(0.6))
    expect(length).toBeGreaterThan(1.0)
    expect(length).toBeLessThan(1.6)
  })

  it('keeps every partial audible but not shrill', () => {
    for (const note of levelUpSchedule(1)) {
      for (const p of LEVEL_UP_PARTIALS) {
        expect(note.freq * p.ratio).toBeGreaterThan(200)
        expect(note.freq * p.ratio).toBeLessThan(5000)
      }
    }
  })

  it('scales with volume and is empty when muted', () => {
    const quiet = levelUpSchedule(0.3)[0]?.gain ?? 0
    const loud = levelUpSchedule(0.9)[0]?.gain ?? 0
    expect(loud).toBeGreaterThan(quiet)
    expect(levelUpSchedule(0)).toEqual([])
    expect(levelUpSchedule(NaN)).toEqual([])
  })

  it('shapes each partial as a struck bell that ends inside its note', () => {
    for (const note of levelUpSchedule(0.6)) {
      for (const p of LEVEL_UP_PARTIALS) {
        const env = levelUpEnvelope(note, p)
        expect(env.attack).toBeGreaterThan(0)
        expect(env.tau).toBeGreaterThan(0)
        expect(env.duration).toBe(note.duration)
      }
    }
  })
})
