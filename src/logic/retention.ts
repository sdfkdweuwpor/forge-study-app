/**
 * How long safety copies live (pure; PLAN §3.5, Phase 11c). Two rules of the safety net are kept here so
 * they are testable without a database:
 *
 *  - the Trash keeps a deleted item for 30 *calendar* days. The expiry is the same local clock time 30
 *    days later and "Deletes in N days" counts calendar days, so a DST change (a 23 h or 25 h day) can
 *    never make an item live 29 or 31 days, or make the label skip a number;
 *  - snapshots are pruned per kind: the newest 7 automatic ones, the newest 5 of every other kind.
 */
import type { ISODate, Millis, SnapshotReason } from '@/db/types'
import { dayOf, diffDays } from './dates'

// ─── Trash ──────────────────────────────────────────────────────────────────

/** How many calendar days a deleted item stays in the Trash. */
export const TRASH_DAYS = 30

/**
 * When an item trashed at `now` is purged: the same local time of day, `TRASH_DAYS` calendar days later.
 * (`now + 30 × 24 h` would land an hour early or late when a DST change falls in between.)
 */
export function trashExpiry(now: Millis): Millis {
  const d = new Date(now)
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + TRASH_DAYS,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  ).getTime()
}

/** True once an entry's time is up (it is removed at the next purge). */
export function isExpired(expiresAt: Millis, now: Millis): boolean {
  return expiresAt <= now
}

/** Whole calendar days left before an entry is purged; 0 on the day it goes, never negative. */
export function daysUntilPurge(expiresAt: Millis, now: Millis): number {
  return Math.max(0, diffDays(dayOf(expiresAt), dayOf(now)))
}

/** "Deletes in 30 days", "Deletes tomorrow", "Deletes today". */
export function purgeLabel(expiresAt: Millis, now: Millis): string {
  const days = daysUntilPurge(expiresAt, now)
  if (days === 0) return 'Deletes today'
  if (days === 1) return 'Deletes tomorrow'
  return `Deletes in ${days} days`
}

// ─── Once a day ─────────────────────────────────────────────────────────────

/**
 * Whether a once-a-day chore (the purge, the automatic snapshot) is due: it never ran, or it last ran
 * on an earlier local day. A `lastDay` in the future (the clock was set back) is not due, so a wrong
 * clock cannot write a snapshot on every start.
 */
export function dailyDue(lastDay: ISODate | null, today: ISODate): boolean {
  return lastDay === null || lastDay < today
}

/** The longest gap between two starts that is taken as ordinary use; a longer one may be a clock that jumped. */
export const CLOCK_JUMP_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Whether the clock has moved more than two days past the last start's (`lastSeen`; `null` on the first
 * start). Someone who was away for a week and a device whose clock was set years ahead look the same, so
 * the purge, which deletes for good, skips that one start and waits for the next.
 */
export function clockJumpedForward(lastSeen: Millis | null, now: Millis): boolean {
  return lastSeen !== null && now - lastSeen > CLOCK_JUMP_MS
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

/** Newest snapshots kept per kind. Automatic ones cover a week; the rest are chosen or safety copies. */
export const SNAPSHOT_KEEP: Readonly<Record<SnapshotReason, number>> = {
  daily: 7,
  manual: 5,
  'pre-import': 5,
  'pre-restore': 5,
  'pre-reset': 5,
}

/** What pruning needs to know about a snapshot. */
export interface SnapshotStub {
  id: string
  reason: SnapshotReason
  createdAt: Millis
}

/** The ids to delete so each kind keeps only its newest `keep[kind]` snapshots (newest first; ties by id). */
export function snapshotsToPrune(
  snapshots: readonly SnapshotStub[],
  keep: Readonly<Record<SnapshotReason, number>> = SNAPSHOT_KEEP,
): string[] {
  const byReason = new Map<SnapshotReason, SnapshotStub[]>()
  for (const s of snapshots) {
    const list = byReason.get(s.reason)
    if (list) list.push(s)
    else byReason.set(s.reason, [s])
  }
  const doomed: string[] = []
  for (const [reason, list] of byReason) {
    list.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    // A kind this build does not know (a newer build's) is kept whole: pruning must never delete what it cannot judge.
    const limit = Math.max(0, keep[reason] ?? Infinity)
    for (const s of list.slice(limit)) doomed.push(s.id)
  }
  return doomed
}

/** Kinds in the order the list shows them when times are equal, and the words used for them. */
export const SNAPSHOT_KIND_LABEL: Readonly<Record<SnapshotReason, string>> = {
  daily: 'Automatic',
  manual: 'Manual',
  'pre-import': 'Before import',
  'pre-restore': 'Before restore',
  'pre-reset': 'Before reset',
}

/** "Automatic", "Manual", "Before import"…; an unknown kind (a newer build's) is shown as it is. */
export function snapshotKindLabel(reason: string): string {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT_KIND_LABEL, reason)
    ? SNAPSHOT_KIND_LABEL[reason as SnapshotReason]
    : reason
}

/** "812 B", "48 KB", "1.3 MB": sizes in the snapshot list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** `forge-snapshot-2026-09-29-0930-manual.json` (local time), the name of a downloaded snapshot. */
export function snapshotFilename(createdAt: Millis, reason: string): string {
  const d = new Date(createdAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `forge-snapshot-${dayOf(createdAt)}-${hh}${mm}-${reason}.json`
}

const CONTENT_WORDS: readonly (readonly [string, string, string])[] = [
  ['goals', 'goal', 'goals'],
  ['milestones', 'course', 'courses'],
  ['tasks', 'task', 'tasks'],
  ['sessions', 'session', 'sessions'],
  ['flashcards', 'flashcard', 'flashcards'],
  ['resources', 'resource', 'resources'],
]

/** "1 goal, 20 courses, 31 tasks and 2,000 sessions": what a snapshot holds, in words (empty when unknown). */
export function snapshotContents(counts: Readonly<Record<string, number>> | null): string {
  if (counts === null) return ''
  const parts = CONTENT_WORDS.flatMap(([table, one, many]) => {
    const n = counts[table] ?? 0
    return n > 0 ? [`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`] : []
  })
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const DAY_SAME_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DAY_OTHER_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Today, 9:30 AM", "Yesterday, 9:30 AM", "Sep 27, 9:30 AM", "Dec 30, 2025, 8:05 PM" (local time). */
export function whenLabel(at: Millis, now: Millis): string {
  const days = diffDays(dayOf(now), dayOf(at))
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : (new Date(at).getFullYear() === new Date(now).getFullYear()
            ? DAY_SAME_YEAR
            : DAY_OTHER_YEAR
          ).format(at)
  return `${day}, ${TIME.format(at)}`
}
