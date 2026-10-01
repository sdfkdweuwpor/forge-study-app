import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { claimLevelCelebration, initCelebratedLevel } from '@/db/repos/levels'
import { ensureSettings, getSettings, updateSettings } from '@/db/repos/settings'

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const last = async () => (await getSettings()).lastCelebratedLevel

describe('first start', () => {
  it('has no level recorded yet', async () => {
    await ensureSettings()
    expect(await last()).toBe(0)
  })

  it('records the current level silently when none was recorded, and only then', async () => {
    await ensureSettings()
    expect(await initCelebratedLevel(5)).toBe(true)
    expect(await last()).toBe(5)
    // A second start, at a higher level, is not a "first start": it is a celebration.
    expect(await initCelebratedLevel(9)).toBe(false)
    expect(await last()).toBe(5)
  })

  it('does not celebrate the level reached by seed or imported data', async () => {
    await ensureSettings()
    expect(await claimLevelCelebration(6)).toBe(false)
    await initCelebratedLevel(6)
    expect(await claimLevelCelebration(6)).toBe(false)
  })
})

describe('claimLevelCelebration', () => {
  beforeEach(async () => {
    await ensureSettings()
    await updateSettings({ lastCelebratedLevel: 7 })
  })

  it('records a higher level and says the caller owns the celebration', async () => {
    expect(await claimLevelCelebration(8)).toBe(true)
    expect(await last()).toBe(8)
  })

  it('never celebrates the same level twice, and never lowers the record', async () => {
    expect(await claimLevelCelebration(8)).toBe(true)
    expect(await claimLevelCelebration(8)).toBe(false)
    expect(await claimLevelCelebration(7)).toBe(false)
    expect(await last()).toBe(8)
  })

  it('goes straight to the highest level when several were crossed at once', async () => {
    expect(await claimLevelCelebration(10)).toBe(true)
    expect(await last()).toBe(10)
    expect(await claimLevelCelebration(9)).toBe(false)
  })

  it('gives the celebration to exactly one of two tabs racing for it', async () => {
    const results = await Promise.all([claimLevelCelebration(8), claimLevelCelebration(8)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await last()).toBe(8)
  })
})
