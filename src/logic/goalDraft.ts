/**
 * The new-goal wizard's draft (pure). The wizard edits a `DraftGoal` (form-friendly: numbers are the
 * text being typed, units are one line each, courses are keyed by a client id); `validateStep` says
 * what blocks "Next", `draftToRows` turns it into stored rows, and `previewPlan` runs the scheduler
 * on those rows with no tasks, so step 4 can show a projected finish before anything is saved.
 */
import type {
  Availability,
  DateRange,
  Goal,
  ID,
  ISODate,
  Millis,
  Milestone,
  Unit,
  WeekMinutes,
  WguTerm,
} from '@/db/types'
import { addDays, addMonths, compareISODate, isISODate, type Weekday } from './dates'
import { planGoal, type GoalPlan } from './scheduler'

export type CourseType = NonNullable<Milestone['courseType']>
export const COURSE_TYPES: readonly CourseType[] = ['OA', 'PA', 'OA+PA']

export const TITLE_MAX = 120
export const CODE_MAX = 16
export const HOURS_MAX = 2000
export const CUS_MAX = 40
export const UNITS_MAX = 60
/** No study day may be planned past this (matches the scheduler's own ceiling). */
export const DAY_MAX_MINUTES = 16 * 60
export const DEFAULT_DAY_MINUTES = 60
export const DEFAULT_ICON = '🎯'

/** Monday first, the order the availability step lists the days in. Values are `Date#getDay` (0 = Sunday). */
export const WEEKDAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

export interface DraftCourse {
  /** Client id: stable while the wizard is open, replaced by a real id on save. */
  key: string
  code: string
  title: string
  /** Estimated hours, as typed. */
  hours: string
  /** Competency units, as typed; empty means none. */
  cus: string
  courseType: CourseType | ''
  /** Keys of earlier courses that must come first. */
  prerequisiteKeys: string[]
  /** One unit or chapter per line; empty lines are ignored. */
  units: string
}

export interface DraftRange {
  key: string
  /** `''` until picked. */
  start: ISODate | ''
  end: ISODate | ''
  label: string
}

export interface DraftTerm {
  enabled: boolean
  label: string
  start: ISODate
  end: ISODate
  /** The end was set by hand, so moving the start no longer moves it. */
  endEdited: boolean
}

export interface DraftGoal {
  title: string
  icon: string
  /** A gradient preset id (`COVER_PRESETS`), or null for no cover. */
  coverPreset: string | null
  kind: Goal['kind']
  targetDate: ISODate | null
  courses: DraftCourse[]
  minutesByWeekday: WeekMinutes
  daysOff: DraftRange[]
  term: DraftTerm
}

export type KeyMaker = () => string

/** Six months from `start`, minus a day: a WGU term that starts on 1 Oct ends on 31 Mar. */
export function termEndFor(start: ISODate): ISODate {
  return addDays(addMonths(start, 6), -1)
}

export function emptyCourse(newKey: KeyMaker): DraftCourse {
  return {
    key: newKey(),
    code: '',
    title: '',
    hours: '',
    cus: '',
    courseType: '',
    prerequisiteKeys: [],
    units: '',
  }
}

export function emptyDraft(today: ISODate): DraftGoal {
  return {
    title: '',
    icon: DEFAULT_ICON,
    coverPreset: null,
    kind: 'custom',
    targetDate: null,
    courses: [],
    minutesByWeekday: [0, 60, 60, 60, 60, 60, 0],
    daysOff: [],
    term: {
      enabled: false,
      label: 'Term 1',
      start: today,
      end: termEndFor(today),
      endEdited: false,
    },
  }
}

// ─── Editing helpers ────────────────────────────────────────────────────────

/** Moves the item at `from` so it ends up at index `to` (both clamped). Returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item as T)
  return next
}

/** Keeps only prerequisites that still name an earlier course. */
export function pruneStalePrerequisites(courses: readonly DraftCourse[]): DraftCourse[] {
  const earlier = new Set<string>()
  return courses.map((course) => {
    const kept = course.prerequisiteKeys.filter((k) => earlier.has(k))
    earlier.add(course.key)
    return kept.length === course.prerequisiteKeys.length
      ? course
      : { ...course, prerequisiteKeys: kept }
  })
}

export function removeCourse(courses: readonly DraftCourse[], key: string): DraftCourse[] {
  return pruneStalePrerequisites(courses.filter((c) => c.key !== key))
}

export function moveCourse(
  courses: readonly DraftCourse[],
  from: number,
  to: number,
): DraftCourse[] {
  return pruneStalePrerequisites(moveItem(courses, from, to))
}

/** The courses in the order of `keys` (unknown keys ignored, unlisted courses kept after), prerequisites tidied. */
export function reorderCourses(
  courses: readonly DraftCourse[],
  keys: readonly string[],
): DraftCourse[] {
  const byKey = new Map(courses.map((c) => [c.key, c]))
  const listed = [...new Set(keys)].flatMap((k) => {
    const c = byKey.get(k)
    return c ? [c] : []
  })
  const rest = courses.filter((c) => !keys.includes(c.key))
  return pruneStalePrerequisites([...listed, ...rest])
}

/** The courses `key` may depend on: everything listed before it. */
export function prerequisiteOptions(courses: readonly DraftCourse[], key: string): DraftCourse[] {
  const index = courses.findIndex((c) => c.key === key)
  return index <= 0 ? [] : courses.slice(0, index)
}

/** Sets one weekday's study minutes (clamped to 0…16 h, whole minutes). */
export function setDayMinutes(minutes: WeekMinutes, weekday: Weekday, value: number): WeekMinutes {
  const next: WeekMinutes = [...minutes]
  next[weekday] = Math.max(0, Math.min(DAY_MAX_MINUTES, Math.round(value)))
  return next
}

/** The study days (weekday numbers, Monday first) and the minutes planned across a week. */
export function weekSummary(minutes: WeekMinutes): { days: number; minutes: number } {
  let days = 0
  let total = 0
  for (const m of minutes) {
    if (m > 0) {
      days++
      total += m
    }
  }
  return { days, minutes: total }
}

/** Moves the term start; the end follows (start + 6 months − 1 day) until it has been set by hand. */
export function setTermStart(term: DraftTerm, start: ISODate): DraftTerm {
  return { ...term, start, end: term.endEdited ? term.end : termEndFor(start) }
}

export function setTermEnd(term: DraftTerm, end: ISODate): DraftTerm {
  return { ...term, end, endEdited: true }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** Positive hours with at most one decimal comma or point; `null` for anything else. */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= HOURS_MAX ? n : null
}

/** `{ ok: true, value: null }` for an empty field; `{ ok: false }` for anything that is not 0…40. */
export function parseCus(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false }
  const n = Number(t)
  return n <= CUS_MAX ? { ok: true, value: n } : { ok: false }
}

/** The unit titles in a "one per line" field. */
export function parseUnits(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** 0 basics, 1 courses, 2 availability, 3 preview. */
export type WizardStep = 0 | 1 | 2 | 3
export type DraftErrors = Record<string, string>

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function validateBasics(draft: DraftGoal, today: ISODate): DraftErrors {
  const errors: DraftErrors = {}
  const title = clean(draft.title)
  if (title === '') errors.title = 'Give the goal a name.'
  else if (title.length > TITLE_MAX) errors.title = `Keep the name under ${TITLE_MAX} characters.`
  if (draft.targetDate !== null) {
    if (!isISODate(draft.targetDate)) errors.targetDate = 'Pick a valid date.'
    else if (compareISODate(draft.targetDate, today) <= 0) {
      errors.targetDate = 'Pick a date after today.'
    }
  }
  return errors
}

export function validateCourses(draft: DraftGoal): DraftErrors {
  const errors: DraftErrors = {}
  if (draft.courses.length === 0) errors.courses = 'Add at least one course.'
  for (const course of draft.courses) {
    const at = `course:${course.key}`
    const title = clean(course.title)
    if (title === '') errors[`${at}:title`] = 'Name the course.'
    else if (title.length > TITLE_MAX) errors[`${at}:title`] = `Under ${TITLE_MAX} characters.`
    if (clean(course.code).length > CODE_MAX) errors[`${at}:code`] = `Under ${CODE_MAX} characters.`
    if (parseHours(course.hours) === null) {
      errors[`${at}:hours`] = `Hours from 0.5 to ${HOURS_MAX}.`
    }
    if (!parseCus(course.cus).ok) errors[`${at}:cus`] = `CUs from 0 to ${CUS_MAX}.`
    if (parseUnits(course.units).length > UNITS_MAX) {
      errors[`${at}:units`] = `At most ${UNITS_MAX} units.`
    }
  }
  return errors
}

export function validateAvailability(draft: DraftGoal): DraftErrors {
  const errors: DraftErrors = {}
  if (weekSummary(draft.minutesByWeekday).days === 0) {
    errors.days = 'Pick at least one study day.'
  }
  for (const range of draft.daysOff) {
    if (!isISODate(range.start) || !isISODate(range.end)) {
      errors[`range:${range.key}`] = 'Pick a start and an end date, or remove this range.'
    } else if (compareISODate(range.start, range.end) > 0) {
      errors[`range:${range.key}`] = 'The end is before the start.'
    }
  }
  const { term } = draft
  if (term.enabled) {
    if (!isISODate(term.start) || !isISODate(term.end)) {
      errors.term = 'Pick the term’s start and end dates.'
    } else if (compareISODate(term.start, term.end) > 0) {
      errors.term = 'The term ends before it starts.'
    }
  }
  return errors
}

/** The schedule settings dialog: the target date plus everything the availability step checks. */
export function validateSchedule(draft: DraftGoal, today: ISODate): DraftErrors {
  const { targetDate } = validateBasics({ ...draft, title: 'x' }, today)
  return { ...validateAvailability(draft), ...(targetDate ? { targetDate } : {}) }
}

/** What blocks moving on from `step` (empty = fine). The preview step has nothing to fix. */
export function validateStep(draft: DraftGoal, step: WizardStep, today: ISODate): DraftErrors {
  if (step === 0) return validateBasics(draft, today)
  if (step === 1) return validateCourses(draft)
  if (step === 2) return validateAvailability(draft)
  return {}
}

/** The first step (0…2) with a problem, or `null` when the whole draft can be saved. */
export function firstInvalidStep(draft: DraftGoal, today: ISODate): WizardStep | null {
  for (const step of [0, 1, 2] as const) {
    if (Object.keys(validateStep(draft, step, today)).length > 0) return step
  }
  return null
}

// ─── Draft → rows ───────────────────────────────────────────────────────────

export interface DraftRows {
  goal: Goal
  milestones: Milestone[]
  units: Unit[]
}

export interface RowsContext {
  today: ISODate
  now: Millis
  /** Fresh ids for the goal, term, courses and units. */
  newId: () => ID
  /** `goal.order`; the repo appends after the last goal when it saves. */
  goalOrder?: number
}

function validRanges(ranges: readonly DraftRange[]): DateRange[] {
  return ranges
    .filter((r) => isISODate(r.start) && isISODate(r.end) && compareISODate(r.start, r.end) <= 0)
    .map<DateRange>((r) => {
      const label = clean(r.label)
      return label === '' ? { start: r.start, end: r.end } : { start: r.start, end: r.end, label }
    })
    .sort((a, b) => compareISODate(a.start, b.start))
}

export interface DraftSchedule {
  availability: Availability
  terms: WguTerm[]
  targetDate: ISODate | null
}

/**
 * The scheduling part of a draft as stored values: weekday minutes, the complete days-off ranges (sorted),
 * the term (kept under `termId` so courses keep pointing at it) and the target date.
 */
export function draftSchedule(draft: DraftGoal, termId: ID): DraftSchedule {
  const { term } = draft
  return {
    availability: {
      minutesByWeekday: [...draft.minutesByWeekday],
      daysOff: validRanges(draft.daysOff),
    },
    terms: term.enabled
      ? [
          {
            id: termId,
            label: clean(term.label) || 'Term 1',
            start: term.start,
            end: term.end,
          },
        ]
      : [],
    targetDate: draft.targetDate,
  }
}

/**
 * A draft that holds an existing goal's schedule (the schedule settings dialog edits it with the same
 * form as the wizard). Courses are not part of it. The term end counts as set by hand.
 */
export function draftFromGoal(
  goal: Pick<Goal, 'title' | 'icon' | 'kind' | 'targetDate' | 'availability' | 'terms'>,
  today: ISODate,
  newKey: KeyMaker,
): DraftGoal {
  const base = emptyDraft(today)
  const term = goal.terms[0]
  return {
    ...base,
    title: goal.title,
    icon: goal.icon,
    kind: goal.kind,
    targetDate: goal.targetDate,
    minutesByWeekday: [...goal.availability.minutesByWeekday],
    daysOff: goal.availability.daysOff.map((r) => ({
      key: newKey(),
      start: r.start,
      end: r.end,
      label: r.label ?? '',
    })),
    term: term
      ? { enabled: true, label: term.label, start: term.start, end: term.end, endEdited: true }
      : base.term,
  }
}

/**
 * The rows the draft describes. Assumes a valid draft, but never throws: an unreadable number becomes
 * 0 hours, an unpicked range is dropped. Courses are numbered in list order; a prerequisite key that
 * does not name an earlier course is ignored.
 */
export function draftToRows(draft: DraftGoal, ctx: RowsContext): DraftRows {
  const goalId = ctx.newId()
  const schedule = draftSchedule(draft, ctx.newId())
  const term = schedule.terms[0] ?? null

  const idByKey = new Map<string, ID>()
  const milestones: Milestone[] = []
  const units: Unit[] = []
  draft.courses.forEach((course, order) => {
    const id = ctx.newId()
    const prerequisiteIds = course.prerequisiteKeys.flatMap((k) => {
      const dep = idByKey.get(k)
      return dep === undefined ? [] : [dep]
    })
    idByKey.set(course.key, id)
    const cus = parseCus(course.cus)
    const code = clean(course.code)
    milestones.push({
      id,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      goalId,
      kind: 'course',
      code: code === '' ? null : code,
      title: clean(course.title),
      icon: null,
      cover: null,
      status: 'todo',
      order,
      prerequisiteIds,
      estimateHours: parseHours(course.hours) ?? 0,
      dueDate: null,
      cus: cus.ok ? cus.value : null,
      courseType: course.courseType === '' ? null : course.courseType,
      termId: term?.id ?? null,
      notes: [],
      projectedStart: null,
      projectedEnd: null,
      completedAt: null,
    })
    parseUnits(course.units)
      .slice(0, UNITS_MAX)
      .forEach((title, i) => {
        units.push({
          id: ctx.newId(),
          createdAt: ctx.now,
          updatedAt: ctx.now,
          goalId,
          milestoneId: id,
          title,
          order: i,
          estimateMinutes: null,
          difficulty: 2,
          status: 'todo',
          completedAt: null,
        })
      })
  })

  const goal: Goal = {
    id: goalId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    title: clean(draft.title),
    icon: draft.icon || DEFAULT_ICON,
    cover: draft.coverPreset === null ? null : { kind: 'gradient', preset: draft.coverPreset },
    kind: draft.kind,
    status: 'active',
    startDate: ctx.today,
    targetDate: schedule.targetDate,
    availability: schedule.availability,
    terms: schedule.terms,
    notes: [],
    order: ctx.goalOrder ?? 0,
    baselineEnd: null,
    projection: null,
    lastRebalancedOn: null,
    completedAt: null,
  }
  return { goal, milestones, units }
}

/**
 * The plan the draft would produce today: the scheduler over the draft's rows with no tasks. Ids are
 * throwaway, so call it as often as the draft changes.
 */
export function previewPlan(
  draft: DraftGoal,
  today: ISODate,
  globalDaysOff: readonly DateRange[] = [],
): GoalPlan {
  let n = 0
  const rows = draftToRows(draft, { today, now: 0, newId: () => `preview-${n++}` })
  return planGoal({ ...rows, tasks: [], globalDaysOff }, today)
}
