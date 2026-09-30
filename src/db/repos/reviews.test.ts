import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COURSE_IDS, WGU_GOAL_ID, buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  completeWeeklyReview,
  getWeeklyReview,
  isReviewDone,
  loadReviewInput,
  plannedMinutesOf,
  saveReviewNote,
} from '@/db/repos/reviews'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { createTask } from '@/db/repos/tasks'
import { getXpSummary, xpNetForKey } from '@/db/repos/xp'
import type { ISODate, Millis, Session } from '@/db/types'
import { buildWeeklyReview } from '@/logic/weeklyReview'

const WEEK: ISODate = '2026-09-21' // Monday
const TODAY: ISODate = '2026-09-27' // Sunday: the review day
const NOW: Millis = new Date(2026, 8, 27, 20, 0).getTime()

let seq = 0

function sessionRow(day: ISODate, minutes: number, over: Partial<Session> = {}): Session {
  seq += 1
  const startedAt = new Date(`${day}T09:00:00`).getTime() + seq * 60_000
  return {
    id: `s${seq}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    plannedMinutes: minutes,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: minutes,
    round: seq,
    interrupted: false,
    counted: true,
    note: null,
    ...over,
  }
}

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  await updateSettings({ weekStartsOn: 1 })
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('the note ("what got in the way?")', () => {
  it('creates the row on the first save and keeps the week as its id', async () => {
    expect(await getWeeklyReview(WEEK)).toBeUndefined()
    const row = await saveReviewNote(WEEK, 'The D278 practice test ran long.', { now: NOW })
    expect(row).toMatchObject({
      id: WEEK,
      weekStart: WEEK,
      blockers: 'The D278 practice test ran long.',
      wins: '',
      completedAt: null,
    })
    expect(await getWeeklyReview(WEEK)).toEqual(row)
  })

  it('a later save replaces the text and changes nothing else', async () => {
    const first = await saveReviewNote(WEEK, 'Draft', { now: NOW })
    const second = await saveReviewNote(WEEK, 'Draft, then more', { now: NOW + 5_000 })
    expect(second.blockers).toBe('Draft, then more')
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt).toBe(NOW + 5_000)
    expect(await db.weeklyReviews.count()).toBe(1)
  })

  it('an emptied note is saved as empty, not dropped', async () => {
    await saveReviewNote(WEEK, 'Something', { now: NOW })
    const row = await saveReviewNote(WEEK, '', { now: NOW + 1 })
    expect(row.blockers).toBe('')
    expect(await db.weeklyReviews.count()).toBe(1)
  })

  it('weeks are separate rows', async () => {
    await saveReviewNote('2026-09-14', 'Last week', { now: NOW })
    await saveReviewNote(WEEK, 'This week', { now: NOW })
    expect((await getWeeklyReview('2026-09-14'))?.blockers).toBe('Last week')
    expect((await getWeeklyReview(WEEK))?.blockers).toBe('This week')
  })
})

describe('marking the review done', () => {
  it('pays 10 XP once, under review:<weekStart>, and records the moment', async () => {
    const done = await completeWeeklyReview(WEEK, ['3 tasks done', '2 h of focus'], { now: NOW })
    expect(done.xp).toMatchObject({ source: 'ritual', amount: 10, key: `review:${WEEK}` })
    expect(done.row).toMatchObject({ completedAt: NOW, wins: '3 tasks done\n2 h of focus' })
    expect(await isReviewDone(WEEK)).toBe(true)
    expect(await xpNetForKey(`review:${WEEK}`)).toBe(10)
    expect((await getXpSummary(TODAY)).lifetime).toBe(10)
  })

  it('is idempotent: the second call pays nothing and keeps the first moment and wins', async () => {
    await completeWeeklyReview(WEEK, ['First'], { now: NOW })
    const again = await completeWeeklyReview(WEEK, ['Second'], { now: NOW + 60_000 })
    expect(again.xp).toBeNull()
    expect(again.row.completedAt).toBe(NOW)
    expect(again.row.wins).toBe('First')
    expect(await xpNetForKey(`review:${WEEK}`)).toBe(10)
    expect(await db.xpEvents.where('source').equals('ritual').count()).toBe(1)
  })

  it('two at once still pay once', async () => {
    const [a, b] = await Promise.all([
      completeWeeklyReview(WEEK, [], { now: NOW }),
      completeWeeklyReview(WEEK, [], { now: NOW }),
    ])
    expect([a.xp, b.xp].filter((x) => x !== null)).toHaveLength(1)
    expect(await db.xpEvents.where('key').equals(`review:${WEEK}`).count()).toBe(1)
  })

  it('keeps the note written before, and a note written after leaves it done', async () => {
    await saveReviewNote(WEEK, 'Slow Tuesday', { now: NOW })
    const done = await completeWeeklyReview(WEEK, ['A win'], { now: NOW + 1_000 })
    expect(done.row.blockers).toBe('Slow Tuesday')
    expect(done.row.createdAt).toBe(NOW)
    const after = await saveReviewNote(WEEK, 'Slow Tuesday and Thursday', { now: NOW + 2_000 })
    expect(after.completedAt).toBe(NOW + 1_000)
    expect(after.wins).toBe('A win')
    expect(await isReviewDone(WEEK)).toBe(true)
  })

  it('each week pays its own 10 XP', async () => {
    await completeWeeklyReview('2026-09-14', [], { now: NOW })
    const next = await completeWeeklyReview(WEEK, [], { now: NOW })
    expect(next.xp?.amount).toBe(10)
    expect((await getXpSummary(TODAY)).lifetime).toBe(20)
  })

  it('does not pay for a week that is not done yet', async () => {
    await saveReviewNote(WEEK, 'Only a note', { now: NOW })
    expect(await isReviewDone(WEEK)).toBe(false)
    expect(await db.xpEvents.count()).toBe(0)
  })
})

describe('plannedMinutesOf', () => {
  it('uses the slot, then the minute estimate, then pomodoros, else nothing', () => {
    const t = (d: number | null, m: number | null, p: number | null) => ({
      durationMinutes: d,
      estimateMinutes: m,
      estimatePomodoros: p,
    })
    expect(plannedMinutesOf(t(50, 30, 2), 25)).toBe(50)
    expect(plannedMinutesOf(t(null, 30, 2), 25)).toBe(30)
    expect(plannedMinutesOf(t(null, null, 2), 25)).toBe(50)
    expect(plannedMinutesOf(t(0, 0, 3), 30)).toBe(90)
    expect(plannedMinutesOf(t(null, null, null), 25)).toBe(0)
  })
})

describe('loadReviewInput', () => {
  it('reads the week and the one before it, counted sessions and finished tasks only', async () => {
    await db.sessions.bulkAdd([
      sessionRow('2026-09-14', 40), // the week before: kept for the comparison
      sessionRow('2026-09-21', 25),
      sessionRow('2026-09-27', 50),
      sessionRow('2026-09-22', 25, { counted: false }),
      sessionRow('2026-09-22', 5, { kind: 'break' }),
      sessionRow('2026-09-07', 25), // two weeks before: not read
      sessionRow('2026-09-28', 25), // after the week: not read
    ])
    const a = await createTask({ title: 'Email mentor about term plan', status: 'done' }, { now: NOW })
    await db.tasks.update(a.id, { completedDay: '2026-09-23', completedAt: NOW - 3 * 86_400_000 })
    const b = await createTask({ title: 'Older task', status: 'done' }, { now: NOW })
    await db.tasks.update(b.id, { completedDay: '2026-08-01', completedAt: NOW - 50 * 86_400_000 })
    await createTask({ title: 'Still open' }, { now: NOW })

    const input = await loadReviewInput(WEEK, TODAY)
    expect(input.weekStartsOn).toBe(1)
    expect(input.sessions.map((s) => s.day).sort()).toEqual(['2026-09-14', '2026-09-21', '2026-09-27'])
    expect(input.tasks.map((t) => t.id)).toEqual([a.id])
  })

  it('previews the next week from open tasks: do date first, else the deadline, each once', async () => {
    await createTask({ title: 'Study C779 unit 3', doDate: '2026-09-28', durationMinutes: 50 }, { now: NOW })
    await createTask({ title: 'Email mentor', doDate: '2026-09-28', estimatePomodoros: 1 }, { now: NOW })
    await createTask(
      { title: 'D278 practice test', doDate: '2026-09-30', dueDate: '2026-10-02', estimateMinutes: 90 },
      { now: NOW },
    )
    await createTask({ title: 'Pay the phone bill', dueDate: '2026-10-01' }, { now: NOW })
    await createTask({ title: 'Later', doDate: '2026-10-05' }, { now: NOW })
    await createTask({ title: 'This week', doDate: '2026-09-25' }, { now: NOW })
    await createTask({ title: 'Already done', doDate: '2026-09-29', status: 'done' }, { now: NOW })

    const input = await loadReviewInput(WEEK, TODAY)
    const byDay = new Map<string, { items: number; minutes: number }>()
    for (const p of input.planned) {
      const cur = byDay.get(p.day) ?? { items: 0, minutes: 0 }
      byDay.set(p.day, { items: cur.items + 1, minutes: cur.minutes + p.minutes })
    }
    expect([...byDay.entries()].sort()).toEqual([
      ['2026-09-28', { items: 2, minutes: 75 }],
      ['2026-09-30', { items: 1, minutes: 90 }],
      ['2026-10-01', { items: 1, minutes: 0 }],
    ])
    // The deadline of a task that has a do date does not add it a second time.
    expect(input.planned).toHaveLength(4)
  })

  it('carries goals with a chart colour, finished courses and unlocked badges', async () => {
    const sample = buildWguBsCs(TODAY, NOW)
    await db.goals.add(sample.goal)
    await db.milestones.bulkAdd(sample.milestones)
    const done = new Date(2026, 8, 23, 16, 30).getTime()
    await db.milestones.update(COURSE_IDS.C182, { status: 'done', completedAt: done })
    await db.badges.add({ id: 'first-focus', createdAt: done, updatedAt: done, unlockedAt: done, context: null })

    const input = await loadReviewInput(WEEK, TODAY)
    expect(input.goals.map((g) => g.id)).toContain(WGU_GOAL_ID)
    expect(input.goals.every((g) => g.color !== 'red')).toBe(true)
    expect(input.courses).toEqual([
      { code: 'C182', title: expect.stringContaining('Introduction to IT') as string, completedAt: done },
    ])
    expect(input.badges).toEqual([{ id: 'first-focus', unlockedAt: done }])
  })

  it('reads the streak as it stood at the end of a past week, and today’s days for the freeze count', async () => {
    // Mon–Sat of the week, then nothing: the run ended Saturday.
    const rows = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'].map(
      (day) => ({
        id: day,
        createdAt: NOW,
        updatedAt: NOW,
        day,
        focusMinutes: 25,
        focusSessions: 1,
        pomodoros: 1,
        tasksDone: 0,
        xp: 0,
        dailyGoalTarget: 6,
        dailyGoalHit: false,
        qualified: true,
      }),
    )
    await db.streakDays.bulkAdd(rows)
    const inWeek = await loadReviewInput(WEEK, '2026-09-27')
    expect(inWeek.streak).toEqual({ current: 6, best: 6 })
    // Reviewed a week later, the streak of that week is still what it was then.
    const later = await loadReviewInput(WEEK, '2026-10-04')
    expect(later.streak).toEqual({ current: 6, best: 6 })
    expect(later.streakDays.filter((d) => d.status === 'qualified')).toHaveLength(6)
  })

  it('feeds buildWeeklyReview end to end', async () => {
    await db.sessions.bulkAdd([sessionRow('2026-09-22', 50), sessionRow('2026-09-24', 25)])
    await createTask({ title: 'Study C182 unit 1', doDate: '2026-09-29', durationMinutes: 45 }, { now: NOW })
    const review = buildWeeklyReview(await loadReviewInput(WEEK, TODAY))
    expect(review.focusMinutes).toBe(75)
    expect(review.nextWeek[1]).toEqual({ day: '2026-09-29', minutes: 45, items: 1 })
    expect(review.wins).toContain('1 h 15 min of focus')
  })

  it('an empty database is a fresh week, not an error', async () => {
    const review = buildWeeklyReview(await loadReviewInput(WEEK, TODAY))
    expect(review.wins).toEqual(['A fresh week starts Monday.'])
    expect(review.hoursPerGoal).toEqual([])
    expect(review.nextWeek).toHaveLength(7)
  })
})
