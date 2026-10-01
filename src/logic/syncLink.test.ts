import { describe, expect, it } from 'vitest'
import {
  LINK_EXPIRED_TEXT,
  LINK_FAILED_TEXT,
  cleanEmailCode,
  linkErrorMessage,
  looksLikeEmail,
  parseLinkReturn,
} from './syncLink'

const UUID = '3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10'

describe('parseLinkReturn', () => {
  it('finds the auth code in the query', () => {
    expect(parseLinkReturn({ code: UUID }, '')).toEqual({ kind: 'code', code: UUID })
  })

  it('finds an error in the query or the fragment, and prefers its code', () => {
    expect(parseLinkReturn({ error: 'access_denied', error_code: 'otp_expired' }, '')).toEqual({
      kind: 'error',
      errorCode: 'otp_expired',
    })
    expect(parseLinkReturn({}, '#error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'error',
      errorCode: 'otp_expired',
    })
    expect(parseLinkReturn({ error: 'access_denied' }, '')).toEqual({
      kind: 'error',
      errorCode: 'access_denied',
    })
  })

  it('an error wins over a code', () => {
    expect(parseLinkReturn({ code: UUID, error: 'server_error' }, '')).toEqual({
      kind: 'error',
      errorCode: 'server_error',
    })
  })

  it('has nothing to say about an ordinary address', () => {
    expect(parseLinkReturn({}, '')).toBeNull()
    expect(parseLinkReturn({ tab: 'x' }, '#top')).toBeNull()
  })

  it('does not exchange a code that cannot be one', () => {
    expect(parseLinkReturn({ code: '' }, '')).toBeNull()
    expect(parseLinkReturn({ code: 'short' }, '')).toBeNull()
    expect(parseLinkReturn({ code: 'has spaces in it, not a code' }, '')).toBeNull()
    expect(parseLinkReturn({ code: 'x'.repeat(201) }, '')).toBeNull()
  })
})

describe('linkErrorMessage', () => {
  it('says a used or expired link is used up, and never repeats the server', () => {
    expect(linkErrorMessage('otp_expired')).toBe(LINK_EXPIRED_TEXT)
    expect(linkErrorMessage('access_denied')).toBe(LINK_EXPIRED_TEXT)
    expect(linkErrorMessage('unexpected_failure')).toBe(LINK_FAILED_TEXT)
    expect(linkErrorMessage(null)).toBe(LINK_FAILED_TEXT)
  })
})

describe('looksLikeEmail', () => {
  it('accepts an address and refuses what is plainly not one', () => {
    expect(looksLikeEmail('ana@example.com')).toBe(true)
    expect(looksLikeEmail('  ana.k+forge@wgu.edu ')).toBe(true)
    expect(looksLikeEmail('')).toBe(false)
    expect(looksLikeEmail('ana')).toBe(false)
    expect(looksLikeEmail('ana@example')).toBe(false)
    expect(looksLikeEmail('ana @example.com')).toBe(false)
  })
})

describe('cleanEmailCode', () => {
  it('takes 6 to 10 digits, however the mail app spaced them', () => {
    expect(cleanEmailCode('123456')).toBe('123456')
    expect(cleanEmailCode(' 123 456 ')).toBe('123456')
    expect(cleanEmailCode('123-456')).toBe('123456')
    expect(cleanEmailCode('1234567890')).toBe('1234567890')
  })

  it('refuses everything else', () => {
    expect(cleanEmailCode('')).toBeNull()
    expect(cleanEmailCode('12345')).toBeNull()
    expect(cleanEmailCode('12345678901')).toBeNull()
    expect(cleanEmailCode('12345a')).toBeNull()
  })
})
