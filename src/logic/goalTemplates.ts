/**
 * Starter goals for the planner's first step (pure): exactly four templates, each a realistic skeleton the
 * person edits on the review screen. A template becomes a `PlanDraft` (the same shape a pasted syllabus or
 * Claude's JSON becomes), plus the weekly windows and length it suggests, so it goes through the same
 * review as anything else.
 *
 * - WGU term: seven B.S. Computer Science courses (24 CUs, 310 h) in one six-month term.
 * - Certification: CompTIA A+ Core 1, one course per exam domain, a practice-exam checkpoint, a readiness
 *   block and the exam.
 * - Semester course: fourteen weekly topics in two halves, a midterm and a final.
 * - Personal project: four phases from brief to launch.
 *
 * `wguTemplate` is the older goal-draft form of the WGU term, kept for the repo's tests and the form
 * editors that still speak `DraftGoal`.
 */
import type { Goal, ISODate, TimeWindow, WeekMinutes } from '@/db/types'
import { addDays, addMonths, weekdayOf } from './dates'
import {
  emptyDraft,
  termEndFor,
  type CourseType,
  type DraftCourse,
  type DraftGoal,
  type KeyMaker,
} from './goalDraft'
import type { DraftAssessment, DraftCourse as PlanCourse, PlanDraft } from './planImport/draft'

export type TemplateId = 'wgu-term' | 'certification' | 'semester-course' | 'personal-project'

export interface TemplateUnit {
  title: string
  /** Study hours; omitted = the course's hours are shared among its units. */
  hours?: number
}

export interface TemplateAssessment {
  title: string
  kind: DraftAssessment['kind']
  /** Days after the start. Omitted = the planner places it after the course's work. */
  afterDays?: number
}

export interface TemplateCourse {
  code?: string
  title: string
  hours?: number
  cus?: number
  type?: 'OA' | 'PA'
  /** Codes of courses earlier in the list that come first. */
  after?: readonly string[]
  units: readonly (string | TemplateUnit)[]
  assessments?: readonly TemplateAssessment[]
}

export interface GoalTemplate {
  id: TemplateId
  name: string
  blurb: string
  icon: string
  kind: Goal['kind']
  goalTitle: string
  courses: readonly TemplateCourse[]
  /** Study windows per weekday, Sunday first. */
  weekly: readonly (readonly TimeWindow[])[]
  sessionMinutes: number
  /** Days from the start to the suggested finish; `'term'` = six months minus a day. */
  finish: number | 'term'
  /** Whether the goal is a WGU term (CUs, and a term on the goal page). */
  term: boolean
  /** Words in a typed goal that suggest this template. */
  keywords: readonly string[]
}

const win = (start: `${number}:${number}`, end: `${number}:${number}`): TimeWindow => ({
  start,
  end,
})

// ─── WGU term ───────────────────────────────────────────────────────────────

interface CourseSpec {
  code: string
  title: string
  hours: number
  cus: number
  type: CourseType
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

/** Monday to Friday 3 h in the evening and Saturday morning: about 16 h of study after breaks, enough for the 310 h plus reviews. */
const WGU_WEEKLY: readonly (readonly TimeWindow[])[] = [
  [],
  ...[1, 2, 3, 4, 5].map(() => [win('18:00', '21:00')]),
  [win('09:00', '13:00')],
]

const wguCourse = (spec: CourseSpec): TemplateCourse => ({
  code: spec.code,
  title: spec.title,
  hours: spec.hours,
  cus: spec.cus,
  type: spec.type === 'PA' ? 'PA' : 'OA',
  ...(spec.after ? { after: spec.after } : {}),
  units: spec.units,
  assessments:
    spec.type === 'PA'
      ? [{ title: `${spec.code} performance assessment`, kind: 'project' }]
      : [{ title: `${spec.code} objective assessment`, kind: 'exam' }],
})

// ─── Certification: CompTIA A+ Core 1 ───────────────────────────────────────

const APLUS_COURSES: readonly TemplateCourse[] = [
  {
    code: '1.0',
    title: 'Mobile Devices',
    units: [
      { title: 'Laptop hardware and components', hours: 2 },
      { title: 'Mobile device ports and accessories', hours: 1.5 },
      { title: 'Wireless connectivity and syncing', hours: 2 },
    ],
  },
  {
    code: '2.0',
    title: 'Networking',
    units: [
      { title: 'Ports, protocols and services', hours: 2.5 },
      { title: 'Networking hardware and devices', hours: 2 },
      { title: 'Wireless standards and SOHO setup', hours: 2.5 },
      { title: 'IP addressing, DHCP and DNS', hours: 2 },
      { title: 'Network configuration tools', hours: 2 },
    ],
  },
  {
    code: '3.0',
    title: 'Hardware',
    units: [
      { title: 'Cables and connectors', hours: 2 },
      { title: 'RAM and storage devices', hours: 3 },
      { title: 'Motherboards, CPUs and cooling', hours: 3 },
      { title: 'Power supplies and peripherals', hours: 2 },
      { title: 'Printers and multifunction devices', hours: 2.5 },
    ],
  },
  {
    code: '4.0',
    title: 'Virtualization and Cloud Computing',
    units: [
      { title: 'Cloud models and services', hours: 2 },
      { title: 'Client-side virtualization', hours: 2 },
    ],
  },
  {
    code: '5.0',
    title: 'Hardware and Network Troubleshooting',
    units: [
      { title: 'The troubleshooting methodology', hours: 1.5 },
      { title: 'Power and motherboard problems', hours: 2.5 },
      { title: 'Storage and RAID problems', hours: 2.5 },
      { title: 'Display and video problems', hours: 2 },
      { title: 'Mobile device problems', hours: 2 },
      { title: 'Network problems', hours: 3 },
    ],
    assessments: [{ title: 'Practice exam checkpoint (aim for 80%)', kind: 'quiz' }],
  },
  {
    title: 'Exam readiness',
    units: [
      { title: 'Review the weak areas from the checkpoint', hours: 4 },
      { title: 'Second practice exam, timed', hours: 2 },
      { title: 'Final pass over ports, acronyms and tools', hours: 2 },
    ],
    assessments: [{ title: 'CompTIA A+ Core 1 (220-1101)', kind: 'exam' }],
  },
]

const evenings = (end: `${number}:${number}`, sat: TimeWindow | null): (readonly TimeWindow[])[] => [
  [],
  ...[1, 2, 3, 4, 5].map(() => [win('19:00', end)]),
  sat ? [sat] : [],
]

// ─── Semester course: CS 101 ────────────────────────────────────────────────

const week = (n: number, title: string): TemplateUnit => ({ title: `Week ${n}: ${title}`, hours: 2.5 })

const SEMESTER_COURSES: readonly TemplateCourse[] = [
  {
    code: 'CS 101',
    title: 'Introduction to Programming, weeks 1 to 8',
    units: [
      week(1, 'Variables, types and input'),
      week(2, 'Conditionals'),
      week(3, 'Loops'),
      week(4, 'Functions'),
      week(5, 'Strings and lists'),
      week(6, 'Dictionaries and sets'),
      week(7, 'Files and exceptions'),
      { title: 'Week 8: Midterm review', hours: 3 },
    ],
    assessments: [{ title: 'Midterm exam', kind: 'exam', afterDays: 56 }],
  },
  {
    code: 'CS 101',
    title: 'Introduction to Programming, weeks 9 to 15',
    units: [
      week(9, 'Recursion'),
      week(10, 'Objects and classes'),
      week(11, 'Inheritance and interfaces'),
      week(12, 'Testing and debugging'),
      week(13, 'Searching, sorting and Big-O'),
      week(14, 'Final project'),
      { title: 'Week 15: Final review', hours: 3 },
    ],
    assessments: [
      { title: 'Final project due', kind: 'project', afterDays: 98 },
      { title: 'Final exam', kind: 'exam', afterDays: 108 },
    ],
  },
]

// ─── Personal project ───────────────────────────────────────────────────────

const PROJECT_COURSES: readonly TemplateCourse[] = [
  {
    title: 'Plan',
    units: [
      { title: 'Write the one-page brief', hours: 1.5 },
      { title: 'List the pages and the content each needs', hours: 2 },
      { title: 'Pick a stack and set up the repository', hours: 2 },
    ],
  },
  {
    title: 'Design',
    units: [
      { title: 'Sketch wireframes for each page', hours: 3 },
      { title: 'Choose type, colors and spacing', hours: 2 },
      { title: 'Write up three projects and gather photos', hours: 3 },
    ],
  },
  {
    title: 'Build',
    units: [
      { title: 'Layout and navigation', hours: 4 },
      { title: 'Home and about pages', hours: 3 },
      { title: 'Projects gallery', hours: 4 },
      { title: 'Contact form', hours: 2 },
      { title: 'Accessibility and performance pass', hours: 3 },
    ],
  },
  {
    title: 'Launch',
    units: [
      { title: 'Deploy and connect the domain', hours: 2 },
      { title: 'Test on phones and other browsers', hours: 2 },
      { title: 'Share it and collect feedback', hours: 1.5 },
    ],
    assessments: [{ title: 'Launch day', kind: 'project' }],
  },
]

export const TEMPLATES: readonly GoalTemplate[] = [
  {
    id: 'wgu-term',
    name: 'WGU term',
    blurb: 'Seven B.S. Computer Science courses in one six-month term.',
    icon: '🎓',
    kind: 'degree',
    goalTitle: 'B.S. Computer Science, Term 1',
    courses: WGU_TEMPLATE_COURSES.map(wguCourse),
    weekly: WGU_WEEKLY,
    sessionMinutes: 50,
    finish: 'term',
    term: true,
    keywords: ['wgu', 'western governors', 'term', 'degree', 'bachelor', 'competency'],
  },
  {
    id: 'certification',
    name: 'Certification',
    blurb: 'CompTIA A+ Core 1: five exam domains, a practice-exam checkpoint and the exam.',
    icon: '📜',
    kind: 'certification',
    goalTitle: 'CompTIA A+ Core 1 (220-1101)',
    courses: APLUS_COURSES,
    weekly: evenings('20:30', win('09:00', '12:00')),
    sessionMinutes: 50,
    finish: 70,
    term: false,
    keywords: ['certification', 'certificate', 'exam', 'comptia', 'aws', 'security+', 'pmp', 'a+'],
  },
  {
    id: 'semester-course',
    name: 'Semester course',
    blurb: 'Weekly topics across a semester, with a midterm and a final.',
    icon: '📚',
    kind: 'custom',
    goalTitle: 'CS 101 Introduction to Programming',
    courses: SEMESTER_COURSES,
    weekly: [[win('14:00', '16:00')], ...[1, 2, 3, 4].map(() => [win('19:00', '20:30')]), [], []],
    sessionMinutes: 50,
    finish: 112,
    term: false,
    keywords: ['semester', 'course', 'class', 'syllabus', 'midterm', 'college'],
  },
  {
    id: 'personal-project',
    name: 'Personal project',
    blurb: 'Four phases from a one-page brief to launch day.',
    icon: '🛠️',
    kind: 'custom',
    goalTitle: 'Ship my portfolio website',
    courses: PROJECT_COURSES,
    weekly: [[], [], [win('19:00', '21:00')], [], [win('19:00', '21:00')], [], [win('10:00', '14:00')]],
    sessionMinutes: 50,
    finish: 56,
    term: false,
    keywords: ['project', 'build', 'app', 'website', 'portfolio', 'launch', 'ship', 'write a book'],
  },
]

export function templateById(id: TemplateId): GoalTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? (TEMPLATES[0] as GoalTemplate)
}

/** The template a typed goal most resembles (most keyword hits), or `null` when none does. */
export function suggestTemplate(text: string): GoalTemplate | null {
  const t = text.toLowerCase()
  let best: GoalTemplate | null = null
  let bestHits = 0
  for (const tpl of TEMPLATES) {
    const hits = tpl.keywords.filter((k) => t.includes(k)).length
    if (hits > bestHits) {
      best = tpl
      bestHits = hits
    }
  }
  return best
}

/** The suggested finish for a template started on `start`. */
export function templateFinish(t: GoalTemplate, start: ISODate): ISODate {
  return t.finish === 'term' ? termEndFor(start) : addDays(start, t.finish)
}

/** A date `days` after `start`, moved back to Friday (from a weekend) so nothing is due on a Saturday. */
function weekdayAfter(start: ISODate, days: number): ISODate {
  const d = addDays(start, days)
  const wd = weekdayOf(d)
  if (wd === 6) return addDays(d, -1)
  if (wd === 0) return addDays(d, -2)
  return d
}

/** The template as a draft for the planner (units carry their hours as minutes; dates are set from `start`). */
export function templatePlanDraft(t: GoalTemplate, start: ISODate): PlanDraft {
  const finish = templateFinish(t, start)
  const courses = t.courses.map((c): PlanCourse => {
    const out: PlanCourse = {
      title: c.title,
      units: c.units.map((u) => {
        if (typeof u === 'string') return { title: u }
        return u.hours === undefined
          ? { title: u.title }
          : { title: u.title, estimatedMinutes: Math.round(u.hours * 60) }
      }),
      assessments: (c.assessments ?? []).map((a): DraftAssessment => {
        const date = a.afterDays === undefined ? undefined : weekdayAfter(start, a.afterDays)
        return date === undefined
          ? { title: a.title, kind: a.kind }
          : { title: a.title, kind: a.kind, date }
      }),
    }
    if (c.code !== undefined) out.code = c.code
    if (c.hours !== undefined) out.estimatedHours = c.hours
    if (c.cus !== undefined) out.cus = c.cus
    if (c.type !== undefined) out.type = c.type
    if (c.after !== undefined) out.prerequisites = [...c.after]
    return out
  })
  return {
    goal: {
      title: t.goalTitle,
      icon: t.icon,
      targetDate: finish,
      ...(t.term ? { term: { start, end: finish } } : {}),
    },
    courses,
  }
}

/** Months of a term-length goal, for the "When" step's quick pick. */
export function sixMonthsFrom(start: ISODate): ISODate {
  return addDays(addMonths(start, 6), -1)
}

// ─── Older goal-draft form (repo tests, form editors) ───────────────────────

/**
 * Monday to Friday two and a half hours, Saturday four, Sunday off: about 16 h a week of study windows.
 * The slot planner takes a 10-minute break between 50-minute sessions inside them, so this is about
 * 14 h of study, which fits the 310 h in the six-month term with the buffer.
 */
const TEMPLATE_WEEK: WeekMinutes = [0, 150, 150, 150, 150, 150, 240]

/** The WGU term as a `DraftGoal` starting `today`: seven courses (24 CUs, 310 h) in one six-month term. */
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
