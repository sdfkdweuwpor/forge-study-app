import { describe, expect, it } from 'vitest'
import {
  ROUTINE_NAME_MAX,
  ROUTINE_TASKS_MAX,
  STARTER_ROUTINES,
  cleanRoutineName,
  parseRoutinePayload,
  routineMinutes,
  routinePayloadFromTasks,
  routineTaskDrafts,
} from './routines'

describe('parseRoutinePayload', () => {
  it('accepts titles with an optional length, time and goal', () => {
    const payload = {
      tasks: [
        { title: 'C182 · Read Unit 3', durationMinutes: 50, doTime: '09:00', goalId: 'g1' },
        { title: 'Log questions for the mentor' },
      ],
    }
    expect(parseRoutinePayload(payload)).toEqual(payload)
  })

  it('trims titles', () => {
    expect(parseRoutinePayload({ tasks: [{ title: '  D278 review  ' }] })).toEqual({
      tasks: [{ title: 'D278 review' }],
    })
  })

  it.each([
    ['no tasks', { tasks: [] }],
    ['not an object', 'Study day'],
    ['null', null],
    ['tasks is not a list', { tasks: 'a' }],
    ['a blank title', { tasks: [{ title: '   ' }] }],
    ['a title that is too long', { tasks: [{ title: 'x'.repeat(201) }] }],
    ['a length of zero', { tasks: [{ title: 'x', durationMinutes: 0 }] }],
    ['a fractional length', { tasks: [{ title: 'x', durationMinutes: 12.5 }] }],
    ['a time that is not HH:mm', { tasks: [{ title: 'x', doTime: '9am' }] }],
    ['an impossible time', { tasks: [{ title: 'x', doTime: '25:00' }] }],
    ['an empty goal id', { tasks: [{ title: 'x', goalId: '' }] }],
    [
      'too many tasks',
      { tasks: Array.from({ length: ROUTINE_TASKS_MAX + 1 }, (_, i) => ({ title: `T${i}` })) },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(parseRoutinePayload(payload)).toBeNull()
  })
})

describe('cleanRoutineName', () => {
  it('tidies whitespace and caps the length', () => {
    expect(cleanRoutineName('  Study \n day ')).toBe('Study day')
    expect(cleanRoutineName('')).toBe('')
    expect(cleanRoutineName('a'.repeat(ROUTINE_NAME_MAX + 10))).toHaveLength(ROUTINE_NAME_MAX)
  })
})

describe('routinePayloadFromTasks', () => {
  it('keeps title, length (slot, else estimate), time and goal, and nothing else', () => {
    const payload = routinePayloadFromTasks([
      { title: 'Read Unit 3', durationMinutes: 50, estimateMinutes: 30, doTime: '09:00', goalId: 'g1' },
      { title: 'Practice quiz', durationMinutes: null, estimateMinutes: 25, doTime: null, goalId: null },
      { title: 'Call the bursar', durationMinutes: null, estimateMinutes: null, doTime: null, goalId: null },
      { title: 'Tiny', durationMinutes: 2, estimateMinutes: null, doTime: null, goalId: null },
    ])
    expect(payload.tasks).toEqual([
      { title: 'Read Unit 3', durationMinutes: 50, doTime: '09:00', goalId: 'g1' },
      { title: 'Practice quiz', durationMinutes: 25 },
      { title: 'Call the bursar' },
      { title: 'Tiny' },
    ])
    expect(parseRoutinePayload(payload)).not.toBeNull()
  })

  it('stops at the most a routine holds', () => {
    const many = Array.from({ length: ROUTINE_TASKS_MAX + 5 }, (_, i) => ({
      title: `Task ${i}`,
      durationMinutes: null,
      estimateMinutes: null,
      doTime: null,
      goalId: null,
    }))
    expect(routinePayloadFromTasks(many).tasks).toHaveLength(ROUTINE_TASKS_MAX)
  })
})

describe('routineTaskDrafts', () => {
  const payload = {
    tasks: [
      { title: 'C779 · Unit 3', durationMinutes: 45, doTime: '10:00', goalId: 'g1' },
      { title: 'D278 · Review', goalId: 'gone' },
      { title: 'Plain' },
    ],
  }

  it('plans each task for the day, in order, keeping only goals that exist', () => {
    expect(routineTaskDrafts(payload, '2026-09-30', new Set(['g1']))).toEqual([
      { title: 'C779 · Unit 3', doDate: '2026-09-30', doTime: '10:00', durationMinutes: 45, goalId: 'g1' },
      { title: 'D278 · Review', doDate: '2026-09-30' },
      { title: 'Plain', doDate: '2026-09-30' },
    ])
  })
})

describe('starters', () => {
  it('are Study day and Weekly reset, both valid routines', () => {
    expect(STARTER_ROUTINES.map((r) => r.name)).toEqual(['Study day', 'Weekly reset'])
    for (const starter of STARTER_ROUTINES) {
      expect(starter.builtIn).toBe(true)
      expect(starter.id.startsWith('starter:')).toBe(true)
      expect(parseRoutinePayload(starter.payload)).toEqual(starter.payload)
    }
  })

  it('add up their minutes', () => {
    expect(routineMinutes(STARTER_ROUTINES[0]?.payload ?? { tasks: [] })).toBe(110)
    expect(routineMinutes({ tasks: [{ title: 'No length' }] })).toBe(0)
  })
})
