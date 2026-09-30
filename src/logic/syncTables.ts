/**
 * Cloud sync (PLAN §4.7.4): which tables sync, which fields of the settings row stay on the device, the
 * write-stamp clock and the deterministic XP event ids. Pure and small on purpose: the always-installed
 * tracking middleware (`db/sync/tracking.ts`) imports it, so it is part of the entry chunk. Everything
 * else about sync lives in lazy modules.
 */
import type { TableName } from '@/db/types'
import { deepEqual } from './deepEqual'

/** Tables whose rows travel to the server (26). Dexie table names are part of the sync format: never rename one. */
export const SYNC_TABLES = [
  'settings',
  'tasks',
  'goals',
  'milestones',
  'units',
  'sessions',
  'xpEvents',
  'badges',
  'rewards',
  'redemptions',
  'blocklist',
  'blockEvents',
  'parkingLot',
  'checkIns',
  'assessments',
  'flashcards',
  'resources',
  'trash',
  'savedViews',
  'rituals',
  'weeklyReviews',
  'templates',
  'plannedAssessments',
  'planProposals',
  'practiceQuestions',
  'questionAttempts',
] as const satisfies readonly TableName[]

export type SyncTableName = (typeof SYNC_TABLES)[number]

/**
 * Tables that never sync: PDF bytes, the device's own snapshots, derived caches rebuilt from synced
 * history, and the sync bookkeeping itself.
 */
export const LOCAL_TABLES = [
  'files',
  'snapshots',
  'streakDays',
  'worldTiles',
  'readiness',
  'syncOutbox',
  'syncState',
] as const satisfies readonly TableName[]

/** The two tables that hold this device's sync bookkeeping (no timestamps, never in a backup). */
export const SYNC_BOOKKEEPING_TABLES = [
  'syncOutbox',
  'syncState',
] as const satisfies readonly TableName[]

const SYNC_SET: ReadonlySet<string> = new Set(SYNC_TABLES)

export function isSyncTable(name: string): name is SyncTableName {
  return SYNC_SET.has(name)
}

/**
 * Append-only tables: a row is never changed after it is written, so re-writing an id that already
 * exists (the blocker re-reading an extension event) is not a change and is not queued.
 */
export const APPEND_ONLY_TABLES: ReadonlySet<SyncTableName> = new Set<SyncTableName>([
  'xpEvents',
  'blockEvents',
])

// ─── The settings row ───────────────────────────────────────────────────────

/**
 * Settings fields that belong to this device and never sync. Theme, accent and reduced motion
 * (`appearance`): a phone in dark mode next to a laptop in light mode is common. Notification
 * permission is per browser. The blocker's extension id and event cursors describe this browser's
 * extension. The backup nudge's last showing is per device.
 */
export const SETTINGS_DEVICE_PATHS = [
  'appearance',
  'notifications',
  'blocker.extensionIdOverride',
  'blocker.lastSyncedAt',
  'blocker.eventsCursor',
  'backup.lastRemindedAt',
] as const

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The part of a settings row that syncs: a copy without the device paths. With `forCompare`, also
 * without `updatedAt`, which every write stamps. Returns null for something that is not an object.
 */
export function syncedSettings(row: unknown, opts: { forCompare?: boolean } = {}): Obj | null {
  if (!isObj(row)) return null
  const out: Obj = { ...row }
  if (opts.forCompare) delete out.updatedAt
  for (const path of SETTINGS_DEVICE_PATHS) {
    const [head, leaf] = path.split('.') as [string, string | undefined]
    if (leaf === undefined) {
      delete out[head]
      continue
    }
    const inner = out[head]
    if (isObj(inner)) {
      const copy = { ...inner }
      delete copy[leaf]
      out[head] = copy
    }
  }
  return out
}

/** Whether a settings write changed anything that syncs (a write that only touches device paths did not). */
export function syncedSettingsChanged(before: unknown, after: unknown): boolean {
  if (before === undefined || after === undefined) return before !== after
  return !deepEqual(
    syncedSettings(before, { forCompare: true }),
    syncedSettings(after, { forCompare: true }),
  )
}

// ─── Stamps ─────────────────────────────────────────────────────────────────

/**
 * The next last-write-wins stamp: the wall clock, but always past the previous stamp of this tab and
 * past the newest remote stamp seen (a hybrid clock). An edit made after seeing another device's change
 * therefore always beats that change, whatever the two clocks say.
 */
export function nextStamp(now: number, last: number, maxSeen: number): number {
  return Math.max(now, last + 1, maxSeen + 1)
}

// ─── Deterministic XP event ids ─────────────────────────────────────────────

/** The id of the `n`-th event (0-based) recorded under an award key: `xp:<key>#<n>`. */
export function xpEventId(key: string, n: number): string {
  return `xp:${key}#${n}`
}

/**
 * The id for the next event under `key`, given the ids that key already has on this device. Two devices
 * that pay the same award offline both write `#0` (one row after sync, not double XP); award, undo,
 * award is `#0 #1 #2` everywhere. Skips ahead if the natural number is somehow taken.
 */
export function nextXpEventId(key: string, existingIds: readonly string[]): string {
  const taken = new Set(existingIds)
  let n = existingIds.length
  while (taken.has(xpEventId(key, n))) n += 1
  return xpEventId(key, n)
}

/** Ids of the starter rewards, fixed so two devices that both seed the shop do not end up with two sets. */
export const starterRewardId = (index: number): string => `starter-reward:${index}`
