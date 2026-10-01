import { describe, expect, it } from 'vitest'
import { seedRequest } from './boot'

describe('seedRequest', () => {
  it('honours ?seed=wgu and ?seed=empty when seeding is enabled', () => {
    expect(seedRequest('?seed=wgu', true)).toBe('wgu')
    expect(seedRequest('?tab=all&seed=empty', true)).toBe('empty')
    expect(seedRequest('?seed=wgu-year', true)).toBe('wgu-year')
  })

  it('never seeds when the build did not enable it, whatever the link says', () => {
    expect(seedRequest('?seed=wgu', false)).toBeNull()
    expect(seedRequest('?seed=empty', false)).toBeNull()
    expect(seedRequest('?seed=wgu-year', false)).toBeNull()
  })

  it('ignores unknown or missing values', () => {
    expect(seedRequest('', true)).toBeNull()
    expect(seedRequest('?seed=', true)).toBeNull()
    expect(seedRequest('?seed=everything', true)).toBeNull()
    expect(seedRequest('?seed=WGU', true)).toBeNull()
  })
})
