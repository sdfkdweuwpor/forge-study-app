/**
 * What the Trash page shows and how it is found (pure; Phase 11c): the type of each entry ("Tasks",
 * "Courses"…), what came along with it ("Includes 3 courses, 27 units and 61 tasks"), which container it
 * lived in, the grouping, the search, and the words that confirm emptying the Trash.
 *
 * The rule for containers (`parentRefs`): `moveToTrash` cascades *down* (a goal takes its courses, units
 * and tasks with it), so what sits in an entry never needs its parent. A task, unit or course that was
 * trashed *before* its goal or course was trashed lives in an entry of its own, and its parent is
 * elsewhere. `db/repos/trash.restoreTrashItem` uses `parentRefs` to bring the parent back too.
 */
import type { ID, Millis, TableName, TrashItem } from '@/db/types'
import { dayOf, diffDays } from './dates'

// ─── Types of things in the Trash ───────────────────────────────────────────

interface TypeLabel {
  singular: string
  plural: string
}

const TYPE_LABELS: Partial<Record<TableName, TypeLabel>> = {
  tasks: { singular: 'Task', plural: 'Tasks' },
  goals: { singular: 'Goal', plural: 'Goals' },
  milestones: { singular: 'Course', plural: 'Courses' },
  units: { singular: 'Unit', plural: 'Units' },
  rewards: { singular: 'Reward', plural: 'Rewards' },
  savedViews: { singular: 'View', plural: 'Views' },
  blocklist: { singular: 'Blocked site', plural: 'Blocked sites' },
  flashcards: { singular: 'Flashcard', plural: 'Flashcards' },
  resources: { singular: 'Resource', plural: 'Resources' },
  templates: { singular: 'Template', plural: 'Templates' },
}

/** The order the groups appear in; anything else follows, A to Z. */
export const TRASH_TYPE_ORDER: readonly TableName[] = [
  'tasks',
  'goals',
  'milestones',
  'units',
  'rewards',
  'savedViews',
  'blocklist',
]

function humanize(table: string): TypeLabel {
  const words = table
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  const plural = words.charAt(0).toUpperCase() + words.slice(1)
  return { singular: plural.replace(/s$/, ''), plural }
}

/** "Task", "Course"… (any table gets a readable name, so a future type needs no change here). */
export function typeLabel(table: TableName, plural = false): string {
  const l = TYPE_LABELS[table] ?? humanize(table)
  return plural ? l.plural : l.singular
}

// ─── Containers ─────────────────────────────────────────────────────────────

export type ParentTable = 'goals' | 'milestones' | 'units'

/** A row an entry belongs to. */
export interface ParentRef {
  table: ParentTable
  id: ID
}

/** Which fields of a row point at its containers. */
const PARENT_FIELDS: Partial<Record<TableName, readonly (readonly [string, ParentTable])[]>> = {
  tasks: [
    ['goalId', 'goals'],
    ['milestoneId', 'milestones'],
    ['unitId', 'units'],
  ],
  milestones: [['goalId', 'goals']],
  units: [
    ['goalId', 'goals'],
    ['milestoneId', 'milestones'],
  ],
}

/** The fields of a row of `table` that name a container, and what each names (an empty list for a top-level thing). */
export function parentFields(table: TableName): readonly (readonly [string, ParentTable])[] {
  return PARENT_FIELDS[table] ?? []
}

/** The goal, course and unit a row (of `table`) points at. */
export function parentRefs(table: TableName, row: unknown): ParentRef[] {
  if (typeof row !== 'object' || row === null) return []
  const out: ParentRef[] = []
  for (const [field, parent] of parentFields(table)) {
    const id = (row as Record<string, unknown>)[field]
    if (typeof id === 'string' && id !== '') out.push({ table: parent, id })
  }
  return out
}

// ─── An entry as the page shows it ──────────────────────────────────────────

/** A container that is not in the app: it is in the Trash too (it comes back with the item) or it is gone for good. */
export interface TrashParent {
  table: ParentTable
  id: ID
  title: string
  state: 'trashed' | 'gone'
  /** For a trashed container: the entry that holds it. */
  trashId?: ID
}

export interface TrashEntry {
  /** The id of the `trash` row. */
  id: ID
  table: TableName
  entityId: ID
  title: string
  deletedAt: Millis
  expiresAt: Millis
  /** Rows that went with it, by table (the entry's own row is not counted). */
  contents: Partial<Record<TableName, number>>
  parents: TrashParent[]
  /** False for a course or unit whose goal or course is gone for good: it has nowhere to come back to. */
  restorable: boolean
}

/** Rows in a payload other than the entry's own row. */
export function countContents(item: TrashItem): Partial<Record<TableName, number>> {
  const out: Partial<Record<TableName, number>> = {}
  for (const [table, rows] of Object.entries(item.payload) as [
    TableName,
    unknown[] | undefined,
  ][]) {
    const own = table === item.entityTable ? 1 : 0
    const n = (rows?.length ?? 0) - own
    if (n > 0) out[table] = n
  }
  return out
}

const COUNTED: readonly (readonly [TableName, string, string])[] = [
  ['milestones', 'course', 'courses'],
  ['units', 'unit', 'units'],
  ['tasks', 'task', 'tasks'],
  ['assessments', 'assessment', 'assessments'],
  ['plannedAssessments', 'planned assessment', 'planned assessments'],
  ['flashcards', 'flashcard', 'flashcards'],
  ['practiceQuestions', 'practice question', 'practice questions'],
  ['resources', 'resource', 'resources'],
  ['files', 'attached file', 'attached files'],
]

/** "3 courses, 27 units and 61 tasks"; empty when nothing came along. */
export function contentsSummary(contents: Partial<Record<TableName, number>>): string {
  const parts = COUNTED.flatMap(([table, one, many]) => {
    const n = contents[table] ?? 0
    return n > 0 ? [`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`] : []
  })
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** One sentence about the containers, or `null` when everything the entry belongs to is still in the app. */
export function parentsNote(
  entry: Pick<TrashEntry, 'table' | 'parents' | 'restorable'>,
): string | null {
  const trashed = entry.parents.filter((p) => p.state === 'trashed')
  const gone = entry.parents.filter((p) => p.state === 'gone')
  // "goal “B.S. Computer Science” and course “C779 Web Development”"; a container nobody remembers is just "goal".
  const names = (list: readonly TrashParent[]) =>
    [
      ...new Set(
        list.map((p) => {
          const kind = typeLabel(p.table).toLowerCase()
          return p.title === '' ? kind : `${kind} “${p.title}”`
        }),
      ),
    ].join(' and ')
  if (!entry.restorable) {
    return `Its ${names(gone)} was deleted for good, so it has nowhere to come back to.`
  }
  const notes: string[] = []
  if (trashed.length > 0) {
    // A goal's entry holds its courses and units too; naming the outermost container is enough.
    const outer = trashed.filter((p) => !trashed.some((q) => outerOf(q.table) < outerOf(p.table)))
    notes.push(`Also brings back its ${names(outer)}, which is in the Trash.`)
  }
  if (gone.length > 0) {
    notes.push(`Its ${names(gone)} was deleted for good, so it comes back without it.`)
  }
  return notes.length > 0 ? notes.join(' ') : null
}

/**
 * What a restore did beyond the item itself, for the toast: the containers that came back with it, or the
 * ones it had to leave behind. `undefined` when it was a plain restore.
 */
export function restoreNote(
  alsoRestored: readonly { entityTable: TableName; title: string }[],
  detached: readonly ParentTable[],
): string | undefined {
  const notes: string[] = []
  if (alsoRestored.length > 0) {
    const names = alsoRestored.map((i) => `${typeLabel(i.entityTable).toLowerCase()} “${i.title}”`)
    notes.push(`Also brought back its ${names.join(' and ')}.`)
  }
  if (detached.length > 0) {
    const kinds = detached.map((t) => typeLabel(t).toLowerCase())
    const many = kinds.length > 1
    const list = many ? `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}` : (kinds[0] ?? '')
    notes.push(`Its ${list} ${many ? 'were' : 'was'} deleted for good, so it came back on its own.`)
  }
  return notes.length > 0 ? notes.join(' ') : undefined
}

/** goals contain courses contain units. */
function outerOf(table: ParentTable): number {
  return table === 'goals' ? 0 : table === 'milestones' ? 1 : 2
}

// ─── Groups and search ──────────────────────────────────────────────────────

export interface TrashGroup {
  table: TableName
  /** "Tasks", "Courses"… */
  label: string
  entries: TrashEntry[]
}

/** Entries by type in a fixed order, newest deletion first inside each. */
export function groupTrash(entries: readonly TrashEntry[]): TrashGroup[] {
  const byTable = new Map<TableName, TrashEntry[]>()
  for (const e of entries) {
    const list = byTable.get(e.table)
    if (list) list.push(e)
    else byTable.set(e.table, [e])
  }
  const rank = (t: TableName): number => {
    const i = TRASH_TYPE_ORDER.indexOf(t)
    return i === -1 ? TRASH_TYPE_ORDER.length : i
  }
  return [...byTable.entries()]
    .map(([table, list]) => ({
      table,
      label: typeLabel(table, true),
      entries: [...list].sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1)),
    }))
    .sort((a, b) => rank(a.table) - rank(b.table) || a.label.localeCompare(b.label))
}

/** Every word of the query must appear in the title, the type or what came along (case does not matter). */
export function matchesQuery(entry: TrashEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [
    entry.title,
    typeLabel(entry.table),
    typeLabel(entry.table, true),
    contentsSummary(entry.contents),
    ...entry.parents.map((p) => p.title),
  ]
    .join(' ')
    .toLowerCase()
  return words.every((w) => haystack.includes(w))
}

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const SHORT_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Deleted today", "Deleted yesterday", "Deleted Sep 12" (calendar days in the local time zone). */
export function deletedLabel(deletedAt: Millis, now: Millis): string {
  const days = diffDays(dayOf(now), dayOf(deletedAt))
  if (days <= 0) return 'Deleted today'
  if (days === 1) return 'Deleted yesterday'
  const sameYear = new Date(deletedAt).getFullYear() === new Date(now).getFullYear()
  return `Deleted ${(sameYear ? SHORT_DAY : SHORT_DAY_YEAR).format(deletedAt)}`
}

/** How many entries there are, "1 item" / "14 items". */
export function itemCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'}`
}

// ─── Emptying ───────────────────────────────────────────────────────────────

/** What has to be typed to empty the Trash. */
export const EMPTY_TRASH_PHRASE = 'empty trash'

/** Case and surrounding spaces do not matter; the words do. */
export function isEmptyTrashPhrase(input: string): boolean {
  return input.trim().toLowerCase().replace(/\s+/g, ' ') === EMPTY_TRASH_PHRASE
}
