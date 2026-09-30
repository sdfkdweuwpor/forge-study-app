/**
 * Dexie store definitions (PLAN §3.3). Released version strings are append-only: NEVER edit
 * STORES_V1 or a later delta. A schema change adds `migrations/vN.ts` (see migrations/README.md).
 *
 * Index rules: never index booleans, `null` or `undefined` (IndexedDB can't key them). Nullable
 * fields such as `dueDate` simply drop out of their index.
 */
import { STORES_V2_DELTA } from './migrations/v2'

export const DB_NAME = 'forge'
export const SCHEMA_VERSION = 2

export const STORES_V1 = {
  settings: 'id',
  tasks:
    'id, status, dueDate, completedDay, goalId, milestoneId, unitId, scheduleKey, seriesId, *tags, [status+dueDate], [goalId+status]',
  goals: 'id, status, order',
  milestones: 'id, goalId, status, code, termId, [goalId+order]',
  units: 'id, goalId, milestoneId, [milestoneId+order]',
  sessions: 'id, status, day, startedAt, taskId, goalId, milestoneId, [kind+day]',
  streakDays: 'id',
  xpEvents: 'id, at, day, source, key',
  badges: 'id, unlockedAt',
  rewards: 'id, order',
  redemptions: 'id, at, rewardId',
  blocklist: 'id, domain, kind',
  blockEvents: 'id, at, day, kind, domain',
  parkingLot: 'id, status, sessionId, createdAt',
  checkIns: 'id, sessionId, day',
  assessments: 'id, goalId, milestoneId, [milestoneId+kind]',
  flashcards: 'id, goalId, milestoneId, dueDate, [milestoneId+dueDate]',
  resources: 'id, goalId, milestoneId, status',
  files: 'id',
  snapshots: 'id, day, createdAt, reason',
  trash: 'id, expiresAt, entityTable, createdAt',
  worldTiles: 'id, sourceId',
  savedViews: 'id, order',
  rituals: 'id, day, kind',
  weeklyReviews: 'id',
  templates: 'id, kind',
} as const

/** The current stores: v1 with every later delta applied (what the latest version declares). */
export const STORES = { ...STORES_V1, ...STORES_V2_DELTA } as const

export type TableName = keyof typeof STORES

/** Every table name, in schema order (backup/export/reset iterate this). */
export const TABLE_NAMES = Object.keys(STORES) as TableName[]
