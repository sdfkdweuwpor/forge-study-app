import { describe, expect, it } from 'vitest'
import { UndoRefusedError, isUndoRefused } from './undo'

describe('UndoRefusedError', () => {
  it('is recognised, subclasses included, and keeps its message', () => {
    class Specific extends UndoRefusedError {}
    const error = new Specific('The task changed since, so it was kept')
    expect(isUndoRefused(error)).toBe(true)
    expect(error.message).toBe('The task changed since, so it was kept')
    expect(error).toBeInstanceOf(Error)
  })

  it('does not match other errors', () => {
    expect(isUndoRefused(new Error('boom'))).toBe(false)
    expect(isUndoRefused('changed since')).toBe(false)
    expect(isUndoRefused(null)).toBe(false)
  })
})
