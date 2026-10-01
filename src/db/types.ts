/**
 * Row types for every Dexie table (PLAN §3.2). Type-only: `src/logic` may `import type` from here.
 * Conventions: ids are strings, instants are epoch ms, calendar days are local `'YYYY-MM-DD'`.
 */
import type { PlanChange } from '@/logic/scheduler/plannerTypes'
import type { SyncTableName } from '@/logic/syncTables'
import type { TableName } from './schema'

export type { TableName } from './schema'

export type ID = string
/** Local calendar day, `'YYYY-MM-DD'`. Never parse with `new Date(str)` (UTC); use `@/logic/dates`. */
export type ISODate = string
/** Local wall-clock time, `'HH:mm'` (24h). */
export type HHmm = string
/** Epoch milliseconds. */
export type Millis = number

export interface Base {
  id: ID
  createdAt: Millis
  updatedAt: Millis
}

/** What repos pass to `add`/`put`: the Dexie `creating` hook stamps missing timestamps. */
export type NewRow<T extends Base> = Omit<T, 'createdAt' | 'updatedAt'> &
  Partial<Pick<T, 'createdAt' | 'updatedAt'>>

/** 0 none, 1 low, 2 med, 3 high, 4 urgent. */
export type Priority = 0 | 1 | 2 | 3 | 4
export type TagColor =
  'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
export type AccentId = 'blue' | 'teal' | 'green' | 'orange' | 'pink' | 'graphite'

/** Inclusive on both ends. */
export interface DateRange {
  start: ISODate
  end: ISODate
  label?: string
}

export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'todo' | 'callout' | 'divider'
export interface Block {
  id: ID
  type: BlockType
  text: string
  checked?: boolean
  emoji?: string
}

export type Cover =
  { kind: 'gradient'; preset: string } | { kind: 'image'; fileId: ID; posY: number }

export interface Subtask {
  id: ID
  title: string
  done: boolean
}

/** `byWeekday`: 0 = Sunday … 6 = Saturday. */
export interface RecurrenceRule {
  freq: 'daily' | 'weekdays' | 'weekly' | 'custom'
  interval: number
  byWeekday: number[]
}

/** A window of wall-clock time on one day. `start < end`; `'24:00'` may end a window. */
export interface TimeWindow {
  start: HHmm
  end: HHmm
}

/** How well the student already knows a unit or course (scales its estimate). */
export type SelfRating = 'know' | 'somewhat' | 'new'

/** A link from a flashcard or practice question to the note it came from (hook, schema v2). */
export interface NoteRef {
  kind: 'goal' | 'course' | 'task' | 'resource'
  id: ID
  /** A block inside that note, or `null` for the whole note. */
  blockId: ID | null
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskSource = 'user' | 'schedule' | 'flashcards' | 'ritual' | 'template' | 'onboarding'
/** Planner item kinds (schema v2). Everyday tasks are `'task'`. */
export type PlanItemKind = 'study' | 'review' | 'practiceTest' | 'assessment' | 'milestone'
export type TaskKind = 'task' | PlanItemKind

/** Calendar-sync hook (schema v2; not built): where a task lives in an outside calendar. */
export interface TaskSync {
  provider: 'google' | 'caldav' | 'ics'
  calendarId: string | null
  externalId: string
  etag: string | null
  lastSyncedAt: Millis | null
  direction: 'push' | 'pull' | 'both'
}

export interface Task extends Base {
  title: string
  notes: Block[]
  status: TaskStatus
  priority: Priority
  /**
   * When I plan to do it (schema v2): Today, Upcoming, the calendar and "Carried over" read this.
   * A task with no do date but a due date is planned for its due date (`logic/taskDates.planDay`).
   */
  doDate: ISODate | null
  /** Planned start on `doDate` (a slot); `null` = any time that day. */
  doTime: HHmm | null
  /** Length of the planned slot (planner items: the session length). */
  durationMinutes: number | null
  /** The hard deadline only (schema v2). Shown as a calm "Due Fri" chip. */
  dueDate: ISODate | null
  dueTime: HHmm | null
  /** Scheduler chunks set both estimates. */
  estimatePomodoros: number | null
  estimateMinutes: number | null
  tags: string[]
  goalId: ID | null
  milestoneId: ID | null
  unitId: ID | null
  source: TaskSource
  /** `${unitId}:${seq}` for scheduler chunks. */
  scheduleKey: string | null
  schedulePinned: boolean
  skippedOn: ISODate | null
  orderInDay: number
  subtasks: Subtask[]
  recurrence: RecurrenceRule | null
  seriesId: ID | null
  /** Fractional indexing. */
  order: number
  boardOrder: number
  startedAt: Millis | null
  completedAt: Millis | null
  completedDay: ISODate | null
  /** An everyday task with a due date and no do date that `autoSlotTasks` may place (opt-in). */
  autoSlot: boolean
  /** `'task'` for everyday tasks; the plan item kind for planner items. */
  kind: TaskKind
  /** The `plannedAssessments` row a review, practice test or assessment item belongs to. */
  assessmentId: ID | null
  /** Calendar-sync hook (not built). */
  sync: TaskSync | null
}

/**
 * Saved-view query model. Defined here (not in `logic/taskQuery`) so `db` never depends on `logic`
 * for types; `logic/taskQuery` imports these.
 */
export type TaskDueFilter = 'any' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'upcoming' | 'none'
export interface TaskFilter {
  status?: TaskStatus[]
  priority?: Priority[]
  tags?: string[]
  /** `true` = every listed tag must be present; default any-of. */
  tagsMatchAll?: boolean
  goalIds?: ID[]
  milestoneIds?: ID[]
  source?: TaskSource[]
  due?: TaskDueFilter
  text?: string
}
export type TaskSortKey =
  'manual' | 'due' | 'priority' | 'created' | 'updated' | 'title' | 'estimate'
export interface TaskSort {
  key: TaskSortKey
  dir: 'asc' | 'desc'
}

// ─── Goals, courses, units ──────────────────────────────────────────────────

/** Minutes available per weekday, index 0 = Sunday. */
export type WeekMinutes = [number, number, number, number, number, number, number]
export interface Availability {
  minutesByWeekday: WeekMinutes
  daysOff: DateRange[]
}
export interface WguTerm {
  id: ID
  label: string
  start: ISODate
  end: ISODate
}
/** Slot-level planning settings of a goal (schema v2, the Goal Breakdown Planner). */
export interface GoalPlanning {
  /** Target study-session length, 25–90 min (default 50). */
  sessionMinutes: number
  /** Study windows per weekday, 7 entries, index 0 = Sunday. */
  weekly: TimeWindow[][]
  /** A rotating shift cycle that replaces `weekly` (day `anchor` is cycle day 0; `null` = no study). */
  shiftPattern: { anchor: ISODate; cycle: (TimeWindow[] | null)[] } | null
  /** Share of the planned work reserved as slack at the end, 0.10–0.15 (default 0.12). */
  bufferPct: number
  /** Study hours per competency unit when a course has only CUs (default 15). */
  cuHoursMultiplier: number
  /** `true`: full speed, the target is only checked. `false`: paced to the target (needs one). */
  asap: boolean
  /** The accepted plan's pace in minutes per study day (roll-forward keeps it); `null` = ASAP. */
  paceMinutesPerStudyDay: number | null
}

export interface GoalProjection {
  end: ISODate | null
  slipDays: number | null
  feasible: boolean
  catchUpMinutes: number | null
  requiredMinutesPerStudyDay: number | null
  issues: string[]
  computedAt: Millis
  /** The end before it last moved (`carryEndMove`), for "Now projected Mar 23 (+9 days)". Absent on older rows. */
  previousEnd?: ISODate | null
  /** When the end last moved. */
  endMovedAt?: Millis | null
}
export interface Goal extends Base {
  title: string
  icon: string
  cover: Cover | null
  kind: 'degree' | 'certification' | 'skill' | 'custom'
  status: 'active' | 'paused' | 'done' | 'archived'
  startDate: ISODate
  targetDate: ISODate | null
  /**
   * `daysOff` is the goal's blackout list. `minutesByWeekday` mirrors `planning.weekly` (the repo keeps
   * the two in sync) for the minutes-based editors.
   */
  availability: Availability
  planning: GoalPlanning
  terms: WguTerm[]
  notes: Block[]
  order: number
  /** Cache written by `rebalanceGoal`. */
  baselineEnd: ISODate | null
  projection: GoalProjection | null
  lastRebalancedOn: ISODate | null
  completedAt: Millis | null
}

/** A course (WGU) or generic milestone. */
export interface Milestone extends Base {
  goalId: ID
  kind: 'course' | 'milestone'
  code: string | null
  title: string
  icon: string | null
  cover: Cover | null
  status: 'todo' | 'active' | 'done'
  order: number
  prerequisiteIds: ID[]
  estimateHours: number
  dueDate: ISODate | null
  cus: number | null
  courseType: 'OA' | 'PA' | 'OA+PA' | null
  termId: ID | null
  notes: Block[]
  projectedStart: ISODate | null
  projectedEnd: ISODate | null
  completedAt: Millis | null
  /** For a course without units: how well it is already known. */
  selfRating: SelfRating | null
}

export type UnitEstimateSource = 'hours' | 'cus' | 'course' | 'import' | 'parsed'

export interface Unit extends Base {
  goalId: ID
  milestoneId: ID
  title: string
  order: number
  estimateMinutes: number | null
  difficulty: 1 | 2 | 3
  status: 'todo' | 'done'
  completedAt: Millis | null
  selfRating: SelfRating | null
  /** How `estimateMinutes` was derived. */
  estimateSource: UnitEstimateSource
  /** The estimate before the self-rating factor, so a re-rating recomputes. */
  baseEstimateMinutes: number | null
  /** A cut-scope hint: the unit may be dropped when the plan does not fit. */
  optional: boolean
}

/** A planned exam, project or quiz (the plan; attempt logs with scores stay in `assessments`). */
export interface PlannedAssessment extends Base {
  goalId: ID
  milestoneId: ID | null
  kind: 'exam' | 'project' | 'quiz'
  title: string
  /** `null` = the planner places it after its course's work. */
  date: ISODate | null
  /** A booked time; the assessment then blocks its slot. */
  time: HHmm | null
  durationMinutes: number | null
  status: 'planned' | 'done' | 'skipped'
  completedAt: Millis | null
  order: number
  source: 'user' | 'syllabus' | 'import' | 'wgu'
}

export type PlanProposalKind =
  | 'rollForward'
  | 'extendDate'
  | 'addTime'
  | 'cutScope'
  | 'spread'
  | 'lifeHappened'
  | 'aiSuggestion'

/** A pending plan change: nothing is applied until the user accepts it. */
export interface PlanProposal extends Base {
  /** `null` = everyday tasks (auto-slot). */
  goalId: ID | null
  kind: PlanProposalKind
  status: 'pending' | 'accepted' | 'dismissed' | 'stale'
  /** The day it was computed for; a proposal from an earlier day is stale. */
  computedFor: ISODate
  title: string
  detail: string
  /** What accepting does (`ProposalApplyData`), validated on accept. */
  apply: unknown
  preview: PlanChange
  /** Hash of the open plan items it was computed from: if the plan changed since, recompute. */
  baseRevision: string
  decidedAt: Millis | null
}

// ─── Focus ──────────────────────────────────────────────────────────────────

export type SessionKind = 'focus' | 'break'
export type SessionMode = 'pomodoro' | 'custom' | 'stopwatch'
export type SessionStatus = 'running' | 'paused' | 'completed' | 'abandoned'
export interface Session extends Base {
  kind: SessionKind
  mode: SessionMode
  status: SessionStatus
  /** Denormalised at start. */
  taskId: ID | null
  goalId: ID | null
  milestoneId: ID | null
  day: ISODate
  startedAt: Millis
  endedAt: Millis | null
  /** `null` = stopwatch. */
  plannedMinutes: number | null
  pausedMs: number
  pausedAt: Millis | null
  actualMinutes: number | null
  round: number
  interrupted: boolean
  counted: boolean
  note: string | null
}

// ─── Progress & gamification ────────────────────────────────────────────────

/** id = day. Rebuildable aggregate cache. */
export interface StreakDay extends Base {
  day: ISODate
  focusMinutes: number
  focusSessions: number
  pomodoros: number
  tasksDone: number
  dailyGoalTarget: number
  dailyGoalHit: boolean
  qualified: boolean
  xp: number
}

export type XpSource =
  'task' | 'session' | 'course' | 'dailyGoal' | 'streak' | 'ritual' | 'adjustment'
/** Append-only. A negative amount is a reversal of the same `key`. */
export interface XpEvent extends Base {
  at: Millis
  day: ISODate
  source: XpSource
  amount: number
  /** e.g. `'task:<id>'`, `'dailyGoal:<day>'`. */
  key: string
  refId: ID | null
  note: string | null
}

export type BadgeId =
  | 'first-focus'
  | 'early-bird'
  | 'night-owl'
  | 'streak-7'
  | 'streak-30'
  | 'streak-100'
  | 'deep-work'
  | 'first-course'
  | 'term-complete'
  | 'hours-100'
  | 'comeback'
/** id = BadgeId. */
export interface Badge extends Base {
  unlockedAt: Millis
  context: string | null
}

export interface Reward extends Base {
  title: string
  icon: string
  price: number
  description: string
  archived: boolean
  order: number
}
export interface Redemption extends Base {
  rewardId: ID
  rewardTitle: string
  price: number
  at: Millis
  day: ISODate
  refundedAt: Millis | null
}

// ─── Blocker ────────────────────────────────────────────────────────────────

export interface BlocklistEntry extends Base {
  kind: 'block' | 'allow'
  domain: string
  /** allow: `'youtube.com/watch?v=…'` or a path prefix. */
  pattern: string | null
  enabled: boolean
  isDefault: boolean
  note: string | null
}
/** id = the extension's uuid (idempotent pulls). */
export interface BlockEvent extends Base {
  at: Millis
  day: ISODate
  kind: 'attempt' | 'unlock'
  domain: string
  minutes: number | null
}

// ─── Extras ─────────────────────────────────────────────────────────────────

export interface ParkingItem extends Base {
  text: string
  sessionId: ID | null
  status: 'open' | 'done' | 'converted'
  taskId: ID | null
}
export interface CheckIn extends Base {
  sessionId: ID | null
  at: Millis
  day: ISODate
  hour: number
  weekday: number
  focus: 1 | 2 | 3 | 4 | 5
  mood: string | null
}
export interface Assessment extends Base {
  goalId: ID
  milestoneId: ID
  kind: 'preassessment' | 'oa' | 'pa'
  date: ISODate
  scorePct: number | null
  passed: boolean | null
  areas: { name: string; scorePct: number }[]
  notes: string
}
/** FSRS memory state (hook, schema v2; not built). */
export interface FsrsState {
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  lastReview: Millis | null
}
export interface Flashcard extends Base {
  goalId: ID
  milestoneId: ID
  front: string
  back: string
  tags: string[]
  /** SM-2 fields. */
  ease: number
  intervalDays: number
  repetitions: number
  lapses: number
  dueDate: ISODate
  lastReviewedAt: Millis | null
  suspended: boolean
  /** Which scheduler owns the card (v2 hook). */
  scheduler: 'sm2' | 'fsrs'
  fsrs: FsrsState | null
  noteRef: NoteRef | null
}
/** A practice question (hook, schema v2; not built). */
export interface PracticeQuestion extends Base {
  goalId: ID
  milestoneId: ID
  unitId: ID | null
  prompt: string
  /** Multiple choice, or `null` for a typed answer. */
  choices: string[] | null
  answer: string
  explanation: string
  tags: string[]
  source: 'user' | 'import'
  noteRef: NoteRef | null
  suspended: boolean
}
/** One answer to a practice question. A miss sets `requeueOn`; answering it right later clears it. */
export interface QuestionAttempt extends Base {
  questionId: ID
  goalId: ID
  milestoneId: ID
  at: Millis
  day: ISODate
  correct: boolean
  answer: string
  requeueOn: ISODate | null
}
/** Readiness per course (id = milestoneId) or unit (id = unitId); feeds the planner's extra reviews. */
export interface Readiness extends Base {
  goalId: ID
  milestoneId: ID
  unitId: ID | null
  /** 0–1. */
  score: number
  extraReviewMinutes: number
  inputs: {
    paPct: number | null
    cardRetention: number | null
    questionAccuracy: number | null
    unitsDonePct: number
  }
  computedAt: Millis
}
export interface Resource extends Base {
  goalId: ID
  milestoneId: ID
  kind: 'link' | 'pdf' | 'note'
  title: string
  url: string | null
  fileId: ID | null
  status: 'toRead' | 'done'
  notes: string
  order: number
}
export interface StoredFile extends Base {
  name: string
  mime: string
  size: number
  blob: Blob
}
export type SnapshotReason =
  'daily' | 'manual' | 'pre-import' | 'pre-restore' | 'pre-reset' | 'pre-sync'
export interface Snapshot extends Base {
  day: ISODate
  reason: SnapshotReason
  schemaVersion: number
  /** Size of the JSON in bytes (what a download weighs), whether or not it is stored compressed. */
  sizeBytes: number
  /** JSON of a BackupFile (file blobs excluded). Empty when `gz` holds the same JSON compressed. */
  data: string
  /** The JSON, gzip-compressed, when the browser could compress it (Phase 11c). Read via `readSnapshotText`. */
  gz?: Blob
  /** Rows per table (settings excluded) when it was taken, for the list. Absent before Phase 11c. */
  counts?: Record<string, number>
}
export interface TrashItem extends Base {
  entityTable: TableName
  entityId: ID
  title: string
  expiresAt: Millis
  /** The entity plus its cascaded children, by table. */
  payload: Partial<Record<TableName, unknown[]>>
}
/** Optional cache; the world is rebuildable from history. */
export interface WorldTile extends Base {
  x: number
  y: number
  kind: string
  variant: number
  sourceKind: string
  sourceId: ID
  earnedAt: Millis
}
export interface SavedView extends Base {
  name: string
  icon: string
  layout: 'list' | 'board' | 'calendar'
  filter: TaskFilter
  sort: TaskSort
  groupBy: 'date' | 'project' | 'none'
  order: number
}
/** id = `${kind}:${day}`. */
export interface Ritual extends Base {
  day: ISODate
  kind: 'morning' | 'evening'
  top3: ID[]
  reflection: string
  completedAt: Millis | null
}
/** id = weekStart. */
export interface WeeklyReview extends Base {
  weekStart: ISODate
  wins: string
  blockers: string
  completedAt: Millis | null
}
export interface Template extends Base {
  kind: 'task' | 'goal'
  name: string
  icon: string
  /** Validated by zod on use. */
  payload: unknown
}

// ─── Settings (singleton, id = 'app') ───────────────────────────────────────

export interface BlockWindow {
  /** 0 = Sunday. */
  days: number[]
  start: HHmm
  end: HHmm
}
export type ThemePref = 'light' | 'dark' | 'system'
export type ReducedMotionPref = 'system' | 'on' | 'off'
export type AmbientSound = 'none' | 'brown' | 'rain' | 'cafe'
export type BlockerMode = 'focus' | 'schedule' | 'always' | 'off'

export interface Settings extends Base {
  profile: { name: string }
  onboardedAt: Millis | null
  appearance: { theme: ThemePref; accent: AccentId; reducedMotion: ReducedMotionPref }
  weekStartsOn: 0 | 1
  timer: {
    pomodoroMin: number
    shortBreakMin: number
    longBreakMin: number
    longBreakEvery: number
    customMin: number
    autoStartBreaks: boolean
    autoStartFocus: boolean
  }
  dailyGoalPomodoros: number
  sound: {
    enabled: boolean
    volume: number
    chime: boolean
    ambient: AmbientSound
    ambientVolume: number
  }
  notifications: { enabled: boolean; promptedAt: Millis | null }
  blocker: {
    mode: BlockerMode
    schedule: BlockWindow[]
    motivation: string[]
    extensionIdOverride: string | null
    lastSyncedAt: Millis | null
    eventsCursor: Millis
    /** The default blocklist was added once; sites the user removed never come back on their own. */
    blocklistSeeded: boolean
  }
  scheduling: {
    globalDaysOff: DateRange[]
    defaultStudyStart: HHmm
    bestHour: number | null
    lastDailyRunDay: ISODate | null
    /** When everyday tasks may be auto-slotted, per weekday (index 0 = Sunday). v2. */
    taskWindows: TimeWindow[][]
  }
  /**
   * `lastExportAt`: when a full backup file was last saved. `remindWeekly`: the gentle weekly nudge is on.
   * `lastRemindedAt`: when the nudge last showed, so it never shows twice in a week.
   */
  backup: { lastExportAt: Millis | null; remindWeekly: boolean; lastRemindedAt: Millis | null }
  tagColors: Record<string, TagColor>
  /** Highest level the level-up moment has shown. 0 = not set yet (first start): initialised silently. */
  lastCelebratedLevel: number
  /** The three starter rewards were offered once (or the shop already had rewards); never seed again. */
  rewardsSeeded: boolean
  /**
   * My World. `seed` is the constant the city's seeded generator starts from: created once (0 = not yet),
   * then never changed, so the same history always grows the same city.
   */
  world: { seed: number }
  /**
   * Daily rituals (Phase 11g). `prompts`: Today may offer the morning plan and the evening shutdown
   * (a gentle card, dismissible for the day). The morning card shows until `morningUntil`, the evening
   * one from `eveningFrom`, both local `'HH:mm'`.
   */
  rituals: { prompts: boolean; morningUntil: HHmm; eveningFrom: HHmm }
}
/** Settings without the row bookkeeping (`id`, timestamps). */
export type SettingsData = Omit<Settings, keyof Base>

// ─── Cloud sync (schema v3, PLAN §4.7.4) ────────────────────────────────────

/**
 * One record changed on this device since it last pushed (`[tbl+id]` is the key, so a record has at most
 * one entry). No payload: the push reads the row as it is then, and a missing row is sent as a tombstone.
 * `at` is the last-write-wins stamp of the latest change (`logic/syncTables.nextStamp`).
 */
export interface SyncOutboxEntry {
  tbl: SyncTableName
  id: ID
  at: Millis
}
export type SyncErrorKind =
  | 'offline'
  | 'server'
  | 'rateLimited'
  | 'signedOut'
  | 'setup'
  | 'forbidden'
  | 'tooLarge'
  | 'updateNeeded'
  | 'snapshot'
export interface SyncError {
  kind: SyncErrorKind
  message: string
  at: Millis
}
export interface SyncSession {
  accessToken: string
  refreshToken: string
  expiresAt: Millis
  userId: string
  email: string
}
/**
 * This device's sync configuration and bookkeeping (one row, `id = 'device'`). Never synced, never in a
 * backup, a snapshot or a crash export. With no row, sync is off.
 */
export interface SyncStateRow {
  id: 'device'
  /** Tracking and the engine are on. */
  enabled: boolean
  url: string | null
  anonKey: string | null
  email: string | null
  session: SyncSession | null
  pendingLogin: { email: string; codeVerifier: string; requestedAt: Millis } | null
  /** New at every enable: the last-write-wins tie-break and the echo filter. */
  deviceId: string | null
  /** The account this device last merged with; signing in to another one starts a first sync again. */
  accountUserId: string | null
  phase: 'off' | 'bootstrap' | 'steady'
  /** Last applied server `seq`. */
  pullCursor: number
  /** Highest remote stamp seen (never more than server time + 5 min). */
  maxSeenStamp: Millis
  lastSyncAt: Millis | null
  lastAttemptAt: Millis | null
  lastError: SyncError | null
  /** Server clock minus this device's clock, when measured. */
  clockSkewMs: number | null
  /**
   * The `deviceId` a `pre-sync` snapshot was already taken for. A first sync that restarts after an
   * interruption must not snapshot again: the data is half merged by then, and the keep-5 pruning would
   * eventually push out the snapshot of the real "before". Absent until the first sync snapshots.
   */
  preSyncFor?: string | null
}

// ─── Table → row map ────────────────────────────────────────────────────────

export interface TableRows {
  settings: Settings
  tasks: Task
  goals: Goal
  milestones: Milestone
  units: Unit
  sessions: Session
  streakDays: StreakDay
  xpEvents: XpEvent
  badges: Badge
  rewards: Reward
  redemptions: Redemption
  blocklist: BlocklistEntry
  blockEvents: BlockEvent
  parkingLot: ParkingItem
  checkIns: CheckIn
  assessments: Assessment
  flashcards: Flashcard
  resources: Resource
  files: StoredFile
  snapshots: Snapshot
  trash: TrashItem
  worldTiles: WorldTile
  savedViews: SavedView
  rituals: Ritual
  weeklyReviews: WeeklyReview
  templates: Template
  plannedAssessments: PlannedAssessment
  planProposals: PlanProposal
  practiceQuestions: PracticeQuestion
  questionAttempts: QuestionAttempt
  readiness: Readiness
  syncOutbox: SyncOutboxEntry
  syncState: SyncStateRow
}

// Compile-time guard (type-only): TableRows and the schema's table list must stay in sync.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T
export type TableRowsMatchSchema = AssertTrue<Exact<keyof TableRows, TableName>>
