/**
 * Domain handlers and start-up work for badges (Phase 6C).
 *
 * A badge is earned by history, so every trigger does the same thing: `reconcileBadges` re-reads the
 * history, inserts what is newly earned and never removes anything. Triggers are a counted session
 * ending, a course being completed, the streak rows changing (Phase 7 writes them without an event of
 * its own) and app start, which also catches whatever happened while no tab was open.
 *
 * Badges earned by a live event or a streak change are announced ("Badge unlocked · Early Bird 🌅")
 * through a small listener list that `BadgeUnlockToaster` subscribes to. The reconcile at app start is
 * silent: whatever it finds arrived without an event (older history, an import, a restored backup, the
 * first run on this device), so it is credited quietly and simply appears in the grid.
 */
import { recordError } from '@/app/reportError'
import { defineHandler, type DomainHandler } from '@/db/events'
import { reconcileBadges, watchStreakDays } from '@/db/repos/badges'
import type { Badge, TableName } from '@/db/types'

// ─── Announcements ──────────────────────────────────────────────────────────

type UnlockListener = (badges: readonly Badge[]) => void
const listeners = new Set<UnlockListener>()

/** Calls `listener` with the badges each reconcile newly unlocked (and announces). Returns unsubscribe. */
export function onBadgesUnlocked(listener: UnlockListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function announce(badges: readonly Badge[]): void {
  if (badges.length === 0) return
  for (const listener of [...listeners]) listener(badges)
}

// ─── Reconcile ──────────────────────────────────────────────────────────────

/** Reconciles now and announces what is new. Concurrent calls are safe: each badge is returned once. */
export async function reconcileAndAnnounce(now: number = Date.now()): Promise<Badge[]> {
  const fresh = await reconcileBadges(now)
  announce(fresh)
  return fresh
}

const sessionEnded = defineHandler({
  id: 'badges.sessionEnded',
  event: 'session.ended',
  async handle(event) {
    // A session that did not count earns nothing.
    if (!event.counted) return
    await reconcileAndAnnounce()
  },
})

const courseCompleted = defineHandler({
  id: 'badges.milestoneCompleted',
  event: 'milestone.completed',
  async handle() {
    await reconcileAndAnnounce()
  },
})

/** Tables `reconcileBadges` reads from the synced data (the streak rows are rebuilt locally, see progress). */
const BADGE_INPUTS: ReadonlySet<TableName> = new Set<TableName>([
  'sessions',
  'milestones',
  'goals',
  'settings',
])

/**
 * Cloud sync brought rows from another device: credit whatever this history now earns, quietly. The
 * badges the other device earned arrive as rows and need no toast here, and nothing is announced for
 * work done elsewhere, so this reconciles without `announce`.
 */
const syncApplied = defineHandler({
  id: 'badges.syncApplied',
  event: 'sync.applied',
  async handle(event) {
    if (!event.tables.some((t) => BADGE_INPUTS.has(t))) return
    await reconcileBadges()
  },
})

export const badgeDomainHandlers: DomainHandler[] = [sessionEnded, courseCompleted, syncApplied]

// ─── Start-up and streak changes ────────────────────────────────────────────

let stopWatching: (() => void) | null = null

/** Stops watching the streak rows (tests and hot reload); the next app start watches again. */
export function stopBadgeWatch(): void {
  stopWatching?.()
  stopWatching = null
}

/**
 * The feature's `onAppStart` (runs on load and at each local midnight). Credits whatever the history has
 * earned, silently, then watches the streak rows once, so a streak that moves later reconciles too (and
 * announces, like any live unlock).
 */
export async function badgeAppStart(ctx: { now: number }): Promise<void> {
  await reconcileBadges(ctx.now)

  if (stopWatching === null) {
    stopWatching = watchStreakDays(
      () => {
        reconcileAndAnnounce().catch((e: unknown) => recordError(e, 'badges.streakChanged'))
      },
      (e) => recordError(e, 'badges.watchStreakDays'),
    )
  }
}
