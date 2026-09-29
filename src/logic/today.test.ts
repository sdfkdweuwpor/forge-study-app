// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8 (23 h day), ends Sun Nov 1 (25 h day).
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import { groupToday, isGoalWork, pickNow, type TodayContext } from '@/logic/today'

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
    dueDate: null,
    dueTime: null,
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
      task({ title: 'plan chunk', source: 'schedule', dueDate: TODAY, goalId: 'g1' }),
      task({ title: 'cards', source: 'flashcards', dueDate: TODAY }),
      task({ title: 'mine', dueDate: TODAY }),
      task({ title: 'late plan', source: 'schedule', dueDate: '2026-09-27' }),
      task({ title: 'late mine', dueDate: '2026-09-28' }),
      task({ title: 'tomorrow', dueDate: '2026-09-30' }),
      task({ title: 'no date' }),
      task({
        title: 'done today',
        status: 'done',
        dueDate: TODAY,
        completedDay: TODAY,
        completedAt: local(2026, 9, 29, 9),
      }),
      task({
        title: 'done before',
        status: 'done',
        dueDate: '2026-09-20',
        completedDay: '2026-09-21',
      }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.fromGoals)).toEqual(['plan chunk', 'cards'])
    expect(titles(g.yours)).toEqual(['mine'])
    expect(g.rolledOver.map((r) => [r.task.title, r.daysOverdue])).toEqual([
      ['late plan', 2],
      ['late mine', 1],
    ])
    expect(titles(g.completedToday)).toEqual(['done today'])
  })

  it('returns empty groups for no tasks', () => {
    expect(groupToday([], CTX)).toEqual({
      fromGoals: [],
      yours: [],
      rolledOver: [],
      completedToday: [],
    })
  })

  it('does not mutate or reuse the input array', () => {
    const tasks = [task({ dueDate: TODAY, order: 2 }), task({ dueDate: TODAY, order: 1 })]
    const copy = [...tasks]
    groupToday(tasks, CTX)
    expect(tasks).toEqual(copy)
  })

  it('hides tasks skipped for today, including overdue ones', () => {
    const tasks = [
      task({ title: 'skipped', dueDate: TODAY, skippedOn: TODAY }),
      task({ title: 'skipped overdue', dueDate: '2026-09-25', skippedOn: TODAY }),
      task({ title: 'skipped yesterday', dueDate: TODAY, skippedOn: '2026-09-28' }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.yours)).toEqual(['skipped yesterday'])
    expect(g.rolledOver).toEqual([])
  })

  it('includes an in-progress task even when it is due later or has no date', () => {
    const tasks = [
      task({ title: 'pulled forward', status: 'doing', dueDate: '2026-10-02' }),
      task({ title: 'no date doing', status: 'doing' }),
      task({ title: 'doing plan', status: 'doing', source: 'schedule', dueDate: '2026-10-01' }),
      task({ title: 'todo later', dueDate: '2026-10-02' }),
    ]
    const g = groupToday(tasks, CTX)
    expect(titles(g.yours).sort()).toEqual(['no date doing', 'pulled forward'])
    expect(titles(g.fromGoals)).toEqual(['doing plan'])
  })

  it('an overdue in-progress task is rolled over, once', () => {
    const g = groupToday([task({ title: 'stuck', status: 'doing', dueDate: '2026-09-26' })], CTX)
    expect(g.yours).toEqual([])
    expect(g.rolledOver.map((r) => r.daysOverdue)).toEqual([3])
  })

  describe('ordering', () => {
    it('timed tasks first by time, then the day order, then priority, then list order', () => {
      const tasks = [
        task({ title: 'z low', dueDate: TODAY, priority: 1, order: 1 }),
        task({ title: 'urgent', dueDate: TODAY, priority: 4, order: 9 }),
        task({ title: '14:00', dueDate: TODAY, dueTime: '14:00' }),
        task({ title: '09:00', dueDate: TODAY, dueTime: '09:00' }),
        task({ title: 'pinned first', dueDate: TODAY, orderInDay: -1, priority: 0 }),
        task({ title: 'a low', dueDate: TODAY, priority: 1, order: 0.5 }),
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
        task({ title: 'chunk 3', source: 'schedule', dueDate: TODAY, orderInDay: 3 }),
        task({ title: 'chunk 1', source: 'schedule', dueDate: TODAY, orderInDay: 1 }),
        task({
          title: 'evening',
          source: 'schedule',
          dueDate: TODAY,
          dueTime: '19:00',
          orderInDay: 0,
        }),
        task({
          title: 'morning',
          source: 'schedule',
          dueDate: TODAY,
          dueTime: '08:30',
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
        task({ title: 'old low', dueDate: '2026-09-10', priority: 1 }),
        task({ title: 'recent urgent', dueDate: '2026-09-28', priority: 4 }),
        task({ title: 'old high', dueDate: '2026-09-15', priority: 3 }),
        task({ title: 'recent high', dueDate: '2026-09-27', priority: 3 }),
      ]
      expect(groupToday(tasks, CTX).rolledOver.map((r) => r.task.title)).toEqual([
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
        task({ title: 'a', dueDate: TODAY }),
        task({ title: 'b', dueDate: TODAY }),
        task({ title: 'c', dueDate: TODAY }),
      ]
      const forward = titles(groupToday(tasks, CTX).yours)
      expect(titles(groupToday([...tasks].reverse(), CTX).yours)).toEqual(forward)
    })
  })

  describe('daysOverdue counts calendar days', () => {
    it('across the spring-forward night', () => {
      const ctx: TodayContext = { today: '2026-03-08', now: local(2026, 3, 8, 12) }
      const g = groupToday([task({ dueDate: '2026-03-06' }), task({ dueDate: '2026-03-07' })], ctx)
      expect(g.rolledOver.map((r) => r.daysOverdue).sort()).toEqual([1, 2])
    })

    it('across the fall-back night', () => {
      const ctx: TodayContext = { today: '2026-11-02', now: local(2026, 11, 2, 12) }
      const g = groupToday([task({ dueDate: '2026-10-31' }), task({ dueDate: '2026-11-01' })], ctx)
      expect(g.rolledOver.map((r) => r.daysOverdue).sort()).toEqual([1, 2])
    })

    it('across a year boundary', () => {
      const ctx: TodayContext = { today: '2027-01-02', now: local(2027, 1, 2, 12) }
      expect(groupToday([task({ dueDate: '2026-12-30' })], ctx).rolledOver[0]?.daysOverdue).toBe(3)
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
    expect(groupToday([task({ dueDate: TODAY })], { today: TODAY }).yours).toHaveLength(1)
  })
})

describe('pickNow', () => {
  it('returns null when there is nothing to do', () => {
    expect(pickNow([], CTX)).toBeNull()
    expect(
      pickNow(
        [
          task({ dueDate: '2026-09-30' }),
          task({}),
          task({ dueDate: TODAY, status: 'done' }),
          task({ dueDate: TODAY, skippedOn: TODAY }),
        ],
        CTX,
      ),
    ).toBeNull()
  })

  it('1. an in-progress task wins over everything, most recently started first', () => {
    const tasks = [
      task({ title: 'urgent overdue', dueDate: '2026-09-20', priority: 4 }),
      task({ title: 'plan', source: 'schedule', dueDate: TODAY, dueTime: '08:00' }),
      task({ title: 'doing old', status: 'doing', dueDate: TODAY, startedAt: 1_000 }),
      task({ title: 'doing new', status: 'doing', dueDate: '2026-10-05', startedAt: 9_000 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('doing new')
  })

  it('a skipped in-progress task is passed over', () => {
    const tasks = [
      task({ title: 'doing', status: 'doing', dueDate: TODAY, skippedOn: TODAY }),
      task({ title: 'other', dueDate: TODAY }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('other')
  })

  it('2. goal work due today, by time then day order, beats overdue and own tasks', () => {
    const tasks = [
      task({ title: 'urgent overdue', dueDate: '2026-09-20', priority: 4 }),
      task({ title: 'own urgent', dueDate: TODAY, priority: 4 }),
      task({ title: 'plan pm', source: 'schedule', dueDate: TODAY, dueTime: '15:00' }),
      task({ title: 'plan am', source: 'schedule', dueDate: TODAY, dueTime: '08:00' }),
      task({ title: 'plan untimed', source: 'schedule', dueDate: TODAY }),
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
      task({ title: 'own', dueDate: TODAY, priority: 4 }),
      task({ title: 'cards', source: 'flashcards', dueDate: TODAY }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('cards')
  })

  it('3. overdue tasks by priority, then how late', () => {
    const tasks = [
      task({ title: 'own today', dueDate: TODAY, priority: 4 }),
      task({ title: 'old low', dueDate: '2026-09-01', priority: 1 }),
      task({ title: 'recent high', dueDate: '2026-09-28', priority: 3 }),
      task({ title: 'old high', dueDate: '2026-09-10', priority: 3 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('old high')
  })

  it('overdue goal work is overdue work, not today’s plan', () => {
    const tasks = [
      task({ title: 'yesterday plan', source: 'schedule', dueDate: '2026-09-28', priority: 0 }),
      task({ title: 'urgent overdue', dueDate: '2026-09-27', priority: 4 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('urgent overdue')
  })

  it('4. today’s own tasks by priority, then time, then order', () => {
    const tasks = [
      task({ title: 'low', dueDate: TODAY, priority: 1 }),
      task({ title: 'high late', dueDate: TODAY, priority: 3, dueTime: '17:00' }),
      task({ title: 'high early', dueDate: TODAY, priority: 3, dueTime: '09:00' }),
      task({ title: 'high untimed', dueDate: TODAY, priority: 3 }),
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
      task({ title: 'done', status: 'done', dueDate: TODAY, priority: 4 }),
      task({ title: 'skipped', dueDate: TODAY, skippedOn: TODAY, priority: 4 }),
      task({ title: 'future', dueDate: '2026-09-30', priority: 4 }),
      task({ title: 'undated', priority: 4 }),
      task({ title: 'the one', dueDate: TODAY, priority: 0 }),
    ]
    expect(pickNow(tasks, CTX)?.title).toBe('the one')
  })

  it('is deterministic when everything ties', () => {
    const tasks = [
      task({ title: 'a', dueDate: TODAY }),
      task({ title: 'b', dueDate: TODAY }),
      task({ title: 'c', dueDate: TODAY }),
    ]
    const forward = pickNow(tasks, CTX)?.title
    expect(pickNow([...tasks].reverse(), CTX)?.title).toBe(forward)
  })

  it('agrees with groupToday: what it picks is on the Today screen', () => {
    const tasks = [
      task({ dueDate: '2026-09-27', priority: 2 }),
      task({ dueDate: TODAY, source: 'schedule' }),
      task({ dueDate: TODAY, priority: 3 }),
      task({ dueDate: '2026-10-01' }),
    ]
    const picked = pickNow(tasks, CTX)
    const g = groupToday(tasks, CTX)
    const visible = [...g.fromGoals, ...g.yours, ...g.rolledOver.map((r) => r.task)]
    expect(picked && visible.includes(picked)).toBe(true)
  })

  it('works on a DST day', () => {
    const ctx: TodayContext = { today: '2026-03-08', now: local(2026, 3, 8, 9) }
    const tasks = [
      task({ title: 'late', dueDate: '2026-03-07', priority: 2 }),
      task({ title: 'plan', source: 'schedule', dueDate: '2026-03-08', dueTime: '10:00' }),
    ]
    expect(pickNow(tasks, ctx)?.title).toBe('plan')
    expect(pickNow(tasks.slice(0, 1), ctx)?.title).toBe('late')
  })
})
