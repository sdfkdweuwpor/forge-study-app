/**
 * A year of study on the WGU sample goal, for performance checks: twenty finished courses with 2,000
 * finished 50-minute study sessions between them (about five a day, going back a year), and two more
 * courses still to take, so the plan the goal gets holds about 300 open sessions. Loaded on top of the
 * WGU sample by `?seed=wgu-year` (`src/dev/seed.ts`) and by the budget tests. Dates are relative to
 * `today`; ids are stable.
 */
import type { ID, ISODate, Milestone, Millis, Task, Unit } from '@/db/types'
import { addDays, dayStartMs } from '@/logic/dates'
import { TASK_V2_DEFAULTS } from '@/logic/taskDates'
import { WGU_GOAL_ID, WGU_TERM_ID } from './wguBsCs'

export interface StudyYear {
  milestones: Milestone[]
  units: Unit[]
  /** Finished study sessions (`source: 'schedule'`, keyed like the planner's). */
  tasks: Task[]
}

const FINISHED: ReadonlyArray<readonly [string, string]> = [
  ['C455', 'English Composition I'],
  ['C456', 'English Composition II'],
  ['C458', 'Health, Fitness, and Wellness'],
  ['C957', 'Applied Algebra'],
  ['C958', 'Calculus I'],
  ['C960', 'Discrete Mathematics II'],
  ['C459', 'Introduction to Probability and Statistics'],
  ['C463', 'Introduction to Humanities'],
  ['C464', 'Introduction to Communication'],
  ['D072', 'Fundamentals for Success in Business'],
  ['C165', 'Integrated Physical Sciences'],
  ['C952', 'Computer Architecture'],
  ['C191', 'Operating Systems for Programmers'],
  ['C949', 'Data Structures and Algorithms I'],
  ['C950', 'Data Structures and Algorithms II'],
  ['C867', 'Scripting and Programming: Applications'],
  ['C175', 'Data Management: Foundations'],
  ['C170', 'Data Management: Applications'],
  ['D286', 'Java Fundamentals'],
  ['D287', 'Java Frameworks'],
]

const STILL_TO_TAKE: ReadonlyArray<readonly [string, string]> = [
  ['D284', 'Software Engineering'],
  ['D288', 'Back-End Programming'],
]

const UNITS_PER_COURSE = 5
const SESSION_MINUTES = 50
const HOUR = 3_600_000

export const studyYearCourseId = (code: string): ID => `course-${code.toLowerCase()}`
const unitIdOf = (code: string, n: number): ID => `unit-${code.toLowerCase()}-${n}`

/** `finished` sessions (default 2,000) spread over the finished courses, newest yesterday. */
export function buildStudyYear(
  today: ISODate,
  now: Millis,
  opts: { finished?: number } = {},
): StudyYear {
  const finished = Math.max(0, opts.finished ?? 2000)
  const perCourse = Math.ceil(finished / FINISHED.length)
  const perUnit = Math.ceil(perCourse / UNITS_PER_COURSE)
  const start = addDays(today, -366)

  const course = (code: string, title: string, i: number, done: boolean): Milestone => {
    const endsIn = done ? -366 + Math.round(((i + 1) * 365) / FINISHED.length) : 0
    return {
      id: studyYearCourseId(code),
      createdAt: dayStartMs(start),
      updatedAt: now,
      goalId: WGU_GOAL_ID,
      kind: 'course',
      code,
      title,
      icon: null,
      cover: null,
      status: done ? 'done' : 'todo',
      // After the sample's five courses (orders 0–4).
      order: 5 + i + (done ? 0 : FINISHED.length),
      prerequisiteIds: [],
      estimateHours: done ? Math.round((perCourse * SESSION_MINUTES) / 60) : 45,
      dueDate: null,
      cus: 3,
      courseType: 'OA',
      termId: WGU_TERM_ID,
      notes: [],
      projectedStart: null,
      projectedEnd: null,
      completedAt: done ? dayStartMs(addDays(today, Math.min(-1, endsIn))) + 15 * HOUR : null,
      selfRating: null,
    }
  }

  const milestones = [
    ...FINISHED.map(([code, title], i) => course(code, title, i, true)),
    ...STILL_TO_TAKE.map(([code, title], i) => course(code, title, i, false)),
  ]

  const units: Unit[] = milestones.flatMap((m) =>
    Array.from({ length: UNITS_PER_COURSE }, (_, i): Unit => {
      const done = m.status === 'done'
      const minutes = done ? perUnit * SESSION_MINUTES : 540
      return {
        id: unitIdOf(m.code ?? m.id, i + 1),
        createdAt: m.createdAt,
        updatedAt: now,
        goalId: WGU_GOAL_ID,
        milestoneId: m.id,
        title: `Unit ${i + 1}`,
        order: i,
        estimateMinutes: minutes,
        difficulty: 2,
        status: done ? 'done' : 'todo',
        completedAt: done ? m.completedAt : null,
        selfRating: null,
        estimateSource: 'hours',
        baseEstimateMinutes: minutes,
        optional: false,
      }
    }),
  )

  // Oldest first: session k of the year is on day ⌊k / 5.5⌋ from the start, in the evening.
  const tasks: Task[] = Array.from({ length: finished }, (_, k): Task => {
    const c = Math.min(FINISHED.length - 1, Math.floor(k / perCourse))
    const [code = 'C455'] = FINISHED[c] ?? []
    const inCourse = k - c * perCourse
    const unit = Math.min(UNITS_PER_COURSE, Math.floor(inCourse / perUnit) + 1)
    const seq = inCourse - (unit - 1) * perUnit + 1
    const day = addDays(today, Math.min(-1, -365 + Math.floor((k * 364) / Math.max(1, finished))))
    const at = dayStartMs(day) + (17 + (k % 5)) * HOUR
    const unitId = unitIdOf(code, unit)
    return {
      ...TASK_V2_DEFAULTS,
      id: `year-${k}`,
      createdAt: at - 7 * 24 * HOUR,
      updatedAt: at,
      title: `${code} · Unit ${unit} (${SESSION_MINUTES} min)`,
      notes: [],
      status: 'done',
      priority: 0,
      dueDate: null,
      dueTime: null,
      estimatePomodoros: 2,
      estimateMinutes: SESSION_MINUTES,
      tags: [],
      goalId: WGU_GOAL_ID,
      milestoneId: studyYearCourseId(code),
      unitId,
      source: 'schedule',
      scheduleKey: `${unitId}:${seq}`,
      schedulePinned: false,
      skippedOn: null,
      orderInDay: k % 5,
      subtasks: [],
      recurrence: null,
      seriesId: null,
      order: at,
      boardOrder: at,
      startedAt: null,
      completedAt: at,
      completedDay: day,
      kind: 'study',
      doDate: day,
      doTime: `${17 + (k % 5)}:00`,
      durationMinutes: SESSION_MINUTES,
    }
  })

  return { milestones, units, tasks }
}
