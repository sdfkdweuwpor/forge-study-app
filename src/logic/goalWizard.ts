/**
 * The wizard's state machine (pure): the draft, the current step, and the reducer that edits them. The
 * component only dispatches; `serializeWizard` / `restoreWizard` keep a half-finished draft across a
 * refresh (the stored text is checked with Zod, so a stale or damaged copy is dropped, never trusted).
 */
import { z } from 'zod'
import type { ISODate } from '@/db/types'
import type { Weekday } from './dates'
import {
  moveCourse,
  removeCourse,
  reorderCourses,
  setDayMinutes,
  setTermEnd,
  setTermStart,
  emptyDraft,
  type DraftCourse,
  type DraftGoal,
  type DraftRange,
  type WizardStep,
} from './goalDraft'

export interface WizardState {
  draft: DraftGoal
  step: WizardStep
  /** The furthest step reached, so earlier steps stay reachable from the step bar. */
  reached: WizardStep
  /** "Next" was pressed on a step with problems: show them. Cleared when the step changes. */
  attempted: boolean
}

export type BasicsPatch = Partial<
  Pick<DraftGoal, 'title' | 'icon' | 'coverPreset' | 'kind' | 'targetDate'>
>

export type WizardAction =
  | { type: 'patch'; patch: BasicsPatch }
  | { type: 'addCourse'; key: string }
  | { type: 'patchCourse'; key: string; patch: Partial<Omit<DraftCourse, 'key'>> }
  | { type: 'removeCourse'; key: string }
  | { type: 'moveCourse'; from: number; to: number }
  | { type: 'reorderCourses'; keys: readonly string[] }
  | { type: 'togglePrerequisite'; key: string; prerequisite: string }
  | { type: 'setDayMinutes'; weekday: Weekday; minutes: number }
  | { type: 'addRange'; key: string }
  | { type: 'patchRange'; key: string; patch: Partial<Omit<DraftRange, 'key'>> }
  | { type: 'removeRange'; key: string }
  | { type: 'setTermEnabled'; enabled: boolean }
  | { type: 'setTermLabel'; label: string }
  | { type: 'setTermStart'; start: ISODate }
  | { type: 'setTermEnd'; end: ISODate }
  /** Swap in a whole draft (the WGU template, or "undo" of that). */
  | { type: 'replace'; draft: DraftGoal; step?: WizardStep }
  | { type: 'go'; step: WizardStep }
  | { type: 'attempt' }

export function initialWizard(today: ISODate): WizardState {
  return { draft: emptyDraft(today), step: 0, reached: 0, attempted: false }
}

const LAST_STEP: WizardStep = 3

const clampStep = (n: number): WizardStep =>
  Math.max(0, Math.min(LAST_STEP, Math.round(n))) as WizardStep

function withDraft(state: WizardState, draft: DraftGoal): WizardState {
  return { ...state, draft }
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  const { draft } = state
  switch (action.type) {
    case 'patch':
      return withDraft(state, { ...draft, ...action.patch })
    case 'addCourse':
      return withDraft(state, {
        ...draft,
        courses: [
          ...draft.courses,
          {
            key: action.key,
            code: '',
            title: '',
            hours: '',
            cus: '',
            courseType: '',
            prerequisiteKeys: [],
            units: '',
          },
        ],
      })
    case 'patchCourse':
      return withDraft(state, {
        ...draft,
        courses: draft.courses.map((c) => (c.key === action.key ? { ...c, ...action.patch } : c)),
      })
    case 'removeCourse':
      return withDraft(state, { ...draft, courses: removeCourse(draft.courses, action.key) })
    case 'moveCourse':
      return withDraft(state, {
        ...draft,
        courses: moveCourse(draft.courses, action.from, action.to),
      })
    case 'reorderCourses':
      return withDraft(state, { ...draft, courses: reorderCourses(draft.courses, action.keys) })
    case 'togglePrerequisite':
      return withDraft(state, {
        ...draft,
        courses: draft.courses.map((c) => {
          if (c.key !== action.key) return c
          const has = c.prerequisiteKeys.includes(action.prerequisite)
          return {
            ...c,
            prerequisiteKeys: has
              ? c.prerequisiteKeys.filter((k) => k !== action.prerequisite)
              : [...c.prerequisiteKeys, action.prerequisite],
          }
        }),
      })
    case 'setDayMinutes':
      return withDraft(state, {
        ...draft,
        minutesByWeekday: setDayMinutes(draft.minutesByWeekday, action.weekday, action.minutes),
      })
    case 'addRange':
      return withDraft(state, {
        ...draft,
        daysOff: [...draft.daysOff, { key: action.key, start: '', end: '', label: '' }],
      })
    case 'patchRange':
      return withDraft(state, {
        ...draft,
        daysOff: draft.daysOff.map((r) => (r.key === action.key ? { ...r, ...action.patch } : r)),
      })
    case 'removeRange':
      return withDraft(state, {
        ...draft,
        daysOff: draft.daysOff.filter((r) => r.key !== action.key),
      })
    case 'setTermEnabled':
      return withDraft(state, { ...draft, term: { ...draft.term, enabled: action.enabled } })
    case 'setTermLabel':
      return withDraft(state, { ...draft, term: { ...draft.term, label: action.label } })
    case 'setTermStart':
      return withDraft(state, { ...draft, term: setTermStart(draft.term, action.start) })
    case 'setTermEnd':
      return withDraft(state, { ...draft, term: setTermEnd(draft.term, action.end) })
    case 'replace': {
      const step = action.step ?? 0
      return { draft: action.draft, step, reached: step, attempted: false }
    }
    case 'go': {
      const step = clampStep(action.step)
      return {
        ...state,
        step,
        reached: (step > state.reached ? step : state.reached) as WizardStep,
        attempted: false,
      }
    }
    case 'attempt':
      return state.attempted ? state : { ...state, attempted: true }
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoOrBlank = z.union([iso, z.literal('')])

const draftSchema = z.object({
  title: z.string().max(400),
  icon: z.string().max(16),
  coverPreset: z.string().max(40).nullable(),
  kind: z.enum(['degree', 'certification', 'skill', 'custom']),
  targetDate: iso.nullable(),
  courses: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        code: z.string().max(64),
        title: z.string().max(400),
        hours: z.string().max(16),
        cus: z.string().max(16),
        courseType: z.enum(['OA', 'PA', 'OA+PA', '']),
        prerequisiteKeys: z.array(z.string().max(64)).max(200),
        units: z.string().max(8000),
      }),
    )
    .max(200),
  minutesByWeekday: z.tuple([
    z.number().min(0).max(960),
    z.number().min(0).max(960),
    z.number().min(0).max(960),
    z.number().min(0).max(960),
    z.number().min(0).max(960),
    z.number().min(0).max(960),
    z.number().min(0).max(960),
  ]),
  daysOff: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        start: isoOrBlank,
        end: isoOrBlank,
        label: z.string().max(200),
      }),
    )
    .max(100),
  term: z.object({
    enabled: z.boolean(),
    label: z.string().max(200),
    start: iso,
    end: iso,
    endEdited: z.boolean(),
  }),
})

const storedSchema = z.object({
  v: z.literal(1),
  step: z.number().int().min(0).max(LAST_STEP),
  draft: draftSchema,
})

/** The text to keep across a refresh. */
export function serializeWizard(state: WizardState): string {
  return JSON.stringify({ v: 1, step: state.step, draft: state.draft })
}

/** A wizard rebuilt from stored text, or `null` when there is none or it is not a valid draft. */
export function restoreWizard(raw: string | null): WizardState | null {
  if (raw === null) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = storedSchema.safeParse(json)
  if (!parsed.success) return null
  const step = clampStep(parsed.data.step)
  return { draft: parsed.data.draft, step, reached: step, attempted: false }
}

/** Whether the draft differs from a fresh one (so "Start over" and the leave-warning matter). */
export function isPristine(draft: DraftGoal, today: ISODate): boolean {
  const fresh = emptyDraft(today)
  return (
    draft.title.trim() === '' &&
    draft.courses.length === 0 &&
    draft.targetDate === null &&
    draft.coverPreset === null &&
    draft.icon === fresh.icon &&
    draft.daysOff.length === 0 &&
    !draft.term.enabled &&
    draft.minutesByWeekday.every((m, i) => m === fresh.minutesByWeekday[i])
  )
}
