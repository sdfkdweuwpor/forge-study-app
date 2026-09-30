import { describe, expect, it } from 'vitest'
import {
  flashcardToV2,
  goalToV2,
  migrateTablesV1toV2,
  settingsToV2,
  taskToV2,
  trashToV2,
  unitToV2,
  wguPlannedAssessments,
} from './schemaV2'

/** The mapped row, read as plain data (the mappers keep their input's static type). */
const data = <T>(v: unknown): T => v as T

describe('schema v2 row mapping', () => {
  it('moves a v1 task date to the do date, once', () => {
    const v1 = {
      id: 't',
      source: 'schedule',
      dueDate: '2026-09-29',
      dueTime: '10:00',
      estimateMinutes: 45,
    }
    const v2 = taskToV2(v1)
    expect(v2).toEqual({
      ...v1,
      doDate: '2026-09-29',
      doTime: '10:00',
      dueDate: null,
      dueTime: null,
      durationMinutes: 45,
      autoSlot: false,
      kind: 'study',
      assessmentId: null,
      sync: null,
    })
    expect(taskToV2(v2)).toEqual(v2)
    // A v2 task that has a real deadline keeps it.
    const withDeadline = { ...v2, dueDate: '2026-10-02' }
    expect(taskToV2(withDeadline).dueDate).toBe('2026-10-02')
    expect(
      data<{ kind: string }>(taskToV2({ id: 'f', source: 'flashcards', dueDate: null })).kind,
    ).toBe('review')
  })

  it('gives a goal planning from its minutes, and a goal without availability an empty week', () => {
    const g = data<{ planning: { weekly: unknown[][]; asap: boolean } }>(
      goalToV2(
        {
          id: 'g',
          targetDate: null,
          availability: { minutesByWeekday: [0, 60, 0, 0, 0, 0, 0], daysOff: [] },
        },
        { studyStart: '20:00' },
      ),
    )
    expect(g.planning.weekly[1]).toEqual([{ start: '20:00', end: '21:00' }])
    expect(g.planning.asap).toBe(true)
    const broken = data<{ planning: { weekly: unknown[][] } }>(goalToV2({ id: 'x' }))
    expect(broken.planning.weekly.every((d) => d.length === 0)).toBe(true)
  })

  it('fills unit, flashcard and settings fields without touching what is there', () => {
    expect(unitToV2({ id: 'u', estimateMinutes: null })).toMatchObject({
      estimateSource: 'course',
      baseEstimateMinutes: null,
      optional: false,
      selfRating: null,
    })
    expect(unitToV2({ id: 'u', estimateMinutes: 90, optional: true }).optional).toBe(true)
    expect(flashcardToV2({ id: 'c', scheduler: 'fsrs' }).scheduler).toBe('fsrs')
    const s = data<{ scheduling: { taskWindows: unknown[] } }>(
      settingsToV2({ id: 'app', scheduling: { defaultStudyStart: '09:00' } }),
    )
    expect(s.scheduling.taskWindows).toHaveLength(7)
  })

  it('creates the WGU assessments with stable ids (done for a finished course)', () => {
    const courses = [
      { id: 'c1', goalId: 'g', order: 0, status: 'done', courseType: 'OA+PA', completedAt: 5 },
      { id: 'c2', goalId: 'g', order: 1, status: 'todo', courseType: 'PA', completedAt: null },
      { id: 'c3', goalId: 'g', order: 2, status: 'todo', courseType: null, completedAt: null },
    ]
    expect(wguPlannedAssessments(courses, 9).map((a) => [a.id, a.kind, a.status, a.order])).toEqual(
      [
        ['c1:oa', 'exam', 'done', 0],
        ['c1:pa', 'project', 'done', 1],
        ['c2:pa', 'project', 'planned', 3],
      ],
    )
  })

  it('maps whole tables, trash payloads too, and passes unknown tables through', () => {
    const out = migrateTablesV1toV2(
      {
        settings: [{ id: 'app', scheduling: { defaultStudyStart: '06:30' } }],
        goals: [
          {
            id: 'g',
            targetDate: null,
            availability: { minutesByWeekday: [0, 30, 0, 0, 0, 0, 0], daysOff: [] },
          },
        ],
        trash: [
          {
            id: 'tr',
            payload: { tasks: [{ id: 't', source: 'user', dueDate: '2026-09-01', dueTime: null }] },
          },
        ],
        mystery: [{ id: 'm' }],
      },
      1,
    )
    expect((out.goals?.[0] as { planning: { weekly: unknown[][] } }).planning.weekly[1]).toEqual([
      { start: '06:30', end: '07:00' },
    ])
    expect(
      (out.trash?.[0] as { payload: { tasks: { doDate: string }[] } }).payload.tasks[0]?.doDate,
    ).toBe('2026-09-01')
    expect(out.mystery).toEqual([{ id: 'm' }])
    expect(out.plannedAssessments).toEqual([])
    expect(trashToV2(null, 1)).toBeNull()
  })
})
