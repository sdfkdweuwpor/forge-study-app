/** Public API of the Claude plan import logic (BRIEF §5.4). Pure: no React, Dexie or DOM. */
export { EXAMPLE_JSON } from './example'
export { toPlanDraft } from './draft'
export type { DraftAssessment, DraftCourse, DraftUnit, PlanDraft } from './draft'
export { describeDaysOff, describeWeek, formatMinutes, termLabel, weeklyMinutes } from './format'
export { DEFAULT_WEEK, hasWrites, knownCourses, planToOps, unitMinutes } from './mapping'
export type {
  CourseChange,
  ExistingCourse,
  ExistingGoal,
  ImportOps,
  ImportPreview,
  MapContext,
  PreviewCourse,
} from './mapping'
export { extractJson, parsePlan, pathText } from './parse'
export type { ParseOptions, ParseResult, PlanIssue } from './parse'
export { buildPrompt, fieldLines, OUTLINE_PLACEHOLDER } from './prompt'
export { CROSS_FIELD_RULES, fieldDoc, fieldDocs } from './reference'
export type { FieldDoc, Requirement } from './reference'
export { LineTable } from './jsonPositions'
export type { KnownCourse } from './relations'
export { ASSESSMENT_KINDS, PLAN_VERSION, planSchema } from './schema'
export type { AssessmentKind, Plan, PlanAssessment, PlanCourse, PlanGoal, PlanUnit } from './schema'
