/**
 * Readiness → the planner's extra review time (pure; a schema v2 hook, PLAN §4.5–4.6). A `readiness`
 * row (per course, `id = milestoneId`, or per unit, `id = unitId`) carries a 0–1 score and the extra
 * review minutes it calls for; the planner places them as `extra:<unitOrCourseId>:<n>` reviews right
 * after the unit's study, or after the course's last unit.
 *
 * `reviewMinutesForScore` is the suggested mapping for whoever computes the rows (Phase 11e): nothing
 * extra once a score reaches `readyAt`, otherwise up to `maxMinutes`, growing with the gap, in whole
 * grains.
 */
import type { ID, Readiness } from '@/db/types'

export interface ExtraReviewMinutes {
  /** Per unit id. */
  units: Map<ID, number>
  /** Per course id (rows without a unit). */
  courses: Map<ID, number>
}

const clean = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0)

/**
 * The planner hook from readiness rows: `PlannerUnit.extraReviewMinutes` per unit and
 * `PlannerCourse.extraReviewMinutes` per course. Zero or invalid minutes are left out; if a unit or
 * course appears twice, the most recently computed row wins.
 */
export function extraReviewMinutesFrom(rows: readonly Readiness[]): ExtraReviewMinutes {
  const units = new Map<ID, number>()
  const courses = new Map<ID, number>()
  const sorted = [...rows].sort((a, b) => a.computedAt - b.computedAt || (a.id < b.id ? -1 : 1))
  for (const r of sorted) {
    const minutes = clean(r.extraReviewMinutes)
    const target = r.unitId === null ? courses : units
    const id = r.unitId ?? r.milestoneId
    if (minutes > 0) target.set(id, minutes)
    else target.delete(id)
  }
  return { units, courses }
}

export interface ReviewMinutesOptions {
  /** Score at or above which no extra review is planned. Default 0.8 (a PA of 80 %). */
  readyAt?: number
  /** Extra minutes at a score of 0. Default 120. */
  maxMinutes?: number
  grain?: number
}

/** Extra review minutes for a 0–1 readiness score: 0 when ready, up to `maxMinutes` at 0. */
export function reviewMinutesForScore(score: number, opts: ReviewMinutesOptions = {}): number {
  const readyAt = opts.readyAt ?? 0.8
  const max = opts.maxMinutes ?? 120
  const grain = Math.max(1, opts.grain ?? 5)
  if (!Number.isFinite(score) || readyAt <= 0) return 0
  const s = Math.min(1, Math.max(0, score))
  if (s >= readyAt) return 0
  const gap = (readyAt - s) / readyAt
  return Math.ceil((gap * max) / grain) * grain
}
