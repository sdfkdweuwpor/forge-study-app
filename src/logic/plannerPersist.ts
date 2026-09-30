/**
 * Keeping a half-finished planner draft across a refresh (pure). The state is stored as JSON in local
 * preferences; `restorePlanner` checks it with Zod, so a stale or damaged copy is dropped, never trusted.
 */
import { z } from 'zod'
import type { ISODate } from '@/db/types'
import { isISODate } from './dates'
import {
  DRAFT_VERSION,
  emptyPlannerDraft,
  type PlannerDraft,
  type PlannerState,
  type PlannerStep,
} from './plannerDraft'
import { clampSession, SHIFT_PRESET_IDS } from './plannerAvailability'

const isoDate = z.string().refine(isISODate)
const isoOrEmpty = z.union([z.literal(''), isoDate])
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/)
const windowSchema = z.object({ start: clock, end: clock })
const rating = z.enum(['know', 'somewhat', 'new'])

const unitSchema = z.object({
  key: z.string(),
  title: z.string(),
  minutes: z.number().nullable(),
  rating: rating.nullable(),
  optional: z.boolean(),
})
const assessmentSchema = z.object({
  key: z.string(),
  title: z.string(),
  kind: z.enum(['exam', 'project', 'quiz']),
  date: isoDate.nullable(),
})
const courseSchema = z.object({
  key: z.string(),
  code: z.string(),
  title: z.string(),
  cus: z.number().nullable(),
  hours: z.number().nullable(),
  effortBy: z.enum(['hours', 'cus']),
  courseType: z.enum(['', 'OA', 'PA', 'OA+PA']),
  rating,
  prerequisiteKeys: z.array(z.string()),
  units: z.array(unitSchema),
  assessments: z.array(assessmentSchema),
})
const availabilitySchema = z.object({
  weekly: z.array(z.array(windowSchema)).length(7),
  sessionMinutes: z.number(),
  blackouts: z.array(
    z.object({ key: z.string(), start: isoOrEmpty, end: isoOrEmpty, label: z.string() }),
  ),
  shift: z
    .object({
      preset: z.enum(SHIFT_PRESET_IDS as [string, ...string[]]),
      anchor: isoDate,
      onWindows: z.array(windowSchema),
      offWindows: z.array(windowSchema),
    })
    .nullable(),
})

const draftSchema = z.object({
  v: z.literal(DRAFT_VERSION),
  source: z.enum(['blank', 'template', 'paste', 'pdf', 'claude', 'typed']),
  templateId: z.enum(['wgu-term', 'certification', 'semester-course', 'personal-project']).nullable(),
  title: z.string(),
  icon: z.string(),
  kind: z.enum(['degree', 'certification', 'skill', 'custom']),
  sourceText: z.string(),
  courses: z.array(courseSchema),
  unparsed: z.array(z.object({ line: z.number(), text: z.string() })),
  needsBreakdown: z.boolean(),
  targetMode: z.enum(['date', 'asap']),
  targetDate: isoDate.nullable(),
  startDate: isoDate,
  availability: availabilitySchema,
  cuMultiplier: z.number().positive(),
  bufferPct: z.number().min(0).max(0.3),
  wguTerm: z.boolean(),
})

const stateSchema = z.object({
  draft: draftSchema,
  step: z.number().int().min(0).max(6),
  reached: z.number().int().min(0).max(6),
})

export function serializePlanner(state: PlannerState): string {
  return JSON.stringify({ draft: state.draft, step: state.step, reached: state.reached })
}

/**
 * The saved state, or `null` when there is none, it does not check out, or it is not from `today` onward
 * (a start date in the past is moved to today, so an old draft is still useful).
 */
export function restorePlanner(text: string | null, today: ISODate): PlannerState | null {
  if (text === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = stateSchema.safeParse(raw)
  if (!parsed.success) return null
  const draft = parsed.data.draft as unknown as PlannerDraft
  const base = emptyPlannerDraft(today)
  const startDate: ISODate = draft.startDate < today ? today : draft.startDate
  return {
    draft: {
      ...base,
      ...draft,
      startDate,
      availability: { ...draft.availability, sessionMinutes: clampSession(draft.availability.sessionMinutes) },
    },
    step: parsed.data.step as PlannerStep,
    reached: Math.max(parsed.data.step, parsed.data.reached) as PlannerStep,
    attempted: false,
  }
}
