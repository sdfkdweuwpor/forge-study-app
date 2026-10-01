import type { LucideIcon } from 'lucide-react'
import { fuzzyScore } from '@/logic/fuzzy'
import type {
  CommandCtx,
  CommandDef,
  CommandGroup,
  SearchResult,
  ShortcutDef,
} from '../registry/types'
import { recentKey, type RecentEntry } from './recents'

/**
 * What the command palette lists (pure, unit-tested; PaletteOverlay only renders it).
 *
 * Groups, in this order: Recent, Actions (commands), Pages ("Go to" commands plus any provider group
 * called Pages), Tasks, Goals, then every other provider group by name; with a query, groups whose
 * items match the text move ahead of groups that do not. Without a query it shows
 * recents and a short list of suggestions; with one it fuzzy-ranks commands (title, then keywords)
 * and re-ranks each provider's results by how well their title matches.
 */

export type PaletteMode = 'all' | 'search'

export type RecentResult = Extract<RecentEntry, { kind: 'result' }>

export type PaletteAction =
  | { type: 'command'; command: CommandDef }
  | { type: 'result'; providerId: string; group: string; result: SearchResult }
  | { type: 'recent'; entry: RecentResult }

export interface ModelItem {
  /** Unique across groups, so a command can be in Recent and Actions at once. */
  id: string
  title: string
  subtitle?: string
  icon?: LucideIcon
  shortcut?: string
  matches?: number[]
  subtitleMatches?: number[]
  action: PaletteAction
}

export interface ModelGroup {
  id: string
  heading: string
  items: ModelItem[]
}

export interface ProviderResults {
  providerId: string
  /** Heading the provider's results are listed under. */
  group: string
  results: readonly SearchResult[]
}

export interface PaletteInput {
  query: string
  mode: PaletteMode
  commands: readonly CommandDef[]
  shortcuts: readonly ShortcutDef[]
  ctx: CommandCtx
  recents: readonly RecentEntry[]
  providers: readonly ProviderResults[]
}

export const PAGES_COMMAND_GROUP: CommandGroup = 'Go to'

export const LIMITS = {
  recent: 5,
  /** Without a query: a short list of suggestions per group. */
  suggestedActions: 8,
  suggestedPages: 6,
  /** With a query. */
  actions: 6,
  pages: 5,
  /** Per provider; also what a provider is asked for. */
  results: 8,
} as const

const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  'Create',
  'Focus',
  'Goals',
  'Review',
  'View',
  'Data',
  'Help',
  'Go to',
]

/** Provider headings that keep a fixed place after Actions and Pages; any other heading follows, A to Z. */
const PROVIDER_GROUP_ORDER = ['Tasks', 'Goals', 'Courses'] as const

/** A keyword-only match ranks below any title match (title scores are positive). */
const KEYWORD_PENALTY = 40
/** A subtitle-only match on a search result ranks below any title match. */
const SUBTITLE_PENALTY = 30

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function shortcutKeysById(shortcuts: readonly ShortcutDef[]): Map<string, string> {
  return new Map(shortcuts.map((s) => [s.id, s.keys]))
}

/**
 * Commands whose `when` allows them right now. A `when` that throws hides its command. Two commands
 * with the same group and title (two features both offering "New task") list once, keeping the one
 * that shows a shortcut.
 */
export function availableCommands(commands: readonly CommandDef[], ctx: CommandCtx): CommandDef[] {
  const out: CommandDef[] = []
  const at = new Map<string, number>()
  for (const c of commands) {
    if (c.when) {
      try {
        if (!c.when(ctx)) continue
      } catch {
        continue
      }
    }
    const key = `${c.group}\u0000${c.title.trim().toLowerCase()}`
    const first = at.get(key)
    if (first === undefined) {
      at.set(key, out.length)
      out.push(c)
    } else if (!out[first]?.shortcutId && c.shortcutId) {
      out[first] = c
    }
  }
  return out
}

function commandItem(
  command: CommandDef,
  keysById: ReadonlyMap<string, string>,
  id: string = `cmd:${command.id}`,
): ModelItem {
  const keys = command.shortcutId !== undefined ? keysById.get(command.shortcutId) : undefined
  return {
    id,
    title: command.title,
    ...(command.icon ? { icon: command.icon } : {}),
    ...(keys !== undefined ? { shortcut: keys } : {}),
    action: { type: 'command', command },
  }
}

interface Ranked<T> {
  item: T
  score: number
  matches?: number[]
  subtitleMatches?: number[]
}

/** Best first; ties keep the original order (Array.sort is stable). */
function byScore<T>(list: Ranked<T>[]): Ranked<T>[] {
  return list.sort((a, b) => b.score - a.score)
}

export function rankCommands(
  commands: readonly CommandDef[],
  query: string,
): Ranked<CommandDef>[] {
  const out: Ranked<CommandDef>[] = []
  for (const command of commands) {
    const title = fuzzyScore(query, command.title)
    if (title) {
      out.push({ item: command, score: title.score, matches: title.matches })
      continue
    }
    // Keywords match as word prefixes only: a fuzzy match across several words finds almost anything.
    const needle = query.trim().toLowerCase()
    const words = [command.group, ...(command.keywords ?? [])]
    if (words.some((w) => w.toLowerCase().startsWith(needle)))
      out.push({ item: command, score: -KEYWORD_PENALTY })
  }
  return byScore(out)
}

/**
 * Provider results, best title match first. Results the provider found some other way (the notes of
 * a task, say) stay in its own order after the ones whose title matches.
 */
export function rankResults(results: readonly SearchResult[], query: string): Ranked<SearchResult>[] {
  const out: Ranked<SearchResult>[] = []
  results.forEach((result, index) => {
    const title = fuzzyScore(query, result.title)
    if (title) {
      out.push({ item: result, score: title.score, matches: title.matches })
      return
    }
    const subtitle = result.subtitle ? fuzzyScore(query, result.subtitle) : null
    if (subtitle) {
      out.push({
        item: result,
        score: subtitle.score - SUBTITLE_PENALTY,
        subtitleMatches: subtitle.matches,
      })
      return
    }
    out.push({ item: result, score: -1e6 - index })
  })
  return byScore(out)
}

function resultItem(providerId: string, group: string, ranked: Ranked<SearchResult>): ModelItem {
  const { item } = ranked
  return {
    id: `res:${providerId}:${item.id}`,
    title: item.title,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    ...(item.icon ? { icon: item.icon } : {}),
    ...(ranked.matches ? { matches: ranked.matches } : {}),
    ...(ranked.subtitleMatches ? { subtitleMatches: ranked.subtitleMatches } : {}),
    action: { type: 'result', providerId, group, result: item },
  }
}

function recentItems(
  recents: readonly RecentEntry[],
  commands: readonly CommandDef[],
  keysById: ReadonlyMap<string, string>,
  mode: PaletteMode,
): ModelItem[] {
  const byId = new Map(commands.map((c) => [c.id, c]))
  const items: ModelItem[] = []
  for (const entry of recents) {
    if (items.length >= LIMITS.recent) break
    if (entry.kind === 'command') {
      const command = byId.get(entry.id)
      if (command && mode === 'all')
        items.push(commandItem(command, keysById, `recent:${recentKey(entry)}`))
    } else {
      items.push({
        id: `recent:${recentKey(entry)}`,
        title: entry.title,
        subtitle: entry.subtitle ? `${entry.group} · ${entry.subtitle}` : entry.group,
        action: { type: 'recent', entry },
      })
    }
  }
  return items
}

/** Merges results of providers that share a heading, keeping each result's own provider id. */
function providerGroups(
  providers: readonly ProviderResults[],
  query: string,
): Map<string, ModelItem[]> {
  const groups = new Map<string, ModelItem[]>()
  for (const p of providers) {
    const ranked = rankResults(p.results, query).slice(0, LIMITS.results)
    if (ranked.length === 0) continue
    const list = groups.get(p.group) ?? []
    for (const r of ranked) list.push(resultItem(p.providerId, p.group, r))
    groups.set(p.group, list)
  }
  return groups
}

function groupOrder(heading: string): number {
  const i = (PROVIDER_GROUP_ORDER as readonly string[]).indexOf(heading)
  return i === -1 ? PROVIDER_GROUP_ORDER.length : i
}

export function buildPaletteGroups(input: PaletteInput): ModelGroup[] {
  const { mode, ctx } = input
  const query = input.query.trim()
  const keysById = shortcutKeysById(input.shortcuts)
  const available = availableCommands(input.commands, ctx)
  const isPage = (c: CommandDef) => c.group === PAGES_COMMAND_GROUP
  const actionsPool = mode === 'search' ? [] : available.filter((c) => !isPage(c))
  const pagesPool = available.filter(isPage)

  const groups: ModelGroup[] = []
  const push = (id: string, heading: string, items: ModelItem[]) => {
    if (items.length > 0) groups.push({ id, heading, items })
  }

  let actions: ModelItem[]
  let pages: ModelItem[]
  const found = new Map<string, ModelItem[]>()

  if (query === '') {
    push('recent', 'Recent', recentItems(input.recents, available, keysById, mode))
    const order = (c: CommandDef) => COMMAND_GROUP_ORDER.indexOf(c.group)
    actions = [...actionsPool]
      .sort((a, b) => order(a) - order(b))
      .slice(0, LIMITS.suggestedActions)
      .map((c) => commandItem(c, keysById))
    pages = pagesPool.slice(0, LIMITS.suggestedPages).map((c) => commandItem(c, keysById))
  } else {
    const toItems = (pool: CommandDef[], limit: number) =>
      rankCommands(pool, query)
        .slice(0, limit)
        .map((r) => ({
          ...commandItem(r.item, keysById),
          ...(r.matches ? { matches: r.matches } : {}),
        }))
    actions = toItems(actionsPool, LIMITS.actions)
    pages = toItems(pagesPool, LIMITS.pages)
    for (const [heading, items] of providerGroups(input.providers, query)) found.set(heading, items)
  }

  push('actions', 'Actions', actions)
  // A provider that lists pages (a goal's page, a course) joins the Go-to commands under one heading.
  push('pages', 'Pages', [...pages, ...(found.get('Pages') ?? [])])
  found.delete('Pages')

  const rest = [...found.entries()].sort(
    ([a], [b]) => groupOrder(a) - groupOrder(b) || a.localeCompare(b),
  )
  for (const [heading, items] of rest) push(`group-${slug(heading)}`, heading, items)

  // With a query, a group whose items really match what was typed comes before one that only holds
  // what a provider returned (or a keyword hit), so the first row is the best match, not just the
  // first group. Otherwise the order above stands (the sort is stable).
  if (query !== '') {
    const matched = (g: ModelGroup) => g.items.some((i) => i.matches || i.subtitleMatches)
    groups.sort((a, b) => Number(!matched(a)) - Number(!matched(b)))
  }
  return groups
}

/** Every item by its id, for turning a selected row back into its action. */
export function indexItems(groups: readonly ModelGroup[]): Map<string, ModelItem> {
  const map = new Map<string, ModelItem>()
  for (const g of groups) for (const item of g.items) map.set(item.id, item)
  return map
}
