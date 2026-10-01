/**
 * The site blocker's data (BRIEF §5.8): the blocklist and its allowlist exceptions (`blocklist` rows,
 * `kind: 'block' | 'allow'`), the mode, schedule, motivation lines and extension id (in
 * `settings.blocker`) and the attempts and unlocks the extension reports (`blockEvents`).
 *
 * The app is the editor and the extension is the enforcer: whatever changes here is pushed to the
 * extension by the BlockerSync provider (`features/blocker`). Components never touch the tables.
 *
 * Rules the repo enforces:
 * - The 11 default domains are added once (`settings.blocker.blocklistSeeded`); one the user removes
 *   never comes back on its own. `restoreDefaultBlocklist` brings the missing ones back on request.
 * - A domain is stored the way the extension reads it (no scheme, path or `www.`), once per domain.
 * - Events from the extension are merged by their own id, so pulling the same events twice changes nothing.
 */
import { newId } from '@/lib/ids'
import {
  buildBlockerConfig,
  checkAllowPattern,
  checkBlockDomain,
  cleanMotivationLines,
  cleanSchedule,
  parseExtensionId,
  type DomainProblem,
} from '@/logic/blocker'
import { dayOf } from '@/logic/dates'
import { isBlockEvent, type BlockEvent as ExtensionEvent, type BlockerConfig } from '@ext/protocol'
import { db } from '../db'
import { DEFAULT_BLOCKED_DOMAINS, DEFAULT_MOTIVATION } from '../defaults'
import type { BlockEvent, BlockerMode, BlockWindow, BlocklistEntry, ID, Millis } from '../types'
import type { RepoOptions } from './tasks'
import { getSettings, updateSettings } from './settings'

const DEFAULT_SET: ReadonlySet<string> = new Set(DEFAULT_BLOCKED_DOMAINS)

/** Thrown when what was typed can't be added. `message` is fit to show under the field. */
export class BlocklistInputError extends Error {
  readonly problem: DomainProblem
  constructor(problem: DomainProblem, message: string) {
    super(message)
    this.name = 'BlocklistInputError'
    this.problem = problem
  }
}

/** A change that can be taken back (a toast's Undo). */
export interface Undoable {
  undo: () => Promise<void>
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Every blocklist row: blocked sites first, then allow exceptions, each in the order they were added. */
export async function listBlocklist(): Promise<BlocklistEntry[]> {
  const rows = await db.blocklist.toArray()
  return rows.sort(
    (a, b) =>
      Number(a.kind === 'allow') - Number(b.kind === 'allow') ||
      a.createdAt - b.createdAt ||
      a.domain.localeCompare(b.domain),
  )
}

/** The config the extension should be running, from the rows and settings as they are now. */
export async function getBlockerConfig(): Promise<BlockerConfig> {
  const [entries, settings] = await Promise.all([listBlocklist(), getSettings()])
  return buildBlockerConfig(entries, settings.blocker)
}

/** Every event the extension has reported, oldest first. */
export async function listBlockEvents(): Promise<BlockEvent[]> {
  return db.blockEvents.orderBy('at').toArray()
}

// ─── Blocklist ──────────────────────────────────────────────────────────────

const defaultId = (domain: string): ID => `default:${domain}`

function blockRow(domain: string, now: Millis, createdAt = now): BlocklistEntry {
  const isDefault = DEFAULT_SET.has(domain)
  return {
    id: isDefault ? defaultId(domain) : newId(),
    createdAt,
    updatedAt: now,
    kind: 'block',
    domain,
    pattern: null,
    enabled: true,
    isDefault,
    note: null,
  }
}

/**
 * Adds the 11 default domains the first time, when the user has not been through this before.
 * Returns how many were added. Safe to call on every start: it does nothing once seeded, and a site
 * the user removed is never re-added.
 */
export async function seedDefaultBlocklist(opts: RepoOptions = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.settings, db.blocklist, async () => {
    if ((await getSettings()).blocker.blocklistSeeded) return 0
    const have = new Set((await db.blocklist.toArray()).map((r) => r.domain))
    const missing = DEFAULT_BLOCKED_DOMAINS.filter((d) => !have.has(d))
    // Spread the timestamps so the list keeps the brief's order.
    await db.blocklist.bulkPut(missing.map((d, i) => blockRow(d, now, now + i)))
    await updateSettings({ blocker: { blocklistSeeded: true } })
    return missing.length
  })
}

/** How many default sites are not on the list right now (what "Restore defaults" would add). */
export async function countMissingDefaults(): Promise<number> {
  const have = new Set(
    (await db.blocklist.where('kind').equals('block').toArray()).map((r) => r.domain),
  )
  return DEFAULT_BLOCKED_DOMAINS.filter((d) => !have.has(d)).length
}

/** Puts back the default sites that are missing, and returns how many. Switched-off ones stay as they are. */
export async function restoreDefaultBlocklist(opts: RepoOptions = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.blocklist, async () => {
    const have = new Set(
      (await db.blocklist.where('kind').equals('block').toArray()).map((r) => r.domain),
    )
    const missing = DEFAULT_BLOCKED_DOMAINS.filter((d) => !have.has(d))
    await db.blocklist.bulkPut(missing.map((d, i) => blockRow(d, now, now + i)))
    return missing.length
  })
}

/**
 * Adds a site to the blocklist. What was typed may be a full address; only the domain is kept.
 * Throws `BlocklistInputError` (with a message for the field) when it is empty, isn't a site, is
 * already covered, or would block Forge itself.
 */
export async function addBlockedDomain(
  raw: string,
  opts: RepoOptions = {},
): Promise<BlocklistEntry & Undoable> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.blocklist, async () => {
    const rows = (await db.blocklist.where('kind').equals('block').toArray()).map((r) => ({
      domain: r.domain,
      enabled: r.enabled,
    }))
    const checked = checkBlockDomain(raw, rows)
    if (!checked.ok) throw new BlocklistInputError(checked.problem, checked.message)
    const entry = blockRow(checked.value, now)
    await db.blocklist.add(entry)
    return { ...entry, undo: () => removeById(entry.id) }
  })
}

/**
 * Adds an allowlist exception: a page or channel that stays reachable while its site is blocked
 * (`youtube.com/watch?v=abc`, `youtube.com/@CS50`). Throws `BlocklistInputError` like `addBlockedDomain`.
 */
export async function addAllowException(
  raw: string,
  opts: RepoOptions = {},
): Promise<BlocklistEntry & Undoable> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.blocklist, async () => {
    const rows = await db.blocklist.where('kind').equals('allow').toArray()
    const checked = checkAllowPattern(raw, rows)
    if (!checked.ok) throw new BlocklistInputError(checked.problem, checked.message)
    const entry: BlocklistEntry = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      kind: 'allow',
      domain: checked.value.domain,
      pattern: checked.value.pattern,
      enabled: true,
      isDefault: false,
      note: null,
    }
    await db.blocklist.add(entry)
    return { ...entry, undo: () => removeById(entry.id) }
  })
}

async function removeById(id: ID): Promise<void> {
  await db.blocklist.delete(id)
}

/** Removes a row (a blocked site or an exception). The result's `undo` puts it back; `null` if it was already gone. */
export async function removeBlocklistEntry(id: ID): Promise<Undoable | null> {
  return db.transaction('rw', db.blocklist, async () => {
    const row = await db.blocklist.get(id)
    if (!row) return null
    await db.blocklist.delete(id)
    return {
      undo: async () => {
        // Undo must not resurrect a duplicate if the same site was added again in the meantime.
        const clash =
          row.kind === 'block'
            ? await db.blocklist
                .where('domain')
                .equals(row.domain)
                .filter((r) => r.kind === 'block')
                .first()
            : await db.blocklist
                .filter((r) => r.kind === 'allow' && r.pattern === row.pattern)
                .first()
        if (!clash) await db.blocklist.put(row)
      },
    }
  })
}

/** Switches a row on or off without losing it. */
export async function setBlocklistEntryEnabled(
  id: ID,
  enabled: boolean,
  opts: RepoOptions = {},
): Promise<void> {
  const now = opts.now ?? Date.now()
  await db.transaction('rw', db.blocklist, async () => {
    const row = await db.blocklist.get(id)
    if (!row || row.enabled === enabled) return
    await db.blocklist.put({ ...row, enabled, updatedAt: now })
  })
}

// ─── Mode, schedule, motivation, extension id ───────────────────────────────

export async function setBlockerMode(mode: BlockerMode): Promise<void> {
  await updateSettings({ blocker: { mode } })
}

/** Saves the schedule windows (invalid and empty ones are dropped, days put in order). */
export async function setBlockerSchedule(windows: readonly BlockWindow[]): Promise<BlockWindow[]> {
  const schedule = cleanSchedule(windows)
  await updateSettings({ blocker: { schedule } })
  return schedule
}

/** Saves the motivation lines shown on the blocked page (trimmed, no blanks or repeats). */
export async function setMotivationLines(lines: readonly string[]): Promise<string[]> {
  const motivation = cleanMotivationLines(lines)
  await updateSettings({ blocker: { motivation } })
  return motivation
}

export async function resetMotivationLines(): Promise<string[]> {
  return setMotivationLines(DEFAULT_MOTIVATION)
}

/**
 * Saves the extension id the app talks to. Empty text goes back to the built-in id. Throws a
 * `RangeError` (with a message for the field) when the text isn't an extension id.
 */
export async function setExtensionIdOverride(raw: string): Promise<string | null> {
  const parsed = parseExtensionId(raw)
  if (!parsed.ok) throw new RangeError(parsed.message)
  await updateSettings({ blocker: { extensionIdOverride: parsed.id } })
  return parsed.id
}

// ─── Events from the extension ──────────────────────────────────────────────

/** An extension event as a row: `blocked` is an `attempt`, an unlock keeps its minutes. */
function eventRow(e: ExtensionEvent): BlockEvent {
  return {
    id: e.id,
    // Derived from the event alone, so storing it twice writes the same row.
    createdAt: e.at,
    updatedAt: e.at,
    at: e.at,
    day: dayOf(e.at),
    kind: e.kind === 'unlock' ? 'unlock' : 'attempt',
    domain: e.domain.trim().toLowerCase(),
    minutes: e.kind === 'unlock' ? (e.unlockMinutes ?? null) : null,
  }
}

/**
 * Stores events pulled from the extension, keyed by the extension's own id, so the same event twice
 * (an overlapping pull, a second tab) is one row. Malformed entries are skipped. Returns how many
 * events were new.
 */
export async function mergeBlockEvents(events: readonly ExtensionEvent[]): Promise<number> {
  const rows = new Map<string, BlockEvent>()
  for (const e of events) if (isBlockEvent(e)) rows.set(e.id, eventRow(e))
  if (rows.size === 0) return 0
  return db.transaction('rw', db.blockEvents, async () => {
    const ids = [...rows.keys()]
    const existing = await db.blockEvents.bulkGet(ids)
    await db.blockEvents.bulkPut([...rows.values()])
    return existing.filter((row) => row === undefined).length
  })
}

/** Remembers how far the extension's events have been read. It only moves forward. */
export async function saveEventsCursor(cursor: Millis): Promise<void> {
  const current = (await getSettings()).blocker.eventsCursor
  if (Number.isFinite(cursor) && cursor > current) {
    await updateSettings({ blocker: { eventsCursor: cursor } })
  }
}

/** Notes that the extension has the current config. */
export async function markBlockerSynced(opts: RepoOptions = {}): Promise<void> {
  await updateSettings({ blocker: { lastSyncedAt: opts.now ?? Date.now() } })
}
