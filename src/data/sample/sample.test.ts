import { describe, expect, it } from 'vitest'
import { dayOf } from '@/logic/dates'
import { xpForTask } from '@/logic/xp'
import { buildStarterData } from './starterTasks'
import { buildWguBsCs, COURSE_IDS, WGU_GOAL_ID } from './wguBsCs'

/** The fixed clock the screenshots and e2e specs use: Tue 2026-09-29 09:30 local. */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = dayOf(NOW)

const wgu = buildWguBsCs(TODAY, NOW)
const { tasks, xpEvents } = buildStarterData({ today: TODAY, now: NOW })

describe('the WGU sample goal', () => {
  it('is a B.S. in Computer Science with the five named courses', () => {
    expect(wgu.goal).toMatchObject({
      title: 'B.S. Computer Science — WGU',
      icon: '🎓',
      kind: 'degree',
    })
    const courses = wgu.milestones.map((m) => `${m.code} ${m.title}`)
    expect(courses).toEqual([
      'C182 Introduction to IT',
      'C779 Web Development Foundations',
      'D278 Scripting and Programming Foundations',
      'C172 Network and Security Foundations',
      'C959 Discrete Mathematics I',
    ])
  })

  it('has CUs, hours and one status each: C182 done, C779 in progress, the rest to do', () => {
    const byCode = Object.fromEntries(wgu.milestones.map((m) => [m.code, m]))
    expect(byCode.C182).toMatchObject({ status: 'done', cus: 4, estimateHours: 40 })
    expect(byCode.C182?.completedAt).not.toBeNull()
    expect(byCode.C779).toMatchObject({ status: 'active', cus: 3, estimateHours: 30 })
    for (const code of ['D278', 'C172', 'C959']) {
      expect(byCode[code]).toMatchObject({ status: 'todo', completedAt: null })
      expect(byCode[code]?.cus).toBeGreaterThan(0)
      expect(byCode[code]?.estimateHours).toBeGreaterThan(0)
    }
  })

  it('links every course and unit back to the goal, with unique ids', () => {
    for (const m of wgu.milestones) expect(m.goalId).toBe(WGU_GOAL_ID)
    const courseIds = new Set(wgu.milestones.map((m) => m.id))
    for (const u of wgu.units) {
      expect(u.goalId).toBe(WGU_GOAL_ID)
      expect(courseIds.has(u.milestoneId)).toBe(true)
    }
    expect(new Set(wgu.units.map((u) => u.id)).size).toBe(wgu.units.length)
  })

  it('unit minutes add up to about the course hours, and finished courses have finished units', () => {
    for (const m of wgu.milestones) {
      const minutes = wgu.units
        .filter((u) => u.milestoneId === m.id)
        .reduce((n, u) => n + (u.estimateMinutes ?? 0), 0)
      expect(Math.abs(minutes / 60 - m.estimateHours)).toBeLessThanOrEqual(m.estimateHours * 0.25)
    }
    const c182Units = wgu.units.filter((u) => u.milestoneId === COURSE_IDS.C182)
    expect(c182Units.every((u) => u.status === 'done' && u.completedAt !== null)).toBe(true)
  })

  it('is dated around the given day: a six-month term already under way', () => {
    const term = wgu.goal.terms[0]
    expect(term && term.start < TODAY && TODAY < term.end).toBe(true)
    expect(wgu.goal.targetDate).toBe(term?.end)
    expect(wgu.goal.availability.minutesByWeekday).toHaveLength(7)
  })

  it('moves with the clock: the same shape a month later', () => {
    const later = buildWguBsCs('2026-10-29', NOW)
    expect(later.goal.startDate > wgu.goal.startDate).toBe(true)
    expect(later.milestones.map((m) => m.id)).toEqual(wgu.milestones.map((m) => m.id))
  })
})

describe('the sample tasks', () => {
  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')

  it('are about thirty, with unique ids and real titles', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(25)
    expect(tasks.length).toBeLessThanOrEqual(40)
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
    for (const t of tasks) expect(t.title.trim().length).toBeGreaterThan(5)
    expect(tasks.some((t) => /lorem|ipsum/i.test(t.title))).toBe(false)
  })

  it('cover overdue, today, upcoming, undated and completed work', () => {
    expect(open.some((t) => t.dueDate !== null && t.dueDate < TODAY)).toBe(true)
    expect(open.some((t) => t.dueDate === TODAY)).toBe(true)
    expect(open.some((t) => t.dueDate !== null && t.dueDate > TODAY)).toBe(true)
    expect(open.some((t) => t.dueDate === null)).toBe(true)
    expect(done.length).toBeGreaterThanOrEqual(10)
    expect(open.some((t) => t.status === 'doing')).toBe(true)
  })

  it('include scheduled goal chunks named like "C779 · Unit 3: CSS layout (45 min)"', () => {
    const chunk = tasks.find((t) => t.title === 'C779 · Unit 3: CSS layout (45 min)')
    expect(chunk).toMatchObject({
      source: 'schedule',
      goalId: WGU_GOAL_ID,
      milestoneId: COURSE_IDS.C779,
      dueDate: TODAY,
      estimateMinutes: 45,
      estimatePomodoros: 2,
    })
    const scheduled = tasks.filter((t) => t.source === 'schedule')
    expect(scheduled.length).toBeGreaterThan(8)
    expect(new Set(scheduled.map((t) => t.scheduleKey)).size).toBe(scheduled.length)
    for (const t of scheduled) {
      expect(t.unitId && wgu.units.some((u) => u.id === t.unitId)).toBe(true)
      expect(t.title).toMatch(/^[A-Z]\d{3} · Unit \d+: .+ \(\d+ min\)$/)
    }
  })

  it('include personal tasks, tags, and a weekly recurring review on Sundays', () => {
    for (const title of ['Email mentor about term plan', 'Renew library card']) {
      expect(tasks.some((t) => t.title === title && t.source === 'user')).toBe(true)
    }
    expect(new Set(tasks.flatMap((t) => t.tags)).size).toBeGreaterThanOrEqual(5)
    const review = open.find((t) => t.title === 'Weekly review')
    expect(review?.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0] })
    // Sunday.
    expect(review?.dueDate && new Date(`${review.dueDate}T12:00:00`).getDay()).toBe(0)
    // Last week's finished instance belongs to the same series.
    const finished = done.find((t) => t.title === 'Weekly review')
    expect(finished?.seriesId).toBe(review?.seriesId)
  })

  it('link only to goals, courses and units that exist', () => {
    const courseIds = new Set(wgu.milestones.map((m) => m.id))
    for (const t of tasks) {
      if (t.goalId !== null) expect(t.goalId).toBe(WGU_GOAL_ID)
      if (t.milestoneId !== null) expect(courseIds.has(t.milestoneId)).toBe(true)
    }
  })

  it('finished tasks carry completion fields within the last two weeks', () => {
    for (const t of done) {
      expect(t.completedAt).not.toBeNull()
      expect(t.completedDay).not.toBeNull()
      expect(t.completedDay && t.completedDay < TODAY).toBe(true)
      expect(t.completedDay && t.completedDay >= '2026-09-15').toBe(true)
    }
    for (const t of open) expect([t.completedAt, t.completedDay]).toEqual([null, null])
  })
})

describe('the sample XP', () => {
  it('has one event per finished task, worth exactly what completing it pays', () => {
    const done = tasks.filter((t) => t.status === 'done')
    for (const t of done) {
      const events = xpEvents.filter((e) => e.key === `task:${t.id}`)
      expect(events).toHaveLength(1)
      expect(events[0]?.amount).toBe(
        xpForTask({ estimate: t.estimatePomodoros, priority: t.priority }),
      )
      expect(events[0]?.day).toBe(t.completedDay)
    }
  })

  it('adds the course bonus for C182 and a few daily-goal awards, over the last 14 days', () => {
    expect(xpEvents.find((e) => e.source === 'course')).toMatchObject({ amount: 250 })
    expect(xpEvents.filter((e) => e.source === 'dailyGoal').length).toBeGreaterThanOrEqual(2)
    expect(new Set(xpEvents.map((e) => e.id)).size).toBe(xpEvents.length)
    for (const e of xpEvents) {
      expect(e.day < TODAY && e.day >= '2026-09-15').toBe(true)
      expect(e.amount).toBeGreaterThan(0)
    }
  })
})
