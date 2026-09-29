import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, APP_URL, DEFAULT_EXTENSION_ID } from '@/config'

describe('config', () => {
  it('exposes the shared constants', () => {
    expect(APP_ORIGIN).toBe('https://forge-study-app.netlify.app')
    expect(APP_URL.startsWith(APP_ORIGIN)).toBe(true)
    expect(DEFAULT_EXTENSION_ID).toHaveLength(32)
  })

  it('runs in the America/New_York time zone', () => {
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).toBe(240)
  })

  it('has a working IndexedDB', () => {
    expect(typeof indexedDB.open).toBe('function')
  })
})
