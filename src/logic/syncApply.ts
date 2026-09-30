/**
 * Pure helpers for the sync repo engine (`db/repos/sync.ts`, PLAN §4.7.5) that `logic/sync.ts` does not
 * carry: what to keep of a trashed file when a pulled row replaces or deletes the trash entry, which
 * plan tasks are duplicated, which level a page of XP must not celebrate, which refusals may be skipped
 * row by row, and the calm words for what went wrong.
 */
import type { Millis, SyncError, SyncErrorKind, Task } from '@/db/types'
import { decideLevelCelebration } from './xp'
import { isPlanTask } from './scheduler'
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
 * The attached files whose real bytes sit in a trash row that is about to be deleted here, and that a
 * resource still points at (`referenced`: the file ids of this device's resources, the restored one
 * included). The apply writes them back into `files`, so a Restore on another device never costs this one
 * its PDF (the `filesInTrash` rule). A file nothing points at is gone for good, as after "Delete forever".
 */
export function trashFilesToRescue(
  trashRow: unknown,
  referenced: ReadonlySet<string>,
): Record<string, unknown>[] {
  return filesInTrash([trashRow]).filter((f) => typeof f.id === 'string' && referenced.has(f.id))
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
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key).sort()
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

// ─── Refusals ───────────────────────────────────────────────────────────────

/**
 * Whether a failed push says "this content is refused" rather than "try later": a 4xx other than
 * sign-in (401), access rules (403), timeout (408), size (413, which halves the batch) and rate limits
 * (429). Such a batch is split to find the record the server will not take, and that record is skipped
 * and reported, so one bad row can never wedge the queue.
 */
export function isRowRejection(kind: SyncErrorKind, status: number | null): boolean {
  if (kind !== 'server' || status === null) return false
  return status >= 400 && status < 500 && ![401, 403, 408, 413, 429].includes(status)
}

// ─── Words ──────────────────────────────────────────────────────────────────

const PLAIN_NAMES: Partial<Record<SyncTableName, string>> = {
  tasks: 'task',
  goals: 'goal',
  milestones: 'course',
  units: 'unit',
  resources: 'resource',
  flashcards: 'flashcard',
  rewards: 'reward',
  parkingLot: 'parking-lot note',
  checkIns: 'check-in',
  weeklyReviews: 'weekly review',
  savedViews: 'saved view',
  templates: 'template',
  trash: 'Trash entry',
  rituals: 'ritual entry',
  settings: 'settings',
}

/** How an error names a record: “Title” for a row with a title or name, else “a task”. Never longer than 60 characters of the title. */
export function recordLabel(tbl: string, data: unknown): string {
  const kind = PLAIN_NAMES[tbl as SyncTableName] ?? 'item'
  if (isObj(data)) {
    const text = [data.title, data.name, data.note].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    )
    if (text !== undefined) {
      const clean = text.trim().replace(/\s+/g, ' ')
      return `“${clean.length > 60 ? `${clean.slice(0, 59)}…` : clean}”`
    }
  }
  return `a ${kind}`
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
  stalled: "Supabase answered with the same rows again, so Forge stopped. It will try again.",
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
  return Math.round(serverNow - (sentAt + receivedAt) / 2)
}
