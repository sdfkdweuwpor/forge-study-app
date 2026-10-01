import { describe, expect, it } from 'vitest'
import { canAutoReload, isChunkLoadError } from './chunkError'

describe('isChunkLoadError', () => {
  it('recognises the message each engine uses for a failed dynamic import', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://forge-study-app.netlify.app/assets/GoalsPage-3fA9c1.js',
      'error loading dynamically imported module: https://forge-study-app.netlify.app/assets/GoalsPage-3fA9c1.js',
      'Importing a module script failed.',
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
      'Unable to preload CSS for /assets/GoalsPage-9c2d.css',
      'Loading chunk 42 failed.',
    ]) {
      expect(isChunkLoadError(new TypeError(message)), message).toBe(true)
    }
  })

  it('recognises a named ChunkLoadError', () => {
    const e = new Error('boom')
    e.name = 'ChunkLoadError'
    expect(isChunkLoadError(e)).toBe(true)
  })

  it('does not treat ordinary failures as chunk failures', () => {
    expect(
      isChunkLoadError(new Error("Cannot read properties of undefined (reading 'title')")),
    ).toBe(false)
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('canAutoReload', () => {
  const NOW = 1_800_000_000_000

  it('allows the first reload', () => {
    expect(canAutoReload(null, NOW)).toBe(true)
    expect(canAutoReload(Number.NaN, NOW)).toBe(true)
  })

  it('blocks a second reload inside the window, so a permanent failure cannot loop', () => {
    expect(canAutoReload(NOW - 1_000, NOW)).toBe(false)
    expect(canAutoReload(NOW - 29_999, NOW)).toBe(false)
  })

  it('allows another reload once the window has passed (a later deploy)', () => {
    expect(canAutoReload(NOW - 30_000, NOW)).toBe(true)
    expect(canAutoReload(NOW - 3_600_000, NOW)).toBe(true)
  })

  it('treats a timestamp from the future (clock change) as stale', () => {
    expect(canAutoReload(NOW + 60_000, NOW)).toBe(true)
  })
})
