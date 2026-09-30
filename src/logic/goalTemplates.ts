/**
 * Starter goals for the wizard's "Load WGU template" (pure). Realistic B.S. Computer Science courses
 * with plausible hours, competency units and unit lists; the wizard fills its draft from this and the
 * person edits from there.
 */
import type { ISODate, WeekMinutes } from '@/db/types'
import {
  emptyDraft,
  termEndFor,
  type CourseType,
  type DraftCourse,
  type DraftGoal,
  type KeyMaker,
} from './goalDraft'

interface CourseSpec {
  code: string
  title: string
  hours: number
  cus: number
  type: CourseType
  /** Codes of courses (earlier in the list) that come first. */
  after?: readonly string[]
  units: readonly string[]
}

export const WGU_TEMPLATE_COURSES: readonly CourseSpec[] = [
  {
    code: 'C182',
    title: 'Introduction to IT',
    hours: 40,
    cus: 4,
    type: 'OA',
    units: [
      'Hardware and operating systems',
      'Networks and the internet',
      'Programming and scripting concepts',
      'Cloud and virtualization',
      'Databases',
      'Security and ethics',
    ],
  },
  {
    code: 'C779',
    title: 'Web Development Foundations',
    hours: 30,
    cus: 3,
    type: 'PA',
    units: [
      'HTML structure',
      'CSS box model and selectors',
      'CSS layout',
      'JavaScript basics',
      'DOM and events',
      'Forms and accessibility',
    ],
  },
  {
    code: 'D278',
    title: 'Scripting and Programming Foundations',
    hours: 45,
    cus: 3,
    type: 'OA',
    units: ['Variables and expressions', 'Branching', 'Loops', 'Functions', 'Data structures'],
  },
  {
    code: 'C172',
    title: 'Network and Security Foundations',
    hours: 50,
    cus: 3,
    type: 'OA',
    units: [
      'Network models and protocols',
      'Addressing and routing',
      'Threats and defenses',
      'Cryptography basics',
      'Policy and risk',
    ],
  },
  {
    code: 'C959',
    title: 'Discrete Math I',
    hours: 45,
    cus: 4,
    type: 'OA',
    units: [
      'Logic and proofs',
      'Sets and functions',
      'Counting and probability',
      'Graphs and trees',
      'Recursion and induction',
    ],
  },
  {
    code: 'D426',
    title: 'Data Management Foundations',
    hours: 40,
    cus: 3,
    type: 'OA',
    units: [
      'Relational model and SQL basics',
      'Joins and subqueries',
      'Database design and normalization',
      'Transactions and indexes',
      'NoSQL and data warehouses',
    ],
  },
  {
    code: 'C867',
    title: 'Scripting and Programming Applications',
    hours: 60,
    cus: 4,
    type: 'PA',
    after: ['D278'],
    units: [
      'Object-oriented design',
      'Classes and inheritance',
      'Collections and iteration',
      'Testing and debugging',
      'Software project write-up',
    ],
  },
]

/**
 * Monday to Friday two and a half hours, Saturday four, Sunday off: about 16 h a week of study windows.
 * The slot planner takes a 10-minute break between 50-minute sessions inside them, so this is about
 * 14 h of study, which fits the 310 h in the six-month term with the buffer.
 */
const TEMPLATE_WEEK: WeekMinutes = [0, 150, 150, 150, 150, 150, 240]

/**
 * A B.S. Computer Science draft starting `today`: seven courses (24 CUs, 310 h), one six-month term
 * that ends on the goal's target date, and a weekly rhythm that fits inside it.
 */
export function wguTemplate(today: ISODate, newKey: KeyMaker): DraftGoal {
  const base = emptyDraft(today)
  const keyByCode = new Map<string, string>()
  const courses = WGU_TEMPLATE_COURSES.map<DraftCourse>((spec) => {
    const key = newKey()
    keyByCode.set(spec.code, key)
    return {
      key,
      code: spec.code,
      title: spec.title,
      hours: String(spec.hours),
      cus: String(spec.cus),
      courseType: spec.type,
      prerequisiteKeys: (spec.after ?? []).flatMap((code) => {
        const dep = keyByCode.get(code)
        return dep === undefined ? [] : [dep]
      }),
      units: spec.units.join('\n'),
    }
  })
  const end = termEndFor(today)
  return {
    ...base,
    title: 'B.S. Computer Science',
    icon: '🎓',
    coverPreset: 'sand',
    kind: 'degree',
    targetDate: end,
    courses,
    minutesByWeekday: [...TEMPLATE_WEEK],
    term: { enabled: true, label: 'Term 1', start: today, end, endEdited: false },
  }
}
