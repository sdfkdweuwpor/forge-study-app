import { describe, expect, it } from 'vitest'
import type { Ritual, Task } from '@/db/types'
import { TASK_V2_DEFAULTS } from './taskDates'
import { groupToday } from './today'
import {
  REFLECTION_MAX,
  RITUAL_DEFAULT_TIMES,
  TOP_MAX,
  XP_EVENING,
  cleanReflection,
  dismissedKinds,
  dayWords,
  doneHeadline,
  eveningXpKey,
  isPlannedLater,
  moveLabel,
  movableIds,
  normalizeTop3,
  openHeadline,
  openTodayItems,
  promptTimes,
  recentReflections,
  ritualId,
  ritualPrompt,
  top3Progress,
  withDismissed,
  type PromptInput,
} from './rituals'

const TODAY = '2026-09-29'

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    title: `Task ${id}`,
    notes: [],
    status: 'todo',
    priority: 0,
    ...TASK_V2_DEFAULTS,
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
    order: Number(id.replace(/\D/g, '')) || 0,
    boardOrder: 0,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    ...over,
    doDate: over.doDate !== undefined ? over.doDate : TODAY,
  }
}

function ritual(day: string, over: Partial<Ritual> = {}): Ritual {
  return {
    id: ritualId('evening', day),
    createdAt: 0,
    updatedAt: 0,
    day,
    kind: 'evening',
    top3: [],
    reflection: '',
    completedAt: null,
    ...over,
  }
}

describe('keys', () => {
  it('names a ritual by kind and day, and its XP by day', () => {
    expect(ritualId('morning', TODAY)).toBe('morning:2026-09-29')
    expect(ritualId('evening', TODAY)).toBe('evening:2026-09-29')
    expect(eveningXpKey(TODAY)).toBe('ritual:evening:2026-09-29')
    expect(XP_EVENING).toBe(10)
  })
})

describe('normalizeTop3', () => {
  it('keeps the order picked, drops repeats and blanks, and stops at three', () => {
    expect(TOP_MAX).toBe(3)
    expect(normalizeTop3(['b', 'a', 'b', '', 'c', 'd'])).toEqual(['b', 'a', 'c'])
    expect(normalizeTop3([])).toEqual([])
    expect(normalizeTop3(['x'])).toEqual(['x'])
  })
})

describe('cleanReflection', () => {
  it('collapses whitespace into one line', () => {
    expect(cleanReflection('  Good\n\nday,   tired  ')).toBe('Good day, tired')
    expect(cleanReflection('')).toBe('')
  })

  it('cuts a long line without splitting an emoji', () => {
    const long = `${'a'.repeat(REFLECTION_MAX - 1)}😀😀`
    const clean = cleanReflection(long)
    expect(Array.from(clean)).toHaveLength(REFLECTION_MAX)
    expect(clean.endsWith('😀')).toBe(true)
    expect(cleanReflection('a'.repeat(REFLECTION_MAX))).toHaveLength(REFLECTION_MAX)
  })
})

describe('top3Progress', () => {
  it('counts finished ones among those that still exist', () => {
    expect(top3Progress([{ status: 'done' }, { status: 'todo' }, undefined])).toEqual({
      done: 1,
      total: 2,
    })
    expect(top3Progress([])).toEqual({ done: 0, total: 0 })
  })
})

describe("today's items", () => {
  const tasks = [
    task('t1', { doTime: '10:00', source: 'schedule' }),
    task('t2'),
    task('t3', { doDate: '2026-09-27' }),
    task('t4', { doDate: '2026-10-02', status: 'doing' }),
    task('t5', { doDate: null, status: 'doing' }),
    task('t6', { status: 'done', completedDay: TODAY, completedAt: 1 }),
    task('t7', { doDate: '2026-10-01' }),
  ]

  it('is today’s list first, then carried-over work with the day it came from', () => {
    const items = openTodayItems(groupToday(tasks, { today: TODAY }), { today: TODAY })
    expect(items.map((i) => [i.task.id, i.carriedFrom])).toEqual([
      ['t1', null],
      ['t2', null],
      ['t4', null],
      ['t5', null],
      ['t3', '2026-09-27'],
    ])
  })

  it('knows which open work is already planned for a later day', () => {
    expect(isPlannedLater(task('a', { doDate: '2026-10-02' }), TODAY)).toBe(true)
    expect(isPlannedLater(task('b', { doDate: TODAY }), TODAY)).toBe(false)
    expect(isPlannedLater(task('c', { doDate: null }), TODAY)).toBe(false)
    expect(isPlannedLater(task('d', { doDate: null, dueDate: '2026-10-01' }), TODAY)).toBe(true)
  })

  it('moves everything not planned later and not set aside', () => {
    const items = openTodayItems(groupToday(tasks, { today: TODAY }), { today: TODAY })
    expect(movableIds(items, TODAY, new Set()).sort()).toEqual(['t1', 't2', 't3', 't5'])
    expect(movableIds(items, TODAY, new Set(['t2', 't3'])).sort()).toEqual(['t1', 't5'])
  })
})

describe('promptTimes', () => {
  it('reads the stored times and falls back on anything malformed', () => {
    expect(promptTimes({ prompts: true, morningUntil: '11:30', eveningFrom: '18:00' })).toEqual({
      morningUntil: '11:30',
      eveningFrom: '18:00',
    })
    expect(promptTimes(undefined)).toEqual(RITUAL_DEFAULT_TIMES)
    expect(promptTimes({ morningUntil: '25:00', eveningFrom: 'evening' })).toEqual(
      RITUAL_DEFAULT_TIMES,
    )
  })
})

describe('ritualPrompt', () => {
  const base: PromptInput = {
    minutes: 9 * 60 + 30,
    times: { morningUntil: '12:00', eveningFrom: '17:00' },
    enabled: true,
    morningDone: false,
    eveningDone: false,
    dismissed: [],
  }
  const at = (h: number, m = 0): number => h * 60 + m

  it('offers the morning plan before noon while it is not done', () => {
    expect(ritualPrompt(base)).toBe('morning')
    expect(ritualPrompt({ ...base, minutes: at(0, 5) })).toBe('morning')
    expect(ritualPrompt({ ...base, minutes: at(11, 59) })).toBe('morning')
  })

  it('offers nothing between the two windows', () => {
    expect(ritualPrompt({ ...base, minutes: at(12) })).toBeNull()
    expect(ritualPrompt({ ...base, minutes: at(14, 30) })).toBeNull()
    expect(ritualPrompt({ ...base, minutes: at(16, 59) })).toBeNull()
  })

  it('offers the evening shutdown from 17:00 until midnight', () => {
    expect(ritualPrompt({ ...base, minutes: at(17) })).toBe('evening')
    expect(ritualPrompt({ ...base, minutes: at(23, 59) })).toBe('evening')
  })

  it('stays quiet once done, once put away, and when prompts are off', () => {
    expect(ritualPrompt({ ...base, morningDone: true })).toBeNull()
    expect(ritualPrompt({ ...base, minutes: at(18), eveningDone: true })).toBeNull()
    expect(ritualPrompt({ ...base, dismissed: ['morning'] })).toBeNull()
    expect(ritualPrompt({ ...base, minutes: at(18), dismissed: ['evening'] })).toBeNull()
    expect(ritualPrompt({ ...base, enabled: false })).toBeNull()
    // Putting the morning one away does not hide the evening one, and doing the morning plan does
    // not hide the evening shutdown.
    expect(
      ritualPrompt({ ...base, minutes: at(18), dismissed: ['morning'], morningDone: true }),
    ).toBe('evening')
  })

  it('follows the times from settings', () => {
    const times = { morningUntil: '10:00', eveningFrom: '20:30' }
    expect(ritualPrompt({ ...base, times, minutes: at(10) })).toBeNull()
    expect(ritualPrompt({ ...base, times, minutes: at(20, 29) })).toBeNull()
    expect(ritualPrompt({ ...base, times, minutes: at(20, 30) })).toBe('evening')
  })

  it('prefers the evening when the windows overlap', () => {
    const times = { morningUntil: '18:00', eveningFrom: '17:00' }
    expect(ritualPrompt({ ...base, times, minutes: at(17, 30) })).toBe('evening')
    expect(ritualPrompt({ ...base, times, minutes: at(16, 30) })).toBe('morning')
  })
})

describe('putting a prompt away for the day', () => {
  it('remembers kinds for today only', () => {
    expect(dismissedKinds(null, TODAY)).toEqual([])
    const one = withDismissed(null, TODAY, 'morning')
    expect(dismissedKinds(one, TODAY)).toEqual(['morning'])
    const both = withDismissed(one, TODAY, 'evening')
    expect(dismissedKinds(both, TODAY)).toEqual(['morning', 'evening'])
    expect(dismissedKinds(withDismissed(both, TODAY, 'evening'), TODAY)).toEqual([
      'morning',
      'evening',
    ])
    // Yesterday's choice is forgotten, and dismissing today starts a fresh record.
    expect(dismissedKinds(both, '2026-09-30')).toEqual([])
    expect(dismissedKinds(withDismissed(both, '2026-09-30', 'evening'), '2026-09-30')).toEqual([
      'evening',
    ])
  })

  it('shrugs off anything that is not what it wrote', () => {
    for (const raw of [
      '',
      'not json',
      '42',
      'null',
      '{"day":5,"kinds":[]}',
      '{"day":"2026-09-29"}',
    ]) {
      expect(dismissedKinds(raw, TODAY)).toEqual([])
    }
    expect(dismissedKinds('{"day":"2026-09-29","kinds":["morning","noon",7]}', TODAY)).toEqual([
      'morning',
    ])
  })
})

describe('words', () => {
  it('says what got done quietly, and never scolds an empty day', () => {
    expect(doneHeadline(0)).not.toMatch(/only|just|fail|missed|behind/i)
    expect(doneHeadline(1)).toBe('You finished 1 task today.')
    expect(doneHeadline(4)).toBe('You finished 4 tasks today.')
  })

  it('says what is left without alarm', () => {
    expect(openHeadline(0)).toMatch(/Tomorrow starts clear/)
    expect(openHeadline(1)).toBe('1 task still open. Nothing is lost by moving it on.')
    expect(openHeadline(3)).toBe('3 tasks still open. Nothing is lost by moving them on.')
    expect(moveLabel(4)).toBe('Move 4 to tomorrow')
  })
})

describe('dayWords', () => {
  it('lower-cases only the words that are not names', () => {
    expect(dayWords('2026-09-29', TODAY)).toBe('today')
    expect(dayWords('2026-09-30', TODAY)).toBe('tomorrow')
    expect(dayWords('2026-09-28', TODAY)).toBe('yesterday')
    expect(dayWords('2026-10-02', TODAY)).toBe('Friday')
    expect(dayWords('2026-11-12', TODAY)).toBe('Nov 12')
  })
})

describe('recentReflections', () => {
  it('keeps evening rows with words, newest first, up to the limit', () => {
    const rows = [
      ritual('2026-09-25', { reflection: 'Steady.' }),
      ritual('2026-09-27', { reflection: 'Long day, short unit.' }),
      ritual('2026-09-28', { reflection: '   ' }),
      { ...ritual('2026-09-29', { reflection: 'Morning note' }), kind: 'morning' as const },
      ritual('2026-09-26', { reflection: 'Good focus after lunch.' }),
    ]
    expect(recentReflections(rows).map((r) => r.day)).toEqual([
      '2026-09-27',
      '2026-09-26',
      '2026-09-25',
    ])
    expect(recentReflections(rows, 2)).toHaveLength(2)
  })
})
