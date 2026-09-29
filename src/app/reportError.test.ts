import { describe, expect, it } from 'vitest'
import { getRecordedErrors, recordError, toError } from './reportError'

describe('toError', () => {
  it('passes real errors through untouched', () => {
    const e = new RangeError('too far')
    expect(toError(e)).toBe(e)
  })

  it('wraps strings, plain objects and nullish throws', () => {
    expect(toError('disk full').message).toBe('disk full')
    expect(toError({ message: 'Quota exceeded', name: 'QuotaExceededError' }).message).toBe(
      'Quota exceeded',
    )
    expect(toError({ code: 12 }).message).toBe('{"code":12}')
    expect(toError(null).message).toBe('Unknown error')
    expect(toError(undefined).message).toBe('Unknown error')
    expect(toError('').message).toBe('')
    expect(toError(42).message).toBe('42')
  })

  it('survives circular objects', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(toError(loop)).toBeInstanceOf(Error)
  })
})

describe('recordError', () => {
  it('logs the message and detail of any thrown value', () => {
    const before = getRecordedErrors().length
    recordError(null, 'window.error')
    const last = getRecordedErrors().at(-1)
    expect(getRecordedErrors().length).toBe(before + 1)
    expect(last).toMatchObject({ message: 'Unknown error', detail: 'window.error' })
  })
})
