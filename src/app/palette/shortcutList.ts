import type { ScopeId, ShortcutDef } from '../registry/types'

/**
 * The shortcut sheet's content (pure, unit-tested): every registered shortcut, grouped by its
 * `group`, optionally filtered by a search. The sheet renders this; nothing here is hand-listed,
 * so a shortcut a feature registers shows up on its own.
 */

export interface ShortcutRow {
  /** The first shortcut's id. */
  id: string
  description: string
  /** `ShortcutDef.keys` specs ('mod+k', 'g t'), one per way to do it (`j` and `↓` select the next task); the sheet draws each with Kbd. */
  keys: string[]
  /** Where it works, or null when it works everywhere or the group heading already says so. */
  scopeLabel: string | null
}

export interface ShortcutGroup {
  id: string
  heading: string
  rows: ShortcutRow[]
}

export const SCOPE_LABELS: Record<ScopeId, string> = {
  today: 'Today',
  tasks: 'Tasks',
  calendar: 'Calendar',
  focus: 'Focus',
  fullscreen: 'Full-screen focus',
  goal: 'Goal',
  course: 'Course',
  review: 'Review',
  cards: 'Flashcards',
  rewards: 'Rewards',
  progress: 'Progress',
  world: 'My World',
  blocker: 'Blocker',
  modal: 'Dialogs',
  menu: 'Menus',
  palette: 'Command palette',
  drawer: 'Navigation drawer',
}

/** Headings that lead the sheet, in this order; the rest follow A to Z. */
const GROUP_ORDER = [
  'General',
  'Navigation',
  'Tasks',
  'Today',
  'Focus',
  'Goals',
  'Calendar',
  'Review',
  'Flashcards',
] as const

const groupRank = (heading: string): number => {
  const i = (GROUP_ORDER as readonly string[]).indexOf(heading)
  return i === -1 ? GROUP_ORDER.length : i
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/**
 * @param keysText   how the keys read on this platform ("Ctrl K", "⌘ K"), so searching for what is
 *                   printed on the keycaps works. Defaults to the raw spec.
 * @param query      every word must start a word of the description, group, scope or keys. A query
 *                   that is itself part of some shortcut's keys ("g t", "mod k") shows just those.
 */
export function buildShortcutGroups(
  shortcuts: readonly ShortcutDef[],
  query = '',
  keysText: (keys: string) => string = (keys) => keys,
): ShortcutGroup[] {
  const phrase = query.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
  const words = phrase === '' ? [] : phrase.split(' ')

  const rows = shortcuts.map((s) => {
    const scopeLabel = s.scope === 'global' ? null : SCOPE_LABELS[s.scope]
    const keyTexts = [s.keys, keysText(s.keys)].map((k) => k.toLowerCase().replace(/\+/g, ' '))
    const tokens = [s.description, s.group, scopeLabel ?? 'everywhere', ...keyTexts]
      .join(' ')
      .toLowerCase()
      .split(/[\s+]+/)
    return {
      def: s,
      scoped: scopeLabel !== null,
      // "Tasks" under the heading "Tasks" says nothing.
      shownScope: scopeLabel !== s.group ? scopeLabel : null,
      keyMatch: phrase !== '' && keyTexts.some((k) => k.includes(phrase)),
      wordMatch: words.every((w) => tokens.some((t) => t.startsWith(w))),
    }
  })

  const byKeys = rows.some((r) => r.keyMatch)
  const kept = words.length === 0 ? rows : rows.filter((r) => (byKeys ? r.keyMatch : r.wordMatch))

  // One row per action: shortcuts with the same description in the same group and scope share it.
  interface Entry extends ShortcutRow {
    scoped: boolean
  }
  const byHeading = new Map<string, Entry[]>()
  for (const { def, scoped, shownScope } of kept) {
    const list = byHeading.get(def.group) ?? []
    const same = list.find((r) => r.description === def.description && r.scopeLabel === shownScope)
    if (same && same.scoped === scoped) same.keys.push(def.keys)
    else
      list.push({
        id: def.id,
        description: def.description,
        keys: [def.keys],
        scopeLabel: shownScope,
        scoped,
      })
    byHeading.set(def.group, list)
  }

  return [...byHeading.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(([heading, rows]) => ({
      id: slug(heading),
      heading,
      // Shortcuts that work everywhere come first; registration order otherwise (the sort is stable).
      rows: [...rows]
        .sort((a, b) => Number(a.scoped) - Number(b.scoped))
        .map(({ scoped: _scoped, ...row }) => row),
    }))
}

export function countRows(groups: readonly ShortcutGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0)
}
