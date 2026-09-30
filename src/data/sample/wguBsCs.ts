/**
 * Sample goal: a WGU B.S. in Computer Science, with its first courses and the units of the ones being
 * worked on. Dates are relative to `today` (the seed passes the app's clock), so the data looks current
 * whenever it is loaded. Used by `src/dev/seed.ts`; not imported by the shipped app.
 */
import type {
  Availability,
  Goal,
  ID,
  ISODate,
  Milestone,
  Millis,
  PlannedAssessment,
  Unit,
} from '@/db/types'
import { addDays, addMonths, dayStartMs } from '@/logic/dates'
import { planningFromAvailability, wguPlannedAssessments } from '@/logic/schemaV2'

export const WGU_GOAL_ID: ID = 'goal-wgu-bscs'
export const WGU_TERM_ID: ID = 'term-1'

export type CourseCode = 'C182' | 'C779' | 'D278' | 'C172' | 'C959'

/** Stable ids so screenshots, e2e specs and links to sample data never change. */
export const COURSE_IDS: Readonly<Record<CourseCode, ID>> = {
  C182: 'course-c182',
  C779: 'course-c779',
  D278: 'course-d278',
  C172: 'course-c172',
  C959: 'course-c959',
}

export const unitId = (code: CourseCode, n: number): ID => `unit-${code.toLowerCase()}-${n}`

interface CourseSpec {
  code: CourseCode
  title: string
  status: Milestone['status']
  cus: number
  hours: number
  /** Days from today: when the course is (projected to be) finished. */
  endsIn: number
  /** Days from today: when work on it started (or will). */
  startsIn: number
  units: ReadonlyArray<{ title: string; minutes: number; done: boolean }>
}

const COURSES: readonly CourseSpec[] = [
  {
    code: 'C182',
    title: 'Introduction to IT',
    status: 'done',
    cus: 4,
    hours: 40,
    startsIn: -50,
    endsIn: -9,
    units: [
      { title: 'Hardware and operating systems', minutes: 300, done: true },
      { title: 'Networks and the internet', minutes: 300, done: true },
      { title: 'Programming and scripting concepts', minutes: 360, done: true },
      { title: 'Cloud and virtualization', minutes: 300, done: true },
      { title: 'Databases', minutes: 240, done: true },
      { title: 'Security and ethics', minutes: 300, done: true },
    ],
  },
  {
    code: 'C779',
    title: 'Web Development Foundations',
    status: 'active',
    cus: 3,
    hours: 30,
    startsIn: -8,
    endsIn: 16,
    units: [
      { title: 'HTML structure', minutes: 150, done: true },
      { title: 'CSS box model and selectors', minutes: 150, done: false },
      { title: 'CSS layout', minutes: 240, done: false },
      { title: 'JavaScript basics', minutes: 300, done: false },
      { title: 'DOM and events', minutes: 240, done: false },
      { title: 'Forms and accessibility', minutes: 180, done: false },
      { title: 'Responsive design', minutes: 180, done: false },
      { title: 'Practice assessment', minutes: 360, done: false },
    ],
  },
  {
    code: 'D278',
    title: 'Scripting and Programming Foundations',
    status: 'todo',
    cus: 4,
    hours: 45,
    startsIn: 17,
    endsIn: 45,
    units: [
      { title: 'Variables and expressions', minutes: 360, done: false },
      { title: 'Branching', minutes: 360, done: false },
      { title: 'Loops', minutes: 420, done: false },
      { title: 'Functions', minutes: 420, done: false },
      { title: 'Data structures', minutes: 480, done: false },
    ],
  },
  {
    code: 'C172',
    title: 'Network and Security Foundations',
    status: 'todo',
    cus: 4,
    hours: 50,
    startsIn: 46,
    endsIn: 82,
    units: [
      { title: 'Network models and protocols', minutes: 600, done: false },
      { title: 'Addressing and routing', minutes: 600, done: false },
      { title: 'Threats and defenses', minutes: 600, done: false },
      { title: 'Cryptography basics', minutes: 600, done: false },
      { title: 'Policy and risk', minutes: 600, done: false },
    ],
  },
  {
    code: 'C959',
    title: 'Discrete Mathematics I',
    status: 'todo',
    cus: 3,
    hours: 45,
    startsIn: 83,
    endsIn: 120,
    units: [
      { title: 'Logic and proofs', minutes: 540, done: false },
      { title: 'Sets and functions', minutes: 540, done: false },
      { title: 'Counting and probability', minutes: 540, done: false },
      { title: 'Graphs and trees', minutes: 540, done: false },
      { title: 'Recursion and induction', minutes: 540, done: false },
    ],
  },
]

export interface WguSample {
  goal: Goal
  milestones: Milestone[]
  units: Unit[]
  /** The OA of every course (undated; the finished course's is done). */
  plannedAssessments: PlannedAssessment[]
}

/** The goal, its five courses and their units, dated around `today` (`now` stamps the rows). */
export function buildWguBsCs(today: ISODate, now: Millis): WguSample {
  const termStart = addDays(today, -57)
  const termEnd = addDays(addMonths(termStart, 6), -1)
  // Sunday to Saturday: a lighter Sunday and Friday, a longer Saturday.
  const availability: Availability = {
    minutesByWeekday: [60, 90, 90, 90, 90, 60, 120],
    daysOff: [],
  }

  const goal: Goal = {
    id: WGU_GOAL_ID,
    createdAt: dayStartMs(termStart),
    updatedAt: now,
    title: 'B.S. Computer Science — WGU',
    icon: '🎓',
    cover: { kind: 'gradient', preset: 'sand' },
    kind: 'degree',
    status: 'active',
    startDate: termStart,
    targetDate: termEnd,
    availability,
    planning: planningFromAvailability(availability, termEnd, '09:00'),
    terms: [{ id: WGU_TERM_ID, label: 'Term 1', start: termStart, end: termEnd }],
    notes: [
      {
        id: 'goal-note-1',
        type: 'p',
        text: 'Target: finish all five courses this term. The mentor call on Thursdays is the check-in.',
      },
    ],
    order: 0,
    baselineEnd: addDays(termEnd, -6),
    projection: {
      end: addDays(termEnd, -9),
      slipDays: -9,
      feasible: true,
      catchUpMinutes: null,
      requiredMinutesPerStudyDay: null,
      issues: [],
      computedAt: now,
    },
    lastRebalancedOn: today,
    completedAt: null,
  }

  const milestones: Milestone[] = COURSES.map((c, order) => ({
    id: COURSE_IDS[c.code],
    createdAt: dayStartMs(termStart),
    updatedAt: now,
    goalId: WGU_GOAL_ID,
    kind: 'course',
    code: c.code,
    title: c.title,
    icon: null,
    cover: null,
    status: c.status,
    order,
    prerequisiteIds: [],
    estimateHours: c.hours,
    dueDate: addDays(today, c.endsIn),
    cus: c.cus,
    courseType: 'OA',
    termId: WGU_TERM_ID,
    notes: [],
    projectedStart: addDays(today, c.startsIn),
    projectedEnd: addDays(today, c.endsIn),
    completedAt: c.status === 'done' ? dayStartMs(addDays(today, c.endsIn)) + 15 * 3_600_000 : null,
    selfRating: null,
  }))

  const units: Unit[] = COURSES.flatMap((c) =>
    c.units.map((u, i) => ({
      id: unitId(c.code, i + 1),
      createdAt: dayStartMs(termStart),
      updatedAt: now,
      goalId: WGU_GOAL_ID,
      milestoneId: COURSE_IDS[c.code],
      title: u.title,
      order: i,
      estimateMinutes: u.minutes,
      difficulty: (i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3) as Unit['difficulty'],
      status: u.done ? ('done' as const) : ('todo' as const),
      completedAt: u.done
        ? dayStartMs(addDays(today, Math.min(-1, c.startsIn + i * 3))) + 12 * 3_600_000
        : null,
      selfRating: null,
      estimateSource: 'hours' as const,
      baseEstimateMinutes: u.minutes,
      optional: false,
    })),
  )

  const plannedAssessments = wguPlannedAssessments(milestones, dayStartMs(termStart))
  return { goal, milestones, units, plannedAssessments }
}

/** "C779" → its course title, for building task titles. */
export function courseTitle(code: CourseCode): string {
  return COURSES.find((c) => c.code === code)?.title ?? code
}

/** Title of unit `n` (1-based) of a course, for chunk titles like "C779 · Unit 3: CSS layout (45 min)". */
export function unitTitle(code: CourseCode, n: number): string {
  return COURSES.find((c) => c.code === code)?.units[n - 1]?.title ?? `Unit ${n}`
}
