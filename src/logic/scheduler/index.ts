/**
 * Goal scheduler (PLAN §4): pure functions over plain data, `today` injected, deterministic.
 * UI and repos import from here, not from the individual files.
 */
export type {
  CatchUp,
  ChunkFields,
  ChunkPatch,
  ChunkUpdate,
  CourseStatus,
  CourseWindow,
  DiffTask,
  PinnedWork,
  PlannedChunk,
  SchedCourse,
  ScheduleDiff,
  ScheduleInput,
  ScheduleResult,
  SchedulerIssue,
  SchedulerIssueCode,
  SchedulerOptions,
  SchedUnit,
} from './types'
export {
  addMinutesToStudyDays,
  DEFAULT_OPTIONS,
  MAX_REQUIRED_MINUTES,
  mergeDaysOff,
  resolveOptions,
  studyDaysBetween,
} from './capacity'
export {
  computeRemaining,
  parseScheduleKey,
  pomodorosFor,
  resolveUnitEstimates,
  scheduleKey,
  SYNTHETIC_UNIT_TITLE,
  taskMinutes,
  taskUnitId,
  type UnitEstimate,
  type UnitRemaining,
} from './estimates'
export { orderCourses, type TopoCourse, type TopoResult } from './topo'
export { buildSchedule, chunkTitle } from './schedule'
export { suggestCatchUp } from './catchUp'
export {
  chunkFields,
  diffSchedule,
  hasUserContent,
  isActivePin,
  isDiffEmpty,
  type DiffContext,
} from './diff'
export {
  goalWork,
  planGoal,
  type CourseWork,
  type GoalPlan,
  type GoalRows,
  type GoalWork,
} from './plan'

// ─── Goal Breakdown Planner (slot-level, PLAN §4.5) ─────────────────────────
export type {
  AssessmentKind,
  AvailabilityV2,
  BusyBlock,
  CurrentPlanItem,
  DayWindows,
  ItemSlot,
  LivePlanInput,
  PinnedPlanItem,
  PlanChange,
  PlanItem,
  PlanItemKind,
  PlanMove,
  PlannerAssessment,
  PlannerBuffer,
  PlannerCourse,
  PlannerInput,
  PlannerIssue,
  PlannerIssueCode,
  PlannerPace,
  PlannerResult,
  PlannerSettings,
  PlannerTotals,
  PlannerUnit,
  SelfRating,
  ShiftPattern,
  TimeWindow,
  WeekWindows,
} from './plannerTypes'
export {
  addMinutesToWindows,
  averageStudyDayMinutes,
  capacityForDate,
  DEFAULT_SESSION_MINUTES,
  DEFAULT_STUDY_START,
  fromLegacyAvailability,
  largestWindowMinutes,
  MAX_SESSION_MINUTES,
  maxDayMinutes,
  MIN_SESSION_MINUTES,
  sameEveryDay,
  SHIFT_PRESETS,
  shiftCycle,
  withBlackouts,
  type ShiftPresetId,
} from './windows'
export {
  bufferMinutesFor,
  clampBufferPct,
  DEFAULT_BUFFER_PCT,
  DEFAULT_CU_HOURS_MULTIPLIER,
  estimateUnitMinutes,
  SELF_RATING_FACTORS,
  type EffortInput,
} from './effort'
export { splitMinutes, type SplitRules } from './split'
export {
  comparePlanItems,
  DEFAULT_PLANNER_SETTINGS,
  freeMinutesUntil,
  planStudy,
  resolvePlannerSettings,
  scaledOffsets,
} from './planner'
export { shortDate, weeklyMilestones } from './milestones'
export {
  checkFeasibility,
  cutCandidates,
  formatDuration,
  MAX_EXTRA_MINUTES,
  withoutUnits,
  type CutCandidate,
  type CutReason,
  type FeasibilityResult,
} from './feasibility'
export {
  behindProposals,
  behindStatus,
  FAR_BEHIND_MISSED_SHARE,
  FAR_BEHIND_SLIP_DAYS,
  replanWeek,
  rollForward,
  type BehindLevel,
  type BehindReason,
  type BehindStatus,
  type Proposal,
  type ProposalApply,
  type ProposalKind,
  type ReflowResult,
  type ReplanWeekOptions,
  type RollForwardResult,
  type WeekProposal,
} from './reflow'
export { diffPlanItems, isChangeEmpty } from './planDiff'
export {
  autoSlotTasks,
  DEFAULT_TASK_MINUTES,
  type AutoSlotOptions,
  type AutoSlotResult,
  type AutoSlotTask,
} from './autoSlot'
