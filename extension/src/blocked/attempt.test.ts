import { describe, expect, it } from 'vitest'
import { shouldLogAttempt } from './attempt.js'

describe('shouldLogAttempt', () => {
  it('counts a top-frame navigation, with or without a referrer', () => {
    expect(shouldLogAttempt({ isTopFrame: true, navigationType: 'navigate' })).toBe(true)
    expect(shouldLogAttempt({ isTopFrame: true, navigationType: '' })).toBe(true)
  })

  it('does not count a page framed by another site', () => {
    expect(shouldLogAttempt({ isTopFrame: false, navigationType: 'navigate' })).toBe(false)
  })

  it('does not count a reload or Back/Forward, so refreshing the page cannot pad the count', () => {
    expect(shouldLogAttempt({ isTopFrame: true, navigationType: 'reload' })).toBe(false)
    expect(shouldLogAttempt({ isTopFrame: true, navigationType: 'back_forward' })).toBe(false)
    expect(shouldLogAttempt({ isTopFrame: true, navigationType: 'prerender' })).toBe(false)
  })
})
