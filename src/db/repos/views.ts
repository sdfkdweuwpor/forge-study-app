/**
 * Saved views (BRIEF §5.3: "sorting, filtering and saved views like Notion databases"). A view is a
 * name, an emoji icon and the layout, filter, sort and grouping it shows. Components call these; they
 * never touch `db.savedViews`. Deleting is reversible: `deleteSavedView` returns an `undo()` that puts
 * the row back exactly as it was (same id and timestamps, so the sidebar link keeps working).
 */
import { newId } from '@/lib/ids'
import { isCrowded, orderBetween } from '@/logic/order'
import { normalizeFilter } from '@/logic/taskViews'
import { db } from '../db'
import type { ID, Millis, SavedView, TaskFilter, TaskSort } from '../types'

export interface RepoOptions {
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: Millis
}

export interface Undoable {
  undo: () => Promise<void>
}

export const DEFAULT_VIEW_ICON = '📌'
export const MAX_VIEW_NAME_LENGTH = 60

export interface SavedViewInput {
  name: string
  icon?: string
  layout: SavedView['layout']
  filter?: TaskFilter
  sort?: TaskSort
  groupBy?: SavedView['groupBy']
}

/** Whitespace collapsed, trimmed and cut to `MAX_VIEW_NAME_LENGTH`. Empty means "not a name". */
export function cleanViewName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_VIEW_NAME_LENGTH).trim()
}

const cleanIcon = (icon: string | undefined): string => {
  const trimmed = icon?.trim()
  return trimmed ? trimmed : DEFAULT_VIEW_ICON
}

/** Every saved view in sidebar order. */
export async function listSavedViews(): Promise<SavedView[]> {
  return db.savedViews.orderBy('order').toArray()
}

export async function getSavedView(id: ID): Promise<SavedView | null> {
  return (await db.savedViews.get(id)) ?? null
}

/** Adds a view at the end of the list. Throws a `RangeError` for a name with no letters in it. */
export async function createSavedView(
  input: SavedViewInput,
  opts: RepoOptions = {},
): Promise<SavedView> {
  const now = opts.now ?? Date.now()
  const name = cleanViewName(input.name)
  if (name === '') throw new RangeError('A view needs a name')
  const view: SavedView = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name,
    icon: cleanIcon(input.icon),
    layout: input.layout,
    filter: normalizeFilter(input.filter ?? {}),
    sort: input.sort ?? { key: 'manual', dir: 'asc' },
    groupBy: input.groupBy ?? 'date',
    // Time-based, like tasks: appending never scans the table.
    order: now,
  }
  await db.savedViews.add(view)
  return view
}

export type SavedViewPatch = Partial<
  Pick<SavedView, 'name' | 'icon' | 'layout' | 'sort' | 'groupBy'>
> & {
  filter?: TaskFilter
}

export interface SavedViewUpdate extends Undoable {
  view: SavedView
}

/**
 * Changes a view's name, icon, layout, filter, sort or grouping. A blank name is ignored (the old
 * one stays). Returns the saved view and an `undo()`, or `null` when the view no longer exists.
 */
export async function updateSavedView(
  id: ID,
  patch: SavedViewPatch,
  opts: RepoOptions = {},
): Promise<SavedViewUpdate | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.savedViews, async () => {
    const before = await db.savedViews.get(id)
    if (!before) return null
    const changes: Partial<SavedView> = {}
    if (patch.name !== undefined) {
      const name = cleanViewName(patch.name)
      if (name !== '' && name !== before.name) changes.name = name
    }
    if (patch.icon !== undefined) {
      const icon = cleanIcon(patch.icon)
      if (icon !== before.icon) changes.icon = icon
    }
    if (patch.layout !== undefined && patch.layout !== before.layout) changes.layout = patch.layout
    if (patch.groupBy !== undefined && patch.groupBy !== before.groupBy)
      changes.groupBy = patch.groupBy
    if (patch.sort !== undefined) changes.sort = patch.sort
    if (patch.filter !== undefined) changes.filter = normalizeFilter(patch.filter)
    if (Object.keys(changes).length === 0) return { view: before, undo: async () => undefined }
    await db.savedViews.update(id, { ...changes, updatedAt: now })
    const view = (await db.savedViews.get(id)) ?? before
    return {
      view,
      undo: async () => {
        // Puts the row back exactly, unless it has been deleted since.
        await db.transaction('rw', db.savedViews, async () => {
          if (await db.savedViews.get(id)) await db.savedViews.put(before)
        })
      },
    }
  })
}

/** Renames a view. A name with no letters is refused and the old one stays. */
export async function renameSavedView(
  id: ID,
  name: string,
  opts: RepoOptions = {},
): Promise<SavedViewUpdate | null> {
  return updateSavedView(id, { name }, opts)
}

/** Deletes a view. `undo()` restores the same row (a later delete of the same id is not resurrected twice). */
export async function deleteSavedView(id: ID): Promise<(Undoable & { view: SavedView }) | null> {
  return db.transaction('rw', db.savedViews, async () => {
    const view = await db.savedViews.get(id)
    if (!view) return null
    await db.savedViews.delete(id)
    return {
      view,
      undo: async () => {
        await db.savedViews.put(view)
      },
    }
  })
}

/**
 * Moves a view between two neighbours in the sidebar (either is `null` at the ends of the list).
 * Only the moved row is rewritten; when neighbours have grown too close the list is renumbered once.
 */
export async function moveSavedView(
  id: ID,
  above: ID | null,
  below: ID | null,
  opts: RepoOptions = {},
): Promise<SavedView | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.savedViews, async () => {
    if (!(await db.savedViews.get(id))) return null
    const orderOf = async (other: ID | null): Promise<number | null> =>
      other === null ? null : ((await db.savedViews.get(other))?.order ?? null)
    let a = await orderOf(above)
    let b = await orderOf(below)
    if (isCrowded(a, b)) {
      const rows = (await db.savedViews.orderBy('order').toArray()).filter((v) => v.id !== id)
      const at = above === null ? 0 : rows.findIndex((v) => v.id === above) + 1
      const moved = await db.savedViews.get(id)
      if (moved) rows.splice(at, 0, moved)
      await db.savedViews.bulkUpdate(
        rows.map((v, i) => ({ key: v.id, changes: { order: i * 1024 } })),
      )
      a = await orderOf(above)
      b = await orderOf(below)
    }
    await db.savedViews.update(id, { order: orderBetween(a, b), updatedAt: now })
    return (await db.savedViews.get(id)) ?? null
  })
}
