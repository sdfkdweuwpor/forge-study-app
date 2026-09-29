import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  cleanViewName,
  createSavedView,
  DEFAULT_VIEW_ICON,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  MAX_VIEW_NAME_LENGTH,
  moveSavedView,
  renameSavedView,
  updateSavedView,
} from '@/db/repos/views'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('cleanViewName', () => {
  it('collapses whitespace, trims and cuts to the limit', () => {
    expect(cleanViewName('  High   priority \n this week ')).toBe('High priority this week')
    expect(cleanViewName('   ')).toBe('')
    expect(cleanViewName('x'.repeat(200))).toHaveLength(MAX_VIEW_NAME_LENGTH)
  })
})

describe('createSavedView', () => {
  it('stores a view with its layout, filter, sort and grouping, and a default icon', async () => {
    const view = await createSavedView(
      {
        name: '  C779 this week ',
        layout: 'board',
        filter: { milestoneIds: ['course-c779'], priority: [], due: 'week' },
        sort: { key: 'due', dir: 'asc' },
        groupBy: 'project',
      },
      { now: NOW },
    )
    expect(view).toMatchObject({
      name: 'C779 this week',
      icon: DEFAULT_VIEW_ICON,
      layout: 'board',
      // Empty filter keys are not stored.
      filter: { milestoneIds: ['course-c779'], due: 'week' },
      sort: { key: 'due', dir: 'asc' },
      groupBy: 'project',
      createdAt: NOW,
      updatedAt: NOW,
      order: NOW,
    })
    expect(await db.savedViews.get(view.id)).toEqual(view)
  })

  it('defaults to the manual sort grouped by date, and keeps a chosen icon', async () => {
    const view = await createSavedView(
      { name: 'Everything', icon: '🎯', layout: 'list' },
      { now: NOW },
    )
    expect(view.icon).toBe('🎯')
    expect(view.sort).toEqual({ key: 'manual', dir: 'asc' })
    expect(view.groupBy).toBe('date')
    expect(view.filter).toEqual({})
  })

  it('refuses a name with nothing in it', async () => {
    await expect(createSavedView({ name: '   ', layout: 'list' })).rejects.toThrow(RangeError)
    expect(await db.savedViews.count()).toBe(0)
  })

  it('appends, so the list keeps creation order', async () => {
    const a = await createSavedView({ name: 'A', layout: 'list' }, { now: NOW })
    const b = await createSavedView({ name: 'B', layout: 'list' }, { now: NOW + 1 })
    const c = await createSavedView({ name: 'C', layout: 'list' }, { now: NOW + 2 })
    expect((await listSavedViews()).map((v) => v.id)).toEqual([a.id, b.id, c.id])
  })
})

describe('updateSavedView / renameSavedView', () => {
  it('changes only what differs and stamps updatedAt', async () => {
    const view = await createSavedView({ name: 'Mentor', layout: 'list' }, { now: NOW })
    const result = await updateSavedView(
      view.id,
      { layout: 'calendar', filter: { tags: ['mentor'] }, sort: { key: 'due', dir: 'asc' } },
      { now: NOW + 5_000 },
    )
    expect(result?.view).toMatchObject({
      name: 'Mentor',
      layout: 'calendar',
      filter: { tags: ['mentor'] },
      sort: { key: 'due', dir: 'asc' },
      updatedAt: NOW + 5_000,
      createdAt: NOW,
    })
  })

  it('writes nothing for a patch that changes nothing', async () => {
    const view = await createSavedView({ name: 'Mentor', layout: 'list' }, { now: NOW })
    const result = await updateSavedView(
      view.id,
      { name: 'Mentor', layout: 'list' },
      { now: NOW + 9 },
    )
    expect(result?.view.updatedAt).toBe(NOW)
    expect((await getSavedView(view.id))?.updatedAt).toBe(NOW)
  })

  it('renames, cleaning the name, and ignores a blank one', async () => {
    const view = await createSavedView({ name: 'Old', layout: 'list' }, { now: NOW })
    expect((await renameSavedView(view.id, '  New   name ', { now: NOW + 1 }))?.view.name).toBe(
      'New name',
    )
    expect((await renameSavedView(view.id, '   '))?.view.name).toBe('New name')
  })

  it('undo puts the earlier values back', async () => {
    const view = await createSavedView({ name: 'Old', layout: 'list' }, { now: NOW })
    const result = await renameSavedView(view.id, 'New', { now: NOW + 1 })
    await result?.undo()
    expect(await getSavedView(view.id)).toEqual(view)
  })

  it('undo does not bring back a view deleted in the meantime', async () => {
    const view = await createSavedView({ name: 'Old', layout: 'list' }, { now: NOW })
    const result = await renameSavedView(view.id, 'New', { now: NOW + 1 })
    await deleteSavedView(view.id)
    await result?.undo()
    expect(await getSavedView(view.id)).toBeNull()
  })

  it('returns null for a view that does not exist', async () => {
    expect(await updateSavedView('nope', { name: 'x' })).toBeNull()
    expect(await renameSavedView('nope', 'x')).toBeNull()
  })
})

describe('deleteSavedView', () => {
  it('removes the row and undo restores it exactly, in the same place', async () => {
    const a = await createSavedView({ name: 'A', layout: 'list' }, { now: NOW })
    const b = await createSavedView({ name: 'B', layout: 'board' }, { now: NOW + 1 })
    const c = await createSavedView({ name: 'C', layout: 'list' }, { now: NOW + 2 })
    const result = await deleteSavedView(b.id)
    expect(result?.view).toEqual(b)
    expect((await listSavedViews()).map((v) => v.id)).toEqual([a.id, c.id])
    await result?.undo()
    expect(await getSavedView(b.id)).toEqual(b)
    expect((await listSavedViews()).map((v) => v.id)).toEqual([a.id, b.id, c.id])
  })

  it('returns null for a view that does not exist', async () => {
    expect(await deleteSavedView('nope')).toBeNull()
  })
})

describe('moveSavedView', () => {
  it('puts a view between two neighbours by rewriting only that row', async () => {
    const a = await createSavedView({ name: 'A', layout: 'list' }, { now: NOW })
    const b = await createSavedView({ name: 'B', layout: 'list' }, { now: NOW + 10 })
    const c = await createSavedView({ name: 'C', layout: 'list' }, { now: NOW + 20 })
    await moveSavedView(c.id, a.id, b.id)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['A', 'C', 'B'])
    expect((await getSavedView(a.id))?.order).toBe(a.order)
    expect((await getSavedView(b.id))?.order).toBe(b.order)
  })

  it('moves to either end', async () => {
    const a = await createSavedView({ name: 'A', layout: 'list' }, { now: NOW })
    const b = await createSavedView({ name: 'B', layout: 'list' }, { now: NOW + 10 })
    await moveSavedView(b.id, null, a.id)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['B', 'A'])
    await moveSavedView(b.id, a.id, null)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['A', 'B'])
  })

  it('renumbers the list once when neighbours are too close together', async () => {
    const a = await createSavedView({ name: 'A', layout: 'list' }, { now: 1_000 })
    const b = await createSavedView({ name: 'B', layout: 'list' }, { now: 1_000.0001 })
    const c = await createSavedView({ name: 'C', layout: 'list' }, { now: 2_000 })
    await moveSavedView(c.id, a.id, b.id)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['A', 'C', 'B'])
  })

  it('returns null for a view that does not exist', async () => {
    expect(await moveSavedView('nope', null, null)).toBeNull()
  })
})
