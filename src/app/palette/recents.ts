import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'

/**
 * Recently used palette items, newest first, kept in localStorage (`PREF_KEYS.paletteRecent`).
 * A command is stored by id and looked up in the registry when shown. A search result cannot be
 * stored as a function, so it keeps what is needed to show it and to find it again through its
 * provider.
 */

export type RecentEntry =
  | { kind: 'command'; id: string }
  | {
      kind: 'result'
      providerId: string
      id: string
      title: string
      subtitle?: string
      /** The provider's group heading, e.g. "Tasks". */
      group: string
    }

export const MAX_RECENTS = 8

export function recentKey(entry: RecentEntry): string {
  return entry.kind === 'command'
    ? `command:${entry.id}`
    : `result:${entry.providerId}:${entry.id}`
}

/** Puts `entry` first, drops an earlier copy of it, and keeps at most `max` entries. */
export function pushRecent(
  list: readonly RecentEntry[],
  entry: RecentEntry,
  max: number = MAX_RECENTS,
): RecentEntry[] {
  const key = recentKey(entry)
  return [entry, ...list.filter((e) => recentKey(e) !== key)].slice(0, Math.max(0, max))
}

const isString = (v: unknown): v is string => typeof v === 'string' && v !== ''

function toEntry(value: unknown): RecentEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.kind === 'command' && isString(v.id)) return { kind: 'command', id: v.id }
  if (
    v.kind === 'result' &&
    isString(v.providerId) &&
    isString(v.id) &&
    isString(v.title) &&
    isString(v.group)
  ) {
    return {
      kind: 'result',
      providerId: v.providerId,
      id: v.id,
      title: v.title,
      group: v.group,
      ...(typeof v.subtitle === 'string' && v.subtitle !== '' ? { subtitle: v.subtitle } : {}),
    }
  }
  return null
}

/** Reads what was saved; anything malformed (a hand-edited or older value) is dropped, never thrown. */
export function parseRecents(raw: string | null): RecentEntry[] {
  if (raw === null) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const seen = new Set<string>()
  const out: RecentEntry[] = []
  for (const item of data) {
    const entry = toEntry(item)
    if (!entry) continue
    const key = recentKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= MAX_RECENTS) break
  }
  return out
}

export function loadRecents(): RecentEntry[] {
  return parseRecents(readPref(PREF_KEYS.paletteRecent))
}

export function saveRecents(list: readonly RecentEntry[]): void {
  writePref(PREF_KEYS.paletteRecent, JSON.stringify(list))
}
