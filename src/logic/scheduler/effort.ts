/**
 * Effort estimates and the buffer (pure).
 *
 * A unit's estimate is its hours, else its competency units × the user's hours-per-CU multiplier, then
 * scaled by how well the user already knows it. The buffer is a share of the planned work kept free as
 * slack after the last session (see `planStudy`), not added to the sessions: on-track work is never
 * inflated, and missed work rolls into the slack.
 */
import { ceilTo } from './capacity'
import type { SelfRating } from './plannerTypes'

/** How much of the full estimate is left to study, by self-rating. */
export const SELF_RATING_FACTORS: Readonly<Record<SelfRating, number>> = {
  know: 0.5,
  somewhat: 0.8,
  new: 1.0,
}

/** Default hours per WGU competency unit (a 3-CU course ≈ 45 h); the user can change it. */
export const DEFAULT_CU_HOURS_MULTIPLIER = 15

export const DEFAULT_BUFFER_PCT = 0.12
/** The UI offers 10–15 %; the logic accepts 0–30 % so a plan can also be checked with no buffer. */
export const MAX_BUFFER_PCT = 0.3

export interface EffortInput {
  hours?: number | null
  cus?: number | null
  cuHoursMultiplier?: number
  selfRating?: SelfRating | null
  /** Rounding step for the result (minutes). */
  grain?: number
}

const positive = (n: number | null | undefined): number | null =>
  n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? n : null

/**
 * Study minutes for a unit or course: `hours` (else `cus × cuHoursMultiplier`) × 60 × the self-rating
 * factor, rounded up to the grain. `null` when neither hours nor CUs are given, so the caller can share
 * the course's hours among such units (`resolveUnitEstimates`).
 */
export function estimateUnitMinutes(input: EffortInput): number | null {
  const grain = positive(input.grain) ?? 5
  const multiplier = positive(input.cuHoursMultiplier) ?? DEFAULT_CU_HOURS_MULTIPLIER
  const hours = positive(input.hours) ?? (positive(input.cus) ?? 0) * multiplier
  if (hours <= 0) return null
  const factor = SELF_RATING_FACTORS[input.selfRating ?? 'new']
  return ceilTo(hours * 60 * factor, grain)
}

/** A buffer share clamped to 0–30 %; anything malformed is the default 12 %. */
export function clampBufferPct(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return DEFAULT_BUFFER_PCT
  return Math.min(MAX_BUFFER_PCT, Math.max(0, pct))
}

/** Minutes of slack for `workMinutes` of planned work, rounded up to the grain. */
export function bufferMinutesFor(workMinutes: number, pct: number, grain = 5): number {
  if (workMinutes <= 0 || pct <= 0) return 0
  return ceilTo(workMinutes * pct, grain)
}
