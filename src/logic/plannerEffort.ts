/**
 * Effort for the planner (pure): what a course and its units cost in study minutes.
 *
 * A course has a budget, its hours or else its competency units × the user's hours-per-CU multiplier.
 * A unit either has its own estimate or shares what is left of the course's budget with the others
 * (the same split the scheduler uses, `resolveUnitEstimates`). The result is then scaled by the
 * self-rating (know it .5, somewhat .8, new 1; `estimateUnitMinutes`). The screens show these numbers
 * live, and the rows saved from the draft carry exactly them, so the preview and the plan agree.
 */
import type { SelfRating } from '@/db/types'
import { ceilTo } from './scheduler/capacity'
import { DEFAULT_CU_HOURS_MULTIPLIER, estimateUnitMinutes } from './scheduler/effort'
import { resolveUnitEstimates } from './scheduler/estimates'

const GRAIN = 5

const positive = (n: number | null | undefined): number | null =>
  n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? n : null

export type EffortBy = 'hours' | 'cus'

export interface CourseBudgetInput {
  hours: number | null
  cus: number | null
  effortBy: EffortBy
  /** Hours per CU. */
  multiplier?: number
}

/** The course's study minutes before the self-rating, or `null` when neither hours nor CUs are known. */
export function courseBaseMinutes(c: CourseBudgetInput): number | null {
  const mult = positive(c.multiplier) ?? DEFAULT_CU_HOURS_MULTIPLIER
  const byHours = positive(c.hours)
  const byCus = positive(c.cus)
  const hours =
    c.effortBy === 'cus'
      ? byCus !== null
        ? byCus * mult
        : byHours
      : (byHours ?? (byCus !== null ? byCus * mult : null))
  return hours === null ? null : Math.round(hours * 60)
}

export interface EffortUnitIn {
  /** The unit's own estimate in minutes, before the rating; `null` = share the course's leftover. */
  baseMinutes: number | null
  /** `null` = the course's rating. */
  rating: SelfRating | null
}

export interface EffortUnitOut {
  /** Before the rating, in whole grains. */
  baseMinutes: number
  /** After the rating: what is planned. */
  minutes: number
}

export interface EffortResult {
  units: EffortUnitOut[]
  totalBaseMinutes: number
  totalMinutes: number
}

const rated = (baseMinutes: number, rating: SelfRating): number =>
  baseMinutes <= 0
    ? 0
    : (estimateUnitMinutes({ hours: baseMinutes / 60, selfRating: rating, grain: GRAIN }) ?? 0)

/**
 * Minutes per unit for one course. `budgetMinutes` is `courseBaseMinutes(...)`. A course with no units
 * is one synthetic unit (returned as the single entry of `units`).
 */
export function resolveEffort(
  budgetMinutes: number | null,
  courseRating: SelfRating,
  units: readonly EffortUnitIn[],
): EffortResult {
  const budget = budgetMinutes ?? 0
  if (units.length === 0) {
    const base = budget > 0 ? ceilTo(budget, GRAIN) : 0
    const minutes = rated(base, courseRating)
    return {
      units: [{ baseMinutes: base, minutes }],
      totalBaseMinutes: base,
      totalMinutes: minutes,
    }
  }
  const bases = resolveUnitEstimates(
    { estimateHours: budget / 60 },
    units.map((u) => ({ estimateMinutes: u.baseMinutes })),
    GRAIN,
  )
  const out = units.map((u, i): EffortUnitOut => {
    const baseMinutes = bases[i] ?? 0
    return { baseMinutes, minutes: rated(baseMinutes, u.rating ?? courseRating) }
  })
  return {
    units: out,
    totalBaseMinutes: out.reduce((n, u) => n + u.baseMinutes, 0),
    totalMinutes: out.reduce((n, u) => n + u.minutes, 0),
  }
}

/** `'2 h 30 min'` style label for a minute count, or `'—'` for none. */
export function effortLabel(minutes: number): string {
  if (minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Parses "1.5", "1,5", "90m", "1h30" or "2 h" typed into an hours field: minutes, or `null`. */
export function parseHoursInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.')
  if (t === '') return null
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*(?:m(?:in(?:ute)?s?)?)?)?$/.exec(t)
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0))
  const m = /^(\d+)\s*m(?:in(?:ute)?s?)?$/.exec(t)
  if (m) return Number(m[1])
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60)
  return null
}

// ─── Changing the multiplier after the goal exists ──────────────────────────

export interface CuRescale {
  /** The new `estimateHours` for a course without units; `null` when the course has units. */
  estimateHours: number | null
  units: Array<{ id: string; estimateMinutes: number; baseEstimateMinutes: number }>
}

/**
 * What a new hours-per-CU multiplier changes in a saved course: the units whose estimate was derived from
 * its CUs (`estimateSource: 'cus'`) share the new budget, and a course without units whose hours were
 * `cus × oldMultiplier` gets the new figure. Estimates the person typed are left alone; `null` when
 * nothing changes.
 */
export function rescaleCuEstimates(
  course: { cus: number | null; estimateHours: number; selfRating: SelfRating | null },
  units: ReadonlyArray<{
    id: string
    estimateSource: string
    estimateMinutes: number | null
    baseEstimateMinutes: number | null
    selfRating: SelfRating | null
  }>,
  oldMultiplier: number,
  newMultiplier: number,
): CuRescale | null {
  const cus = positive(course.cus)
  if (cus === null || oldMultiplier === newMultiplier) return null
  const rating = course.selfRating ?? 'new'
  if (units.length === 0) {
    const was = estimateUnitMinutes({ cus, cuHoursMultiplier: oldMultiplier, selfRating: rating })
    if (was === null || Math.abs(course.estimateHours * 60 - was) > 1) return null
    const now = estimateUnitMinutes({ cus, cuHoursMultiplier: newMultiplier, selfRating: rating })
    return now === null ? null : { estimateHours: now / 60 + 1e-9, units: [] }
  }
  if (!units.some((u) => u.estimateSource === 'cus')) return null
  const budget = courseBaseMinutes({ hours: null, cus, effortBy: 'cus', multiplier: newMultiplier })
  const r = resolveEffort(
    budget,
    rating,
    units.map((u) => ({
      baseMinutes: u.estimateSource === 'cus' ? null : (u.baseEstimateMinutes ?? u.estimateMinutes),
      rating: u.selfRating,
    })),
  )
  const patches = units.flatMap((u, i) => {
    const e = r.units[i]
    return u.estimateSource === 'cus' && e
      ? [{ id: u.id, estimateMinutes: e.minutes, baseEstimateMinutes: e.baseMinutes }]
      : []
  })
  return { estimateHours: null, units: patches }
}
