import { describe, expect, it } from 'vitest'
import { PAGE_EMOJI } from './emoji'

describe('PAGE_EMOJI', () => {
  it('offers about sixty icons in complete rows of ten', () => {
    expect(PAGE_EMOJI.length).toBe(60)
    expect(PAGE_EMOJI.length % 10).toBe(0)
  })

  it('has no duplicate icons or names', () => {
    expect(new Set(PAGE_EMOJI.map((e) => e.char)).size).toBe(PAGE_EMOJI.length)
    expect(new Set(PAGE_EMOJI.map((e) => e.name)).size).toBe(PAGE_EMOJI.length)
  })

  it('includes the study staples', () => {
    const chars = PAGE_EMOJI.map((e) => e.char)
    for (const c of ['🎓', '📚', '🎯', '💻', '🧠', '📝', '🏆', '🔥', '⏱️', '🌱']) {
      expect(chars).toContain(c)
    }
  })
})
