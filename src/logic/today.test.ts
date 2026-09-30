// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8 (23 h day), ends Sun Nov 1 (25 h day).
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import { groupToday, isGoalWork, oneListToday, pickNow, type TodayContext } from '@/logic/today'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${String(seq).padStart(3, '0')}`,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
    title: `Task ${seq}`,
    notes: [],
    status: 'todo',
    priority: 0,
    doDate: null,
    doTime: null,
    estimatePomodoros: null,
    estimateMinutes: null,
    tags: [],
    goalId: null,
    milestoneId: null,
    unitId: null,
    source: 'user',
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    orderInDay: 0,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order: seq,
    boardOrder: seq,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    durationMinutes: null,
    autoSlot: false,
    kind: 'task',
    assessmentId: null,
    sync: null,
    dueDate: null,
    dueTime: null,
    ...overrides,
  }
}

const titles = (tasks: readonly Task[]): string[] => tasks.map((t) => t.title)
const local = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime()

/** Tuesday 2026-09-29, 10:00. */
const TODAY = '2026-09-29'
const CTX: TodayContext = { today: TODAY, now: local(2026, 9, 29, 10) }

describe('isGoalWork', () => {
  it('is scheduler and flashcard work only', () => {
    expect(isGoalWork(task({ source: 'schedule' }))).toBe(true)
    expect(isGoalWork(task({ source: 'flashcards' }))).toBe(true)
    for (const source of ['user', 'ritual', 'template', 'onboarding'] as const) {
      expect(isGoalWork(task({ source }))).toBe(false)
    }
    // A hand-made task linked to a goal is still the user's own.
    expect(isGoalWork(task({ source: 'user', goalId: 'g1' }))).toBe(false)
  })
})

describe('groupToday', () => {
  it('splits tasks into goal work, own tasks, rolled over and completed', () => {
    const tasks = [
      task({ title: 'plan chunk', source: 'schedule', doDate: TODAY, goalId: 'g1' }),
      task({ title: 'cards', source: 'flashcards', doDate: TODAY }),
      task({ title: 'mine', doDate: TODAY }),
      task({ title: 'late plan', source: 'schedule', doDate: '2026-09-27' }),
      task({ title: 'late mine', doDate: '2026-09-28' }),
      task({ title: 'tomorrow', doDate: '2026-09-30' }),
      task({ title: 'no date' }),
      task({
        title: 'done today',
        status: 'done',
        doDate: TODAY,
        completedDay: TODAY,
        completedAt: local(2026, 9, 29, 9),
      }),
      task({
        title: 'done before',
        status: 'done',
        doDate: '2026-09-20',
        completedDay: '2026-09-21',
      }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.fromGoals)).toEqual(['plan chunk', 'cards'])
    expect(titles(g.yours)).toEqual(['mine'])
    expect(g.carriedOver.map((r) => [r.task.title, r.daysAgo])).toEqual([
      ['late plan', 2],
      ['late mine', 1],
    ])
    expect(titles(g.completedToday)).toEqual(['done today'])
  })

  it('returns empty groups for no tasks', () => {
    expect(groupToday([], CTX)).toEqual({
      fromGoals: [],
      yours: [],
      carriedOver: [],
      completedToday: [],
    })
  })

  it('does not mutate or reuse the input array', () => {
    const tasks = [task({ doDate: TODAY, order: 2 }), task({ doDate: TODAY, order: 1 })]
    const copy = [...tasks]
    groupToday(tasks, CTX)
    expect(tasks).toEqual(copy)
  })

  it('hides tasks skipped for today, including overdue ones', () => {
    const tasks = [
      task({ title: 'skipped', doDate: TODAY, skippedOn: TODAY }),
      task({ title: 'skipped overdue', doDate: '2026-09-25', skippedOn: TODAY }),
      task({ title: 'skipped yesterday', doDate: TODAY, skippedOn: '2026-09-28' }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.yours)).toEqual(['skipped yesterday'])
    expect(g.carriedOver).toEqual([])
  })

  it('includes an in-progress task even when it is due later or has no date', () => {
    const tasks = [
      task({ title: 'pulled forward', status: 'doing', doDate: '2026-10-02' }),
      task({ title: 'no date doing', status: 'doing' }),
      task({ title: 'doing plan', status: 'doing', source: 'schedule', doDate: '2026-10-01' }),
      task({ title: 'todo later', doDate: '2026-10-02' }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.yours).sort()).toEqual(['no date doing', 'pulled forward'])
    expect(titles(g.fromGoals)).toEqual(['doing plan'])
  })

  it('an overdue in-progress task is rolled over, once', () => {
    const g = groupToday([task({ title: 'stuck', status: 'doing', doDate: '2026-09-26' })], CTX)
    expect(g.yours).toEqual([])
    expect(g.carriedOver.map((r) => r.daysAgo)).toEqual([3])
  })

  describe('ordering', () => {
    it('timed tasks first by time, then the day order, then priority, then list order', () => {
      const tasks = [
        task({ title: 'z low', doDate: TODAY, priority: 1, order: 1 }),
        task({ title: 'urgent', doDate: TODAY, priority: 4, order: 9 }),
        task({ title: '14:00', doDate: TODAY, doTime: '14:00' }),
        task({ title: '09:00', doDate: TODAY, doTime: '09:00' }),
        task({ title: 'pinned first', doDate: TODAY, orderInDay: -1, priority: 0 }),
        task({ title: 'a low', doDate: TODAY, priority: 1, order: 0.5 }),
      ]
      expect(titles(groupToday(tasks, CTX).yours)).toEqual([
        '09:00',
        '14:00',
        'pinned first',
        'urgent',
        'a low',
        'z low',
      ])
    })

    it('goal work sorts by start time then orderInDay', () => {
      const tasks = [
        task({ title: 'chunk 3', source: 'schedule', doDate: TODAY, orderInDay: 3 }),
        task({ title: 'chunk 1', source: 'schedule', doDate: TODAY, orderInDay: 1 }),
        task({
          title: 'evening',
          source: 'schedule',
          doDate: TODAY,
          doTime: '19:00',
          orderInDay: 0,
        }),
        task({
          title: 'morning',
          source: 'schedule',
          doDate: TODAY,
          doTime: '08:30',
          orderInDay: 9,
        }),
      ]
      expect(titles(groupToday(tasks, CTX).fromGoals)).toEqual([
        'morning',
        'evening',
        'chunk 1',
        'chunk 3',
      ])
    })

    it('rolled over: highest priority first, then most overdue', () => {
      const tasks = [
        task({ title: 'old low', doDate: '2026-09-10', priority: 1 }),
        task({ title: 'recent urgent', doDate: '2026-09-28', priority: 4 }),
        task({ title: 'old high', doDate: '2026-09-15', priority: 3 }),
        task({ title: 'recent high', doDate: '2026-09-27', priority: 3 }),
      ]
      expect(groupToday(tasks, CTX).carriedOver.map((r) => r.task.title)).toEqual([
        'recent urgent',
        'old high',
        'recent high',
        'old low',
      ])
    })

    it('completed today: latest first', () => {
      const tasks = [
        task({
          title: 'first',
          status: 'done',
          completedDay: TODAY,
          completedAt: local(2026, 9, 29, 8),
        }),
        task({
          title: 'last',
          status: 'done',
          completedDay: TODAY,
          completedAt: local(2026, 9, 29, 9, 30),
        }),
      ]
      expect(titles(groupToday(tasks, CTX).completedToday)).toEqual(['last', 'first'])
    })

    it('is deterministic whatever order the tasks arrive in', () => {
      const tasks = [
        task({ title: 'a', doDate: TODAY }),
        task({ title: 'b', doDate: TODAY }),
        task({ title: 'c', doDate: TODAY }),
      ]
      const forward = titles(groupToday(tasks, CTX).yours)
      expect(titles(groupToday([...tasks].reverse(), CTX).yours)).toEqual(forward)
    })
  })

  describe('daysAgo counts calendar days', () => {
    it('across the spring-forward night', () => {
      const ctx: TodayContext = { today: '2026-03-08', now: local(2026, 3, 8, 12) }
      const g = groupToday([task({ doDate: '2026-03-06' }), task({ doDate: '2026-03-07' })], ctx)
      expect(g.carriedOver.map((r) => r.daysAgo).sort()).toEqual([1, 2])
    })

    it('across the fall-back night', () => {
      const ctx: TodayContext = { today: '2026-11-02', now: local(2026, 11, 2, 12) }
      const g = groupToday([task({ doDate: '2026-10-31' }), task({ doDate: '2026-11-01' })], ctx)
      expect(g.carriedOver.map((r) => r.daysAgo).sort()).toEqual([1, 2])
    })

    it('across a year boundary', () => {
      const ctx: TodayContext = { today: '2027-01-02', now: local(2027, 1, 2, 12) }
      expect(groupToday([task({ doDate: '2026-12-30' })], ctx).carriedOver[0]?.daysAgo).toBe(3)
    })
  })

  describe('completedToday', () => {
    it('uses completedDay when present', () => {
      const tasks = [
        task({ title: 'yes', status: 'done', completedDay: TODAY }),
        task({
          title: 'no',
          status: 'done',
          completedDay: '2026-09-28',
          completedAt: local(2026, 9, 29, 9),
        }),
      ]
      expect(titles(groupToday(tasks, CTX).completedToday)).toEqual(['yes'])
    })

    it('falls back to the local day of completedAt', () => {
      const tasks = [
        task({ title: 'midnight', status: 'done', completedAt: local(2026, 9, 29, 0, 0) }),
        task({ title: 'late', status: 'done', completedAt: local(2026, 9, 29, 23, 59) }),
        task({ title: 'day before', status: 'done', completedAt: local(2026, 9, 28, 23, 59) }),
        task({ title: 'next day', status: 'done', completedAt: local(2026, 9, 30, 0, 0) }),
        task({ title: 'never stamped', status: 'done' }),
      ]
      expect(titles(groupToday(tasks, CTX).completedToday).sort()).toEqual(['late', 'midnight'])
    })

    it('respects the 23-hour and 25-hour days', () => {
      const spring: TodayContext = { today: '2026-03-08' }
      const springTasks = [
        task({ title: 'start', status: 'done', completedAt: local(2026, 3, 8, 0, 0) }),
        task({ title: 'end', status: 'done', completedAt: local(2026, 3, 8, 23, 59) }),
        task({ title: 'before', status: 'done', completedAt: local(2026, 3, 7, 23, 59) }),
        task({ title: 'after', status: 'done', completedAt: local(2026, 3, 9, 0, 0) }),
      ]
      expect(titles(groupToday(springTasks, spring).completedToday).sort()).toEqual([
        'end',
        'start',
      ])

      const fall: TodayContext = { today: '2026-11-01' }
      const fallTasks = [
        task({ title: 'start', status: 'done', completedAt: local(2026, 11, 1, 0, 0) }),
        task({ title: 'end', status: 'done', completedAt: local(2026, 11, 1, 23, 59) }),
        task({ title: 'before', status: 'done', completedAt: local(2026, 10, 31, 23, 59) }),
        task({ title: 'after', status: 'done', completedAt: local(2026, 11, 2, 0, 0) }),
      ]
      expect(titles(groupToday(fallTasks, fall).completedToday).sort()).toEqual(['end', 'start'])
    })
  })

  it('works without `now`', () => {
    expect(groupToday([task({ doDate: TODAY })], { today: TODAY }).yours).toHaveLength(1)
  })
})

describe('pickNow', () => {
  it('returns null when there is nothing to do', () => {
    expect(pickNow([], CTX)).toBeNull()
    expect(
      pickNow(
        [
          task({ doDate: '2026-09-30' }),
          task({}),
          task({ doDate: TODAY, status: 'done' }),
          task({ doDate: TODAY, skippedOn: TODAY }),
        ],
        CTX,
      ),
    ).toBeNull()
  })

  it('1. an in-progress task wins over everything, most recently started first', () => {
    const tasks = [
      task({ title: 'urgent overdue', doDate: '2026-09-20', priority: 4 }),
      task({ title: 'plan', source: 'schedule', doDate: TODAY, doTime: '08:00' }),
      task({ title: 'doing old', status: 'doing', doDate: TODAY, startedAt: 1_000 }),
      task({ title: 'doing new', status: 'doing', doDate: '2026-10-05', startedAt: 9_000 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('doing new')
  })

  it('a skipped in-progress task is passed over', () => {
    const tasks = [
      task({ title: 'doing', status: 'doing', doDate: TODAY, skippedOn: TODAY }),
      task({ title: 'other', doDate: TODAY }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('other')
  })

  it('2. goal work due today, by time then day order, beats overdue and own tasks', () => {
    const tasks = [
      task({ title: 'urgent overdue', doDate: '2026-09-20', priority: 4 }),
      task({ title: 'own urgent', doDate: TODAY, priority: 4 }),
      task({ title: 'plan pm', source: 'schedule', doDate: TODAY, doTime: '15:00' }),
      task({ title: 'plan am', source: 'schedule', doDate: TODAY, doTime: '08:00' }),
      task({ title: 'plan untimed', source: 'schedule', doDate: TODAY }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('plan am')
    expect(
      pickNow(
        tasks.filter((t) => t.title !== 'plan am'),
        CTX,
      )?.title,
    ).toBe('plan pm')
    expect(
      pickNow(
        tasks.filter((t) => !t.title.startsWith('plan ') || t.title === 'plan untimed'),
        CTX,
      )?.title,
    ).toBe('plan untimed')
  })

  it('flashcard reviews count as goal work', () => {
    const tasks = [
      task({ title: 'own', doDate: TODAY, priority: 4 }),
      task({ title: 'cards', source: 'flashcards', doDate: TODAY }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('cards')
  })

  it('3. overdue tasks by priority, then how late', () => {
    const tasks = [
      task({ title: 'own today', doDate: TODAY, priority: 4 }),
      task({ title: 'old low', doDate: '2026-09-01', priority: 1 }),
      task({ title: 'recent high', doDate: '2026-09-28', priority: 3 }),
      task({ title: 'old high', doDate: '2026-09-10', priority: 3 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('old high')
  })

  it('overdue goal work is overdue work, not today’s plan', () => {
    const tasks = [
      task({ title: 'yesterday plan', source: 'schedule', doDate: '2026-09-28', priority: 0 }),
      task({ title: 'urgent overdue', doDate: '2026-09-27', priority: 4 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('urgent overdue')
  })

  it('4. today’s own tasks by priority, then time, then order', () => {
    const tasks = [
      task({ title: 'low', doDate: TODAY, priority: 1 }),
      task({ title: 'high late', doDate: TODAY, priority: 3, doTime: '17:00' }),
      task({ title: 'high early', doDate: TODAY, priority: 3, doTime: '09:00' }),
      task({ title: 'high untimed', doDate: TODAY, priority: 3 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('high early')
    expect(
      pickNow(
        tasks.filter((t) => t.title !== 'high early'),
        CTX,
      )?.title,
    ).toBe('high late')
    expect(
      pickNow(
        tasks.filter((t) => t.title.startsWith('low')),
        CTX,
      )?.title,
    ).toBe('low')
  })

  it('ignores done, skipped, future and undated tasks', () => {
    const tasks = [
      task({ title: 'done', status: 'done', doDate: TODAY, priority: 4 }),
      task({ title: 'skipped', doDate: TODAY, skippedOn: TODAY, priority: 4 }),
      task({ title: 'future', doDate: '2026-09-30', priority: 4 }),
      task({ title: 'undated', priority: 4 }),
      task({ title: 'the one', doDate: TODAY, priority: 0 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('the one')
  })

  it('is deterministic when everything ties', () => {
    const tasks = [
      task({ title: 'a', doDate: TODAY }),
      task({ title: 'b', doDate: TODAY }),
      task({ title: 'c', doDate: TODAY }),
    ]
    const forward = pickNow(tasks, CTX)?.title
    expect(pickNow([...tasks].reverse(), CTX)?.title).toBe(forward)
  })

  it('agrees with groupToday: what it picks is on the Today screen', () => {
    const tasks = [
      task({ doDate: '2026-09-27', priority: 2 }),
      task({ doDate: TODAY, source: 'schedule' }),
      task({ doDate: TODAY, priority: 3 }),
      task({ doDate: '2026-10-01' }),
    ]
    const picked = pickNow(tasks, CTX)
    const g = groupToday(tasks, CTX)
    const visible = [...g.fromGoals, ...g.yours, ...g.carriedOver.map((r) => r.task)]
    expect(picked && visible.includes(picked)).toBe(true)
  })

  it('works on a DST day', () => {
    const ctx: TodayContext = { today: '2026-03-08', now: local(2026, 3, 8, 9) }
    const tasks = [
      task({ title: 'late', doDate: '2026-03-07', priority: 2 }),
      task({ title: 'plan', source: 'schedule', doDate: '2026-03-08', doTime: '10:00' }),
    ]
    expect(pickNow(tasks, ctx)?.title).toBe('plan')
    expect(pickNow(tasks.slice(0, 1), ctx)?.title).toBe('late')
  })
})

describe('oneListToday', () => {
  it('merges plan sessions and everyday tasks, timed first by start time, then untimed', () => {
    const tasks = [
      task({ title: 'Untimed own', doDate: TODAY, order: 1 }),
      task({ title: 'Plan 19:00', doDate: TODAY, doTime: '19:00', source: 'schedule' }),
      task({ title: 'Untimed plan', doDate: TODAY, source: 'schedule', order: 2 }),
      task({ title: 'Own 08:30', doDate: TODAY, doTime: '08:30' }),
      task({ title: 'Plan 13:00', doDate: TODAY, doTime: '13:00', source: 'schedule' }),
    ]
    const groups = groupToday(tasks, CTX)
    expect(titles(oneListToday(groups, CTX))).toEqual([
      'Own 08:30',
      'Plan 13:00',
      'Plan 19:00',
      'Untimed own',
      'Untimed plan',
    ])
  })
})
