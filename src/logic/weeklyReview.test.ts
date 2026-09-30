import { describe, expect, it } from 'vitest'
import type { ISODate } from '@/db/types'
import type { NamedRef, StatSession, StatTask } from './stats'
import type { StreakDayEntry, StreakDayStatus } from './streaks'
import {
  buildWeeklyReview,
  isReviewDay,
  nextReviewWeek,
  previousReviewWeek,
  resolveReviewWeek,
  reviewWeekEnd,
  reviewWeekStart,
  reviewXpKey,
  XP_WEEKLY_REVIEW,
  type WeeklyReviewInput,
} from './weeklyReview'

/** The week under review in most tests: Mon Sep 21 – Sun Sep 27, 2026 (New York, EDT). */
const WEEK: ISODate = '2026-09-21'
const TODAY_SUNDAY: ISODate = '2026-09-27'

const GOALS: NamedRef[] = [
  { id: 'g-cs', title: 'B.S. Computer Science', color: 'blue' },
  { id: 'g-cert', title: 'CompTIA A+', color: 'green' },
]

function session(
  id: string,
  day: ISODate,
  minutes: number,
  goalId: string | null = 'g-cs',
  over: Partial<StatSession> = {},
): StatSession {
  const startedAt = new Date(`${day}T09:00:00-04:00`).getTime()
  return {
    id,
    kind: 'focus',
    status: 'completed',
    counted: true,
    day,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    actualMinutes: minutes,
    pausedMs: 0,
    taskId: null,
    goalId,
    milestoneId: null,
    ...over,
  }
}

function task(id: string, day: ISODate | null, over: Partial<StatTask> = {}): StatTask {
  return {
    id,
    status: 'done',
    completedDay: day,
    completedAt: day === null ? null : new Date(`${day}T12:00:00-04:00`).getTime(),
    estimatePomodoros: 2,
    ...over,
  }
}

function days(week: ISODate, statuses: readonly StreakDayStatus[]): StreakDayEntry[] {
  return statuses.map((status, i) => ({ day: addDay(week, i), status }))
}
function addDay(day: ISODate, n: number): ISODate {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function input(over: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return {
    weekStart: WEEK,
    weekStartsOn: 1,
    today: TODAY_SUNDAY,
    sessions: [],
    tasks: [],
    goals: GOALS,
    streak: { current: 0, best: 0 },
    streakDays: [],
    badges: [],
    courses: [],
    planned: [],
    ...over,
  }
}

describe('isReviewDay', () => {
  it('is Sunday when weeks start on Monday, Saturday when they start on Sunday', () => {
    expect(isReviewDay('2026-09-27', 1)).toBe(true) // Sunday
    expect(isReviewDay('2026-09-26', 1)).toBe(false) // Saturday
    expect(isReviewDay('2026-09-28', 1)).toBe(false) // Monday
    expect(isReviewDay('2026-09-26', 0)).toBe(true) // Saturday
    expect(isReviewDay('2026-09-27', 0)).toBe(false) // Sunday
  })

  it('reads the local calendar day, not a UTC parse of the string (the New York bug)', () => {
    // `new Date('2026-09-27')` is midnight UTC, which is still Saturday evening in New York.
    // Every day of a week must answer for its own weekday.
    const answers = Array.from({ length: 7 }, (_, i) => isReviewDay(addDay('2026-09-21', i), 1))
    expect(answers).toEqual([false, false, false, false, false, false, true])
    const saturdayStart = Array.from({ length: 7 }, (_, i) => isReviewDay(addDay('2026-09-20', i), 0))
    expect(saturdayStart).toEqual([false, false, false, false, false, false, true])
  })

  it('is right on the days the clocks change', () => {
    expect(isReviewDay('2026-03-08', 1)).toBe(true) // spring forward, a 23-hour Sunday
    expect(isReviewDay('2026-03-07', 1)).toBe(false)
    expect(isReviewDay('2026-03-07', 0)).toBe(true) // and the Saturday before it
    expect(isReviewDay('2026-11-01', 1)).toBe(true) // fall back, a 25-hour Sunday
    expect(isReviewDay('2026-10-31', 0)).toBe(true)
    expect(isReviewDay('2026-11-01', 0)).toBe(false)
  })
})

describe('which week', () => {
  it('takes any day to the first day of its week', () => {
    expect(reviewWeekStart('2026-09-27', 1)).toBe('2026-09-21')
    expect(reviewWeekStart('2026-09-27', 0)).toBe('2026-09-27')
    expect(reviewWeekEnd('2026-09-21')).toBe('2026-09-27')
  })

  it('resolves the address parameter: this week when missing, malformed, impossible or in the future', () => {
    const today = '2026-09-29' // Tuesday
    expect(resolveReviewWeek(undefined, today, 1)).toBe('2026-09-28')
    expect(resolveReviewWeek('soon', today, 1)).toBe('2026-09-28')
    expect(resolveReviewWeek('2026-02-30', today, 1)).toBe('2026-09-28')
    expect(resolveReviewWeek('2026-10-12', today, 1)).toBe('2026-09-28')
  })

  it('keeps a past week, and a mid-week day is taken to that week’s start', () => {
    expect(resolveReviewWeek('2026-09-21', '2026-09-29', 1)).toBe('2026-09-21')
    expect(resolveReviewWeek('2026-09-24', '2026-09-29', 1)).toBe('2026-09-21')
    expect(resolveReviewWeek('2026-09-24', '2026-09-29', 0)).toBe('2026-09-20')
  })

  it('steps back a week, and forward only as far as this week', () => {
    expect(previousReviewWeek('2026-09-21')).toBe('2026-09-14')
    expect(nextReviewWeek('2026-09-14', '2026-09-29', 1)).toBe('2026-09-21')
    expect(nextReviewWeek('2026-09-21', '2026-09-29', 1)).toBe('2026-09-28')
    expect(nextReviewWeek('2026-09-28', '2026-09-29', 1)).toBeNull()
  })

  it('steps by calendar weeks across the clock change', () => {
    expect(previousReviewWeek('2026-03-09')).toBe('2026-03-02')
    expect(nextReviewWeek('2026-11-02', '2026-11-20', 1)).toBe('2026-11-09')
    expect(previousReviewWeek('2026-11-02')).toBe('2026-10-26')
  })

  it('names the review XP key after the week and pays the ritual amount', () => {
    expect(reviewXpKey('2026-09-21')).toBe('review:2026-09-21')
    expect(XP_WEEKLY_REVIEW).toBe(10)
  })
})

describe('buildWeeklyReview: a full week', () => {
  const sessions = [
    session('s1', '2026-09-21', 50), // Mon
    session('s2', '2026-09-21', 25),
    session('s3', '2026-09-23', 25, 'g-cert'), // Wed
    session('s4', '2026-09-24', 25, 'g-cs'),
    session('s5', '2026-09-26', 100, null), // Sat, no goal
    session('old', '2026-09-15', 60), // the week before: only used for the comparison
  ]
  const tasks = [
    task('t1', '2026-09-21'),
    task('t2', '2026-09-22'),
    task('t3', '2026-09-24'),
    task('t0', '2026-09-16'), // last week
    task('open', null, { status: 'todo' }),
  ]
  const review = buildWeeklyReview(
    input({
      sessions,
      tasks,
      streak: { current: 5, best: 12 },
      streakDays: days(WEEK, ['qualified', 'rest', 'qualified', 'qualified', 'frozen', 'qualified', 'today-open']),
      planned: [
        { day: '2026-09-28', minutes: 60 },
        { day: '2026-09-28', minutes: 25 },
        { day: '2026-09-30', minutes: 50 },
        { day: '2026-10-04', minutes: 0 },
        { day: '2026-10-05', minutes: 90 }, // the week after next: not shown
        { day: '2026-09-27', minutes: 30 }, // this week: not shown
      ],
    }),
  )

  it('adds up the week and only the week', () => {
    expect(review.range).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(review.focusMinutes).toBe(225)
    expect(review.sessions).toBe(5)
    expect(review.tasksDone).toBe(3)
    expect(review.bestDay).toEqual({ day: '2026-09-26', minutes: 100 })
  })

  it('counts qualified days and freezes from the streak engine’s days, neutrally', () => {
    expect(review.qualifiedDays).toBe(4)
    expect(review.freezesUsed).toBe(1)
    expect(review.streak).toEqual({ current: 5, best: 12 })
  })

  it('splits the hours by goal, most first, with "Other" last', () => {
    expect(review.hoursPerGoal).toEqual([
      { id: 'g-cs', title: 'B.S. Computer Science', color: 'blue', minutes: 100 },
      { id: 'g-cert', title: 'CompTIA A+', color: 'green', minutes: 25 },
      { id: null, title: 'Other', color: 'gray', minutes: 100 },
    ])
  })

  it('previews the next seven days from the day after the week', () => {
    expect(review.nextWeek.map((d) => d.day)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(review.nextWeek[0]).toEqual({ day: '2026-09-28', minutes: 85, items: 2 })
    expect(review.nextWeek[2]).toEqual({ day: '2026-09-30', minutes: 50, items: 1 })
    // An item with no length still counts as an item.
    expect(review.nextWeek[6]).toEqual({ day: '2026-10-04', minutes: 0, items: 1 })
    expect(review.nextWeek[1]).toEqual({ day: '2026-09-29', minutes: 0, items: 0 })
  })

  it('gives neutral differences with last week and marks the week as ended today', () => {
    expect(review.comparedToLastWeek).toEqual({ focusMinutesDelta: 165, tasksDelta: 2 })
    expect(review.isCurrentWeek).toBe(true)
    expect(review.isOver).toBe(false)
  })

  it('lists specific, positive wins, best first, at most six', () => {
    expect(review.wins).toEqual([
      '3 tasks done',
      '3 h 45 min of focus',
      'On a 5-day streak',
      'You showed up on 4 days',
      'Longest session: 1 h 40 min',
      'Best day: Saturday, 1 h 40 min',
    ])
    expect(review.wins.length).toBeLessThanOrEqual(6)
  })
})

describe('buildWeeklyReview: the words', () => {
  const never = /less|fewer|down|behind|missed|lost|broke|only|fell|drop/i

  it('says nothing unfavourable when the week had less than the one before, and gives the numbers plainly', () => {
    const review = buildWeeklyReview(
      input({
        sessions: [session('a', '2026-09-22', 25), session('b', '2026-09-15', 200)],
        tasks: [task('t1', '2026-09-22'), task('t2', '2026-09-16'), task('t3', '2026-09-17')],
        streakDays: days(WEEK, ['rest', 'qualified', 'rest', 'rest', 'rest', 'rest', 'rest']),
      }),
    )
    expect(review.comparedToLastWeek.focusMinutesDelta).toBe(-175)
    expect(review.comparedToLastWeek.tasksDelta).toBe(-1)
    expect(review.wins).toEqual([
      '1 task done',
      '25 min of focus',
      'You showed up on 1 day',
      'Longest session: 25 min',
    ])
    for (const win of review.wins) expect(win).not.toMatch(never)
  })

  it('adds "more focus than last week" only when it is more, and only when there was a last week', () => {
    const more = buildWeeklyReview(
      input({ sessions: [session('a', '2026-09-22', 90), session('b', '2026-09-15', 30)] }),
    )
    expect(more.wins).toContain('1 h more focus than last week')
    const first = buildWeeklyReview(input({ sessions: [session('a', '2026-09-22', 90)] }))
    expect(first.wins.some((w) => w.includes('than last week'))).toBe(false)
  })

  it('a quiet week still gets kind, specific lines', () => {
    const review = buildWeeklyReview(
      input({
        sessions: [session('a', '2026-09-23', 25), session('b', '2026-09-25', 25)],
        streakDays: days(WEEK, ['rest', 'rest', 'qualified', 'rest', 'qualified', 'rest', 'rest']),
      }),
    )
    expect(review.wins).toEqual([
      '50 min of focus',
      'You showed up on 2 days',
      'Longest session: 25 min',
    ])
  })

  it('an empty week is one fresh-start line, in the week’s own first day', () => {
    expect(buildWeeklyReview(input()).wins).toEqual(['A fresh week starts Monday.'])
    expect(
      buildWeeklyReview(input({ weekStart: '2026-09-20', weekStartsOn: 0 })).wins,
    ).toEqual(['A fresh week starts Sunday.'])
  })

  it('celebrates finished courses and unlocked badges first, by name', () => {
    const unlocked = new Date('2026-09-25T18:00:00-04:00').getTime()
    const review = buildWeeklyReview(
      input({
        sessions: [session('a', '2026-09-25', 60)],
        courses: [{ code: 'C182', title: 'Introduction to IT', completedAt: unlocked }],
        badges: [{ id: 'first-focus', unlockedAt: unlocked }],
      }),
    )
    expect(review.wins.slice(0, 2)).toEqual([
      'Finished C182 Introduction to IT',
      'Unlocked First Focus 🌱',
    ])
  })

  it('groups several courses or badges into one line each', () => {
    const at = new Date('2026-09-25T18:00:00-04:00').getTime()
    const review = buildWeeklyReview(
      input({
        courses: [
          { code: 'C182', title: 'Introduction to IT', completedAt: at },
          { code: 'D278', title: 'Scripting and Programming - Foundations', completedAt: at },
        ],
        badges: [
          { id: 'first-focus', unlockedAt: at },
          { id: 'early-bird', unlockedAt: at },
        ],
      }),
    )
    expect(review.wins).toEqual([
      'Finished 2 courses: C182, D278',
      'Unlocked 2 badges: First Focus, Early Bird',
    ])
  })

  it('ignores a badge id this build does not know', () => {
    const at = new Date('2026-09-25T18:00:00-04:00').getTime()
    const review = buildWeeklyReview(input({ badges: [{ id: 'from-the-future', unlockedAt: at }] }))
    expect(review.wins).toEqual(['A fresh week starts Monday.'])
  })

  it('keeps at most six wins, dropping the least important', () => {
    const at = new Date('2026-09-25T18:00:00-04:00').getTime()
    const review = buildWeeklyReview(
      input({
        sessions: [
          session('a', '2026-09-22', 30),
          session('b', '2026-09-24', 60),
          session('c', '2026-09-15', 20),
        ],
        tasks: [task('t', '2026-09-22')],
        courses: [{ code: 'C779', title: 'Web Development Foundations', completedAt: at }],
        badges: [{ id: 'first-focus', unlockedAt: at }],
        streak: { current: 9, best: 9 },
        streakDays: days(WEEK, ['qualified', 'qualified', 'qualified', 'qualified', 'qualified', 'qualified', 'qualified']),
      }),
    )
    expect(review.wins).toHaveLength(6)
    expect(review.wins[0]).toBe('Finished C779 Web Development Foundations')
    expect(review.wins).not.toContain('1 h 10 min more focus than last week')
  })

  it('never uses the streak line for a short streak', () => {
    const review = buildWeeklyReview(
      input({ sessions: [session('a', '2026-09-22', 30)], streak: { current: 2, best: 2 } }),
    )
    expect(review.wins.some((w) => w.includes('streak'))).toBe(false)
  })

  it('does not name a best day when only one day had focus', () => {
    const review = buildWeeklyReview(input({ sessions: [session('a', '2026-09-22', 30)] }))
    expect(review.wins.some((w) => w.startsWith('Best day'))).toBe(false)
    expect(review.bestDay).toEqual({ day: '2026-09-22', minutes: 30 })
  })

  it('names no best day when two days tie, but reports the earlier one as the figure', () => {
    const review = buildWeeklyReview(
      input({ sessions: [session('b', '2026-09-24', 40), session('a', '2026-09-22', 40)] }),
    )
    expect(review.bestDay?.day).toBe('2026-09-22')
    expect(review.wins.some((w) => w.startsWith('Best day'))).toBe(false)
  })
})

describe('buildWeeklyReview: what counts', () => {
  it('counts only counted focus sessions', () => {
    const review = buildWeeklyReview(
      input({
        sessions: [
          session('ok', '2026-09-22', 25),
          session('uncounted', '2026-09-22', 20, 'g-cs', { counted: false }),
          session('brk', '2026-09-22', 5, 'g-cs', { kind: 'break' }),
          session('running', '2026-09-22', 25, 'g-cs', { status: 'running' }),
        ],
      }),
    )
    expect(review.focusMinutes).toBe(25)
    expect(review.sessions).toBe(1)
  })

  it('files a task under its completedDay, or the day of completedAt when that is missing', () => {
    const completedAt = new Date('2026-09-23T23:30:00-04:00').getTime()
    const review = buildWeeklyReview(
      input({
        tasks: [
          task('a', null, { completedAt, completedDay: null }),
          task('b', '2026-09-22'),
          task('todo', '2026-09-22', { status: 'todo' }),
        ],
      }),
    )
    expect(review.tasksDone).toBe(2)
  })

  it('a week that has not ended is marked so, and a past week is over', () => {
    const wed = buildWeeklyReview(input({ today: '2026-09-23' }))
    expect(wed.isCurrentWeek).toBe(true)
    expect(wed.isOver).toBe(false)
    const past = buildWeeklyReview(input({ today: '2026-10-02' }))
    expect(past.isCurrentWeek).toBe(false)
    expect(past.isOver).toBe(true)
  })

  it('freezes are counted, not judged', () => {
    const review = buildWeeklyReview(
      input({ streakDays: days(WEEK, ['qualified', 'frozen', 'qualified', 'qualified', 'qualified', 'qualified', 'qualified']) }),
    )
    expect(review.freezesUsed).toBe(1)
    expect(review.qualifiedDays).toBe(6)
  })

  it('ignores streak days outside the week', () => {
    const review = buildWeeklyReview(
      input({
        streakDays: [
          { day: '2026-09-20', status: 'qualified' },
          { day: '2026-09-21', status: 'qualified' },
          { day: '2026-09-28', status: 'frozen' },
        ],
      }),
    )
    expect(review.qualifiedDays).toBe(1)
    expect(review.freezesUsed).toBe(0)
  })
})

describe('buildWeeklyReview: badge and course windows are local days (DST)', () => {
  const at = (iso: string) => new Date(iso).getTime()

  it('an instant late on the last Sunday evening is in the week (a UTC window would drop it)', () => {
    // 22:00 EDT on Sunday Sep 27 is already Monday in UTC.
    const review = buildWeeklyReview(
      input({ badges: [{ id: 'night-owl', unlockedAt: at('2026-09-27T22:00:00-04:00') }] }),
    )
    expect(review.wins).toEqual(['Unlocked Night Owl 🦉'])
  })

  it('an instant just after local midnight belongs to the next week', () => {
    const review = buildWeeklyReview(
      input({ badges: [{ id: 'night-owl', unlockedAt: at('2026-09-28T00:10:00-04:00') }] }),
    )
    expect(review.wins).toEqual(['A fresh week starts Monday.'])
  })

  it('the fall-back week (25-hour Sunday, Nov 1) keeps its last hour and loses the next day', () => {
    const week = '2026-10-26'
    const inWeek = buildWeeklyReview(
      input({
        weekStart: week,
        today: '2026-11-01',
        badges: [
          { id: 'first-focus', unlockedAt: at('2026-10-26T00:00:00-04:00') },
          { id: 'early-bird', unlockedAt: at('2026-11-01T23:30:00-05:00') },
        ],
      }),
    )
    expect(inWeek.wins).toEqual(['Unlocked 2 badges: First Focus, Early Bird'])
    const outside = buildWeeklyReview(
      input({
        weekStart: week,
        today: '2026-11-01',
        badges: [
          { id: 'first-focus', unlockedAt: at('2026-10-25T23:30:00-04:00') },
          { id: 'early-bird', unlockedAt: at('2026-11-02T00:30:00-05:00') },
        ],
      }),
    )
    expect(outside.wins).toEqual(['A fresh week starts Monday.'])
  })

  it('the spring-forward week (23-hour Sunday, Mar 8) keeps its last minute and loses the next day', () => {
    const week = '2026-03-02'
    const inside = buildWeeklyReview(
      input({
        weekStart: week,
        today: '2026-03-08',
        badges: [{ id: 'first-focus', unlockedAt: at('2026-03-08T23:59:00-04:00') }],
      }),
    )
    expect(inside.wins).toEqual(['Unlocked First Focus 🌱'])
    const outside = buildWeeklyReview(
      input({
        weekStart: week,
        today: '2026-03-08',
        badges: [{ id: 'first-focus', unlockedAt: at('2026-03-09T00:00:00-04:00') }],
      }),
    )
    expect(outside.wins).toEqual(['A fresh week starts Monday.'])
  })

  it('the next-week preview lists seven real calendar days across the clock change', () => {
    const review = buildWeeklyReview(input({ weekStart: '2026-10-26', today: '2026-11-01' }))
    expect(review.nextWeek.map((d) => d.day)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ])
    const spring = buildWeeklyReview(input({ weekStart: '2026-03-02', today: '2026-03-08' }))
    expect(spring.nextWeek[0]?.day).toBe('2026-03-09')
    expect(spring.nextWeek[6]?.day).toBe('2026-03-15')
  })
})
