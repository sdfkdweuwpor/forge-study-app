import { describe, expect, it } from 'vitest'
import type { Goal, Milestone, PlannedAssessment } from '@/db/types'
import { calendarEvents } from './calendarEvents'
import { makeTask } from './fixtures'

const goal = {
  id: 'g1',
  title: 'B.S. Computer Science',
  status: 'active',
  targetDate: '2027-03-31',
} as Goal
const goal2 = { id: 'g2', title: 'Other', status: 'active', targetDate: null } as Goal
const course = {
  id: 'm1',
  goalId: 'g1',
  code: 'C182',
  title: 'Introduction to IT',
  status: 'active',
  dueDate: '2026-10-20',
} as Milestone
const exam = {
  id: 'pa1',
  goalId: 'g1',
  milestoneId: 'm1',
  kind: 'exam',
  title: 'Objective Assessment',
  date: '2026-10-22',
  time: null,
  durationMinutes: null,
  status: 'planned',
} as PlannedAssessment

const src = {
  goals: [goal, goal2],
  milestones: [course],
  plannedAssessments: [exam],
  tasks: [
    makeTask({
      id: 's1',
      kind: 'study',
      title: 'C182 · Operating systems (2/4)',
      doDate: '2026-10-01',
      doTime: '19:00',
      durationMinutes: 50,
      goalId: 'g1',
      milestoneId: 'm1',
    }),
    makeTask({
      id: 's2',
      kind: 'study',
      title: 'Networks',
      doDate: '2026-10-02',
      doTime: '19:00',
      durationMinutes: 25,
      goalId: 'g1',
      milestoneId: 'm1',
    }),
    makeTask({ id: 's3', kind: 'study', title: 'Unscheduled', doDate: '2026-10-02', goalId: 'g1' }),
    makeTask({
      id: 's4',
      kind: 'study',
      title: 'Finished',
      status: 'done',
      doDate: '2026-10-02',
      doTime: '10:00',
      goalId: 'g1',
    }),
    makeTask({
      id: 'e1',
      title: 'Dentist',
      doDate: '2026-10-05',
      doTime: '15:00',
      durationMinutes: 45,
    }),
    makeTask({ id: 'e2', title: 'Pay phone bill', dueDate: '2026-10-03' }),
    makeTask({ id: 'e3', title: 'Far away', doDate: '2026-12-05', doTime: '15:00' }),
  ],
}
const base = { today: '2026-09-30' }

describe('calendarEvents', () => {
  it('has study blocks, course targets, goal targets and assessments by default', () => {
    const ev = calendarEvents(src, base)
    expect(ev.map((e) => e.uid)).toEqual([
      's1@forge',
      's2@forge',
      'milestone-m1@forge',
      'assessment-pa1@forge',
      'goal-g1@forge',
    ])
    expect(ev[0]).toMatchObject({
      summary: 'C182 · Operating systems (2/4)',
      start: '19:00',
      durationMinutes: 50,
    })
    expect(ev[1]).toMatchObject({ summary: 'C182 · Networks' })
    expect(ev.find((e) => e.uid === 'milestone-m1@forge')).toMatchObject({
      allDay: true,
      summary: 'Target: C182 · Introduction to IT',
    })
    expect(ev.find((e) => e.uid === 'assessment-pa1@forge')).toMatchObject({
      allDay: true,
      summary: 'Exam: C182 Objective Assessment',
    })
  })

  it('adds timed everyday tasks and deadlines only when asked', () => {
    const ev = calendarEvents(src, { ...base, includeEveryday: true, includeDeadlines: true })
    expect(ev.find((e) => e.uid === 'e1@forge')).toMatchObject({
      summary: 'Dentist',
      durationMinutes: 45,
    })
    expect(ev.find((e) => e.uid === 'due-e2@forge')).toMatchObject({
      summary: 'Due: Pay phone bill',
      allDay: true,
    })
  })

  it('limits to the next N weeks', () => {
    const on = { ...base, includeEveryday: true, weeks: 2 }
    const ids = calendarEvents(src, on).map((e) => e.uid)
    expect(ids).toContain('e1@forge')
    expect(ids).not.toContain('milestone-m1@forge')
    expect(calendarEvents(src, { ...on, weeks: 13 }).map((e) => e.uid)).toContain('e3@forge')
  })

  it('limits to chosen goals', () => {
    const ids = calendarEvents(src, { ...base, goalIds: ['g2'] }).map((e) => e.uid)
    expect(ids).toEqual([])
  })

  it('exports only active goals unless asked for the others too', () => {
    const paused = { ...goal, status: 'paused' } as Goal
    const archived = { ...goal, status: 'archived' } as Goal
    const inactive = { ...src, goals: [paused, goal2] }
    // Paused: none of its study blocks, course targets, assessments or goal target.
    expect(calendarEvents(inactive, base).map((e) => e.uid)).toEqual([])
    expect(calendarEvents({ ...src, goals: [archived, goal2] }, base)).toEqual([])
    const all = calendarEvents(inactive, { ...base, includeInactiveGoals: true }).map((e) => e.uid)
    expect(all).toEqual([
      's1@forge',
      's2@forge',
      'milestone-m1@forge',
      'assessment-pa1@forge',
      'goal-g1@forge',
    ])
  })

  it('keeps everyday tasks and their deadlines whatever the goals are', () => {
    const ev = calendarEvents(
      { ...src, goals: [{ ...goal, status: 'paused' } as Goal] },
      { ...base, includeEveryday: true, includeDeadlines: true },
    )
    expect(ev.map((e) => e.uid)).toEqual(['due-e2@forge', 'e1@forge', 'e3@forge'])
  })

  it('skips finished milestones and assessments', () => {
    const ev = calendarEvents(
      {
        ...src,
        milestones: [{ ...course, status: 'done' }],
        plannedAssessments: [{ ...exam, status: 'done' }],
      },
      base,
    )
    expect(ev.map((e) => e.uid)).toEqual(['s1@forge', 's2@forge', 'goal-g1@forge'])
  })

  it('times a booked assessment', () => {
    const ev = calendarEvents(
      { ...src, plannedAssessments: [{ ...exam, time: '09:00', durationMinutes: 90 }] },
      base,
    )
    expect(ev.find((e) => e.uid === 'assessment-pa1@forge')).toMatchObject({
      start: '09:00',
      durationMinutes: 90,
    })
  })
})
