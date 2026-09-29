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
