import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Command,
  CornerDownRight,
  FileText,
  History,
  type LucideIcon,
} from 'lucide-react'
import { CommandPalette, type PaletteGroup, type PaletteItem } from '@/ui/CommandPalette'
import { useRestoreFocus } from '../hooks/useRestoreFocus'
import { useOpenOverlays, useOverlays } from '../providers/OverlayProvider'
import { useRegistry } from '../registry/RegistryContext'
import { recordError } from '../reportError'
import { useShortcutScope } from '../shortcuts'
import {
  buildPaletteGroups,
  indexItems,
  PAGES_COMMAND_GROUP,
  type ModelItem,
  type PaletteAction,
  type RecentResult,
} from './paletteModel'
import { getPaletteMode, resetPaletteMode } from './paletteMode'
import { loadRecents, pushRecent, saveRecents, type RecentEntry } from './recents'
import { useCommandCtx } from './useCommandCtx'
import { useProviderSearch } from './useProviderSearch'

// Short enough for a phone: the field shares the row with Cancel.
const PLACEHOLDER_ALL = 'Search or run a command'
const PLACEHOLDER_SEARCH = 'Search tasks, goals, pages'
const ICON_SIZE = 16

/** The icon a row shows when its command or provider brought none. */
function fallbackIcon(item: ModelItem): LucideIcon {
  const action = item.action
  if (action.type === 'recent') return History
  if (action.type === 'result') return FileText
  return action.command.group === PAGES_COMMAND_GROUP ? CornerDownRight : Command
}

function toPaletteItem(item: ModelItem): PaletteItem {
  const Icon = item.icon ?? fallbackIcon(item)
  return {
    id: item.id,
    title: item.title,
    icon: <Icon size={ICON_SIZE} strokeWidth={1.75} />,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    ...(item.shortcut ? { shortcut: item.shortcut } : {}),
    ...(item.matches ? { matches: item.matches } : {}),
    ...(item.subtitleMatches ? { subtitleMatches: item.subtitleMatches } : {}),
  }
}

/** What a chosen row is remembered as, so it can lead the empty palette next time. */
function recentFor(action: PaletteAction): RecentEntry | null {
  if (action.type === 'command') return { kind: 'command', id: action.command.id }
  if (action.type === 'recent') return action.entry
  const { result } = action
  return {
    kind: 'result',
    providerId: action.providerId,
    id: result.id,
    title: result.title,
    group: action.group,
    ...(result.subtitle ? { subtitle: result.subtitle } : {}),
  }
}

/**
 * The command palette (`mod+k`, the sidebar Search button): fuzzy search over every registered
 * command, the "Go to" pages and every feature's search provider, with recents and shortcut hints.
 * Mounted once by the app shell. Only an open palette holds any state, so each opening starts fresh.
 */
export function PaletteOverlay(): ReactNode {
  const open = useOpenOverlays().includes('palette')
  return open ? <PaletteSession /> : null
}

function PaletteSession() {
  const overlays = useOverlays()
  const registry = useRegistry()
  const makeCtx = useCommandCtx()
  useShortcutScope('palette')

  const [mode] = useState(getPaletteMode)
  const [recents, setRecents] = useState(loadRecents)
  const [query, setQuery] = useState('')
  useRestoreFocus()

  // Put the next open back to the full palette (a `/` request is for one opening only).
  useEffect(() => resetPaletteMode, [])

  // A remembered result is looked up asynchronously; if the palette was dismissed meanwhile, drop it.
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const search = useProviderSearch(registry.search, query)

  const model = useMemo(
    () =>
      buildPaletteGroups({
        query,
        mode,
        commands: registry.commands,
        shortcuts: registry.shortcuts,
        ctx: makeCtx(),
        recents,
        providers: search.providers,
      }),
    [query, mode, registry, makeCtx, recents, search.providers],
  )
  const { groups, index } = useMemo(() => {
    const groups: PaletteGroup[] = model.map((g) => ({
      id: g.id,
      heading: g.heading,
      items: g.items.map(toPaletteItem),
    }))
    return { groups, index: indexItems(model) }
  }, [model])

  const hasItems = groups.length > 0
  // A search that is slow to answer shows a loading row; an empty list waiting on it must not say
  // "No results" in the meantime, so it shows loading straight away.
  const slow = useSlowFlag(search.pending)
  const loading = search.pending && (!hasItems || slow)
  const error = search.failed && !hasItems ? 'Search is unavailable right now.' : null

  const close = () => overlays.close('palette')

  const remember = (entry: RecentEntry | null) => {
    if (!entry) return
    const next = pushRecent(recents, entry)
    setRecents(next)
    saveRecents(next)
  }

  const run = (action: Exclude<PaletteAction, { type: 'recent' }>) => {
    const ctx = makeCtx()
    const invoke = () => (action.type === 'command' ? action.command.run(ctx) : action.result.run(ctx))
    Promise.resolve()
      .then(invoke)
      .catch((e: unknown) => recordError(e, `palette:${action.type}`))
  }

  /** A remembered search result: find it again through its provider, or fall back to searching for it. */
  const openRecent = async (entry: RecentResult) => {
    const provider = registry.search.find((p) => p.id === entry.providerId)
    try {
      const hits = provider ? await provider.search(entry.title, 12) : []
      if (!alive.current) return
      const hit = hits.find((r) => r.id === entry.id)
      if (hit) {
        remember(entry)
        close()
        run({ type: 'result', providerId: entry.providerId, group: entry.group, result: hit })
        return
      }
    } catch (e) {
      recordError(e, 'palette.recent')
    }
    if (alive.current) setQuery(entry.title)
  }

  const select = (picked: PaletteItem) => {
    const action = index.get(picked.id)?.action
    if (!action) return
    if (action.type === 'recent') {
      void openRecent(action.entry)
      return
    }
    remember(recentFor(action))
    close()
    run(action)
  }

  return (
    <CommandPalette
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      onSelect={select}
      loading={loading}
      error={error}
      onRetry={search.retry}
      placeholder={mode === 'search' ? PLACEHOLDER_SEARCH : PLACEHOLDER_ALL}
    />
  )
}

/** True once `active` has been on for 250 ms, so a fast search never flashes a loading row. */
function useSlowFlag(active: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setTimeout(() => setSlow(true), 250)
    return () => {
      window.clearTimeout(timer)
      setSlow(false)
    }
  }, [active])
  return active && slow
}

