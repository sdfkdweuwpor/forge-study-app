/**
 * Pasted syllabus / course list → an editable `PlanDraft` for the review screen (pure).
 *
 * Line by line, first match wins:
 * 1. Noise (instructor, office hours, grading, table headers, separators, URLs) is ignored.
 * 2. A course line starts with a code: "C182 Introduction to IT – 4 CUs", "D278 Scripting and
 *    Programming Foundations (3 CU)", "CS 101 – Intro to Programming (3 credits)". CUs/credits, OA/PA and
 *    hours are read off it. OA adds an objective assessment (exam), PA a performance assessment (project).
 * 3. "Term …" with two dates sets the term; "Target / Finish by …" with a date sets the target.
 * 4. A section header is a unit: "Week 3: …", "Module 2 – …", "Chapter 5 …", "Unit 4:", "Lesson 1.2".
 *    The first header kind in a course is its unit level; bullets, plain lines and other header kinds
 *    under a header are its details (their hours add up when the header has none).
 * 5. An assessment: exam words anywhere ("Midterm exam Oct 12", "Final exam", "Quiz 3", "OA", "PA",
 *    "Final assessment"), or project words at the start ("Project due Nov 3", "Final project", "Paper 2")
 *    when dated, due, or not a detail. Review / prep / practice lines are study, not assessments. The
 *    first date on the line is its date.
 * 6. A bulleted or numbered line is a unit ("1. Mobile devices (6 hrs)").
 * 7. The first plain line before any content is the title; other plain lines are unparsed.
 * Hours anywhere on a unit or course line ("(6 hrs)", "4–6 hours", "90 min") become its estimate.
 *
 * A typed goal with no structure ("Learn conversational Spanish by June 2027") becomes one course with
 * no units, flagged `needsBreakdown`, with the deadline read as the target date.
 */
import type { ISODate } from '@/db/types'
import type { DraftAssessment, DraftCourse, DraftUnit, PlanDraft } from '../planImport/draft'
import { findDates, firstDate, goalDeadline, MONTH_NAMES } from './dates'

export type ParsedLineKind =
  | 'title'
  | 'term'
  | 'target'
  | 'course'
  | 'unit'
  | 'detail'
  | 'assessment'
  | 'goal'
  | 'ignored'
  | 'unparsed'

export interface ParsedLine {
  /** 1-based. */
  line: number
  text: string
  kind: ParsedLineKind
}

export type PlanTextFormat = 'courseList' | 'syllabus' | 'goal' | 'empty'

export interface PlanParseResult {
  draft: PlanDraft
  /** 0–1: the share of meaningful lines that were understood (0.5 for a bare goal). */
  confidence: number
  /** "We couldn't read these lines". */
  unparsed: Array<{ line: number; text: string }>
  /** A typed goal with no structure: offer templates or the Claude prompt to break it down. */
  needsBreakdown: boolean
  format: PlanTextFormat
  /** Every non-blank line and how it was read (for highlighting the paste). */
  lines: ParsedLine[]
}

export interface PlanParseOptions {
  today: ISODate
}

// ─── Patterns ───────────────────────────────────────────────────────────────

const BULLET_RE =
  /^(?:[-*+•◦▪‣·●○■□➤►>–]|\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)]|\[[ xX]?\])\s+/i
const HEADING_MARK_RE = /^#{1,6}\s+/
const TABLE_ROW_RE = /^\d{1,2}[\s\t]+(?=[A-Z])/

const NOISE_RES: readonly RegExp[] = [
  /^(?:syllabus|course (?:schedule|outline|calendar|overview|description|information|content)|schedule|calendar|outline|topics?|contents|table of contents|agenda|readings?|overview)\s*:?\s*$/i,
  /^(?:instructors?|professors?|teachers?|tas?|teaching assistants?|office hours?|e-?mail|phone|location|room|classroom|meeting times?|class times?|lectures? times?|prerequisites?|textbooks?|required (?:texts?|materials|readings?)|materials|grading|grades?|grade breakdown|attendance|polic(?:y|ies)|late work|academic integrity|accommodations?|website|url|canvas|blackboard|zoom|course website|contact)\b[^:]{0,20}:/i,
  /^https?:\/\/\S+$/i,
  /^page \d+(?: of \d+)?$/i,
  /^(?:week|date|topics?|readings?|assignments?|due|notes|module|chapter)(?:\s*[|\t,/]\s*(?:week|date|topics?|readings?|assignments?|due|notes|module|chapter|hours))+\s*$/i,
  /^[-=_*~#|+.\s]{3,}$/,
]

const HEADER_RE =
  /^(week|wk|module|mod|chapter|chap|ch|unit|lesson|lecture|part|section|topic|session|day|class)\.?\s*(\d{1,3}(?:\.\d{1,2})?|[ivxlc]{1,6}|[a-z])(?=$|[\s:.\-–—),])\s*[:.\-–—)]?\s*(.*)$/i
const HEADER_KIND: Readonly<Record<string, string>> = {
  wk: 'week',
  mod: 'module',
  chap: 'chapter',
  ch: 'chapter',
}

const COURSE_RE = /^([A-Z]{1,4})(\s?)(\d{2,4}[A-Z]?)(?![\w/-])\s*[:\-–—|.]?\s*(.*)$/
const NOT_CODES = new Set([
  'WEEK',
  'WK',
  'UNIT',
  'MOD',
  'CH',
  'PART',
  'DAY',
  'TERM',
  'PAGE',
  'ROOM',
  'Q',
  'FALL',
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'SEPT',
  'OCT',
  'NOV',
  'DEC',
])
const CUS_RE =
  /[([]?\s*(\d{1,2}(?:\.\d)?)\s*(?:c\.?u\.?s?|competency units?|credits?|credit hours?|cr\.?|units?)(?![a-z])\.?\s*[)\]]?/i
const STATUS_RE =
  /[\s(,–—-]*\b(?:completed?|in progress|not started|enrolled|passed|planned|current)\b\)?\s*$/i

const HOURS_RE =
  /[([]?\s*[~≈]?\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?\.?|h|minutes?|mins?\.?)(?![a-z])\s*[)\]]?/i

const REVIEWISH_RE = /\b(?:review|prep|preparation|study guide|practice|mock|revision)\b/i
const STRONG_RE =
  /\b(?:mid-?terms?|exams?|examination|quiz(?:zes)?|objective assessment|performance assessment|pre-?assessment|final assessment)\b/i
const CODE_ASSESSMENT_RE = /^(?:OA|PA)\b|\((?:OA|PA)\)/
const WEAK_RE = new RegExp(
  `^(?:(?:final|midterm|mid-term|course|group|term|research|capstone|unit|chapter|module|mini|major|practical)\\s+)?` +
    `(?:projects?|papers?|essays?|presentations?|reports?|assignments?|tests?|portfolios?|labs?|lab reports?|assessments?|homework|hw|problem sets?|case study|tasks?)` +
    `(?=$|\\s*(?:\\d|#|[:\\-–—(]|due\\b|on\\b|by\\b|report\\b|(?:${MONTH_NAMES})\\b))`,
  'i',
)
const QUALIFIED_RE = /^(?:final|midterm|mid-term|course|group|term|research|capstone|major)\s+/i
const DUE_RE = /\bdue\b/i
const TERM_RE = /^term\b/i
const TARGET_RE =
  /^(?:target(?: date)?|deadline|goal date|finish(?: by)?|complete(?: by)?|graduat(?:e|ion)(?: by)?|end date)\b/i

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Trims separators and empty brackets left behind after pieces were cut out. */
export function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ')
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/\(\s*[–—\-,:;]?\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/\s+([,:;.)])/g, '$1')
      .replace(/([(])\s+/g, '$1')
      .replace(/\s*[–—\-|:,;]\s*[–—\-|:,;]\s*/g, ' – ')
      .replace(/^[\s:–—\-|,.;]+|[\s:–—\-|,;(]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return t
}

const cut = (s: string, from: number, to: number): string => `${s.slice(0, from)} ${s.slice(to)}`

/** Minutes from "(6 hrs)", "4–6 hours", "90 min", and the text without it. */
export function takeHours(text: string): { minutes: number | null; rest: string } {
  const m = HOURS_RE.exec(text)
  if (!m) return { minutes: null, rest: text }
  const a = Number(m[1])
  const b = m[2] !== undefined ? Number(m[2]) : a
  const value = (a + b) / 2
  const perMinute = (m[3] ?? '').toLowerCase().startsWith('m')
  const minutes = Math.round(perMinute ? value : value * 60)
  if (!(minutes > 0)) return { minutes: null, rest: text }
  return { minutes, rest: cut(text, m.index, m.index + m[0].length) }
}

function stripDates(text: string, today: ISODate, numeric: boolean): string {
  let t = text
  for (const d of [...findDates(text, today, { numeric })].reverse()) t = cut(t, d.index, d.end)
  return t
}

function isAssessment(text: string, asDetail: boolean, today: ISODate): boolean {
  if (REVIEWISH_RE.test(text)) return false
  if (STRONG_RE.test(text) || CODE_ASSESSMENT_RE.test(text)) return true
  if (!WEAK_RE.test(text)) return false
  if (!asDetail || QUALIFIED_RE.test(text)) return true
  return DUE_RE.test(text) || firstDate(text, today) !== null
}

function assessmentKind(text: string): DraftAssessment['kind'] {
  if (/\bquiz/i.test(text)) return 'quiz'
  if (
    /\b(?:project|paper|essay|presentation|report|portfolio|assignment|homework|hw|problem set|case study|task|performance assessment|lab)s?\b/i.test(
      text,
    ) ||
    /\bPA\b/.test(text)
  )
    return 'project'
  return 'exam'
}

function assessmentOf(text: string, today: ISODate): DraftAssessment {
  const date = firstDate(text, today)
  let title = date ? cut(text, date.index, date.end) : text
  title = title.replace(/\s*\b(?:due|on|by)\s*$/i, '')
  title = cleanTitle(title.replace(/\s*\b(?:due|on|by)\s*(?=[–—\-:,(]|$)/i, ''))
  if (/^OA$/.test(title)) title = 'Objective assessment'
  else if (/^PA$/.test(title)) title = 'Performance assessment'
  const out: DraftAssessment = {
    title: title === '' ? 'Assessment' : title,
    kind: assessmentKind(text),
  }
  if (date) out.date = date.date
  return out
}

interface CourseBuilder {
  course: DraftCourse
  /** The header kind that makes units in this course ("week", "module", …). */
  level: string | null
  /** The unit the next details belong to. */
  header: { unit: DraftUnit; detailMinutes: number } | null
}

// ─── Parser ─────────────────────────────────────────────────────────────────

export function parsePlanText(text: string, opts: PlanParseOptions): PlanParseResult {
  const { today } = opts
  const lines: ParsedLine[] = []
  const courses: CourseBuilder[] = []
  const st: {
    current: CourseBuilder | null
    title: string | null
    targetDate: ISODate | null
    term: { start: ISODate; end: ISODate } | null
  } = { current: null, title: null, targetDate: null, term: null }

  const closeHeader = (): void => {
    const h = st.current?.header
    if (h && h.unit.estimatedMinutes === undefined && h.detailMinutes > 0)
      h.unit.estimatedMinutes = h.detailMinutes
    if (st.current) st.current.header = null
  }
  const ensureCourse = (): CourseBuilder => {
    if (st.current) return st.current
    const c: CourseBuilder = {
      course: { title: st.title ?? 'Course', units: [], assessments: [] },
      level: null,
      header: null,
    }
    st.current = c
    courses.push(c)
    return c
  }
  const addUnit = (raw: string, minutes: number | null): DraftUnit => {
    const unit: DraftUnit = { title: cleanTitle(raw) || 'Unit' }
    if (minutes !== null) unit.estimatedMinutes = minutes
    ensureCourse().course.units.push(unit)
    return unit
  }

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')
  rawLines.forEach((raw, i) => {
    const line = i + 1
    const trimmed = raw.trim()
    if (trimmed === '') return
    const mark = (kind: ParsedLineKind): void => {
      lines.push({ line, text: trimmed, kind })
    }
    const bullet = BULLET_RE.exec(trimmed)
    const heading = HEADING_MARK_RE.test(trimmed)
    const body = trimmed.replace(HEADING_MARK_RE, '').replace(BULLET_RE, '').trim()
    if (body === '' || NOISE_RES.some((re) => re.test(body))) return mark('ignored')

    // Course line.
    const cm = COURSE_RE.exec(body)
    const letters = cm?.[1] ?? ''
    if (cm && !NOT_CODES.has(letters) && !(cm[2] === ' ' && (cm[3] ?? '').length < 3)) {
      closeHeader()
      let rest = (cm[4] ?? '').replace(STATUS_RE, '')
      const course: DraftCourse = {
        code: `${letters}${cm[2]}${cm[3]}`,
        title: '',
        units: [],
        assessments: [],
      }
      const cus = CUS_RE.exec(rest)
      if (cus) {
        course.cus = Math.round(Number(cus[1]))
        rest = cut(rest, cus.index, cus.index + cus[0].length)
      }
      const h = takeHours(rest)
      if (h.minutes !== null) course.estimatedHours = Math.round((h.minutes / 60) * 10) / 10
      rest = h.rest
      const oa = /\bOA\b/.test(rest) || /objective assessment/i.test(rest)
      const pa = /\bPA\b/.test(rest) || /performance assessment/i.test(rest)
      rest = rest
        .replace(/\(?\b(?:OA|PA)\b\)?/g, '')
        .replace(/\(?(?:objective|performance) assessment\)?/gi, '')
      if (oa && !pa) course.type = 'OA'
      if (pa && !oa) course.type = 'PA'
      if (oa) course.assessments.push({ title: 'Objective assessment', kind: 'exam' })
      if (pa) course.assessments.push({ title: 'Performance assessment', kind: 'project' })
      course.title = cleanTitle(stripDates(rest, today, false)) || course.code || 'Course'
      st.current = { course, level: null, header: null }
      courses.push(st.current)
      return mark('course')
    }

    // Term and target lines.
    if (TERM_RE.test(body)) {
      const ds = findDates(body, today)
      if (ds.length >= 2 && ds[0] && ds[1]) {
        st.term = { start: ds[0].date, end: ds[1].date }
        return mark('term')
      }
    }
    if (TARGET_RE.test(body)) {
      const d = firstDate(body, today)
      if (d) {
        st.targetDate = d.date
        return mark('target')
      }
    }

    // Section header.
    const hm = HEADER_RE.exec(body)
    if (hm) {
      const kindRaw = (hm[1] ?? '').toLowerCase()
      const kind = HEADER_KIND[kindRaw] ?? kindRaw
      const rest = hm[3] ?? ''
      if (rest !== '' && isAssessment(rest, false, today)) {
        ensureCourse().course.assessments.push(assessmentOf(rest, today))
        return mark('assessment')
      }
      const c = ensureCourse()
      if (c.level !== null && c.level !== kind && c.header) {
        const h = takeHours(body)
        if (h.minutes !== null) c.header.detailMinutes += h.minutes
        return mark('detail')
      }
      closeHeader()
      c.level = kind
      const h = takeHours(body)
      const unit = addUnit(stripDates(h.rest, today, false), h.minutes)
      c.header = { unit, detailMinutes: 0 }
      return mark('unit')
    }

    // Assessment.
    const header = st.current?.header ?? null
    if (isAssessment(body, header !== null, today)) {
      ensureCourse().course.assessments.push(assessmentOf(body, today))
      return mark('assessment')
    }

    // Details under a header, then list items.
    if (header) {
      const h = takeHours(body)
      if (h.minutes !== null) header.detailMinutes += h.minutes
      return mark('detail')
    }
    if (bullet || TABLE_ROW_RE.test(body) || (REVIEWISH_RE.test(body) && courses.length > 0)) {
      const h = takeHours(body.replace(TABLE_ROW_RE, ''))
      addUnit(stripDates(h.rest, today, false), h.minutes)
      return mark('unit')
    }

    // The title, before any content.
    if (
      st.title === null &&
      courses.length === 0 &&
      (heading || lines.every((l) => l.kind === 'ignored'))
    ) {
      st.title = cleanTitle(body)
      return mark('title')
    }
    return mark('unparsed')
  })
  closeHeader()

  const unparsed = lines
    .filter((l) => l.kind === 'unparsed')
    .map(({ line, text: t }) => ({ line, text: t }))
  const meaningful = lines.filter((l) => l.kind !== 'ignored')

  // A typed goal: nothing structured, or a single statement that is not a course line
  // ("Pass the AWS Solutions Architect exam by Dec 15" is a goal, not a bare assessment).
  const single = meaningful.length === 1 && meaningful[0]?.kind !== 'course'
  if (courses.length === 0 || single) {
    const statement = single
      ? meaningful[0]
      : meaningful.find((l) => l.kind === 'title' || l.kind === 'unparsed')
    if (!statement) return emptyResult(lines)
    return goalResult(statement, lines, today, st.targetDate)
  }

  const draftCourses = courses.map((c) => c.course)
  const recognized = lines.filter((l) => l.kind !== 'ignored' && l.kind !== 'unparsed').length
  const confidence =
    Math.round((recognized / Math.max(1, recognized + unparsed.length)) * 100) / 100
  const courseLines = lines.filter((l) => l.kind === 'course').length
  const unitCount = draftCourses.reduce((n, c) => n + c.units.length, 0)
  const goalTitle =
    st.title ?? (draftCourses.length === 1 ? (draftCourses[0] as DraftCourse).title : 'Study plan')
  const goal: PlanDraft['goal'] = { title: goalTitle }
  if (st.targetDate) goal.targetDate = st.targetDate
  if (st.term) goal.term = st.term
  return {
    draft: { goal, courses: draftCourses },
    confidence,
    unparsed,
    needsBreakdown: false,
    format: courseLines >= 2 && unitCount === 0 ? 'courseList' : 'syllabus',
    lines,
  }
}

function emptyResult(lines: ParsedLine[]): PlanParseResult {
  return {
    draft: { goal: { title: '' }, courses: [] },
    confidence: 0,
    unparsed: [],
    needsBreakdown: false,
    format: 'empty',
    lines,
  }
}

/** One statement → one course with no units, to be broken down (templates or the Claude prompt). */
function goalResult(
  statement: ParsedLine,
  lines: ParsedLine[],
  today: ISODate,
  target: ISODate | null,
): PlanParseResult {
  const text = statement.text.replace(BULLET_RE, '')
  const deadline = goalDeadline(text, today)
  let title = cleanTitle(deadline ? cut(text, deadline.index, deadline.end) : text)
    .replace(/^(?:my goal is to|goal:|i want to|i'd like to|i would like to|i need to)\s+/i, '')
    .replace(/[.!]+$/, '')
  title = title.charAt(0).toUpperCase() + title.slice(1)
  const targetDate = deadline?.date ?? target
  const assessments: DraftAssessment[] = []
  if (/\b(?:exam|test)\b/i.test(text) && !REVIEWISH_RE.test(text)) {
    const a: DraftAssessment = { title: 'Exam', kind: 'exam' }
    if (targetDate) a.date = targetDate
    assessments.push(a)
  }
  const goal: PlanDraft['goal'] = { title }
  if (targetDate) goal.targetDate = targetDate
  const marked = lines.map((l) => (l === statement ? { ...l, kind: 'goal' as const } : l))
  return {
    draft: { goal, courses: [{ title, units: [], assessments }] },
    confidence: 0.5,
    unparsed: marked
      .filter((l) => l.kind === 'unparsed')
      .map(({ line, text: t }) => ({ line, text: t })),
    needsBreakdown: true,
    format: 'goal',
    lines: marked,
  }
}
