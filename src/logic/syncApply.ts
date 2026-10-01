/**
 * Pure helpers for the sync repo engine (`db/repos/sync.ts`, PLAN §4.7.5) that `logic/sync.ts` does not
 * carry: what to keep of a trashed file when a pulled row replaces or deletes the trash entry, which
 * plan tasks are duplicated, which level a page of XP must not celebrate, which refusals may be skipped
 * row by row, and the calm words for what went wrong.
 */
import type { Millis, SyncError, SyncErrorKind, Task } from '@/db/types'
import { decideLevelCelebration } from './xp'
import { isPlanTask } from './scheduler'
import { TRASH_DAYS } from './retention'
import { filesInTrash } from './snapshotJson'
import type { SyncTableName } from './syncTables'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// ─── Trash and attached files ───────────────────────────────────────────────

/** The `{ __blob, type, size }` a pushed trash row carries in place of a file's bytes. */
export function isBlobMarker(v: unknown): boolean {
  return isObj(v) && v.__blob === true
}

/**
 * The trash row to write when a pulled one arrives: the pulled row, except that an attached file whose
 * bytes this device still holds in its own copy of the row (a real `Blob`, same file id) keeps them. The
 * pulled copy only has the marker, so writing it as it is would throw the PDF away on the one device that
 * has it. Returns `remote` itself when nothing needs keeping.
 */
export function keepLocalTrashBlobs(local: unknown, remote: Obj): Obj {
  const theirs = isObj(remote.payload) ? remote.payload.files : undefined
  const ours = isObj(local) && isObj(local.payload) ? local.payload.files : undefined
  if (!Array.isArray(theirs) || !Array.isArray(ours) || typeof Blob === 'undefined') return remote
  const held = new Map<string, Blob>()
  for (const f of ours) {
    if (isObj(f) && typeof f.id === 'string' && f.blob instanceof Blob) held.set(f.id, f.blob)
  }
  if (held.size === 0) return remote
  let changed = false
  const files = theirs.map((f: unknown) => {
    if (!isObj(f) || typeof f.id !== 'string' || !isBlobMarker(f.blob)) return f
    const blob = held.get(f.id)
    if (blob === undefined) return f
    changed = true
    return { ...f, blob }
  })
  return changed ? { ...remote, payload: { ...(remote.payload as Obj), files } } : remote
}

/**
 * The attached files whose real bytes sit in a trash row that a pull is about to delete here: the apply
 * writes them back into `files`. A Restore on another device brings the resource back, but its row can
 * arrive on a later page or in a later cycle than the tombstone (edited after the restore, or held back
 * by the server), and this may be the only device with the bytes, so they are kept whether or not a
 * resource points at them yet. A row past its `expiresAt` is being purged, not restored: nothing is kept,
 * as when this device purges it. What nobody claims is removed later (`rescuedFilesToDrop`).
 */
export function trashFilesToRescue(trashRow: unknown, now: Millis): Record<string, unknown>[] {
  if (isObj(trashRow) && typeof trashRow.expiresAt === 'number' && trashRow.expiresAt <= now)
    return []
  return filesInTrash([trashRow]).filter((f) => typeof f.id === 'string')
}

/** How long bytes kept from a deleted trash row wait for a resource to claim them: the Trash's own 30 days. */
export const RESCUED_FILE_KEEP_MS = TRASH_DAYS * 24 * 60 * 60_000

/**
 * The files kept by `trashFilesToRescue` that nothing claimed within `RESCUED_FILE_KEEP_MS`: the Trash
 * entry was deleted for good on another device. A kept file is written with `updatedAt` = when it was
 * kept (a stored file is never edited, so `updatedAt > createdAt` marks one); `referenced` holds every
 * file id a resource points at, here or inside a Trash entry.
 */
export function rescuedFilesToDrop(
  files: readonly { id: string; createdAt: Millis; updatedAt: Millis }[],
  referenced: ReadonlySet<string>,
  now: Millis,
): string[] {
  return files
    .filter(
      (f) =>
        f.updatedAt > f.createdAt &&
        now - f.updatedAt >= RESCUED_FILE_KEEP_MS &&
        !referenced.has(f.id),
    )
    .map((f) => f.id)
}

// ─── Plan tasks ─────────────────────────────────────────────────────────────

type PlanTaskLike = Pick<Task, 'source' | 'scheduleKey' | 'kind' | 'status'>

/**
 * The `scheduleKey`s that two or more open plan tasks share: both devices re-planned the same goal
 * offline and each created its own task for the same chunk. Finished tasks do not count (completing the
 * same chunk on two devices is two real sessions). Sorted, so the answer is the same everywhere.
 */
export function duplicatePlanKeys(tasks: readonly PlanTaskLike[]): string[] {
  const seen = new Map<string, number>()
  for (const t of tasks) {
    if (t.status === 'done' || t.scheduleKey === null) continue
    if (!isPlanTask(t)) continue
    seen.set(t.scheduleKey, (seen.get(t.scheduleKey) ?? 0) + 1)
  }
  return [...seen]
    .filter(([, n]) => n > 1)
    .map(([key]) => key)
    .sort()
}

/** The goal a pulled task belongs to when it is an item of that goal's plan, else null. */
export function planTaskGoalId(data: unknown): string | null {
  if (!isObj(data) || data.source !== 'schedule') return null
  return typeof data.goalId === 'string' ? data.goalId : null
}

// ─── Levels ─────────────────────────────────────────────────────────────────

/**
 * The level to record as already celebrated after a page of XP arrived from another device, or null
 * when `settings.lastCelebratedLevel` is already there. XP earned elsewhere is not a moment here.
 */
export function levelToAbsorb(lastCelebrated: number, currentLevel: number): number | null {
  const d = decideLevelCelebration(lastCelebrated, currentLevel)
  return d.kind === 'none' ? null : d.level
}

// ─── Seed rows with fixed ids ───────────────────────────────────────────────

/**
 * Whether `local` is a row this device only has because it seeded it, under an id every device uses
 * (`starter-reward:N`, `default:<domain>`), and has not touched since. On a first sync the account wins
 * over such a row whatever the stamps say: a seed is always newer than anything the account's owner did
 * on another device, so comparing stamps would hand the account back its starter rewards and default
 * sites after the person edited or removed them.
 *  - a starter reward: `updatedAt === createdAt`;
 *  - a default site: `kind: 'block'`, on, no pattern, no note, and `updatedAt` fewer than
 *    `defaultSiteCount` ms from `createdAt` (the seed spreads `createdAt` by one ms per site; any later
 *    edit is far past it).
 * Rows of any other table, or with another id, are never seeds in this sense.
 */
export function accountWinsOverSeed(
  tbl: string,
  local: unknown,
  defaultSiteCount: number,
): boolean {
  if (!isObj(local) || typeof local.id !== 'string') return false
  const { createdAt, updatedAt } = local
  if (typeof createdAt !== 'number' || typeof updatedAt !== 'number') return false
  if (tbl === 'rewards') return /^starter-reward:\d+$/.test(local.id) && updatedAt === createdAt
  if (tbl === 'blocklist') {
    return (
      typeof local.domain === 'string' &&
      local.id === `default:${local.domain}` &&
      local.kind === 'block' &&
      local.enabled === true &&
      local.pattern === null &&
      local.note === null &&
      Math.abs(updatedAt - createdAt) < defaultSiteCount
    )
  }
  return false
}

// ─── Refusals ───────────────────────────────────────────────────────────────

/**
 * Whether a failed push says "this content is refused" rather than "try later": a 4xx other than
 * sign-in (401), access rules (403), timeout (408), size (413, which halves the batch) and rate limits
 * (429), that carries a PostgreSQL code of a row breaking a rule: cardinality (21, one key twice), data
 * (22, a value the column cannot take), integrity (23, a constraint) or a program limit (54). Such a batch
 * is split to find the record the server will not take, and that record is skipped and reported, so one
 * bad row can never wedge the queue. A 4xx without such a code (a proxy, a schema-cache reload, a missing
 * column) says nothing about one row, so it fails the cycle and everything stays queued.
 */
export function isRowRejection(
  kind: SyncErrorKind,
  status: number | null,
  code: string | null = null,
): boolean {
  if (kind !== 'server' || status === null || code === null) return false
  return (
    status >= 400 &&
    status < 500 &&
    ![401, 403, 408, 413, 429].includes(status) &&
    /^(21|22|23|54)[0-9A-Z]{3}$/.test(code)
  )
}

// ─── Words ──────────────────────────────────────────────────────────────────

const PLAIN_NAMES: Partial<Record<SyncTableName, string>> = {
  tasks: 'a task',
  goals: 'a goal',
  milestones: 'a course',
  units: 'a unit',
  resources: 'a resource',
  flashcards: 'a flashcard',
  rewards: 'a reward',
  parkingLot: 'a parking-lot note',
  checkIns: 'a check-in',
  weeklyReviews: 'a weekly review',
  savedViews: 'a saved view',
  templates: 'a template',
  trash: 'a Trash entry',
  rituals: 'a ritual entry',
  settings: 'the settings',
}

/** How an error names a record: “Title” for a row with a title or name (shortened to 60 characters), else “a task”. */
export function recordLabel(tbl: string, data: unknown): string {
  if (isObj(data)) {
    const text = [data.title, data.name, data.note].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    )
    if (text !== undefined) {
      const clean = text.trim().replace(/\s+/g, ' ')
      return `“${clean.length > 60 ? `${clean.slice(0, 59)}…` : clean}”`
    }
  }
  return PLAIN_NAMES[tbl as SyncTableName] ?? 'an item'
}

/** One error, stamped. */
export function syncError(kind: SyncErrorKind, message: string, at: Millis): SyncError {
  return { kind, message, at }
}

export const SYNC_TEXT = {
  updateNeeded:
    'Another device runs a newer Forge. Reload to update this one; sync picks up where it left off.',
  snapshot:
    "Forge couldn't save a safety snapshot first, so it changed nothing. It will try again shortly.",
  stalled: 'Supabase answered with the same rows again, so Forge stopped. It will try again.',
  signedOut: 'Sign in again to keep syncing. Your changes are kept on this device.',
  tooLarge: (label: string): string =>
    `${label} is too large to sync, so it stays on this device. Everything else synced.`,
  refused: (label: string): string =>
    `Supabase wouldn't take ${label}, so it stays on this device. Everything else synced.`,
} as const

/** Whether the clock should be measured again: never measured, or the last measurement is over an hour old. */
export function clockCheckDue(lastCheckedAt: Millis | null, now: Millis): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= 60 * 60_000 || now < lastCheckedAt
}

/** Server time minus this device's time, from a call sent at `sentAt` and answered at `receivedAt`. */
export function clockSkew(serverNow: Millis, sentAt: Millis, receivedAt: Millis): number {
  // `+ 0` turns a rounded -0 into 0.
  return Math.round(serverNow - (sentAt + receivedAt) / 2) + 0
}
