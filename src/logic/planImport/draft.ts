/**
 * The hand-off to the Goal Breakdown Planner's review screen. AI output always needs the user's
 * confirmation, so a parsed plan can become a `PlanDraft` that the planner lets the user edit, reorder and
 * delete before anything is scheduled. The planner imports this type from here.
 *
 * The draft is deliberately looser than a plan: a course may have no code or hours yet (the planner also
 * builds drafts by hand), and units and assessments are always lists. Fields the draft has no home for
 * (`order`, per-course `targetDate`, `availability`) are not carried; `order` is applied by sorting.
 */
import type { ISODate } from '@/db/types'
import { unitMinutes } from './mapping'
import type { AssessmentKind, Plan } from './schema'

export interface DraftUnit {
  title: string
  estimatedMinutes?: number
}

export interface DraftAssessment {
  title: string
  kind: AssessmentKind
  date?: ISODate
}

export interface DraftCourse {
  code?: string
  title: string
  cus?: number
  type?: 'OA' | 'PA'
  estimatedHours?: number
  /** Course codes. */
  prerequisites?: string[]
  units: DraftUnit[]
  assessments: DraftAssessment[]
}

export interface PlanDraft {
  goal: {
    title: string
    icon?: string
    targetDate?: ISODate
    term?: { start: ISODate; end: ISODate }
  }
  courses: DraftCourse[]
}

/**
 * A validated plan as an editable draft. Courses come out in the order the plan asks for (`order`, else
 * the place in the list); units keep their order. Optional fields the plan left out are absent, not `undefined`.
 */
export function toPlanDraft(plan: Plan): PlanDraft {
  const { name, icon, targetDate, term } = plan.goal
  const courses = plan.courses
    .map((course, index) => ({ course, index }))
    .sort((a, b) => (a.course.order ?? a.index) - (b.course.order ?? b.index) || a.index - b.index)
    .map(({ course: c }): DraftCourse => {
      const draft: DraftCourse = {
        title: c.name,
        code: c.code,
        estimatedHours: c.estimatedHours,
        units: (c.units ?? []).map((u) => {
          const minutes = unitMinutes(u)
          return minutes === null ? { title: u.title } : { title: u.title, estimatedMinutes: minutes }
        }),
        assessments: (c.assessments ?? []).map((a) =>
          a.date === undefined
            ? { title: a.title, kind: a.kind }
            : { title: a.title, kind: a.kind, date: a.date },
        ),
      }
      if (c.cus !== undefined) draft.cus = c.cus
      if (c.type !== undefined) draft.type = c.type
      if (c.prerequisites !== undefined) draft.prerequisites = [...c.prerequisites]
      return draft
    })

  return {
    goal: {
      title: name,
      ...(icon !== undefined ? { icon } : {}),
      ...(targetDate !== undefined ? { targetDate } : {}),
      ...(term !== undefined ? { term: { start: term.start, end: term.end } } : {}),
    },
    courses,
  }
}
