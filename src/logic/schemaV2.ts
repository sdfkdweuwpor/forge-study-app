/**
 * Schema v2 row mapping (pure; PLAN §4.6). The Dexie upgrade (`db/migrations/v2.ts`) and the backup
 * migrator (`logic/backup.ts`) share it, so an old backup or snapshot imports exactly like an upgraded
 * database.
 *
 * Every function is idempotent: a row that already carries its v2 fields keeps them (a task that already
 * has `doDate` is not moved again), so running a mapping twice changes nothing.
 *
 * - Tasks: the single v1 date meant "the day to do it", so `dueDate/dueTime` move to `doDate/doTime` and
 *   the due fields are cleared (no v1 task claims a deadline it never had). `durationMinutes` is the
 *   estimate, `kind` is `study` for scheduler chunks, `review` for flashcard reviews, else `task`.
 * - Goals get `planning`: the v1 weekday minutes as one window per study day starting at the user's
 *   `defaultStudyStart`, 50-min sessions, a 12 % buffer, 15 h per CU, ASAP only without a target.
 * - Units and courses get their self-rating and estimate metadata; flashcards their scheduler fields.
 * - WGU courses (`courseType` OA / PA / OA+PA) get undated planned assessments, with ids derived from the
 *   course (`${courseId}:oa`, `${courseId}:pa`), so re-running never duplicates them.
 */
import type {
  Availability,
  GoalPlanning,
  HHmm,
  ISODate,
  Millis,
  PlannedAssessment,
  TimeWindow,
} from '@/db/types'
import { DEFAULT_BUFFER_PCT, DEFAULT_CU_HOURS_MULTIPLIER } from './scheduler/effort'
import { DEFAULT_SESSION_MINUTES, fromLegacyAvailability } from './scheduler/windows'

/** `settings.scheduling.defaultStudyStart` when a database has no settings row yet. */
export const V2_DEFAULT_STUDY_START: HHmm = '09:00'

/** Everyday tasks may be auto-slotted 09:00–21:00 every day unless the user says otherwise. */
export function defaultTaskWindows(): TimeWindow[][] {
  return Array.from({ length: 7 }, () => [{ start: '09:00', end: '21:00' }])
}

type Row = Record<string, unknown>

const has = (row: Row, key: string): boolean => Object.prototype.hasOwnProperty.call(row, key)
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Fills `key` with `value` only when the row does not have it yet. */
function fill(row: Row, key: string, value: unknown): void {
  if (!has(row, key)) row[key] = value
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export function taskToV2<T extends object>(input: T): T {
  const row: Row = { ...(input as Row) }
  if (!has(row, 'doDate')) {
    row.doDate = row.dueDate ?? null
    row.doTime = row.dueTime ?? null
    row.dueDate = null
    row.dueTime = null
  }
  fill(row, 'doTime', null)
  fill(row, 'durationMinutes', numOrNull(row.estimateMinutes))
  fill(row, 'autoSlot', false)
  fill(
    row,
    'kind',
    row.source === 'schedule' ? 'study' : row.source === 'flashcards' ? 'review' : 'task',
  )
  fill(row, 'assessmentId', null)
  fill(row, 'sync', null)
  return row as T
}

// ─── Goals ──────────────────────────────────────────────────────────────────

/**
 * The planning settings for a goal known only by its v1 availability: one window per study weekday
 * starting at `studyStart` (moved earlier if it would pass midnight), ASAP when there is no target.
 */
export function planningFromAvailability(
  availability: Availability,
  targetDate: ISODate | null,
  studyStart: HHmm = V2_DEFAULT_STUDY_START,
): GoalPlanning {
  const av = fromLegacyAvailability(availability, {
    studyStart,
    sessionMinutes: DEFAULT_SESSION_MINUTES,
  })
  return {
    sessionMinutes: DEFAULT_SESSION_MINUTES,
    weekly: av.weekly.map((day) => day.map((w) => ({ start: w.start, end: w.end }))),
    shiftPattern: null,
    bufferPct: DEFAULT_BUFFER_PCT,
    cuHoursMultiplier: DEFAULT_CU_HOURS_MULTIPLIER,
    asap: targetDate === null,
    paceMinutesPerStudyDay: null,
  }
}

const EMPTY_AVAILABILITY: Availability = { minutesByWeekday: [0, 0, 0, 0, 0, 0, 0], daysOff: [] }

function isAvailability(v: unknown): v is Availability {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Partial<Availability>
  return Array.isArray(a.minutesByWeekday) && Array.isArray(a.daysOff)
}

export function goalToV2<T extends object>(input: T, ctx: { studyStart?: HHmm } = {}): T {
  const row: Row = { ...(input as Row) }
  if (!has(row, 'planning')) {
    const availability = isAvailability(row.availability) ? row.availability : EMPTY_AVAILABILITY
    const target = typeof row.targetDate === 'string' ? row.targetDate : null
    row.planning = planningFromAvailability(availability, target, ctx.studyStart)
  }
  return row as T
}

// ─── Courses and units ──────────────────────────────────────────────────────

export function milestoneToV2<T extends object>(input: T): T {
  const row: Row = { ...(input as Row) }
  fill(row, 'selfRating', null)
  return row as T
}

export function unitToV2<T extends object>(input: T): T {
  const row: Row = { ...(input as Row) }
  const minutes = numOrNull(row.estimateMinutes)
  fill(row, 'selfRating', null)
  fill(row, 'optional', false)
  fill(row, 'baseEstimateMinutes', minutes)
  fill(row, 'estimateSource', minutes === null ? 'course' : 'hours')
  return row as T
}

export function flashcardToV2<T extends object>(input: T): T {
  const row: Row = { ...(input as Row) }
  fill(row, 'scheduler', 'sm2')
  fill(row, 'fsrs', null)
  fill(row, 'noteRef', null)
  return row as T
}

/** `settings.scheduling.taskWindows`, the one settings field v2 adds. */
export function settingsToV2<T extends object>(input: T): T {
  const row: Row = { ...(input as Row) }
  const scheduling = row.scheduling
  if (
    typeof scheduling === 'object' &&
    scheduling !== null &&
    !has(scheduling as Row, 'taskWindows')
  )
    row.scheduling = { ...(scheduling as Row), taskWindows: defaultTaskWindows() }
  return row as T
}

/** Ids of the planned assessments a WGU course gets. */
export const wguAssessmentId = (courseId: string, kind: 'oa' | 'pa'): string =>
  `${courseId}:${kind}`

interface CourseLike {
  id: string
  goalId: string
  order: number
  status: string
  courseType: string | null
  completedAt: Millis | null
}

function isCourseLike(v: unknown): v is CourseLike {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Row
  return typeof r.id === 'string' && typeof r.goalId === 'string'
}

/**
 * Undated planned assessments for the WGU courses among `courses`: an OA is an exam ("Objective
 * assessment"), a PA a project ("Performance assessment"). A finished course's are done already, so
 * the planner never places them.
 */
export function wguPlannedAssessments(
  courses: readonly unknown[],
  now: Millis,
): PlannedAssessment[] {
  const out: PlannedAssessment[] = []
  for (const c of courses) {
    if (!isCourseLike(c)) continue
    const type = c.courseType
    if (type !== 'OA' && type !== 'PA' && type !== 'OA+PA') continue
    const done = c.status === 'done'
    const order = Number.isFinite(c.order) ? c.order : 0
    const make = (kind: 'oa' | 'pa', n: number): PlannedAssessment => ({
      id: wguAssessmentId(c.id, kind),
      createdAt: now,
      updatedAt: now,
      goalId: c.goalId,
      milestoneId: c.id,
      kind: kind === 'oa' ? 'exam' : 'project',
      title: kind === 'oa' ? 'Objective assessment' : 'Performance assessment',
      date: null,
      time: null,
      durationMinutes: null,
      status: done ? 'done' : 'planned',
      completedAt: done ? (c.completedAt ?? now) : null,
      order: order * 2 + n,
      source: 'wgu',
    })
    if (type === 'OA' || type === 'OA+PA') out.push(make('oa', 0))
    if (type === 'PA' || type === 'OA+PA') out.push(make('pa', 1))
  }
  return out
}

// ─── Whole tables (backups, snapshots) ──────────────────────────────────────

/** The tables v2 adds, empty in a migrated v1 backup (plus the WGU assessments). */
export const V2_NEW_TABLES = [
  'plannedAssessments',
  'planProposals',
  'practiceQuestions',
  'questionAttempts',
  'readiness',
] as const

/**
 * Rows of several tables mapped to v2 (a trash entry's payload, or a backup's tables): every row as the
 * Dexie upgrade maps it, plus the WGU planned assessments of any courses among them. Tables it does not
 * know are passed through; no empty tables are added.
 */
export function migrateRowsV1toV2(
  tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  now: Millis,
  studyStart: HHmm = V2_DEFAULT_STUDY_START,
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(tables)) if (rows) out[name] = [...rows]
  const map = (name: string, fn: (row: object) => object): void => {
    const rows = out[name]
    if (rows) out[name] = rows.map((r) => (typeof r === 'object' && r !== null ? fn(r) : r))
  }
  map('tasks', taskToV2)
  map('goals', (r) => goalToV2(r, { studyStart }))
  map('milestones', milestoneToV2)
  map('units', unitToV2)
  map('flashcards', flashcardToV2)
  map('settings', settingsToV2)
  const added = wguPlannedAssessments(out.milestones ?? [], now)
  if (added.length > 0) {
    const list = out.plannedAssessments ?? []
    const existing = new Set(list.map((r) => (r as Row | null)?.id))
    for (const a of added) if (!existing.has(a.id)) list.push(a)
    out.plannedAssessments = list
  }
  return out
}

/** `settings.scheduling.defaultStudyStart` from a table map, else the v2 default. */
function studyStartOf(tables: Readonly<Record<string, readonly unknown[] | undefined>>): HHmm {
  const settings = (tables.settings ?? []).find(
    (r): r is Row => typeof r === 'object' && r !== null && (r as Row).id === 'app',
  )
  const scheduling = settings?.scheduling as Row | undefined
  return typeof scheduling?.defaultStudyStart === 'string'
    ? scheduling.defaultStudyStart
    : V2_DEFAULT_STUDY_START
}

/**
 * A v1 table map (a backup file's `tables`) as v2: every row mapped as the Dexie upgrade maps it, trash
 * payloads too, and the new tables added. Unknown tables are passed through untouched.
 */
export function migrateTablesV1toV2(
  tables: Readonly<Record<string, readonly unknown[]>>,
  now: Millis,
): Record<string, unknown[]> {
  const studyStart = studyStartOf(tables)
  const out = migrateRowsV1toV2(tables, now, studyStart)
  if (out.trash) out.trash = out.trash.map((r) => trashToV2(r, now, studyStart))
  for (const name of V2_NEW_TABLES) out[name] ??= []
  return out
}

/** A trash entry whose payload holds v1 rows, with the payload mapped (restoring it gives v2 rows). */
export function trashToV2<T>(input: T, now: Millis, studyStart: HHmm = V2_DEFAULT_STUDY_START): T {
  if (typeof input !== 'object' || input === null) return input
  const row: Row = { ...(input as Row) }
  const payload = row.payload
  if (typeof payload === 'object' && payload !== null)
    row.payload = migrateRowsV1toV2(payload as Record<string, unknown[]>, now, studyStart)
  return row as T
}
