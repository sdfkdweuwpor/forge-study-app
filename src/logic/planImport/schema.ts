/**
 * The "forgePlan" import format (BRIEF §5.4): the JSON Claude is asked to produce from a course
 * outline. One Zod schema is the single source of truth: it validates the paste, and `reference.ts`
 * generates the in-app schema reference, the error wording and the prompt from it, so they cannot drift.
 *
 * Strict but forgiving: strings are trimmed, numbers may arrive as strings ("40"), codes are
 * uppercased, and `type` is case-insensitive. Unknown keys are rejected (a typo such as `prereqs`
 * must not be silently dropped). Dates are `YYYY-MM-DD` and must exist on the calendar.
 *
 * Rules that span fields (unique codes, prerequisites, cycles) live in `relations.ts`, because Zod skips
 * object-level refinements while a child is invalid and we want every problem reported in one pass.
 */
import { z } from 'zod'

export const PLAN_VERSION = 1

/** Document keys read by `reference.ts` from the generated JSON Schema (Zod copies `.meta()` into it). */
interface FieldMeta {
  description: string
  /** Completes "<path> must be …" in an error message. Derived from the type when omitted. */
  expects?: string
  /** Completes "<path> …" when the field is missing. Defaults to "is required". */
  missing?: string
}

const meta = <T extends z.ZodType>(schema: T, m: FieldMeta): T => schema.meta({ ...m }) as T

/** `"40"` and `" 3.5 "` become numbers; anything else is left for the number schema to reject. */
const toNumber = (value: unknown): unknown =>
  typeof value === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(value) ? Number(value) : value

const toUpper = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

const looseNumber = <T extends z.ZodType>(inner: T) => z.preprocess(toNumber, inner)

const text = (max: number) => z.string().trim().min(1).max(max)

const isoDate = z.string().trim().pipe(z.iso.date())

/** "C182", "D278", "MATH 101": uppercase letters, digits and a few separators. */
export const COURSE_CODE = /^[A-Z0-9][A-Z0-9 ._-]{0,19}$/
const courseCode = z.string().trim().toUpperCase().regex(COURSE_CODE)

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]
const WEEKDAY_NAMES: Record<WeekdayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const dayHours = (day: WeekdayKey) =>
  meta(looseNumber(z.number().min(0).max(24)).optional(), {
    description: `Study hours on ${WEEKDAY_NAMES[day]}. 0 or left out means no study.`,
    expects: 'a number of hours from 0 to 24',
  })

const unitSchema = z
  .strictObject({
    title: meta(text(120), { description: 'Unit, chapter or topic name.' }),
    estimatedHours: meta(looseNumber(z.number().positive().max(200)).optional(), {
      description: 'Study hours for this unit. Give this or estimatedMinutes, not both.',
      expects: 'a positive number of hours',
    }),
    estimatedMinutes: meta(looseNumber(z.number().positive().max(12000)).optional(), {
      description: 'Study minutes for this unit. Give this or estimatedHours, not both.',
      expects: 'a positive number of minutes',
    }),
  })
  .superRefine((unit, ctx) => {
    if (unit.estimatedHours !== undefined && unit.estimatedMinutes !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'has both estimatedHours and estimatedMinutes; keep only one',
      })
    }
  })

const courseSchema = z.strictObject({
  code: meta(courseCode, {
    description: 'Course code, unique in the plan. Uppercased for you.',
    expects: 'a course code such as C182 (letters and digits, up to 20 characters)',
  }),
  name: meta(text(160), { description: 'Course title.' }),
  cus: meta(looseNumber(z.number().int().min(1).max(99)).optional(), {
    description: 'Competency units (WGU credit).',
    expects: 'a whole number of competency units from 1 to 99',
  }),
  type: meta(z.preprocess(toUpper, z.enum(['OA', 'PA'])).optional(), {
    description: 'OA = objective assessment (exam), PA = performance assessment (project).',
  }),
  estimatedHours: meta(looseNumber(z.number().positive().max(1000)), {
    description: 'Total study hours you expect this course to take.',
    expects: 'a positive number of hours',
  }),
  order: meta(looseNumber(z.number()).optional(), {
    description:
      'Position among the courses. Defaults to the place in this list. Only used for new courses.',
  }),
  prerequisites: meta(z.array(courseCode).max(30).optional(), {
    description: 'Codes of courses to finish first. Each must be in this plan.',
    expects: 'a list of course codes such as ["C182"]',
  }),
  targetDate: meta(isoDate.optional(), { description: 'Finish this course by this date.' }),
  units: meta(z.array(unitSchema).max(200).optional(), {
    description:
      'Chapters or topics in study order. When every unit has an estimate, their total is the course’s work.',
    expects: 'a list of units',
  }),
})

const termSchema = z
  .strictObject({
    start: meta(isoDate, { description: 'First day of the term.' }),
    end: meta(isoDate, {
      description: 'Last day of the term. Courses count toward its CUs unless they end later.',
    }),
  })
  .superRefine((term, ctx) => {
    if (term.end < term.start) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'must not be before term.start' })
    }
  })

const dayOffSchema = z
  .strictObject({
    from: meta(isoDate, { description: 'First day off.' }),
    to: meta(isoDate, { description: 'Last day off (inclusive).' }),
  })
  .superRefine((range, ctx) => {
    if (range.to < range.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must not be before "from"' })
    }
  })

const hoursPerWeekdaySchema = z
  .strictObject({
    mon: dayHours('mon'),
    tue: dayHours('tue'),
    wed: dayHours('wed'),
    thu: dayHours('thu'),
    fri: dayHours('fri'),
    sat: dayHours('sat'),
    sun: dayHours('sun'),
  })
  .superRefine((hours, ctx) => {
    if (!Object.values(hours).some((h) => typeof h === 'number' && h > 0)) {
      ctx.addIssue({ code: 'custom', message: 'needs at least one day with more than 0 hours' })
    }
  })

const availabilitySchema = z.strictObject({
  hoursPerWeekday: meta(hoursPerWeekdaySchema, {
    description: 'Study hours for each weekday. Days you leave out count as 0.',
    expects: 'an object with mon to sun hours',
  }),
  daysOff: meta(z.array(dayOffSchema).max(60).optional(), {
    description: 'Vacations and other days with no study, as inclusive date ranges.',
    expects: 'a list of { "from", "to" } date ranges',
  }),
})

const goalSchema = z.strictObject({
  name: meta(text(120), { description: 'Goal title, e.g. B.S. Computer Science — WGU.' }),
  icon: meta(text(16).optional(), { description: 'One emoji shown beside the title.' }),
  targetDate: meta(isoDate.optional(), {
    description: 'Finish-by date. Defaults to the term end when a term is given.',
  }),
  term: meta(termSchema.optional(), {
    description: 'The WGU term this plan covers (terms run six months).',
    expects: 'an object with start and end dates',
  }),
  availability: meta(availabilitySchema.optional(), {
    description: 'When you can study. Left out, the goal starts at 2 hours Monday to Friday.',
    expects: 'an object with hoursPerWeekday',
  }),
})

export const planSchema = z.strictObject({
  forgePlan: meta(looseNumber(z.literal(PLAN_VERSION)), {
    description: 'Format version. Always 1.',
    expects: '1',
    missing: 'is required: start the object with "forgePlan": 1',
  }),
  goal: meta(goalSchema, {
    description: 'The degree, certification or skill this plan belongs to.',
    expects: 'an object with the goal’s name',
  }),
  courses: meta(z.array(courseSchema).min(1).max(100), {
    description: 'Courses in the order you plan to take them.',
    expects: 'a list with 1 to 100 courses',
  }),
})

export type Plan = z.output<typeof planSchema>
export type PlanGoal = Plan['goal']
export type PlanCourse = Plan['courses'][number]
export type PlanUnit = NonNullable<PlanCourse['units']>[number]
