/**
 * The Dexie database (PLAN §3). Components never import this directly: reads go through
 * `src/db/hooks/*` or a feature's `queries.ts`, writes go through `src/db/repos/*`.
 */
import Dexie, { type Table } from 'dexie'
import { STORES_V2_DELTA, upgradeV2 } from './migrations/v2'
import { DB_NAME, STORES_V1 } from './schema'
import type {
  Assessment,
  Badge,
  Base,
  BlockEvent,
  BlocklistEntry,
  CheckIn,
  Flashcard,
  Goal,
  ID,
  Milestone,
  Millis,
  NewRow,
  ParkingItem,
  PlannedAssessment,
  PlanProposal,
  PracticeQuestion,
  QuestionAttempt,
  Readiness,
  Redemption,
  Resource,
  Reward,
  Ritual,
  SavedView,
  Session,
  Settings,
  Snapshot,
  StoredFile,
  StreakDay,
  Task,
  Template,
  TrashItem,
  Unit,
  WeeklyReview,
  WorldTile,
  XpEvent,
} from './types'

/** A table keyed by string id whose inserts may omit the timestamps (the hooks stamp them). */
export type ForgeTable<T extends Base> = Table<T, ID, NewRow<T>>

export type Clock = () => Millis

/**
 * `createdAt`/`updatedAt` stamping (DECISIONS: hooks only fill missing values).
 * - creating: fills `createdAt`/`updatedAt` only when absent, so restore/trash-restore keep originals.
 * - updating: stamps `updatedAt` unless the change sets it explicitly; a `put()` that drops
 *   `createdAt` keeps the stored one. A no-op change (empty diff) is left alone. Schema upgrades
 *   (`versionchange` transactions) are not stamped: a migration is not an edit.
 */
export function installTimestampHooks(db: Dexie, clock: Clock = Date.now): void {
  for (const table of db.tables) {
    table.hook('creating', (_key, obj: Partial<Base>) => {
      const now = clock()
      if (obj.createdAt == null) obj.createdAt = now
      if (obj.updatedAt == null) obj.updatedAt = obj.createdAt
    })
    table.hook('updating', (mods: object, _key, existing: Base, tx) => {
      const changes = mods as Record<string, unknown>
      if (Object.keys(changes).length === 0) return undefined
      if (tx.mode === 'versionchange') return undefined
      const extra: Partial<Base> = {}
      if ('createdAt' in changes && changes.createdAt == null) extra.createdAt = existing.createdAt
      if (changes.updatedAt == null) extra.updatedAt = clock()
      return extra
    })
  }
}

export class ForgeDB extends Dexie {
  declare settings: ForgeTable<Settings>
  declare tasks: ForgeTable<Task>
  declare goals: ForgeTable<Goal>
  declare milestones: ForgeTable<Milestone>
  declare units: ForgeTable<Unit>
  declare sessions: ForgeTable<Session>
  declare streakDays: ForgeTable<StreakDay>
  declare xpEvents: ForgeTable<XpEvent>
  declare badges: ForgeTable<Badge>
  declare rewards: ForgeTable<Reward>
  declare redemptions: ForgeTable<Redemption>
  declare blocklist: ForgeTable<BlocklistEntry>
  declare blockEvents: ForgeTable<BlockEvent>
  declare parkingLot: ForgeTable<ParkingItem>
  declare checkIns: ForgeTable<CheckIn>
  declare assessments: ForgeTable<Assessment>
  declare flashcards: ForgeTable<Flashcard>
  declare resources: ForgeTable<Resource>
  declare files: ForgeTable<StoredFile>
  declare snapshots: ForgeTable<Snapshot>
  declare trash: ForgeTable<TrashItem>
  declare worldTiles: ForgeTable<WorldTile>
  declare savedViews: ForgeTable<SavedView>
  declare rituals: ForgeTable<Ritual>
  declare weeklyReviews: ForgeTable<WeeklyReview>
  declare templates: ForgeTable<Template>
  declare plannedAssessments: ForgeTable<PlannedAssessment>
  declare planProposals: ForgeTable<PlanProposal>
  declare practiceQuestions: ForgeTable<PracticeQuestion>
  declare questionAttempts: ForgeTable<QuestionAttempt>
  declare readiness: ForgeTable<Readiness>

  constructor(name: string = DB_NAME, clock: Clock = Date.now) {
    super(name)
    // Append-only version history. v2+: see ./migrations/README.md.
    this.version(1).stores(STORES_V1)
    this.version(2)
      .stores(STORES_V2_DELTA)
      .upgrade((tx) => upgradeV2(tx, clock()))
    installTimestampHooks(this, clock)
  }
}

/** The app's single database instance. Dexie opens it lazily on first use. */
export const db = new ForgeDB()
