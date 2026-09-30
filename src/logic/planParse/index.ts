/**
 * Pasted syllabus or course list → a `PlanDraft` (the shape from `@/logic/planImport`) for the Goal
 * Breakdown Planner's review screen. Pure: no React, Dexie or DOM.
 */
export { cleanTitle, parsePlanText, takeHours } from './parse'
export type {
  ParsedLine,
  ParsedLineKind,
  PlanParseOptions,
  PlanParseResult,
  PlanTextFormat,
} from './parse'
export { findDates, firstDate, goalDeadline, inferYear, type FoundDate } from './dates'
