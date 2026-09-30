/**
 * Schema v2: the Goal Breakdown Planner (PLAN §4.6).
 * - tasks: `doDate`/`doTime`/`durationMinutes`, `autoSlot`, `kind`, `assessmentId`, `sync`; indexes on
 *   `doDate`, `[status+doDate]`, `kind`, `assessmentId` and `[goalId+kind]`.
 * - sessions: a `[goalId+day]` index (the field already exists).
 * - goals get `planning`; units and courses their self-rating and estimate metadata; flashcards their
 *   scheduler fields (none of these are indexed, so their stores do not change).
 * - new tables: `plannedAssessments`, `planProposals`, `practiceQuestions`, `questionAttempts`,
 *   `readiness`.
 * Trash payloads are mapped too (restoring a v1 row after the upgrade must give a v2 row). The row
 * mapping is pure and shared with the backup migrator (`@/logic/schemaV2`).
 */
import type { Transaction } from 'dexie'
import {
  flashcardToV2,
  goalToV2,
  milestoneToV2,
  settingsToV2,
  taskToV2,
  trashToV2,
  unitToV2,
  V2_DEFAULT_STUDY_START,
  wguPlannedAssessments,
} from '@/logic/schemaV2'

/** Only the stores that change in v2 (Dexie keeps every other table as declared in v1). */
export const STORES_V2_DELTA = {
  tasks:
    'id, status, dueDate, doDate, completedDay, goalId, milestoneId, unitId, scheduleKey, seriesId, kind, assessmentId, *tags, [status+dueDate], [status+doDate], [goalId+status], [goalId+kind]',
  sessions: 'id, status, day, startedAt, taskId, goalId, milestoneId, [kind+day], [goalId+day]',
  plannedAssessments: 'id, goalId, milestoneId, date, [goalId+order]',
  planProposals: 'id, goalId, status, createdAt',
  practiceQuestions: 'id, goalId, milestoneId, unitId',
  questionAttempts: 'id, questionId, milestoneId, day, requeueOn',
  readiness: 'id, goalId, milestoneId',
} as const

type Row = Record<string, unknown>

/** Replaces the object Dexie hands to `modify()` with `next`, key by key. */
function assign(target: Row, next: Row): void {
  for (const key of Object.keys(next)) target[key] = next[key]
}

/**
 * Upgrades every row in one transaction. Timestamps are kept: the timestamp hooks skip `versionchange`
 * transactions (see `db.ts`), so the upgrade does not make every row look freshly edited.
 */
export async function upgradeV2(tx: Transaction, now: number = Date.now()): Promise<void> {
  const settings = (await tx.table('settings').get('app')) as Row | undefined
  const scheduling = settings?.scheduling as Row | undefined
  const studyStart =
    typeof scheduling?.defaultStudyStart === 'string'
      ? scheduling.defaultStudyStart
      : V2_DEFAULT_STUDY_START

  await tx
    .table('tasks')
    .toCollection()
    .modify((row: Row) => assign(row, taskToV2(row)))
  await tx
    .table('goals')
    .toCollection()
    .modify((row: Row) => assign(row, goalToV2(row, { studyStart })))
  await tx
    .table('milestones')
    .toCollection()
    .modify((row: Row) => assign(row, milestoneToV2(row)))
  await tx
    .table('units')
    .toCollection()
    .modify((row: Row) => assign(row, unitToV2(row)))
  await tx
    .table('flashcards')
    .toCollection()
    .modify((row: Row) => assign(row, flashcardToV2(row)))
  await tx
    .table('settings')
    .toCollection()
    .modify((row: Row) => assign(row, settingsToV2(row)))
  // Trashed rows come back through `restoreFromTrash`, so they must be v2 rows too.
  await tx
    .table('trash')
    .toCollection()
    .modify((row: Row) => assign(row, trashToV2(row, now, studyStart)))

  const courses = (await tx.table('milestones').toArray()) as unknown[]
  const assessments = tx.table('plannedAssessments')
  for (const a of wguPlannedAssessments(courses, now)) {
    if ((await assessments.get(a.id)) === undefined) await assessments.add(a)
  }
}
