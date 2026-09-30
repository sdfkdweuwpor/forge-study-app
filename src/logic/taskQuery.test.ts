// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8, ends Sun Nov 1.
import { describe, expect, it } from 'vitest'
import type { Task, TaskFilter, TaskSort } from '@/db/types'
import {
  dateBucketOf,
  DATE_BUCKETS,
  filterTasks,
  groupTasks,
  priorityLabel,
  queryTasks,
  sortTasks,
  taskMatcher,
  type ProjectRef,
  type QueryContext,
} from '@/logic/taskQuery'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
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

/** Tuesday 2026-09-29. Monday-start week ends Sun Oct 4; Sunday-start week ends Sat Oct 3. */
const TODAY: QueryContext = { today: '2026-09-29' }

describe('priorityLabel', () => {
  it('maps 0-4 to labels', () => {
    expect([0, 1, 2, 3, 4].map((p) => priorityLabel(p as 0 | 1 | 2 | 3 | 4))).toEqual([
      'None',
      'Low',
      'Medium',
      'High',
      'Urgent',
    ])
  })
})

describe('filterTasks', () => {
  const tasks = [
    task({
      title: 'Read chapter 4',
      status: 'todo',
      priority: 3,
      tags: ['C182', 'reading'],
      goalId: 'g1',
      milestoneId: 'm182',
      doDate: '2026-09-30',
    }),
    task({
      title: 'Flashcards C779',
      status: 'doing',
      priority: 2,
      tags: ['C779'],
      goalId: 'g1',
      milestoneId: 'm779',
      doDate: '2026-09-29',
      source: 'flashcards',
    }),
    task({
      title: 'Lab report',
      status: 'done',
      priority: 4,
      tags: ['lab', 'C182'],
      goalId: 'g1',
      milestoneId: 'm182',
      doDate: '2026-09-20',
      completedDay: '2026-09-21',
    }),
    task({ title: 'Buy groceries', status: 'todo', priority: 0, tags: [], doDate: null }),
    task({
      title: 'D278 practice',
      status: 'todo',
      priority: 1,
      tags: ['D278'],
      goalId: 'g2',
      milestoneId: 'm278',
      doDate: '2026-09-25',
      source: 'schedule',
    }),
  ]

  it('no filter, or empty lists, keeps everything', () => {
    expect(filterTasks(tasks, {}, TODAY)).toHaveLength(5)
    expect(
      filterTasks(
        tasks,
        {
          status: [],
          priority: [],
          tags: [],
          goalIds: [],
          milestoneIds: [],
          source: [],
          text: '  ',
          due: 'any',
        },
        TODAY,
      ),
    ).toHaveLength(5)
  })

  it('never mutates or reorders the input', () => {
    const copy = [...tasks]
    filterTasks(tasks, { status: ['todo'] }, TODAY)
    expect(tasks).toEqual(copy)
    expect(filterTasks(tasks, {}, TODAY)).not.toBe(tasks)
  })

  it('status is any-of', () => {
    expect(titles(filterTasks(tasks, { status: ['done'] }, TODAY))).toEqual(['Lab report'])
    expect(titles(filterTasks(tasks, { status: ['todo', 'doing'] }, TODAY))).toHaveLength(4)
  })

  it('priority is any-of', () => {
    expect(titles(filterTasks(tasks, { priority: [3, 4] }, TODAY))).toEqual([
      'Read chapter 4',
      'Lab report',
    ])
    expect(titles(filterTasks(tasks, { priority: [0] }, TODAY))).toEqual(['Buy groceries'])
  })

  it('source is any-of', () => {
    expect(titles(filterTasks(tasks, { source: ['schedule', 'flashcards'] }, TODAY))).toEqual([
      'Flashcards C779',
      'D278 practice',
    ])
  })

  it('tags: any-of by default, all-of on request, ignoring case and #', () => {
    expect(titles(filterTasks(tasks, { tags: ['c182'] }, TODAY))).toEqual([
      'Read chapter 4',
      'Lab report',
    ])
    expect(titles(filterTasks(tasks, { tags: ['#C182', 'd278'] }, TODAY))).toEqual([
      'Read chapter 4',
      'Lab report',
      'D278 practice',
    ])
    expect(
      titles(filterTasks(tasks, { tags: ['C182', 'lab'], tagsMatchAll: true }, TODAY)),
    ).toEqual(['Lab report'])
    expect(filterTasks(tasks, { tags: ['C182', 'nope'], tagsMatchAll: true }, TODAY)).toEqual([])
    expect(filterTasks(tasks, { tags: ['nope'] }, TODAY)).toEqual([])
    expect(filterTasks(tasks, { tags: ['#', '  '] }, TODAY)).toHaveLength(5) // nothing usable → no restriction
  })

  it('goal and course (milestone) filters', () => {
    expect(titles(filterTasks(tasks, { goalIds: ['g2'] }, TODAY))).toEqual(['D278 practice'])
    expect(titles(filterTasks(tasks, { milestoneIds: ['m182'] }, TODAY))).toEqual([
      'Read chapter 4',
      'Lab report',
    ])
    expect(titles(filterTasks(tasks, { goalIds: ['g1', 'g2'] }, TODAY))).toHaveLength(4)
    // Both narrow together.
    expect(titles(filterTasks(tasks, { goalIds: ['g1'], milestoneIds: ['m779'] }, TODAY))).toEqual([
      'Flashcards C779',
    ])
    // A task with no goal never matches a goal filter.
    expect(filterTasks(tasks, { goalIds: ['g1'] }, TODAY).map((t) => t.title)).not.toContain(
      'Buy groceries',
    )
  })

  it('combines every condition with AND', () => {
    const filter: TaskFilter = {
      status: ['todo'],
      tags: ['C182'],
      priority: [3],
      due: 'upcoming',
      text: 'chapter',
    }
    expect(titles(filterTasks(tasks, filter, TODAY))).toEqual(['Read chapter 4'])
    expect(filterTasks(tasks, { ...filter, priority: [1] }, TODAY)).toEqual([])
  })

  describe('text', () => {
    const rich = [
      task({
        title: 'Essay outline',
        tags: ['C777'],
        subtasks: [{ id: 's1', title: 'Draft thesis statement', done: false }],
        notes: [{ id: 'n1', type: 'p', text: 'Use the **Chicago** style guide' }],
      }),
      task({ title: 'Quiz prep' }),
    ]

    it('matches the title, case-insensitively, as a substring', () => {
      expect(titles(filterTasks(rich, { text: 'ESSAY' }, TODAY))).toEqual(['Essay outline'])
      expect(titles(filterTasks(rich, { text: 'utl' }, TODAY))).toEqual(['Essay outline'])
    })

    it('also searches tags (with #), subtasks and note text without markup', () => {
      expect(titles(filterTasks(rich, { text: '#c777' }, TODAY))).toEqual(['Essay outline'])
      expect(titles(filterTasks(rich, { text: 'thesis' }, TODAY))).toEqual(['Essay outline'])
      expect(titles(filterTasks(rich, { text: 'chicago style' }, TODAY))).toEqual(['Essay outline'])
      expect(filterTasks(rich, { text: '**' }, TODAY)).toEqual([])
    })

    it('several words must all appear, in any order', () => {
      expect(titles(filterTasks(rich, { text: 'outline essay' }, TODAY))).toEqual(['Essay outline'])
      expect(filterTasks(rich, { text: 'essay quiz' }, TODAY)).toEqual([])
    })
  })

  describe('due (today is Tue 2026-09-29)', () => {
    const due = [
      task({ title: 'late', doDate: '2026-09-28' }),
      task({ title: 'late done', doDate: '2026-09-28', status: 'done' }),
      task({ title: 'today', doDate: '2026-09-29' }),
      task({ title: 'tomorrow', doDate: '2026-09-30' }),
      task({ title: 'fri', doDate: '2026-10-02' }),
      task({ title: 'sat', doDate: '2026-10-03' }),
      task({ title: 'sun', doDate: '2026-10-04' }),
      task({ title: 'next mon', doDate: '2026-10-05' }),
      task({ title: 'none' }),
    ]
    const q = (filter: TaskFilter, ctx: QueryContext = TODAY): string[] =>
      titles(filterTasks(due, filter, ctx))

    it('any', () => expect(q({ due: 'any' })).toHaveLength(9))
    it('none', () => expect(q({ due: 'none' })).toEqual(['none']))
    it('overdue excludes finished tasks', () => expect(q({ due: 'overdue' })).toEqual(['late']))
    it('today', () => expect(q({ due: 'today' })).toEqual(['today']))
    it('tomorrow', () => expect(q({ due: 'tomorrow' })).toEqual(['tomorrow']))
    it('upcoming is everything after today', () => {
      expect(q({ due: 'upcoming' })).toEqual(['tomorrow', 'fri', 'sat', 'sun', 'next mon'])
    })
    it('week runs from today to the end of the week (Monday start)', () => {
      expect(q({ due: 'week' })).toEqual(['today', 'tomorrow', 'fri', 'sat', 'sun'])
    })
    it('week follows weekStartsOn', () => {
      expect(q({ due: 'week' }, { today: '2026-09-29', weekStartsOn: 0 })).toEqual([
        'today',
        'tomorrow',
        'fri',
        'sat',
      ])
    })
    it('week on the last day of the week is just today', () => {
      expect(q({ due: 'week' }, { today: '2026-10-04' })).toEqual(['sun'])
    })
  })

  describe('due across DST', () => {
    const dst = [
      task({ title: 'sat', doDate: '2026-03-07' }),
      task({ title: 'sun (DST)', doDate: '2026-03-08' }),
      task({ title: 'mon', doDate: '2026-03-09' }),
    ]
    it('tomorrow is the next calendar day even when it has 23 hours', () => {
      expect(titles(filterTasks(dst, { due: 'tomorrow' }, { today: '2026-03-07' }))).toEqual([
        'sun (DST)',
      ])
      expect(titles(filterTasks(dst, { due: 'today' }, { today: '2026-03-08' }))).toEqual([
        'sun (DST)',
      ])
    })
    it('the week containing the change ends on Sunday', () => {
      expect(titles(filterTasks(dst, { due: 'week' }, { today: '2026-03-07' }))).toEqual([
        'sat',
        'sun (DST)',
      ])
    })
    it('a 25-hour day works too', () => {
      const fall = [
        task({ title: 'nov1', doDate: '2026-11-01' }),
        task({ title: 'nov2', doDate: '2026-11-02' }),
      ]
      expect(titles(filterTasks(fall, { due: 'tomorrow' }, { today: '2026-10-31' }))).toEqual([
        'nov1',
      ])
      expect(titles(filterTasks(fall, { due: 'week' }, { today: '2026-10-31' }))).toEqual(['nov1'])
    })
  })

  it('taskMatcher compiles once and can be reused', () => {
    const matches = taskMatcher({ status: ['todo'], priority: [3] }, TODAY)
    expect(tasks.filter(matches)).toHaveLength(1)
    expect(matches(tasks[3] as Task)).toBe(false)
  })
})

describe('sortTasks', () => {
  const ids = (list: readonly Task[]): string[] => list.map((t) => t.id)

  it('manual: by fractional order, either direction', () => {
    const a = task({ order: 3 })
    const b = task({ order: 1.5 })
    const c = task({ order: 2 })
    expect(ids(sortTasks([a, b, c], { key: 'manual', dir: 'asc' }))).toEqual([b.id, c.id, a.id])
    expect(ids(sortTasks([a, b, c], { key: 'manual', dir: 'desc' }))).toEqual([a.id, c.id, b.id])
  })

  it('due: earliest first, undated last in both directions', () => {
    const none = task({ title: 'none' })
    const late = task({ title: 'late', doDate: '2026-10-09' })
    const soon = task({ title: 'soon', doDate: '2026-09-30' })
    const mid = task({ title: 'mid', doDate: '2026-10-02' })
    expect(titles(sortTasks([none, late, soon, mid], { key: 'due', dir: 'asc' }))).toEqual([
      'soon',
      'mid',
      'late',
      'none',
    ])
    expect(titles(sortTasks([none, late, soon, mid], { key: 'due', dir: 'desc' }))).toEqual([
      'late',
      'mid',
      'soon',
      'none',
    ])
  })

  it('due: within a day, all-day tasks come before timed ones, then by time', () => {
    const allDay = task({ title: 'all day', doDate: '2026-09-30' })
    const morning = task({ title: '09:00', doDate: '2026-09-30', doTime: '09:00' })
    const evening = task({ title: '18:30', doDate: '2026-09-30', doTime: '18:30' })
    expect(titles(sortTasks([evening, morning, allDay], { key: 'due', dir: 'asc' }))).toEqual([
      'all day',
      '09:00',
      '18:30',
    ])
    expect(titles(sortTasks([allDay, evening, morning], { key: 'due', dir: 'desc' }))).toEqual([
      '18:30',
      '09:00',
      'all day',
    ])
  })

  it('due: ties go to the higher priority', () => {
    const low = task({ title: 'low', doDate: '2026-09-30', priority: 1 })
    const high = task({ title: 'high', doDate: '2026-09-30', priority: 3 })
    expect(titles(sortTasks([low, high], { key: 'due', dir: 'asc' }))).toEqual(['high', 'low'])
  })

  it('priority: desc puts urgent first, asc puts none first; ties by due date', () => {
    const none = task({ title: 'none' })
    const low = task({ title: 'low', priority: 1 })
    const highLate = task({ title: 'high late', priority: 3, doDate: '2026-10-09' })
    const highSoon = task({ title: 'high soon', priority: 3, doDate: '2026-09-30' })
    const urgent = task({ title: 'urgent', priority: 4 })
    const all = [none, low, highLate, highSoon, urgent]
    expect(titles(sortTasks(all, { key: 'priority', dir: 'desc' }))).toEqual([
      'urgent',
      'high soon',
      'high late',
      'low',
      'none',
    ])
    expect(titles(sortTasks(all, { key: 'priority', dir: 'asc' }))).toEqual([
      'none',
      'low',
      'high soon',
      'high late',
      'urgent',
    ])
  })

  it('created and updated', () => {
    const a = task({ createdAt: 300, updatedAt: 100 })
    const b = task({ createdAt: 100, updatedAt: 300 })
    const c = task({ createdAt: 200, updatedAt: 200 })
    expect(ids(sortTasks([a, b, c], { key: 'created', dir: 'asc' }))).toEqual([b.id, c.id, a.id])
    expect(ids(sortTasks([a, b, c], { key: 'created', dir: 'desc' }))).toEqual([a.id, c.id, b.id])
    expect(ids(sortTasks([a, b, c], { key: 'updated', dir: 'desc' }))).toEqual([b.id, c.id, a.id])
  })

  it('title: case-insensitive with natural number order', () => {
    const list = [
      task({ title: 'Task 10' }),
      task({ title: 'task 2' }),
      task({ title: 'C182 notes' }),
      task({ title: 'Task 1' }),
    ]
    expect(titles(sortTasks(list, { key: 'title', dir: 'asc' }))).toEqual([
      'C182 notes',
      'Task 1',
      'task 2',
      'Task 10',
    ])
    expect(titles(sortTasks(list, { key: 'title', dir: 'desc' }))).toEqual([
      'Task 10',
      'task 2',
      'Task 1',
      'C182 notes',
    ])
  })

  it('estimate: pomodoros, else minutes ÷ 25; unestimated last in both directions', () => {
    const big = task({ title: 'big', estimatePomodoros: 4 })
    const small = task({ title: 'small', estimatePomodoros: 1 })
    const minutesOnly = task({ title: '50 min', estimateMinutes: 50 }) // 2 pomodoros
    const none = task({ title: 'none' })
    const all = [none, big, minutesOnly, small]
    expect(titles(sortTasks(all, { key: 'estimate', dir: 'asc' }))).toEqual([
      'small',
      '50 min',
      'big',
      'none',
    ])
    expect(titles(sortTasks(all, { key: 'estimate', dir: 'desc' }))).toEqual([
      'big',
      '50 min',
      'small',
      'none',
    ])
  })

  it('is stable and independent of input order', () => {
    const same = [
      task({ title: 'a', priority: 2, order: 1 }),
      task({ title: 'b', priority: 2, order: 2 }),
      task({ title: 'c', priority: 2, order: 3 }),
    ]
    const sort: TaskSort = { key: 'priority', dir: 'desc' }
    const forward = titles(sortTasks(same, sort))
    expect(forward).toEqual(['a', 'b', 'c'])
    expect(titles(sortTasks([...same].reverse(), sort))).toEqual(forward)
    expect(titles(sortTasks([same[1] as Task, same[2] as Task, same[0] as Task], sort))).toEqual(
      forward,
    )
  })

  it('does not mutate its input', () => {
    const list = [task({ order: 2 }), task({ order: 1 })]
    const copy = [...list]
    sortTasks(list, { key: 'manual', dir: 'asc' })
    expect(list).toEqual(copy)
  })
})

describe('dateBucketOf and groupTasks(date)', () => {
  const at = (title: string, doDate: string | null, status: Task['status'] = 'todo'): Task =>
    task({ title, doDate, status })

  it('lists the buckets in display order', () => {
    expect(DATE_BUCKETS.map((b) => b.label)).toEqual([
      'Carried over',
      'Today',
      'Tomorrow',
      'This week',
      'Later',
      'No date',
      'Earlier',
    ])
  })

  it('buckets a Tuesday', () => {
    const list = [
      at('none', null),
      at('later', '2026-10-06'),
      at('week', '2026-10-02'),
      at('week end', '2026-10-04'),
      at('tomorrow', '2026-09-30'),
      at('today', '2026-09-29'),
      at('overdue', '2026-09-28'),
      at('overdue old', '2026-01-01'),
    ]
    const groups = groupTasks(list, 'date', TODAY)
    expect(groups.map((g) => [g.id, g.label, titles(g.tasks)])).toEqual([
      ['overdue', 'Carried over', ['overdue', 'overdue old']],
      ['today', 'Today', ['today']],
      ['tomorrow', 'Tomorrow', ['tomorrow']],
      ['week', 'This week', ['week', 'week end']],
      ['later', 'Later', ['later']],
      ['none', 'No date', ['none']],
    ])
  })

  it('omits empty groups and keeps the input order inside a group', () => {
    const groups = groupTasks([at('b', '2026-09-29'), at('a', '2026-09-29')], 'date', TODAY)
    expect(groups).toHaveLength(1)
    expect(titles(groups[0]?.tasks ?? [])).toEqual(['b', 'a'])
    expect(groupTasks([], 'date', TODAY)).toEqual([])
  })

  it('a finished task with a past due date is "Earlier", never "Overdue"', () => {
    const done = at('done last week', '2026-09-20', 'done')
    expect(dateBucketOf(done, TODAY)).toBe('earlier')
    expect(dateBucketOf(at('open last week', '2026-09-20'), TODAY)).toBe('overdue')
    expect(dateBucketOf(at('done today', '2026-09-29', 'done'), TODAY)).toBe('today')
  })

  it('"This week" follows weekStartsOn', () => {
    const sunday = at('sun', '2026-10-04')
    expect(dateBucketOf(sunday, { today: '2026-09-29', weekStartsOn: 1 })).toBe('week')
    expect(dateBucketOf(sunday, { today: '2026-09-29', weekStartsOn: 0 })).toBe('later')
  })

  it('on the last day of the week, tomorrow is next week and there is no "This week"', () => {
    const ctx: QueryContext = { today: '2026-10-04' } // Sunday, Monday-start week
    expect(dateBucketOf(at('mon', '2026-10-05'), ctx)).toBe('tomorrow')
    expect(dateBucketOf(at('tue', '2026-10-06'), ctx)).toBe('later')
  })

  it('handles the DST change days', () => {
    const spring: QueryContext = { today: '2026-03-07' } // Saturday
    expect(dateBucketOf(at('a', '2026-03-08'), spring)).toBe('tomorrow')
    expect(dateBucketOf(at('b', '2026-03-09'), spring)).toBe('later')
    expect(dateBucketOf(at('c', '2026-03-08'), { today: '2026-03-08' })).toBe('today')
    expect(dateBucketOf(at('d', '2026-03-07'), { today: '2026-03-08' })).toBe('overdue')
    const fall: QueryContext = { today: '2026-10-31' }
    expect(dateBucketOf(at('e', '2026-11-01'), fall)).toBe('tomorrow')
    expect(dateBucketOf(at('f', '2026-11-02'), fall)).toBe('later')
    expect(dateBucketOf(at('g', '2026-11-01'), { today: '2026-11-01', weekStartsOn: 0 })).toBe(
      'today',
    )
  })

  it('crosses a year boundary', () => {
    const ctx: QueryContext = { today: '2026-12-31' }
    expect(dateBucketOf(at('a', '2027-01-01'), ctx)).toBe('tomorrow')
    expect(dateBucketOf(at('b', '2027-01-03'), ctx)).toBe('week') // Sunday Jan 3
    expect(dateBucketOf(at('c', '2027-01-04'), ctx)).toBe('later')
  })
})

describe('groupTasks(project)', () => {
  const projects: ProjectRef[] = [
    { id: 'g1', kind: 'goal', label: 'WGU B.S. Computer Science' },
    { id: 'm182', kind: 'milestone', label: 'C182 Intro to IT' },
    { id: 'm779', kind: 'milestone', label: 'C779 Web Development' },
  ]
  const ctx = { ...TODAY, projects }

  it('groups by course, then goal, in the order of `projects`, then "No project"', () => {
    const list = [
      task({ title: 'loose' }),
      task({ title: 'goal only', goalId: 'g1' }),
      task({ title: 'web 1', goalId: 'g1', milestoneId: 'm779' }),
      task({ title: 'intro 1', goalId: 'g1', milestoneId: 'm182' }),
      task({ title: 'web 2', milestoneId: 'm779' }),
    ]
    const groups = groupTasks(list, 'project', ctx)
    expect(groups.map((g) => [g.id, g.label, titles(g.tasks)])).toEqual([
      ['goal:g1', 'WGU B.S. Computer Science', ['goal only']],
      ['milestone:m182', 'C182 Intro to IT', ['intro 1']],
      ['milestone:m779', 'C779 Web Development', ['web 1', 'web 2']],
      ['none', 'No project', ['loose']],
    ])
  })

  it('an unknown course falls back to its goal; an unknown goal is "No project"', () => {
    const list = [
      task({ title: 'stale course', goalId: 'g1', milestoneId: 'gone' }),
      task({ title: 'stale goal', goalId: 'gone' }),
    ]
    const groups = groupTasks(list, 'project', ctx)
    expect(groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['WGU B.S. Computer Science', ['stale course']],
      ['No project', ['stale goal']],
    ])
  })

  it('omits projects with no tasks and works with no projects at all', () => {
    expect(groupTasks([task({ goalId: 'g1' })], 'project', { ...TODAY })).toEqual([
      { id: 'none', label: 'No project', tasks: expect.any(Array) },
    ])
    expect(groupTasks([], 'project', ctx)).toEqual([])
  })
})

describe('groupTasks(none) and queryTasks', () => {
  it('none: one unlabelled group, or nothing for an empty list', () => {
    const list = [task(), task()]
    const groups = groupTasks(list, 'none', TODAY)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: 'all', label: '' })
    expect(groups[0]?.tasks).toHaveLength(2)
    expect(groupTasks([], 'none', TODAY)).toEqual([])
  })

  it('queryTasks filters, sorts, then groups', () => {
    const list = [
      task({ title: 'b', doDate: '2026-09-30', priority: 1 }),
      task({ title: 'a', doDate: '2026-09-30', priority: 4 }),
      task({ title: 'done', doDate: '2026-09-30', status: 'done' }),
      task({ title: 'overdue', doDate: '2026-09-20', priority: 2 }),
      task({ title: 'later', doDate: '2026-10-20', priority: 3 }),
    ]
    const result = queryTasks(
      list,
      {
        filter: { status: ['todo', 'doing'] },
        sort: { key: 'priority', dir: 'desc' },
        groupBy: 'date',
      },
      TODAY,
    )
    expect(titles(result.tasks)).toEqual(['a', 'later', 'overdue', 'b'])
    expect(result.groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['Carried over', ['overdue']],
      ['Tomorrow', ['a', 'b']],
      ['Later', ['later']],
    ])
  })

  it('queryTasks defaults: no filter, manual order, no grouping', () => {
    const list = [task({ title: 'second', order: 2 }), task({ title: 'first', order: 1 })]
    const result = queryTasks(list, {}, TODAY)
    expect(titles(result.tasks)).toEqual(['first', 'second'])
    expect(result.groups).toHaveLength(1)
  })
})
