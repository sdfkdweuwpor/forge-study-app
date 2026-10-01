import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, APP_URL, DEFAULT_EXTENSION_ID, FALLBACK_ORIGIN } from '@/config'

describe('config', () => {
  it('exposes the shared constants', () => {
    expect(APP_ORIGIN).toBe('https://sdfkdweuwpor.github.io')
    expect(APP_URL).toBe('https://sdfkdweuwpor.github.io/forge-study-app/')
    expect(FALLBACK_ORIGIN).toBe('https://forge-study-app.netlify.app')
    expect(DEFAULT_EXTENSION_ID).toHaveLength(32)
  })

  it('runs in the America/New_York time zone', () => {
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).toBe(240)
  })

  it('has a working IndexedDB', () => {
    expect(typeof indexedDB.open).toBe('function')
  })
})
