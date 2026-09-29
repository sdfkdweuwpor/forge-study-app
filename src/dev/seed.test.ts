import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { getXpSummary } from '@/db/repos/xp'
import { applySeed } from '@/dev/seed'
import { dayOf } from '@/logic/dates'
import { levelFromLifetimeXp } from '@/logic/xp'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const counts = async () =>
  Object.fromEntries(
    await Promise.all(db.tables.map(async (t) => [t.name, await t.count()] as const)),
  )

describe('applySeed("wgu")', () => {
  it('loads the goal, courses, units, tasks and XP, and ensures the settings row', async () => {
    await applySeed('wgu')
    const c = await counts()
    expect(c).toMatchObject({ goals: 1, milestones: 5, settings: 1 })
    expect(c.units).toBeGreaterThan(20)
    expect(c.tasks).toBeGreaterThanOrEqual(25)
    expect(c.xpEvents).toBeGreaterThan(10)
    const settings = await db.settings.get('app')
    expect(settings?.onboardedAt).not.toBeNull()
    expect(settings?.tagColors.C779).toBe('blue')
  })

  it('leaves XP consistent with the log: lifetime is the sum and the level follows it', async () => {
    await applySeed('wgu')
    const events = await db.xpEvents.toArray()
    const total = events.reduce((sum, e) => sum + e.amount, 0)
    const summary = await getXpSummary(dayOf(Date.now()))
    expect(summary.lifetime).toBe(total)
    expect(summary.level).toEqual(levelFromLifetimeXp(total))
    expect(summary.level.level).toBeGreaterThanOrEqual(3)
  })

  it('dates the data around today, so it looks current on any day', async () => {
    await applySeed('wgu')
    const today = dayOf(Date.now())
    const open = (await db.tasks.toArray()).filter((t) => t.status !== 'done')
    expect(open.some((t) => t.dueDate === today)).toBe(true)
    expect(open.some((t) => t.dueDate !== null && t.dueDate < today)).toBe(true)
  })

  it('is repeatable: seeding twice gives the same rows, not duplicates', async () => {
    await applySeed('wgu')
    const first = await counts()
    await applySeed('wgu')
    expect(await counts()).toEqual(first)
  })
})

describe('applySeed("empty")', () => {
  it('wipes every table and leaves only the settings row', async () => {
    await applySeed('wgu')
    await applySeed('empty')
    const c = await counts()
    const { settings, ...rest } = c
    expect(settings).toBe(1)
    expect(Object.values(rest).every((n) => n === 0)).toBe(true)
    expect((await db.settings.get('app'))?.onboardedAt).toBeNull()
  })

  it('works on a database that was never used', async () => {
    await applySeed('empty')
    expect(await db.settings.count()).toBe(1)
    expect(await db.tasks.count()).toBe(0)
  })
})
