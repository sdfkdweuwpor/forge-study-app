/**
 * Sample tasks for the dev seed: about thirty tasks around `today`, the way a WGU student's week
 * looks. Scheduled goal chunks (source `schedule`, linked to a course and unit), the student's own
 * errands, one weekly recurring task, and two weeks of finished work with the XP it earned. Dates are
 * relative to `today`, so the list always has overdue, today, upcoming and completed work.
 */
import type { Block, ID, ISODate, Millis, Task, XpEvent } from '@/db/types'
import { addDays, atTime, dayStartMs } from '@/logic/dates'
import { xpForTask, XP_COURSE_COMPLETE, XP_DAILY_GOAL } from '@/logic/xp'
import {
  COURSE_IDS,
  WGU_GOAL_ID,
  unitId,
  unitTitle,
  type CourseCode,
} from './wguBsCs'

export interface StarterContext {
  today: ISODate
  now: Millis
}

export interface StarterData {
  tasks: Task[]
  xpEvents: XpEvent[]
}

type Spec = Partial<Task> & { id: ID; title: string }

const BASE: Omit<Task, 'id' | 'title' | 'createdAt' | 'updatedAt'> = {
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
  order: 0,
  boardOrder: 0,
  startedAt: null,
  completedAt: null,
  completedDay: null,
}

const note = (id: string, text: string): Block => ({ id, type: 'p', text })

export function buildStarterData({ today, now }: StarterContext): StarterData {
  const day = (offset: number): ISODate => addDays(today, offset)
  let seq = 0
  const specs: Spec[] = []
  const add = (spec: Spec): void => {
    specs.push({ order: (seq += 1) * 1024, ...spec })
  }

  /** A scheduled chunk of a course: "C779 · Unit 3: CSS layout (45 min)". */
  const chunk = (
    code: CourseCode,
    unit: number,
    minutes: number,
    part: number,
    extra: Partial<Task> = {},
  ): Spec => ({
    id: `task-${code.toLowerCase()}-u${unit}-${part}`,
    title: `${code} · Unit ${unit}: ${unitTitle(code, unit)} (${minutes} min)`,
    source: 'schedule',
    goalId: WGU_GOAL_ID,
    milestoneId: COURSE_IDS[code],
    unitId: unitId(code, unit),
    scheduleKey: `${unitId(code, unit)}:${part}`,
    estimateMinutes: minutes,
    estimatePomodoros: Math.max(1, Math.round(minutes / 25)),
    ...extra,
  })

  // ── Rolled over ──────────────────────────────────────────────────────────────
  add({
    ...chunk('C779', 2, 30, 3, { dueDate: day(-2), dueTime: '09:00', orderInDay: 0 }),
  })
  add({
    id: 'task-financial-aid',
    title: 'Reply to Financial Aid about the term 2 disbursement',
    dueDate: day(-1),
    priority: 3,
    estimatePomodoros: 1,
    tags: ['admin'],
    notes: [note('n-fa', 'They asked for the enrollment verification letter. It is in the WGU portal under Documents.')],
  })
  add({
    id: 'task-library-card',
    title: 'Renew library card',
    dueDate: day(-3),
    tags: ['errands'],
  })

  // ── Today ────────────────────────────────────────────────────────────────────
  add(
    chunk('C779', 3, 45, 2, {
      dueDate: day(0),
      dueTime: '10:00',
      status: 'doing',
      startedAt: now - 12 * 60_000,
      orderInDay: 0,
      subtasks: [
        { id: 'st-flex', title: 'Flexbox: axis and alignment', done: true },
        { id: 'st-grid', title: 'Grid: template areas', done: false },
        { id: 'st-lab', title: 'Rebuild the pricing page layout', done: false },
      ],
    }),
  )
  add(chunk('C779', 3, 30, 3, { dueDate: day(0), dueTime: '14:00', orderInDay: 1 }))
  add({
    id: 'task-cards-c779',
    title: 'Review 14 C779 flashcards (~10 min)',
    source: 'flashcards',
    goalId: WGU_GOAL_ID,
    milestoneId: COURSE_IDS.C779,
    dueDate: day(0),
    dueTime: '16:30',
    estimatePomodoros: 1,
    estimateMinutes: 10,
    orderInDay: 2,
  })
  add({
    id: 'task-email-mentor',
    title: 'Email mentor about term plan',
    dueDate: day(0),
    priority: 3,
    estimatePomodoros: 1,
    tags: ['mentor'],
    notes: [
      note('n-mentor-1', 'Ask whether D278 should come before C172 this term.'),
      note('n-mentor-2', 'Mention that C182 is done and the C779 OA is planned for mid-October.'),
    ],
  })
  add({
    id: 'task-schedule-oa',
    title: 'Schedule the C779 objective assessment',
    dueDate: day(0),
    priority: 2,
    estimatePomodoros: 1,
    tags: ['admin'],
    goalId: WGU_GOAL_ID,
    milestoneId: COURSE_IDS.C779,
  })

  // ── Upcoming ─────────────────────────────────────────────────────────────────
  add(chunk('C779', 3, 60, 4, { dueDate: day(1), dueTime: '09:00' }))
  add(chunk('C779', 4, 45, 1, { dueDate: day(1), dueTime: '14:00', orderInDay: 1 }))
  add({
    id: 'task-proctor-d278',
    title: 'Book a proctoring slot for the D278 exam',
    dueDate: day(2),
    priority: 2,
    estimatePomodoros: 1,
    tags: ['admin'],
    goalId: WGU_GOAL_ID,
    milestoneId: COURSE_IDS.D278,
  })
  add(chunk('C779', 4, 60, 2, { dueDate: day(2), dueTime: '09:00' }))
  add(chunk('C779', 5, 45, 1, { dueDate: day(3), dueTime: '09:00' }))
  add(chunk('C779', 5, 90, 2, { dueDate: day(4), dueTime: '10:00' }))
  add({
    id: 'task-weekly-review-next',
    title: 'Weekly review',
    dueDate: day(5),
    dueTime: '18:00',
    priority: 2,
    estimatePomodoros: 1,
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] },
    seriesId: 'task-weekly-review-1',
    tags: ['review'],
    subtasks: [
      { id: 'wr-1', title: 'Check hours against the plan', done: false },
      { id: 'wr-2', title: 'Write one win and one blocker', done: false },
      { id: 'wr-3', title: 'Move anything that slipped', done: false },
    ],
  })
  add({
    id: 'task-tuition',
    title: 'Pay tuition installment',
    dueDate: day(9),
    priority: 4,
    tags: ['finance'],
  })
  add({
    id: 'task-car-registration',
    title: 'Renew car registration',
    dueDate: day(15),
    tags: ['errands'],
  })
  add({
    id: 'task-transcript',
    title: 'Request transcript from Portland CC for transfer credits',
    dueDate: day(23),
    priority: 1,
    tags: ['admin'],
  })

  // ── No date ──────────────────────────────────────────────────────────────────
  add({
    id: 'task-python-ide',
    title: 'Pick a Python editor for D278',
    tags: ['D278'],
    estimatePomodoros: 1,
  })
  add({
    id: 'task-notes-folder',
    title: 'Organize the study notes folder',
    tags: ['notes'],
  })
  add({
    id: 'task-term-guide',
    title: 'Read the term 2 course guide',
    priority: 1,
    tags: ['reading'],
    estimatePomodoros: 2,
  })

  // ── Finished in the last two weeks ───────────────────────────────────────────
  const done = (
    offset: number,
    time: string,
    spec: Spec,
  ): Spec => ({
    status: 'done',
    dueDate: day(offset),
    completedDay: day(offset),
    completedAt: atTime(day(offset), time),
    ...spec,
  })
  add(done(-13, '19:40', chunk('C182', 4, 45, 1)))
  add(done(-12, '20:05', chunk('C182', 5, 40, 1)))
  add(done(-11, '08:20', chunk('C182', 6, 60, 1, { priority: 2 })))
  add(
    done(-9, '16:10', {
      id: 'task-c182-oa',
      title: 'Take the C182 objective assessment',
      priority: 4,
      estimatePomodoros: 4,
      tags: ['C182'],
      goalId: WGU_GOAL_ID,
      milestoneId: COURSE_IDS.C182,
    }),
  )
  add(done(-8, '07:50', chunk('C779', 1, 45, 1)))
  add(done(-7, '21:15', chunk('C779', 1, 30, 2)))
  add(done(-6, '12:30', { id: 'task-vscode', title: 'Set up VS Code and Git for the C779 labs', estimatePomodoros: 1, tags: ['C779'] }))
  add(done(-5, '18:45', chunk('C779', 2, 45, 1)))
  add(done(-4, '11:00', { id: 'task-fafsa', title: 'Submit FAFSA renewal', priority: 3, estimatePomodoros: 2, tags: ['finance'] }))
  add(done(-3, '10:40', chunk('C779', 2, 45, 2)))
  add(
    done(-2, '17:30', {
      id: 'task-weekly-review-1',
      title: 'Weekly review',
      priority: 2,
      estimatePomodoros: 1,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] },
      seriesId: 'task-weekly-review-1',
      tags: ['review'],
    }),
  )
  add(done(-1, '20:10', chunk('C779', 3, 30, 1)))

  const tasks: Task[] = specs.map((spec, i) => {
    const created = dayStartMs(addDays(today, -14)) + i * 3_600_000
    return {
      ...BASE,
      boardOrder: spec.order ?? 0,
      createdAt: created,
      updatedAt: Math.max(created, spec.completedAt ?? spec.startedAt ?? created),
      ...spec,
    } as Task
  })

  // The XP the finished tasks earned, exactly as `completeTask` would have written it.
  const xpEvents: XpEvent[] = []
  for (const t of tasks) {
    if (t.status !== 'done' || t.completedAt === null || t.completedDay === null) continue
    xpEvents.push({
      id: `xp-${t.id}`,
      createdAt: t.completedAt,
      updatedAt: t.completedAt,
      at: t.completedAt,
      day: t.completedDay,
      source: 'task',
      amount: xpForTask({ estimate: t.estimatePomodoros, priority: t.priority }),
      key: `task:${t.id}`,
      refId: t.id,
      note: null,
    })
  }
  const bonus = (id: string, offset: number, time: string, source: 'course' | 'dailyGoal', amount: number, key: string, refId: ID | null) => {
    const at = atTime(day(offset), time)
    xpEvents.push({ id, createdAt: at, updatedAt: at, at, day: day(offset), source, amount, key, refId, note: null })
  }
  bonus('xp-course-c182', -9, '16:30', 'course', XP_COURSE_COMPLETE, `course:${COURSE_IDS.C182}`, COURSE_IDS.C182)
  for (const offset of [-8, -5, -3]) {
    bonus(`xp-daily-${offset}`, offset, '22:00', 'dailyGoal', XP_DAILY_GOAL, `dailyGoal:${day(offset)}`, null)
  }

  return { tasks, xpEvents }
}
