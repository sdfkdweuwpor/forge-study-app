/**
 * The Goal Breakdown Planner's draft (pure). The planner UI edits one `PlannerDraft` across its steps:
 * what the goal is made of (courses → units + assessments), when it should be done, when the person can
 * study, and how much effort each piece is. Nothing is scheduled until the last step.
 *
 * - `plannerReducer` is the whole state machine (edits, reorders, deletes with a way back).
 * - `applyPlanDraft` / `applyTemplate` fill a draft from a parsed syllabus, Claude's JSON or a template;
 *   they are the only ways content gets in, so it is always reviewed.
 * - `plannerRows` turns a draft into the rows a goal is saved as (with `Goal.planning`), and
 *   `previewPlanner` runs the same planner the repo runs (`planGoalSlots`) over those rows, so the
 *   preview and the saved plan agree.
 * - `withTargetDate`, `withAddedTime` and `withoutUnitKeys` apply the three ways out of a plan that does
 *   not fit; each is verified by `checkFeasibility` before it is offered.
 */
import type {
  DateRange,
  Goal,
  ID,
  ISODate,
  Millis,
  Milestone,
  PlannedAssessment,
  SelfRating,
  Unit,
  UnitEstimateSource,
  WguTerm,
} from '@/db/types'
import { addDays, compareISODate, diffDays, isISODate } from './dates'
import type { PlanDraft } from './planImport/draft'
import { parsePlanText, type PlanParseResult } from './planParse'
import {
  availabilityFromGoal,
  clampSession,
  cloneAvailability,
  defaultAvailability,
  toGoalAvailability,
  validateAvailability,
  withExtraMinutes,
  type AvailabilityDraft,
} from './plannerAvailability'
import { courseBaseMinutes, resolveEffort, type EffortBy, type EffortResult } from './plannerEffort'
import { DEFAULT_BUFFER_PCT, DEFAULT_CU_HOURS_MULTIPLIER } from './scheduler/effort'
import { planGoalSlots, type SlotPlan } from './scheduler/goalSlots'
import type { PlanItem } from './scheduler/plannerTypes'
import {
  templateById,
  templateFinish,
  templatePlanDraft,
  type GoalTemplate,
  type TemplateId,
} from './goalTemplates'

// ─── Types ──────────────────────────────────────────────────────────────────

export const DRAFT_VERSION = 1

export type DraftSource = 'blank' | 'template' | 'paste' | 'pdf' | 'claude' | 'typed'
export type AssessmentKind = 'exam' | 'project' | 'quiz'
export type CourseTypeValue = '' | 'OA' | 'PA' | 'OA+PA'

export interface PlannerUnit {
  key: string
  title: string
  /** The unit's own estimate in minutes before the self-rating; `null` = shares the course's hours. */
  minutes: number | null
  /** `null` = the course's rating. */
  rating: SelfRating | null
  optional: boolean
}

export interface PlannerAssessmentDraft {
  key: string
  title: string
  kind: AssessmentKind
  date: ISODate | null
}

export interface PlannerCourse {
  key: string
  code: string
  title: string
  cus: number | null
  hours: number | null
  /** Which of `hours` and `cus` is the course's budget. */
  effortBy: EffortBy
  courseType: CourseTypeValue
  rating: SelfRating
  /** Keys of earlier courses that come first. */
  prerequisiteKeys: string[]
  units: PlannerUnit[]
  assessments: PlannerAssessmentDraft[]
}

export interface UnparsedLine {
  line: number
  text: string
}

export interface PlannerDraft {
  v: typeof DRAFT_VERSION
  source: DraftSource
  templateId: TemplateId | null
  /** The start date a template's dates were worked out from, so a later start can offer to shift them. */
  templateStart: ISODate | null
  title: string
  icon: string
  kind: Goal['kind']
  /** A typed goal's longer description; saved as the goal's first note. */
  description: string
  /** The text pasted or read from a PDF, so a refresh keeps it. */
  sourceText: string
  /** The text the courses below were last read from (`sourceText` differs once it is edited). */
  readText: string
  courses: PlannerCourse[]
  /** "We couldn't read these lines". */
  unparsed: UnparsedLine[]
  needsBreakdown: boolean
  targetMode: 'date' | 'asap'
  targetDate: ISODate | null
  startDate: ISODate
  availability: AvailabilityDraft
  /** Hours per competency unit. */
  cuMultiplier: number
  /** Share of the work kept as slack, 0.10–0.15 in the UI. */
  bufferPct: number
  /** Save a six-month WGU term on the goal (start → target). */
  wguTerm: boolean
}

export const STEP_NAMES = [
  'Start',
  'When',
  'Availability',
  'Effort',
  'Review',
  'Preview',
  'Confirm',
] as const
export type PlannerStep = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const LAST_STEP: PlannerStep = 6

export const DEFAULT_ICON = '🎯'
export const TITLE_MAX = 120
export const UNITS_MAX = 80
export const RATINGS: readonly SelfRating[] = ['know', 'somewhat', 'new']
export const RATING_LABELS: Readonly<Record<SelfRating, string>> = {
  know: 'Know it',
  somewhat: 'Somewhat',
  new: 'New to me',
}

export function emptyPlannerDraft(today: ISODate): PlannerDraft {
  return {
    v: DRAFT_VERSION,
    source: 'blank',
    templateId: null,
    templateStart: null,
    title: '',
    icon: DEFAULT_ICON,
    kind: 'custom',
    description: '',
    sourceText: '',
    readText: '',
    courses: [],
    unparsed: [],
    needsBreakdown: false,
    targetMode: 'date',
    targetDate: null,
    startDate: today,
    availability: defaultAvailability(),
    cuMultiplier: DEFAULT_CU_HOURS_MULTIPLIER,
    bufferPct: DEFAULT_BUFFER_PCT,
    wguTerm: false,
  }
}

export function emptyCourse(key: string): PlannerCourse {
  return {
    key,
    code: '',
    title: '',
    cus: null,
    hours: null,
    effortBy: 'hours',
    courseType: '',
    rating: 'new',
    prerequisiteKeys: [],
    units: [],
    assessments: [],
  }
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Whether the draft still holds nothing the person typed (so a saved copy need not be kept). */
export function isPristine(draft: PlannerDraft, today: ISODate): boolean {
  const base = emptyPlannerDraft(today)
  return (
    draft.courses.length === 0 &&
    draft.title === '' &&
    draft.sourceText === '' &&
    draft.description === '' &&
    draft.unparsed.length === 0 &&
    draft.templateId === null &&
    draft.targetDate === null &&
    draft.targetMode === base.targetMode &&
    JSON.stringify(draft.availability) === JSON.stringify(base.availability)
  )
}

// ─── Filling the draft ──────────────────────────────────────────────────────

export interface FillOptions {
  source: DraftSource
  newKey: () => string
  today: ISODate
  /** Keep the title already typed instead of the plan's. */
  keepTitle?: boolean
}

/**
 * A parsed plan (a pasted syllabus, Claude's JSON or a template) as the draft's courses and dates. The
 * availability is left as it is. Everything is only a starting point: the review screen edits it.
 */
export function applyPlanDraft(
  base: PlannerDraft,
  plan: PlanDraft,
  opts: FillOptions,
): PlannerDraft {
  const keyByCode = new Map<string, string>()
  const courses = plan.courses.map((c): PlannerCourse => {
    const key = opts.newKey()
    const code = clean(c.code ?? '')
    if (code !== '') keyByCode.set(code.toLowerCase(), key)
    const hours = c.estimatedHours ?? null
    const cus = c.cus ?? null
    return {
      key,
      code,
      title: clean(c.title),
      cus,
      hours,
      effortBy: hours !== null ? 'hours' : cus !== null ? 'cus' : 'hours',
      courseType: c.type ?? '',
      rating: 'new',
      prerequisiteKeys: [],
      units: c.units.map((u) => ({
        key: opts.newKey(),
        title: clean(u.title),
        minutes: u.estimatedMinutes ?? null,
        rating: null,
        optional: false,
      })),
      assessments: c.assessments.map((a) => ({
        key: opts.newKey(),
        title: clean(a.title),
        kind: a.kind,
        date: a.date ?? null,
      })),
    }
  })
  // Prerequisites name earlier courses by code.
  plan.courses.forEach((c, i) => {
    const target = courses[i]
    if (!target) return
    target.prerequisiteKeys = (c.prerequisites ?? []).flatMap((code) => {
      const key = keyByCode.get(code.toLowerCase())
      const at = courses.findIndex((x) => x.key === key)
      return key !== undefined && at !== -1 && at < i ? [key] : []
    })
  })

  let startDate = base.startDate
  let targetDate = base.targetDate
  let targetMode = base.targetMode
  let wguTerm = base.wguTerm
  const { goal } = plan
  if (goal.term) {
    if (compareISODate(goal.term.start, opts.today) > 0) startDate = goal.term.start
    wguTerm = courses.some((c) => c.cus !== null)
    targetDate = goal.term.end
    targetMode = 'date'
  }
  if (goal.targetDate && compareISODate(goal.targetDate, startDate) > 0) {
    targetDate = goal.targetDate
    targetMode = 'date'
  }
  return {
    ...base,
    source: opts.source,
    title: opts.keepTitle && clean(base.title) !== '' ? base.title : clean(goal.title),
    icon: goal.icon ?? base.icon,
    kind: courses.some((c) => c.cus !== null || c.courseType !== '') ? 'degree' : base.kind,
    courses,
    unparsed: [],
    needsBreakdown: false,
    // Only `applyTemplate` knows the dates came from a template (it sets this after filling).
    templateStart: null,
    startDate,
    targetDate,
    targetMode,
    wguTerm,
  }
}

/** A parse result (`parsePlanText`) as the draft, with the lines it could not read. */
export function applyParse(
  base: PlannerDraft,
  parsed: PlanParseResult,
  opts: FillOptions,
): PlannerDraft {
  const filled = applyPlanDraft(base, parsed.draft, opts)
  return {
    ...filled,
    unparsed: parsed.unparsed.map((u) => ({ line: u.line, text: u.text })),
    needsBreakdown: parsed.needsBreakdown,
  }
}

/** Reads pasted or PDF text into the draft's courses (replacing them). */
export function readSourceText(
  base: PlannerDraft,
  text: string,
  opts: FillOptions & { source: 'paste' | 'pdf' },
): PlannerDraft {
  const parsed = parsePlanText(text, { today: opts.today })
  return { ...applyParse(base, parsed, opts), sourceText: text, readText: text }
}

/** A typed goal ("Learn conversational Spanish by June 2027") as one course that still needs a breakdown. */
export function readTypedGoal(base: PlannerDraft, opts: Omit<FillOptions, 'source'>): PlannerDraft {
  const title = clean(base.title)
  if (title === '') return base
  const parsed = parsePlanText(title, { today: opts.today })
  const filled = applyParse(base, parsed, { ...opts, source: 'typed' })
  return { ...filled, description: base.description, sourceText: '', readText: '' }
}

const normalizeSource = (text: string): string => text.replace(/\r\n?/g, '\n').trim()

/**
 * Whether the pasted or PDF text was edited since the courses were last read from it. Only a real edit
 * counts: line endings and whitespace around the text do not.
 */
export function sourceChanged(draft: PlannerDraft): boolean {
  if (draft.source !== 'paste' && draft.source !== 'pdf') return false
  const text = normalizeSource(draft.sourceText)
  return text !== '' && text !== normalizeSource(draft.readText)
}

/** The parts of an outline a person edits, without keys (which differ on every read). */
function outlineSignature(draft: Pick<PlannerDraft, 'courses' | 'title' | 'unparsed'>): string {
  const index = new Map(draft.courses.map((c, i) => [c.key, i]))
  return JSON.stringify([
    clean(draft.title),
    draft.unparsed.map((u) => [u.line, u.text]),
    draft.courses.map((c) => [
      c.code,
      c.title,
      c.cus,
      c.hours,
      c.effortBy,
      c.courseType,
      c.rating,
      c.prerequisiteKeys.map((k) => index.get(k) ?? -1),
      c.units.map((u) => [u.title, u.minutes, u.rating, u.optional]),
      c.assessments.map((a) => [a.title, a.kind, a.date]),
    ]),
  ])
}

/**
 * Whether the courses differ from what reading `readText` gives: edited, reordered or deleted rows, hours,
 * ratings, dates. Reading the text again would throw those away, so the caller asks first.
 */
export function hasReviewEdits(draft: PlannerDraft, today: ISODate): boolean {
  let n = 0
  const fresh = readSourceText(emptyPlannerDraft(today), draft.readText, {
    source: draft.source === 'pdf' ? 'pdf' : 'paste',
    newKey: () => `k${n++}`,
    today,
  })
  return outlineSignature(fresh) !== outlineSignature(draft)
}

/** A template as the draft: its courses and dates, its suggested weekly windows and session length. */
export function applyTemplate(
  base: PlannerDraft,
  template: GoalTemplate,
  opts: Omit<FillOptions, 'source'>,
): PlannerDraft {
  const start = base.startDate
  const filled = applyPlanDraft(base, templatePlanDraft(template, start), {
    ...opts,
    source: 'template',
  })
  const availability: AvailabilityDraft = {
    ...cloneAvailability(base.availability),
    weekly: Array.from({ length: 7 }, (_, d) =>
      (template.weekly[d] ?? []).map((w) => ({ start: w.start, end: w.end })),
    ),
    sessionMinutes: clampSession(template.sessionMinutes),
    shift: null,
  }
  return {
    ...filled,
    templateId: template.id,
    templateStart: start,
    icon: template.icon,
    kind: template.kind,
    availability,
    targetMode: 'date',
    targetDate: templateFinish(template, start),
    wguTerm: template.term,
    needsBreakdown: false,
  }
}

/** Templates by id, for the picker. */
export { templateById }

// ─── Effort ─────────────────────────────────────────────────────────────────

export interface CourseEffort extends EffortResult {
  key: string
  /** The course's budget before the rating, when it has one. */
  budgetMinutes: number | null
}

/** Minutes per unit for one course under the draft's multiplier. */
export function courseEffort(c: PlannerCourse, multiplier: number): CourseEffort {
  const budgetMinutes = courseBaseMinutes({
    hours: c.hours,
    cus: c.cus,
    effortBy: c.effortBy,
    multiplier,
  })
  const r = resolveEffort(
    budgetMinutes,
    c.rating,
    c.units.map((u) => ({ baseMinutes: u.minutes, rating: u.rating })),
  )
  return { ...r, key: c.key, budgetMinutes }
}

export function draftEffort(draft: PlannerDraft): {
  courses: CourseEffort[]
  totalMinutes: number
} {
  const courses = draft.courses.map((c) => courseEffort(c, draft.cuMultiplier))
  return { courses, totalMinutes: courses.reduce((n, c) => n + c.totalMinutes, 0) }
}

/** The unit minutes each unit would get from the course's budget, written down (so removing one keeps the rest). */
function freezeShares(c: PlannerCourse, multiplier: number): PlannerCourse {
  if (c.units.every((u) => u.minutes !== null) || c.units.length === 0) return c
  const e = courseEffort(c, multiplier)
  return {
    ...c,
    units: c.units.map((u, i) =>
      u.minutes !== null ? u : { ...u, minutes: e.units[i]?.baseMinutes ?? 0 },
    ),
  }
}

/**
 * Units with no estimate of their own get `hours` each (the "fill blanks" button), for courses that have
 * no hours or CUs to share. Courses with a budget keep sharing it.
 */
export function fillBlankUnits(draft: PlannerDraft, hours: number): PlannerDraft {
  const minutes = Math.round(hours * 60)
  return {
    ...draft,
    courses: draft.courses.map((c) => {
      if (courseBaseMinutes({ hours: c.hours, cus: c.cus, effortBy: c.effortBy }) !== null) return c
      return { ...c, units: c.units.map((u) => (u.minutes === null ? { ...u, minutes } : u)) }
    }),
  }
}

/** Courses whose plan would have no study time (nothing to estimate yet). */
export function coursesWithoutEffort(draft: PlannerDraft): PlannerCourse[] {
  return draft.courses.filter((c) => courseEffort(c, draft.cuMultiplier).totalMinutes <= 0)
}

// ─── Reducer ────────────────────────────────────────────────────────────────

export interface PlannerState {
  draft: PlannerDraft
  step: PlannerStep
  /** The furthest step reached, so earlier steps stay reachable from the step bar. */
  reached: PlannerStep
  /** "Continue" was pressed on a step with problems: show them. Cleared when the step changes. */
  attempted: boolean
}

export type DraftPatch = Partial<
  Pick<
    PlannerDraft,
    | 'title'
    | 'icon'
    | 'kind'
    | 'sourceText'
    | 'readText'
    | 'description'
    | 'targetMode'
    | 'targetDate'
    | 'startDate'
    | 'cuMultiplier'
    | 'bufferPct'
    | 'wguTerm'
    | 'needsBreakdown'
    | 'source'
    | 'templateId'
  >
>

export type PlannerAction =
  | { type: 'patch'; patch: DraftPatch }
  | { type: 'availability'; availability: AvailabilityDraft }
  | { type: 'replaceDraft'; draft: PlannerDraft; step?: PlannerStep }
  | { type: 'go'; step: PlannerStep }
  | { type: 'attempt' }
  | { type: 'addCourse'; key: string }
  | {
      type: 'insertCourse'
      index: number
      course: PlannerCourse
      /** Courses that required this one before it was deleted; the requirement comes back. */
      dependents?: readonly string[]
    }
  | {
      type: 'patchCourse'
      key: string
      patch: Partial<Omit<PlannerCourse, 'key' | 'units' | 'assessments'>>
    }
  | { type: 'removeCourse'; key: string }
  | {
      type: 'reorderCourses'
      keys: readonly string[]
      /** Requirements to put back (by course key) before the order is applied (Undo of a reorder). */
      prerequisites?: Readonly<Record<string, readonly string[]>>
    }
  | { type: 'replaceCourse'; course: PlannerCourse }
  | { type: 'addUnit'; courseKey: string; key: string; title?: string; minutes?: number | null }
  | { type: 'patchUnit'; courseKey: string; key: string; patch: Partial<Omit<PlannerUnit, 'key'>> }
  | { type: 'removeUnit'; courseKey: string; key: string }
  | {
      type: 'insertUnit'
      courseKey: string
      index: number
      unit: PlannerUnit
      /** Siblings' minutes that `removeUnit` wrote down (by key); they share again if still untouched. */
      thaw?: Readonly<Record<string, number>>
    }
  | { type: 'reorderUnits'; courseKey: string; keys: readonly string[] }
  | { type: 'setCourseRating'; courseKey: string; rating: SelfRating }
  | { type: 'addAssessment'; courseKey: string; key: string; kind?: AssessmentKind }
  | {
      type: 'patchAssessment'
      courseKey: string
      key: string
      patch: Partial<Omit<PlannerAssessmentDraft, 'key'>>
    }
  | { type: 'removeAssessment'; courseKey: string; key: string }
  | { type: 'insertAssessment'; courseKey: string; index: number; assessment: PlannerAssessmentDraft }
  | { type: 'dismissUnparsed'; line: number }
  | {
      type: 'unparsedToUnit'
      line: number
      courseKey: string | null
      courseKeyNew: string
      unitKey: string
    }

export function initialPlannerState(today: ISODate): PlannerState {
  return { draft: emptyPlannerDraft(today), step: 0, reached: 0, attempted: false }
}

/** Items in the order of `keys` (unknown ignored, unlisted kept after). */
function orderBy<T extends { key: string }>(list: readonly T[], keys: readonly string[]): T[] {
  const byKey = new Map(list.map((x) => [x.key, x]))
  const listed = [...new Set(keys)].flatMap((k) => {
    const x = byKey.get(k)
    return x ? [x] : []
  })
  return [...listed, ...list.filter((x) => !keys.includes(x.key))]
}

/** Keeps only prerequisites that still name an earlier course. */
export function pruneStalePrerequisites(courses: readonly PlannerCourse[]): PlannerCourse[] {
  const earlier = new Set<string>()
  return courses.map((c) => {
    const kept = c.prerequisiteKeys.filter((k) => earlier.has(k))
    earlier.add(c.key)
    return kept.length === c.prerequisiteKeys.length ? c : { ...c, prerequisiteKeys: kept }
  })
}

/** What Undo needs to put a deleted course back exactly: where it was and who required it. */
export function courseRemovalUndo(
  courses: readonly PlannerCourse[],
  key: string,
): { index: number; course: PlannerCourse; dependents: string[] } | null {
  const index = courses.findIndex((c) => c.key === key)
  const course = courses[index]
  if (!course) return null
  return {
    index,
    course,
    dependents: courses.filter((c) => c.prerequisiteKeys.includes(key)).map((c) => c.key),
  }
}

/** What Undo needs to put a deleted unit back: its place, and the minutes deleting it wrote into siblings. */
export function unitRemovalUndo(
  draft: PlannerDraft,
  courseKey: string,
  unitKey: string,
): { index: number; unit: PlannerUnit; thaw: Record<string, number> } | null {
  const course = draft.courses.find((c) => c.key === courseKey)
  const index = course ? course.units.findIndex((u) => u.key === unitKey) : -1
  const unit = course?.units[index]
  if (!course || !unit) return null
  const frozen = freezeShares(course, draft.cuMultiplier)
  const thaw: Record<string, number> = {}
  course.units.forEach((u, i) => {
    const minutes = frozen.units[i]?.minutes
    if (u.key !== unitKey && u.minutes === null && minutes !== null && minutes !== undefined)
      thaw[u.key] = minutes
  })
  return { index, unit, thaw }
}

export interface PrerequisiteLoss {
  courseKey: string
  /** The requirements the course had before the reorder (all of them, so Undo can put them back). */
  before: string[]
  /** The ones that no longer name an earlier course. */
  lost: string[]
}

/** The courses that would lose a prerequisite if the courses were put in the order of `keys`. */
export function prerequisiteLossesByOrder(
  courses: readonly PlannerCourse[],
  keys: readonly string[],
): PrerequisiteLoss[] {
  const after = pruneStalePrerequisites(orderBy(courses, keys))
  return after.flatMap((c) => {
    const old = courses.find((x) => x.key === c.key)
    if (!old || old.prerequisiteKeys.length === c.prerequisiteKeys.length) return []
    return [
      {
        courseKey: c.key,
        before: [...old.prerequisiteKeys],
        lost: old.prerequisiteKeys.filter((k) => !c.prerequisiteKeys.includes(k)),
      },
    ]
  })
}

const mapCourse = (
  courses: readonly PlannerCourse[],
  key: string,
  fn: (c: PlannerCourse) => PlannerCourse,
): PlannerCourse[] => courses.map((c) => (c.key === key ? fn(c) : c))

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  const { draft } = state
  const set = (next: PlannerDraft): PlannerState => ({ ...state, draft: next })
  const setCourses = (courses: PlannerCourse[]): PlannerState => set({ ...draft, courses })
  switch (action.type) {
    case 'patch':
      return set({ ...draft, ...action.patch })
    case 'availability':
      return set({ ...draft, availability: action.availability })
    case 'replaceDraft': {
      const step = action.step ?? state.step
      return {
        draft: action.draft,
        step,
        reached: Math.max(state.reached, step) as PlannerStep,
        attempted: false,
      }
    }
    case 'go':
      return {
        ...state,
        step: action.step,
        reached: Math.max(state.reached, action.step) as PlannerStep,
        attempted: false,
      }
    case 'attempt':
      return { ...state, attempted: true }
    case 'addCourse':
      return setCourses([...draft.courses, emptyCourse(action.key)])
    case 'insertCourse': {
      const at = Math.max(0, Math.min(draft.courses.length, action.index))
      const next = [...draft.courses]
      next.splice(at, 0, action.course)
      const back = new Set(action.dependents ?? [])
      const restored = next.map((c, i) =>
        back.has(c.key) && i > at && !c.prerequisiteKeys.includes(action.course.key)
          ? { ...c, prerequisiteKeys: [...c.prerequisiteKeys, action.course.key] }
          : c,
      )
      return setCourses(pruneStalePrerequisites(restored))
    }
    case 'patchCourse':
      return setCourses(mapCourse(draft.courses, action.key, (c) => ({ ...c, ...action.patch })))
    case 'removeCourse':
      return setCourses(pruneStalePrerequisites(draft.courses.filter((c) => c.key !== action.key)))
    case 'reorderCourses': {
      const given = action.prerequisites
      const base = given
        ? draft.courses.map((c) => {
            const keys = given[c.key]
            return keys ? { ...c, prerequisiteKeys: [...keys] } : c
          })
        : draft.courses
      return setCourses(pruneStalePrerequisites(orderBy(base, action.keys)))
    }
    case 'replaceCourse':
      return setCourses(mapCourse(draft.courses, action.course.key, () => action.course))
    case 'addUnit':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          units: [
            ...c.units,
            {
              key: action.key,
              title: action.title ?? '',
              minutes: action.minutes ?? null,
              rating: null,
              optional: false,
            },
          ],
        })),
      )
    case 'patchUnit':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          units: c.units.map((u) => (u.key === action.key ? { ...u, ...action.patch } : u)),
        })),
      )
    case 'removeUnit':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => {
          const frozen = freezeShares(c, draft.cuMultiplier)
          return { ...frozen, units: frozen.units.filter((u) => u.key !== action.key) }
        }),
      )
    case 'insertUnit':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => {
          if (c.units.some((u) => u.key === action.unit.key)) return c
          const thaw = action.thaw ?? {}
          const units = c.units.map((u) =>
            thaw[u.key] !== undefined && u.minutes === thaw[u.key] ? { ...u, minutes: null } : u,
          )
          units.splice(Math.max(0, Math.min(units.length, action.index)), 0, action.unit)
          return { ...c, units }
        }),
      )
    case 'reorderUnits':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          units: orderBy(c.units, action.keys),
        })),
      )
    case 'setCourseRating':
      // Units that follow the course (`rating: null`) follow the new rating; a unit the person rated on
      // its own keeps its rating. (Every unit used to be reset here, which threw those choices away.)
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({ ...c, rating: action.rating })),
      )
    case 'addAssessment':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          assessments: [
            ...c.assessments,
            { key: action.key, title: '', kind: action.kind ?? 'exam', date: null },
          ],
        })),
      )
    case 'patchAssessment':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          assessments: c.assessments.map((a) =>
            a.key === action.key ? { ...a, ...action.patch } : a,
          ),
        })),
      )
    case 'removeAssessment':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => ({
          ...c,
          assessments: c.assessments.filter((a) => a.key !== action.key),
        })),
      )
    case 'insertAssessment':
      return setCourses(
        mapCourse(draft.courses, action.courseKey, (c) => {
          if (c.assessments.some((a) => a.key === action.assessment.key)) return c
          const assessments = [...c.assessments]
          assessments.splice(
            Math.max(0, Math.min(assessments.length, action.index)),
            0,
            action.assessment,
          )
          return { ...c, assessments }
        }),
      )
    case 'dismissUnparsed':
      return set({ ...draft, unparsed: draft.unparsed.filter((u) => u.line !== action.line) })
    case 'unparsedToUnit': {
      const line = draft.unparsed.find((u) => u.line === action.line)
      if (!line) return state
      const unparsed = draft.unparsed.filter((u) => u.line !== action.line)
      const title = clean(line.text)
      const target =
        draft.courses.find((c) => c.key === action.courseKey) ??
        draft.courses[draft.courses.length - 1]
      if (!target) {
        const course: PlannerCourse = {
          ...emptyCourse(action.courseKeyNew),
          title: clean(draft.title) || 'My goal',
          units: [{ key: action.unitKey, title, minutes: null, rating: null, optional: false }],
        }
        return set({ ...draft, unparsed, courses: [course] })
      }
      return set({
        ...draft,
        unparsed,
        courses: mapCourse(draft.courses, target.key, (c) => ({
          ...c,
          units: [
            ...c.units,
            { key: action.unitKey, title, minutes: null, rating: null, optional: false },
          ],
        })),
      })
    }
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type DraftErrors = Record<string, string>

export function validateStart(draft: PlannerDraft): DraftErrors {
  if (draft.courses.length === 0) {
    return {
      courses:
        'Add something to plan: pick a template, paste a course list, or type what you are working toward.',
    }
  }
  return {}
}

export interface EarlyAssessment {
  courseKey: string
  key: string
  title: string
  date: ISODate
}

/** Assessments dated before the start date (earliest first): nothing can be studied for them. */
export function assessmentsBeforeStart(draft: PlannerDraft): EarlyAssessment[] {
  if (!isISODate(draft.startDate)) return []
  return draft.courses
    .flatMap((c) =>
      c.assessments.flatMap((a) =>
        a.date !== null && isISODate(a.date) && compareISODate(a.date, draft.startDate) < 0
          ? [{ courseKey: c.key, key: a.key, title: a.title || 'Untitled assessment', date: a.date }]
          : [],
      ),
    )
    .sort((a, b) => compareISODate(a.date, b.date))
}

/**
 * How many days later (or earlier) the start is than the one a template's dates were worked out from; 0
 * when the draft is not from a template, or its dates already follow the start.
 */
export function templateShiftDays(draft: PlannerDraft): number {
  if (draft.templateId === null || draft.templateStart === null) return 0
  if (!isISODate(draft.startDate) || !isISODate(draft.templateStart)) return 0
  return diffDays(draft.startDate, draft.templateStart)
}

/**
 * The template's dates moved with the start: the target date and every assessment date shift by
 * `templateShiftDays`, and the draft remembers the new start so the offer goes away.
 */
export function shiftTemplateDates(draft: PlannerDraft): PlannerDraft {
  const days = templateShiftDays(draft)
  if (days === 0) return draft
  const move = (d: ISODate | null): ISODate | null => (d === null ? null : addDays(d, days))
  return {
    ...draft,
    templateStart: draft.startDate,
    targetDate: draft.targetMode === 'date' ? move(draft.targetDate) : draft.targetDate,
    courses: draft.courses.map((c) => ({
      ...c,
      assessments: c.assessments.map((a) => ({ ...a, date: move(a.date) })),
    })),
  }
}

export function validateWhen(draft: PlannerDraft, today: ISODate): DraftErrors {
  const errors: DraftErrors = {}
  const early = assessmentsBeforeStart(draft)
  if (early.length > 0) {
    errors.assessmentDates = `${early.length === 1 ? '1 assessment is' : `${early.length} assessments are`} dated before your start date.`
  }
  if (!isISODate(draft.startDate)) errors.startDate = 'Pick a start date.'
  else if (compareISODate(draft.startDate, today) < 0) errors.startDate = 'Start today or later.'
  if (draft.targetMode === 'date') {
    if (draft.targetDate === null || !isISODate(draft.targetDate)) {
      errors.targetDate = 'Pick a finish date, or choose as fast as possible.'
    } else if (
      isISODate(draft.startDate) &&
      compareISODate(draft.targetDate, draft.startDate) <= 0
    ) {
      errors.targetDate = 'The finish date has to be after the start.'
    }
  }
  return errors
}

export function validateEffort(draft: PlannerDraft): DraftErrors {
  const errors: DraftErrors = {}
  for (const c of coursesWithoutEffort(draft)) {
    errors[`course:${c.key}`] = 'Add hours or CUs so there is something to schedule.'
  }
  return errors
}

export function validateReview(draft: PlannerDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (clean(draft.title) === '') errors.title = 'Give the goal a name.'
  else if (clean(draft.title).length > TITLE_MAX)
    errors.title = `Keep it under ${TITLE_MAX} characters.`
  if (draft.courses.length === 0) errors.courses = 'Add at least one course.'
  for (const c of draft.courses) {
    if (clean(c.title) === '' && clean(c.code) === '')
      errors[`course:${c.key}:title`] = 'Name the course.'
    if (c.units.length > UNITS_MAX) errors[`course:${c.key}:units`] = `At most ${UNITS_MAX} units.`
    for (const u of c.units) {
      if (clean(u.title) === '') errors[`unit:${u.key}`] = 'Name the unit, or delete it.'
    }
    for (const a of c.assessments) {
      if (a.date !== null && !isISODate(a.date))
        errors[`assessment:${a.key}`] = 'Pick a valid date.'
    }
  }
  return errors
}

/** What blocks moving on from `step` (empty = fine). */
export function validatePlannerStep(
  draft: PlannerDraft,
  step: PlannerStep,
  today: ISODate,
): DraftErrors {
  switch (step) {
    case 0:
      return validateStart(draft)
    case 1:
      return validateWhen(draft, today)
    case 2:
      return validateAvailability(draft.availability)
    case 3:
      return validateEffort(draft)
    case 4:
      return validateReview(draft)
    case 5:
      return {}
    case 6:
      return clean(draft.title) === '' ? { title: 'Give the goal a name.' } : {}
  }
}

/** The first step (0–4) with a problem, or `null` when the whole draft can be saved. */
export function firstInvalidStep(draft: PlannerDraft, today: ISODate): PlannerStep | null {
  for (const step of [0, 1, 2, 3, 4] as const) {
    if (Object.keys(validatePlannerStep(draft, step, today)).length > 0) return step
  }
  return null
}

// ─── Draft → rows ───────────────────────────────────────────────────────────

export interface PlannerRows {
  goal: Goal
  milestones: Milestone[]
  units: Unit[]
  plannedAssessments: PlannedAssessment[]
}

export interface RowsContext {
  today: ISODate
  now: Millis
  newId: () => ID
  /** Use the draft's own keys as ids (the preview, so options can name units). */
  useKeys?: boolean
  goalOrder?: number
}

/** Fractional hours that survive `hours × 60` in the scheduler's floor (a float error must not lose a grain). */
const hoursOf = (minutes: number): number => minutes / 60 + 1e-9

function estimateSource(
  draft: PlannerDraft,
  c: PlannerCourse,
  explicit: boolean,
): UnitEstimateSource {
  if (explicit) {
    if (draft.source === 'paste' || draft.source === 'pdf') return 'parsed'
    if (draft.source === 'claude') return 'import'
    return 'hours'
  }
  return c.effortBy === 'cus' && c.cus !== null ? 'cus' : 'course'
}

function assessmentSource(draft: PlannerDraft): PlannedAssessment['source'] {
  if (draft.source === 'paste' || draft.source === 'pdf') return 'syllabus'
  if (draft.source === 'claude') return 'import'
  if (draft.templateId === 'wgu-term') return 'wgu'
  return 'user'
}

/** The rows the draft saves as: a goal with its planning, courses, units and planned assessments. */
export function plannerRows(draft: PlannerDraft, ctx: RowsContext): PlannerRows {
  const id = (key: string): ID => (ctx.useKeys ? key : ctx.newId())
  const goalId = ctx.useKeys ? 'planner-preview' : ctx.newId()
  const av = toGoalAvailability(draft.availability)
  const asap = draft.targetMode === 'asap'
  const targetDate = asap ? null : draft.targetDate
  const term: WguTerm | null =
    draft.wguTerm && targetDate !== null
      ? {
          id: ctx.useKeys ? 'planner-term' : ctx.newId(),
          label: 'Term 1',
          start: draft.startDate,
          end: targetDate,
        }
      : null

  const idByKey = new Map<string, ID>()
  const milestones: Milestone[] = []
  const units: Unit[] = []
  const assessments: PlannedAssessment[] = []
  let assessmentOrder = 0

  draft.courses.forEach((c, order) => {
    const courseId = id(c.key)
    idByKey.set(c.key, courseId)
    const effort = courseEffort(c, draft.cuMultiplier)
    const base = { createdAt: ctx.now, updatedAt: ctx.now }
    milestones.push({
      id: courseId,
      ...base,
      goalId,
      kind: 'course',
      code: clean(c.code) === '' ? null : clean(c.code),
      title: clean(c.title) || clean(c.code),
      icon: null,
      cover: null,
      status: 'todo',
      order,
      prerequisiteIds: c.prerequisiteKeys.flatMap((k) => {
        const dep = idByKey.get(k)
        return dep === undefined ? [] : [dep]
      }),
      // A course with units is planned from its units; one without from these hours.
      estimateHours: hoursOf(effort.totalMinutes),
      dueDate: null,
      cus: c.cus,
      courseType: c.courseType === '' ? null : c.courseType,
      termId: term?.id ?? null,
      notes: [],
      projectedStart: null,
      projectedEnd: null,
      completedAt: null,
      selfRating: c.rating,
    })
    c.units.forEach((u, i) => {
      const e = effort.units[i]
      units.push({
        id: id(u.key),
        ...base,
        goalId,
        milestoneId: courseId,
        title: clean(u.title),
        order: i,
        estimateMinutes: e?.minutes ?? 0,
        difficulty: 2,
        status: 'todo',
        completedAt: null,
        selfRating: u.rating ?? c.rating,
        estimateSource: estimateSource(draft, c, u.minutes !== null),
        baseEstimateMinutes: e?.baseMinutes ?? null,
        optional: u.optional,
      })
    })
    for (const a of c.assessments) {
      if (clean(a.title) === '') continue
      assessments.push({
        id: id(a.key),
        ...base,
        goalId,
        milestoneId: courseId,
        kind: a.kind,
        title: clean(a.title),
        date: a.date,
        time: null,
        durationMinutes: null,
        status: 'planned',
        completedAt: null,
        order: assessmentOrder++,
        source: assessmentSource(draft),
      })
    }
  })

  const goal: Goal = {
    id: goalId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    title: clean(draft.title),
    icon: draft.icon || DEFAULT_ICON,
    cover: null,
    kind: draft.kind,
    status: 'active',
    startDate: draft.startDate,
    targetDate,
    availability: av.availability,
    planning: {
      ...av.planning,
      bufferPct: draft.bufferPct,
      cuHoursMultiplier: draft.cuMultiplier,
      asap,
      paceMinutesPerStudyDay: null,
    },
    terms: term ? [term] : [],
    notes:
      clean(draft.description) === ''
        ? []
        : [{ id: id(`${goalId}:note`), type: 'p', text: draft.description.trim() }],
    order: ctx.goalOrder ?? 0,
    baselineEnd: null,
    projection: null,
    lastRebalancedOn: null,
    completedAt: null,
  }
  return { goal, milestones, units, plannedAssessments: assessments }
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * The plan the draft would produce today: the slot planner over the draft's rows with no tasks, the same
 * one `rebalanceGoal` runs when the goal is saved. Units are named by their draft keys.
 */
export function previewPlanner(
  draft: PlannerDraft,
  today: ISODate,
  opts: { globalDaysOff?: readonly DateRange[]; weekStartsOn?: 0 | 1 } = {},
): SlotPlan {
  const rows = plannerRows(draft, { today, now: 0, newId: () => 'unused', useKeys: true })
  return planGoalSlots(
    {
      goal: rows.goal,
      milestones: rows.milestones,
      units: rows.units,
      tasks: [],
      plannedAssessments: rows.plannedAssessments,
      globalDaysOff: opts.globalDaysOff ?? [],
      ...(opts.weekStartsOn !== undefined ? { weekStartsOn: opts.weekStartsOn } : {}),
    },
    today,
  )
}

export interface PlanStats {
  sessions: number
  reviews: number
  practiceTests: number
  milestones: number
  assessments: number
  workMinutes: number
  /** Whole weeks from the start to the projected end (at least 1). */
  weeks: number
  hoursPerWeek: number
  bufferPct: number
  bufferMinutes: number
}

/** Counts and pace for the preview cards. */
export function planStats(plan: SlotPlan, startDate: ISODate): PlanStats {
  const { items, totals, projectedEnd, buffer } = plan.result
  const count = (kind: PlanItem['kind']): number => items.filter((i) => i.kind === kind).length
  const days = projectedEnd === null ? 0 : Math.max(1, diffDays(projectedEnd, startDate) + 1)
  const weeks = Math.max(1, Math.ceil(days / 7))
  return {
    sessions: count('study'),
    reviews: count('review'),
    practiceTests: count('practiceTest'),
    milestones: count('milestone'),
    assessments: count('assessment'),
    workMinutes: totals.work,
    weeks,
    hoursPerWeek: Math.round((totals.work / 60 / weeks) * 10) / 10,
    bufferPct: buffer.pct,
    bufferMinutes: buffer.minutes,
  }
}

// ─── Ways out of a plan that does not fit ───────────────────────────────────

export function withTargetDate(draft: PlannerDraft, date: ISODate): PlannerDraft {
  return { ...draft, targetMode: 'date', targetDate: date }
}

export function withAddedTime(draft: PlannerDraft, minutes: number): PlannerDraft {
  return { ...draft, availability: withExtraMinutes(draft.availability, minutes) }
}

/**
 * The draft without these units (by key). A course whose every unit is cut goes too; a key that names a
 * course (the one hidden unit of a course without units) removes the course. The other units of a cut
 * course keep their hours: shares are written down first, so cutting really takes hours off.
 */
export function withoutUnitKeys(draft: PlannerDraft, keys: readonly string[]): PlannerDraft {
  const cut = new Set(keys)
  const courses: PlannerCourse[] = []
  for (const c of draft.courses) {
    if (cut.has(c.key)) continue
    if (!c.units.some((u) => cut.has(u.key))) {
      courses.push(c)
      continue
    }
    const frozen = freezeShares(c, draft.cuMultiplier)
    const units = frozen.units.filter((u) => !cut.has(u.key))
    if (units.length > 0) courses.push({ ...frozen, units })
  }
  return { ...draft, courses: pruneStalePrerequisites(courses) }
}

/** A readable name for a unit (or a course, for the hidden unit of a course without units) by draft key. */
export function unitLabel(draft: PlannerDraft, key: string): string {
  for (const c of draft.courses) {
    if (c.key === key) return c.code ? `${c.code} ${c.title}` : c.title
    const u = c.units.find((x) => x.key === key)
    if (u) return c.code ? `${c.code}: ${u.title}` : u.title
  }
  return key
}

// ─── From an existing goal (Plan settings) ──────────────────────────────────

export interface PlanSettingsDraft {
  targetMode: 'date' | 'asap'
  targetDate: ISODate | null
  availability: AvailabilityDraft
  cuMultiplier: number
  bufferPct: number
}

export function settingsFromGoal(
  goal: Pick<Goal, 'targetDate' | 'availability' | 'planning'>,
  newKey: () => string,
): PlanSettingsDraft {
  return {
    targetMode: goal.planning.asap || goal.targetDate === null ? 'asap' : 'date',
    targetDate: goal.targetDate,
    availability: availabilityFromGoal(goal, newKey),
    cuMultiplier: goal.planning.cuHoursMultiplier,
    bufferPct: goal.planning.bufferPct,
  }
}

export function validateSettings(s: PlanSettingsDraft, today: ISODate): DraftErrors {
  const errors: DraftErrors = { ...validateAvailability(s.availability) }
  if (s.targetMode === 'date') {
    if (s.targetDate === null || !isISODate(s.targetDate))
      errors.targetDate = 'Pick a finish date, or choose as fast as possible.'
    else if (compareISODate(s.targetDate, today) <= 0)
      errors.targetDate = 'Pick a date after today.'
  }
  return errors
}
