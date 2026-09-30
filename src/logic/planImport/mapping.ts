/**
 * A validated plan → the database rows to write (BRIEF §5.4). Pure: the caller loads the target goal
 * (or none, for a new goal), passes an id generator and gets back every row to add and every change to
 * make, plus the preview the UI shows. The preview is built from the same result that gets written, so
 * what you see is what you import.
 *
 * Merge rules (the UI says them out loud):
 * - courses are matched by code; a match is updated, the rest are added, **nothing is deleted**;
 * - only fields the plan actually gives are changed (an absent `cus` keeps the current value), and a
 *   course's status, notes and progress are never touched;
 * - `order` only places new courses (after the goal's current last one); existing courses and units keep
 *   their place, so a re-import never shuffles what you arranged by hand;
 * - units are matched by title inside a matched course: updated when the plan gives a new estimate,
 *   added when new, kept when the plan does not mention them;
 * - the goal keeps its name and icon; target date, term and availability change only when given.
 * Importing the same plan twice therefore changes nothing the second time.
 */
import type {
  Availability,
  DateRange,
  Goal,
  ID,
  ISODate,
  Milestone,
  NewRow,
  Unit,
  WeekMinutes,
  WguTerm,
} from '@/db/types'
import { describeDaysOff, describeWeek, formatMinutes, termLabel, weeklyMinutes } from './format'
import type { Plan, PlanCourse, PlanUnit } from './schema'

export interface ExistingCourse {
  milestone: Milestone
  units: readonly Unit[]
}

export interface ExistingGoal {
  goal: Goal
  courses: readonly ExistingCourse[]
}

export interface MapContext {
  today: ISODate
  newId: () => ID
  /** `order` for a new goal: after the goals that exist. */
  nextGoalOrder: number
}

/** Used when the plan gives no availability: Monday to Friday, two hours (Sunday first). */
export const DEFAULT_WEEK: WeekMinutes = [0, 120, 120, 120, 120, 120, 0]

export type CourseChange = 'new' | 'update' | 'same'

export interface PreviewCourse {
  code: string
  name: string
  cus: number | null
  type: 'OA' | 'PA' | null
  hours: number
  unitCount: number
  prerequisites: string[]
  change: CourseChange
  /** Labels of what an update changes ("hours", "CUs", …). */
  changed: string[]
  unitsAdded: number
  unitsUpdated: number
}

export interface ImportPreview {
  mode: 'create' | 'merge'
  goal: {
    title: string
    icon: string
    targetDate: ISODate | null
    term: { start: ISODate; end: ISODate; label: string } | null
    /** "Mon–Fri 2 h · Sat 3 h · Sun off", or the default when the plan gave none. */
    availability: string
    weeklyHours: string
    daysOff: string
    /** True when the plan did not give availability for a new goal. */
    availabilityIsDefault: boolean
  }
  /** Merge only: what changes on the goal itself. */
  goalChanges: string[]
  courses: PreviewCourse[]
  totals: {
    courses: number
    added: number
    updated: number
    unchanged: number
    hours: number
    cus: number
    units: number
    unitsAdded: number
    unitsUpdated: number
  }
}

export interface ImportOps {
  mode: 'create' | 'merge'
  goalId: ID
  goalAdd: NewRow<Goal> | null
  /** Merge only; `null` when the goal itself stays as it is. */
  goalChanges: Partial<Goal> | null
  milestonesAdd: NewRow<Milestone>[]
  milestonesUpdate: { id: ID; changes: Partial<Milestone> }[]
  unitsAdd: NewRow<Unit>[]
  unitsUpdate: { id: ID; changes: Partial<Unit> }[]
  preview: ImportPreview
}

/** Whether applying `ops` would write anything at all. */
export function hasWrites(ops: ImportOps): boolean {
  return (
    ops.goalAdd !== null ||
    ops.goalChanges !== null ||
    ops.milestonesAdd.length + ops.milestonesUpdate.length + ops.unitsAdd.length + ops.unitsUpdate.length >
      0
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

const clampMinutes = (m: number): number => Math.max(1, Math.round(m))

/** A unit's estimate in whole minutes, or `null` when the plan gives none. */
export function unitMinutes(unit: PlanUnit): number | null {
  if (unit.estimatedMinutes !== undefined) return clampMinutes(unit.estimatedMinutes)
  if (unit.estimatedHours !== undefined) return clampMinutes(unit.estimatedHours * 60)
  return null
}

const normTitle = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase()

const sameIds = (a: readonly ID[], b: readonly ID[]): boolean =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i])

function toAvailability(
  plan: NonNullable<Plan['goal']['availability']>,
  current: Availability | null,
): Availability {
  const h = plan.hoursPerWeekday
  const minutes = (hours: number | undefined): number => Math.round((hours ?? 0) * 60)
  const week: WeekMinutes = [
    minutes(h.sun),
    minutes(h.mon),
    minutes(h.tue),
    minutes(h.wed),
    minutes(h.thu),
    minutes(h.fri),
    minutes(h.sat),
  ]
  const daysOff: DateRange[] = plan.daysOff
    ? plan.daysOff.map((r) => ({ start: r.from, end: r.to }))
    : (current?.daysOff ?? [])
  return { minutesByWeekday: week, daysOff }
}

const sameAvailability = (a: Availability, b: Availability): boolean =>
  a.minutesByWeekday.every((m, i) => m === b.minutesByWeekday[i]) &&
  a.daysOff.length === b.daysOff.length &&
  a.daysOff.every((r, i) => r.start === b.daysOff[i]?.start && r.end === b.daysOff[i]?.end)

// ── Mapping ─────────────────────────────────────────────────────────────────────────────────────

export function planToOps(plan: Plan, existing: ExistingGoal | null, ctx: MapContext): ImportOps {
  const mode = existing ? 'merge' : 'create'
  const goalId = existing?.goal.id ?? ctx.newId()
  const term = plan.goal.term

  // Terms: reuse one with the same dates, else add one.
  let termRow: WguTerm | null = null
  let termIsNew = false
  if (term) {
    const found = existing?.goal.terms.find((t) => t.start === term.start && t.end === term.end)
    termRow = found ?? {
      id: ctx.newId(),
      label: termLabel(term.start, term.end),
      start: term.start,
      end: term.end,
    }
    termIsNew = found === undefined
  }
  /** A course counts toward the term unless it is due after it. */
  const termIdFor = (c: PlanCourse): ID | null =>
    termRow && term && (c.targetDate === undefined || c.targetDate <= term.end) ? termRow.id : null

  // Which plan courses match a course of the goal (by code; the first match wins).
  const byCode = new Map<string, ExistingCourse>()
  for (const ex of existing?.courses ?? []) {
    const code = ex.milestone.code?.trim().toUpperCase()
    if (code && !byCode.has(code)) byCode.set(code, ex)
  }
  const matchOf = (c: PlanCourse): ExistingCourse | undefined => byCode.get(c.code)

  const idByCode = new Map<string, ID>()
  for (const [code, ex] of byCode) idByCode.set(code, ex.milestone.id)
  const newIds = new Map<PlanCourse, ID>()
  for (const c of plan.courses) {
    const id = matchOf(c)?.milestone.id ?? ctx.newId()
    newIds.set(c, id)
    idByCode.set(c.code, id)
  }
  const resolvePrereqs = (c: PlanCourse): ID[] => [
    ...new Set((c.prerequisites ?? []).flatMap((code) => idByCode.get(code) ?? [])),
  ]

  // New courses go after the goal's last one, ranked by `order` (else their place in the list).
  const base = Math.max(-1, ...(existing?.courses ?? []).map((e) => e.milestone.order)) + 1
  const rank = new Map<PlanCourse, number>()
  plan.courses
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !matchOf(c))
    .sort((a, b) => (a.c.order ?? a.i) - (b.c.order ?? b.i) || a.i - b.i)
    .forEach(({ c }, n) => rank.set(c, base + n))

  const milestonesAdd: NewRow<Milestone>[] = []
  const milestonesUpdate: ImportOps['milestonesUpdate'] = []
  const unitsAdd: NewRow<Unit>[] = []
  const unitsUpdate: ImportOps['unitsUpdate'] = []
  const previewCourses: PreviewCourse[] = []

  for (const c of plan.courses) {
    const id = newIds.get(c) ?? ctx.newId()
    const ex = matchOf(c)
    const planUnits = c.units ?? []
    let unitsAddedHere = 0
    let unitsUpdatedHere = 0
    const changed: string[] = []

    if (!ex) {
      milestonesAdd.push({
        id,
        goalId,
        kind: 'course',
        code: c.code,
        title: c.name,
        icon: null,
        cover: null,
        status: 'todo',
        order: rank.get(c) ?? base,
        prerequisiteIds: resolvePrereqs(c),
        estimateHours: c.estimatedHours,
        dueDate: c.targetDate ?? null,
        cus: c.cus ?? null,
        courseType: c.type ?? null,
        termId: termIdFor(c),
        notes: [],
        projectedStart: null,
        projectedEnd: null,
        completedAt: null,
      })
      planUnits.forEach((u, order) => {
        unitsAdd.push({
          id: ctx.newId(),
          goalId,
          milestoneId: id,
          title: u.title,
          order,
          estimateMinutes: unitMinutes(u),
          difficulty: 2,
          status: 'todo',
          completedAt: null,
        })
      })
      unitsAddedHere = planUnits.length
    } else {
      const m = ex.milestone
      const changes: Partial<Milestone> = {}
      if (m.title !== c.name) {
        changes.title = c.name
        changed.push('name')
      }
      if (m.estimateHours !== c.estimatedHours) {
        changes.estimateHours = c.estimatedHours
        changed.push('hours')
      }
      if (c.cus !== undefined && m.cus !== c.cus) {
        changes.cus = c.cus
        changed.push('CUs')
      }
      if (c.type !== undefined && m.courseType !== c.type) {
        changes.courseType = c.type
        changed.push('type')
      }
      if (c.targetDate !== undefined && m.dueDate !== c.targetDate) {
        changes.dueDate = c.targetDate
        changed.push('due date')
      }
      if (c.prerequisites !== undefined) {
        const ids = resolvePrereqs(c)
        if (!sameIds(ids, m.prerequisiteIds)) {
          changes.prerequisiteIds = ids
          changed.push('prerequisites')
        }
      }
      const termId = termIdFor(c)
      if (termId !== null && m.termId !== termId) {
        changes.termId = termId
        changed.push('term')
      }

      // Units: match by title, update estimates, append the new ones after the last.
      const queues = new Map<string, Unit[]>()
      for (const u of [...ex.units].sort((a, b) => a.order - b.order)) {
        const key = normTitle(u.title)
        queues.set(key, [...(queues.get(key) ?? []), u])
      }
      let nextOrder = Math.max(-1, ...ex.units.map((u) => u.order)) + 1
      for (const u of planUnits) {
        const match = queues.get(normTitle(u.title))?.shift()
        const minutes = unitMinutes(u)
        if (match) {
          if (minutes !== null && minutes !== match.estimateMinutes) {
            unitsUpdate.push({ id: match.id, changes: { estimateMinutes: minutes } })
            unitsUpdatedHere++
          }
        } else {
          unitsAdd.push({
            id: ctx.newId(),
            goalId,
            milestoneId: m.id,
            title: u.title,
            order: nextOrder++,
            estimateMinutes: minutes,
            difficulty: 2,
            status: 'todo',
            completedAt: null,
          })
          unitsAddedHere++
        }
      }
      if (Object.keys(changes).length > 0) milestonesUpdate.push({ id: m.id, changes })
    }

    previewCourses.push({
      code: c.code,
      name: c.name,
      cus: c.cus ?? null,
      type: c.type ?? null,
      hours: c.estimatedHours,
      unitCount: planUnits.length,
      prerequisites: c.prerequisites ?? [],
      change: !ex ? 'new' : changed.length + unitsAddedHere + unitsUpdatedHere > 0 ? 'update' : 'same',
      changed,
      unitsAdded: unitsAddedHere,
      unitsUpdated: unitsUpdatedHere,
    })
  }

  // The goal itself.
  const planAvailability = plan.goal.availability
  let goalAdd: NewRow<Goal> | null = null
  let goalChanges: Partial<Goal> | null = null
  const goalChangeLines: string[] = []
  let availability: Availability

  if (!existing) {
    availability = planAvailability
      ? toAvailability(planAvailability, null)
      : { minutesByWeekday: [...DEFAULT_WEEK] as WeekMinutes, daysOff: [] }
    goalAdd = {
      id: goalId,
      title: plan.goal.name,
      icon: plan.goal.icon ?? '🎓',
      cover: null,
      kind: term || plan.courses.some((c) => c.cus !== undefined) ? 'degree' : 'custom',
      status: 'active',
      startDate: term?.start ?? ctx.today,
      targetDate: plan.goal.targetDate ?? term?.end ?? null,
      availability,
      terms: termRow ? [termRow] : [],
      notes: [],
      order: ctx.nextGoalOrder,
      baselineEnd: null,
      projection: null,
      lastRebalancedOn: null,
      completedAt: null,
    }
  } else {
    const g = existing.goal
    availability = g.availability
    const changes: Partial<Goal> = {}
    if (plan.goal.targetDate !== undefined && plan.goal.targetDate !== g.targetDate) {
      changes.targetDate = plan.goal.targetDate
      goalChangeLines.push(`Target date ${g.targetDate ?? 'none'} → ${plan.goal.targetDate}`)
    }
    if (termRow && termIsNew) {
      changes.terms = [...g.terms, termRow]
      goalChangeLines.push(`Term added: ${termRow.label}`)
    }
    if (planAvailability) {
      const next = toAvailability(planAvailability, g.availability)
      if (!sameAvailability(next, g.availability)) {
        changes.availability = next
        availability = next
        goalChangeLines.push(`Availability: ${describeWeek(next.minutesByWeekday)}`)
        if (planAvailability.daysOff) goalChangeLines.push(`Days off: ${describeDaysOff(next.daysOff)}`)
      }
    }
    if (Object.keys(changes).length > 0) goalChanges = changes
  }

  const sum = (pick: (c: PreviewCourse) => number): number => previewCourses.reduce((n, c) => n + pick(c), 0)
  const targetDate = goalAdd
    ? goalAdd.targetDate
    : (goalChanges?.targetDate ?? existing?.goal.targetDate ?? null)

  return {
    mode,
    goalId,
    goalAdd,
    goalChanges,
    milestonesAdd,
    milestonesUpdate,
    unitsAdd,
    unitsUpdate,
    preview: {
      mode,
      goal: {
        title: existing?.goal.title ?? plan.goal.name,
        icon: existing?.goal.icon ?? plan.goal.icon ?? '🎓',
        targetDate,
        term: term && termRow ? { start: term.start, end: term.end, label: termRow.label } : null,
        availability: describeWeek(availability.minutesByWeekday),
        weeklyHours: formatMinutes(weeklyMinutes(availability.minutesByWeekday)),
        daysOff: describeDaysOff(availability.daysOff),
        availabilityIsDefault: !existing && !planAvailability,
      },
      goalChanges: goalChangeLines,
      courses: previewCourses,
      totals: {
        courses: previewCourses.length,
        added: previewCourses.filter((c) => c.change === 'new').length,
        updated: previewCourses.filter((c) => c.change === 'update').length,
        unchanged: previewCourses.filter((c) => c.change === 'same').length,
        hours: sum((c) => c.hours),
        cus: sum((c) => c.cus ?? 0),
        units: sum((c) => c.unitCount),
        unitsAdded: sum((c) => c.unitsAdded),
        unitsUpdated: sum((c) => c.unitsUpdated),
      },
    },
  }
}
