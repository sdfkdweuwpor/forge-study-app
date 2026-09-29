import { describe, expect, it } from 'vitest'
import { __test, newId } from '@/lib/ids'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  it('returns unique v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 500 }, newId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })

  it('has a getRandomValues fallback that yields v4 UUIDs', () => {
    for (let i = 0; i < 100; i++) expect(__test.uuidFromRandomValues()).toMatch(UUID_V4)
  })
})
