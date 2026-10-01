import { describe, expect, it } from 'vitest'
import { promptAction, updateCheckDue } from './pwaUpdate'

describe('promptAction', () => {
  it('does nothing until an update is ready', () => {
    expect(promptAction({ updateReady: false, sessionActive: false, shown: false })).toBe('none')
    expect(promptAction({ updateReady: false, sessionActive: true, shown: false })).toBe('none')
  })

  it('shows the toast once, when the update is ready and no session runs', () => {
    expect(promptAction({ updateReady: true, sessionActive: false, shown: false })).toBe('show')
    expect(promptAction({ updateReady: true, sessionActive: false, shown: true })).toBe('none')
  })

  it('defers while a session runs, and never shows over one', () => {
    expect(promptAction({ updateReady: true, sessionActive: true, shown: false })).toBe('none')
  })

  it('takes a showing toast down when a session starts, and brings it back after', () => {
    expect(promptAction({ updateReady: true, sessionActive: true, shown: true })).toBe('hide')
    expect(promptAction({ updateReady: true, sessionActive: false, shown: false })).toBe('show')
  })

  it('waits while the session state is still loading', () => {
    expect(promptAction({ updateReady: true, sessionActive: undefined, shown: false })).toBe('none')
    expect(promptAction({ updateReady: true, sessionActive: undefined, shown: true })).toBe('none')
  })
})

describe('updateCheckDue', () => {
  const HOUR = 60 * 60 * 1000
  it('checks at once when it never has', () => {
    expect(updateCheckDue({ lastCheckAt: null, now: 5, online: true, minGapMs: HOUR })).toBe(true)
  })
  it('waits out the gap', () => {
    expect(updateCheckDue({ lastCheckAt: 0, now: HOUR - 1, online: true, minGapMs: HOUR })).toBe(
      false,
    )
    expect(updateCheckDue({ lastCheckAt: 0, now: HOUR, online: true, minGapMs: HOUR })).toBe(true)
  })
  it('never checks offline', () => {
    expect(
      updateCheckDue({ lastCheckAt: null, now: 5 * HOUR, online: false, minGapMs: HOUR }),
    ).toBe(false)
  })
})
