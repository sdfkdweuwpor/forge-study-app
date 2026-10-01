import { describe, expect, it } from 'vitest'
import { findDates, goalDeadline, inferYear } from './dates'
import {
  CHAPTER_SYLLABUS,
  EXAM_PREP_LIST,
  ONLINE_CERTIFICATE,
  TYPED_EXAM_GOAL,
  TYPED_GOAL,
  UNIVERSITY_SYLLABUS,
  WGU_COURSE_LIST,
} from './fixtures'
import { cleanTitle, parsePlanText, takeHours } from './parse'

const today = '2026-09-30'
const parse = (text: string) => parsePlanText(text, { today })

describe('parsePlanText: formats', () => {
  it('reads a WGU course list: codes, titles, CUs, OA/PA', () => {
    const r = parse(WGU_COURSE_LIST)
    expect(r.format).toBe('courseList')
    expect(r.confidence).toBe(1)
    expect(r.unparsed).toEqual([])
    expect(r.needsBreakdown).toBe(false)
    expect(r.draft.goal).toEqual({ title: 'WGU B.S. Computer Science — Term 1' })
    expect(r.draft.courses.map((c) => [c.code, c.title, c.cus, c.type ?? null])).toEqual([
      ['C182', 'Introduction to IT', 4, null],
      ['D278', 'Scripting and Programming Foundations', 3, null],
      ['C779', 'Web Development Foundations', 3, 'OA'],
      ['C173', 'Scripting and Programming - Foundations', 3, 'PA'],
      ['D427', 'Data Management - Applications', 4, null], // "Completed" is dropped
    ])
    expect(r.draft.courses[2]?.assessments).toEqual([
      { title: 'Objective assessment', kind: 'exam' },
    ])
    expect(r.draft.courses[3]?.assessments).toEqual([
      { title: 'Performance assessment', kind: 'project' },
    ])
    expect(r.draft.courses.every((c) => c.units.length === 0)).toBe(true)
  })

  it('reads a weekly university syllabus with dated assessments and folded details', () => {
    const r = parse(UNIVERSITY_SYLLABUS)
    expect(r.format).toBe('syllabus')
    const [course] = r.draft.courses
    expect(r.draft.courses).toHaveLength(1)
    expect(course?.code).toBe('CS 101')
    expect(course?.title).toBe('Introduction to Programming')
    expect(course?.units.map((u) => [u.title, u.estimatedMinutes ?? null])).toEqual([
      ['Week 1: Course overview and setup', 180],
      ['Week 2: Variables, types and expressions', 240],
      ['Week 3: Control flow', 120], // from its "Read chapter 3 (2 hrs)" detail
      ['Week 4: Functions', null],
      ['Week 5: Lists and loops', 300],
      ['Week 6: Dictionaries and sets', null],
      ['Week 7: Files and exceptions', null],
      ['Week 8: Final review', null], // a review week is study, not an assessment
    ])
    expect(course?.assessments).toEqual([
      { title: 'Quiz 1', kind: 'quiz', date: '2026-09-18' },
      { title: 'Midterm exam', kind: 'exam', date: '2026-10-12' },
      { title: 'Project', kind: 'project', date: '2026-11-03' },
      { title: 'Final exam', kind: 'exam', date: '2026-12-10' },
    ])
    // "Lab 1" under Week 3 is a detail of that week, not an assessment.
    expect(r.lines.find((l) => l.text === '- Lab 1')?.kind).toBe('detail')
    // Instructor, the schedule heading and office hours are noise; the meeting line is not understood.
    expect(r.unparsed).toEqual([{ line: 2, text: 'Fall 2026 · MWF 10:00' }])
    expect(r.confidence).toBe(0.94)
  })

  it('reads an online certificate by modules, with lessons as details and a final assessment', () => {
    const r = parse(ONLINE_CERTIFICATE)
    expect(r.draft.goal.title).toBe('Google Data Analytics Certificate')
    const [course] = r.draft.courses
    expect(course?.code).toBeUndefined()
    expect(course?.title).toBe('Google Data Analytics Certificate')
    expect(course?.units.map((u) => u.estimatedMinutes)).toEqual([1080, 1260, 1440, 1320, 1560])
    expect(course?.units[2]?.title).toBe('Module 3 - Prepare Data for Exploration')
    expect(course?.assessments).toEqual([{ title: 'Final assessment', kind: 'exam' }])
    expect(r.lines.filter((l) => l.kind === 'detail').map((l) => l.line)).toEqual([5, 6])
    expect(r.confidence).toBe(1)
  })

  it('reads a numbered exam-prep list and reports the line it could not read', () => {
    const r = parse(EXAM_PREP_LIST)
    const [course] = r.draft.courses
    expect(r.draft.goal.title).toBe('Certification exam prep: CompTIA A+ Core 1')
    expect(course?.units.map((u) => [u.title, u.estimatedMinutes ?? null])).toEqual([
      ['Mobile devices', 360],
      ['Networking', 480],
      ['Hardware', null],
      ['Virtualization and cloud computing', null],
      ['Hardware and network troubleshooting', 600],
      ['Practice exam', null], // practice is study; the planner adds its own practice test too
    ])
    expect(course?.assessments).toEqual([
      { title: 'Exam: Core 1 (220-1101)', kind: 'exam', date: '2026-11-20' },
    ])
    expect(r.unparsed).toEqual([{ line: 9, text: 'Buy a voucher before booking' }])
    expect(r.confidence).toBe(0.89)
  })

  it('reads a chapter syllabus with credits, day-first dates, a due report and the term', () => {
    const r = parse(CHAPTER_SYLLABUS)
    const [course] = r.draft.courses
    expect([course?.code, course?.title, course?.cus]).toEqual([
      'BIO 110',
      'Principles of Biology',
      4,
    ])
    expect(course?.units.map((u) => u.title)).toEqual([
      'Chapter 1 – The Chemistry of Life',
      'Chapter 2 – Cells',
      'Chapter 3 – Genetics',
      'Chapter 4 – Evolution',
      'Chapter 5 – Ecology',
    ])
    expect(course?.assessments).toEqual([
      { title: 'Quiz 3', kind: 'quiz', date: '2026-10-14' },
      { title: 'Lab report', kind: 'project', date: '2026-10-28' },
      { title: 'Final exam', kind: 'exam', date: '2026-12-08' },
    ])
    expect(r.draft.goal.term).toEqual({ start: '2026-08-24', end: '2026-12-18' })
  })

  it('turns a typed goal into one course to break down, with its deadline', () => {
    const r = parse(TYPED_GOAL)
    expect(r.format).toBe('goal')
    expect(r.needsBreakdown).toBe(true)
    expect(r.confidence).toBe(0.5)
    expect(r.unparsed).toEqual([])
    expect(r.draft).toEqual({
      goal: { title: 'Learn conversational Spanish', targetDate: '2027-06-30' },
      courses: [{ title: 'Learn conversational Spanish', units: [], assessments: [] }],
    })
    const exam = parse(TYPED_EXAM_GOAL)
    expect(exam.needsBreakdown).toBe(true)
    expect(exam.draft.goal).toEqual({
      title: 'Pass the AWS Solutions Architect Associate exam',
      targetDate: '2026-12-15',
    })
    expect(exam.draft.courses[0]?.assessments).toEqual([
      { title: 'Exam', kind: 'exam', date: '2026-12-15' },
    ])
    expect(parse('I want to get fluent in Italian in 6 months.').draft.goal).toEqual({
      title: 'Get fluent in Italian',
      targetDate: '2027-03-30',
    })
  })

  it('returns an empty result for blank or noise-only text', () => {
    for (const t of ['', '   \n\n', 'Syllabus\n-----\nOffice hours: Mon 2pm']) {
      const r = parse(t)
      expect(r.format).toBe('empty')
      expect(r.confidence).toBe(0)
      expect(r.draft.courses).toEqual([])
    }
  })
})

describe('parsePlanText: line rules', () => {
  it('does not mistake topics for assessments', () => {
    const r = parse(
      'Intro to Software Engineering\n- Project management basics\n- Testing and debugging\n- Test 1 on Oct 20\n- Final project',
    )
    const [course] = r.draft.courses
    expect(course?.units.map((u) => u.title)).toEqual([
      'Project management basics',
      'Testing and debugging',
    ])
    expect(course?.assessments).toEqual([
      { title: 'Test 1', kind: 'exam', date: '2026-10-20' },
      { title: 'Final project', kind: 'project' },
    ])
  })

  it('reads an assessment on a week header, and a table-style row as a unit', () => {
    const r = parse(
      'Data Structures\nWeek 6: Midterm exam\n7  Trees and heaps\n8  Graphs (4-6 hours)',
    )
    const [course] = r.draft.courses
    expect(course?.assessments).toEqual([{ title: 'Midterm exam', kind: 'exam' }])
    expect(course?.units).toEqual([
      { title: 'Trees and heaps' },
      { title: 'Graphs', estimatedMinutes: 300 },
    ])
  })

  it('reads a target line and bare OA / PA lines', () => {
    const r = parse(
      'C959 Discrete Mathematics I\nOA\nC949 Data Structures and Algorithms I\nPA\nFinish by 2027-03-31',
    )
    expect(r.draft.goal.targetDate).toBe('2027-03-31')
    expect(r.draft.courses.map((c) => c.assessments)).toEqual([
      [{ title: 'Objective assessment', kind: 'exam' }],
      [{ title: 'Performance assessment', kind: 'project' }],
    ])
  })
})

describe('dates and hours', () => {
  it('finds dates in common formats and infers the year', () => {
    const at = (t: string) => findDates(t, today).map((d) => d.date)
    expect(at('Midterm Oct 12')).toEqual(['2026-10-12'])
    expect(at('due October 12th, 2027')).toEqual(['2027-10-12'])
    expect(at('Mon, Nov 3 and 14 Dec')).toEqual(['2026-11-03', '2026-12-14'])
    expect(at('10/12 and 1/15/27 and 2026-12-08')).toEqual([
      '2026-10-12',
      '2027-01-15',
      '2026-12-08',
    ])
    expect(at('Jan 15')).toEqual(['2027-01-15']) // more than 60 days ago this year → next year
    expect(at('Sept 1')).toEqual(['2026-09-01']) // under 60 days ago → this year
    expect(at('Feb 30')).toEqual([]) // not a real date
    expect(findDates('Chapters 1/2', today, { numeric: false })).toEqual([])
    expect(inferYear(2, 29, '2027-03-01')).toBe('2028-02-29') // 2027 has none: the next one
  })

  it('reads deadlines of typed goals', () => {
    expect(goalDeadline('by Dec 15', today)?.date).toBe('2026-12-15')
    expect(goalDeadline('by June', today)?.date).toBe('2027-06-30')
    expect(goalDeadline('by March 2028', today)?.date).toBe('2028-03-31')
    expect(goalDeadline('in 10 weeks', today)?.date).toBe('2026-12-09')
    expect(goalDeadline('someday', today)).toBeNull()
  })

  it('reads hours and minutes, ranges averaged', () => {
    expect(takeHours('Networking (6 hrs)')).toEqual({ minutes: 360, rest: 'Networking  ' })
    expect(takeHours('Graphs 4–6 hours').minutes).toBe(300)
    expect(takeHours('Warm-up 90 min').minutes).toBe(90)
    expect(takeHours('~1.5h review').minutes).toBe(90)
    expect(takeHours('Chapter 6 Hardware').minutes).toBeNull()
    expect(cleanTitle('Week 3 ( – ): Control flow –')).toBe('Week 3: Control flow')
  })
})
