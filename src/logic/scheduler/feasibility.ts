/**
 * Feasibility (pure): does the plan fit by its target, and if not, three ways to make it fit: add time
 * to every study day, move the date, or cut scope. Every option is verified by running the planner
 * again with the change applied; the searches run the planner at full speed (ASAP), which fits exactly
 * when some pace fits.
 */
import type { ISODate } from '@/db/types'
import { addDays } from '../dates'
import { isoOfDay } from './capacity'
import { freeMinutesUntil, planRun, planStudy, resolvePlannerSettings, type PlanRun } from './planner'
import type { PlannerCourse, PlannerInput, SelfRating } from './plannerTypes'
import { orderCourses } from './topo'
import { addMinutesToWindows } from './windows'

/** The largest "add X min to every study day" that is suggested. */
export const MAX_EXTRA_MINUTES = 240

export type CutReason = 'optional' | 'alreadyKnown' | 'partlyKnown' | 'lateInPlan'

export interface CutCandidate {
  unitId: string
  courseId: string
  title: string
  /** Study plus readiness-review minutes the cut saves. */
  minutes: number
  reason: CutReason
}

export interface FeasibilityResult {
  fits: boolean
  /** Minutes of work (with the buffer) that do not fit by the target; 0 when it fits. */
  shortfallMinutes: number
  projectedEnd: ISODate | null
  bufferedEnd: ISODate | null
  options: {
    addTime: {
      /** Smallest verified extra minutes per study day, `null` when up to 4 h does not do it. */
      extraMinutesPerStudyDay: number | null
      suggestion: string
      projectedEnd: ISODate | null
    }
    moveDate: {
      /** Earliest verified target date (the ASAP plan's end with its buffer). */
      earliestFeasibleDate: ISODate | null
    }
    cutScope: {
      /** Every unit that could be cut, best candidates first. */
      candidates: CutCandidate[]
      /** A verified smallest-first set of units whose removal makes it fit; empty when none does. */
      suggestedCut: string[]
      cutMinutes: number
      projectedEnd: ISODate | null
    }
  }
}

/** `75` → `'1 h 15 min'`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

const REASON_RANK: Record<CutReason, number> = { optional: 0, alreadyKnown: 1, partlyKnown: 2, lateInPlan: 3 }

function reasonFor(optional: boolean | undefined, rating: SelfRating | undefined): CutReason {
  if (optional) return 'optional'
  if (rating === 'know') return 'alreadyKnown'
  if (rating === 'somewhat') return 'partlyKnown'
  return 'lateInPlan'
}

/** Units with work left, ranked: optional, already known, partly known, then latest in the plan first. */
export function cutCandidates(courses: readonly PlannerCourse[]): CutCandidate[] {
  const { order } = orderCourses(courses)
  const ranked: Array<CutCandidate & { pos: number }> = []
  let pos = 0
  for (const c of order) {
    const units = [...c.units].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    for (const u of units) {
      pos++
      const minutes = Math.max(0, u.remainingMinutes) + Math.max(0, u.extraReviewMinutes ?? 0)
      if (minutes <= 0) continue
      ranked.push({ unitId: u.id, courseId: c.id, title: u.title, minutes, reason: reasonFor(u.optional, u.selfRating), pos })
    }
  }
  return ranked
    .sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || b.pos - a.pos)
    .map(({ pos: _pos, ...c }) => c)
}

/** The input with these units' work removed (they stay listed, so unit numbers do not change). */
export function withoutUnits(input: PlannerInput, unitIds: readonly string[]): PlannerInput {
  const cut = new Set(unitIds)
  return {
    ...input,
    courses: input.courses.map((c) => ({
      ...c,
      units: c.units.map((u) => (cut.has(u.id) ? { ...u, remainingMinutes: 0, extraReviewMinutes: 0 } : u)),
    })),
  }
}

const asap = (input: PlannerInput): PlanRun => planRun(input, null)

/** Whether the ASAP plan (with its buffer) ends by `ref`, with nothing else in the way. */
function fitsBy(input: PlannerInput, ref: ISODate): boolean {
  return planRun({ ...input, targetDate: ref }, null).fits
}

/** Smallest verified extra minutes per study day that make the plan fit by `ref`, or null. */
export function findExtraMinutes(input: PlannerInput, ref: ISODate): number | null {
  const g = resolvePlannerSettings(input.settings).grain
  const at = (units: number): PlannerInput => ({
    ...input,
    availability: addMinutesToWindows(input.availability, units * g),
  })
  let hi = Math.floor(MAX_EXTRA_MINUTES / g)
  if (!fitsBy(at(hi), ref)) return null
  let lo = 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (fitsBy(at(mid), ref)) hi = mid
    else lo = mid + 1
  }
  // Verified with the full planner (pace chosen as it would be on confirm).
  return planStudy({ ...at(hi), targetDate: ref }).fits ? hi * g : null
}

/** The earliest verified target: the ASAP plan's buffered end, nudged forward if a check disagrees. */
export function findEarliestDate(input: PlannerInput): ISODate | null {
  const run = asap({ ...input, targetDate: null })
  if (run.bufferedEnd === null) return null
  let d = isoOfDay(run.bufferedEnd)
  for (let i = 0; i < 14; i++) {
    if (planStudy({ ...input, targetDate: d }).fits) return d
    d = addDays(d, 1)
  }
  return null
}

/** A verified set of units to cut so the plan fits by `ref` (greedy in candidate order, then pruned). */
export function findCut(
  input: PlannerInput,
  ref: ISODate,
  candidates: readonly CutCandidate[],
  shortfall: number,
): string[] {
  const chosen: string[] = []
  let saved = 0
  let fit = false
  for (const c of candidates) {
    chosen.push(c.unitId)
    saved += c.minutes
    // Skip the runs that cannot fit yet: the cut has to save at least the shortfall.
    if (saved < shortfall) continue
    if (fitsBy(withoutUnits(input, chosen), ref)) {
      fit = true
      break
    }
  }
  if (!fit) return []
  // Put back what is not needed, most valuable (latest chosen) first.
  for (let i = chosen.length - 1; i >= 0 && chosen.length > 1; i--) {
    const without = chosen.filter((_, k) => k !== i)
    if (fitsBy(withoutUnits(input, without), ref)) chosen.splice(i, 1)
  }
  return planStudy({ ...withoutUnits(input, chosen), targetDate: ref }).fits ? chosen : []
}

/**
 * Checks the plan against its target (or `reference` when given, e.g. the baseline end in ASAP mode).
 * With no date to meet, it fits unless nothing can be placed.
 */
export function checkFeasibility(input: PlannerInput, reference?: ISODate | null): FeasibilityResult {
  const ref = reference ?? input.targetDate
  const target = { ...input, targetDate: ref }
  const base = planStudy(target)
  const fast = asap({ ...input, targetDate: null })
  const earliest = fast.bufferedEnd === null ? null : isoOfDay(fast.bufferedEnd)
  const candidates = cutCandidates(input.courses)
  const empty: FeasibilityResult['options'] = {
    addTime: { extraMinutesPerStudyDay: 0, suggestion: '', projectedEnd: base.projectedEnd },
    moveDate: { earliestFeasibleDate: earliest },
    cutScope: { candidates, suggestedCut: [], cutMinutes: 0, projectedEnd: base.projectedEnd },
  }
  if (base.fits || ref === null) {
    return {
      fits: base.fits,
      shortfallMinutes: 0,
      projectedEnd: base.projectedEnd,
      bufferedEnd: base.buffer.bufferedEnd,
      options: empty,
    }
  }

  const g = resolvePlannerSettings(input.settings).grain
  const need = fast.totals.work + fast.bufferMinutes
  const have = freeMinutesUntil(input, ref)
  const late = fast.items
    .filter((i) => i.doDate > ref && i.kind !== 'assessment' && i.kind !== 'milestone')
    .reduce((n, i) => n + i.durationMinutes, 0)
  const shortfallMinutes = Math.max(need - have, late, g)

  const extra = findExtraMinutes(input, ref)
  const extended = extra === null ? null : planStudy({ ...target, availability: addMinutesToWindows(input.availability, extra) })
  const moveTo = findEarliestDate(input)
  const cut = findCut(input, ref, candidates, shortfallMinutes)
  const cutRun = cut.length > 0 ? planStudy({ ...withoutUnits(input, cut), targetDate: ref }) : null
  const minutesOf = new Map(candidates.map((c) => [c.unitId, c.minutes]))

  return {
    fits: false,
    shortfallMinutes,
    projectedEnd: base.projectedEnd,
    bufferedEnd: base.buffer.bufferedEnd,
    options: {
      addTime: {
        extraMinutesPerStudyDay: extra,
        suggestion:
          extra === null
            ? `Even ${formatDuration(MAX_EXTRA_MINUTES)} more a day is not enough`
            : `Add ${formatDuration(extra)} to each study day`,
        projectedEnd: extended?.projectedEnd ?? null,
      },
      moveDate: { earliestFeasibleDate: moveTo },
      cutScope: {
        candidates,
        suggestedCut: cut,
        cutMinutes: cut.reduce((n, id) => n + (minutesOf.get(id) ?? 0), 0),
        projectedEnd: cutRun?.projectedEnd ?? null,
      },
    },
  }
}
