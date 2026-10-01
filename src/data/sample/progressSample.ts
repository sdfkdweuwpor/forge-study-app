/**
 * A year of sample focus history for the Progress page: counted sessions, the tasks they were spent on
 * and a `streakDays` row per active day. Deterministic (a seeded generator), so screenshots and e2e
 * specs never change. It reaches the database through `e2e/idb.ts` (raw IndexedDB writes) and feeds the
 * chart demos on /design.
 *
 * It has to load in Node (Playwright specs and shot scripts import it), so it uses relative imports and
 * no `@/` alias at run time. Times are New York wall-clock times, the zone every spec and shot pins
 * (a fixed offset per day, so the rows are the same whatever zone the runner is in).
 */
import type { Session, StreakDay, Task } from '../../db/types'
import { addDays, diffDays, weekdayOf } from '../../logic/dates'

/** The ids of the WGU sample (`wguBsCs.ts`), repeated because that file needs the app's alias. */
const GOAL_ID = 'goal-wgu-bscs'
const COURSES = [
  { id: 'course-c182', code: 'C182', share: 0.24 },
  { id: 'course-c779', code: 'C779', share: 0.38 },
  { id: 'course-d278', code: 'D278', share: 0.22 },
  { id: 'course-c172', code: 'C172', share: 0.16 },
] as const

/** mulberry32: a tiny seeded generator. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The n-th Sunday (1-based) of a month, as an ISO day. */
function nthSunday(year: number, month: number, n: number): string {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const offset = (7 - weekdayOf(first)) % 7
  return addDays(first, offset + (n - 1) * 7)
}

/** Milliseconds for a New York wall-clock time (EDT from the 2nd Sunday of March to the 1st of November). */
export function newYorkMs(day: string, hour: number, minute: number): number {
  const year = Number(day.slice(0, 4))
  const edt = day >= nthSunday(year, 3, 2) && day < nthSunday(year, 11, 1)
  const offset = edt ? '-04:00' : '-05:00'
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return new Date(`${day}T${hh}:${mm}:00${offset}`).getTime()
}

export interface ProgressSample {
  sessions: Session[]
  tasks: Task[]
  streakDays: StreakDay[]
}

export interface ProgressSampleOptions {
  /** The last day of history. */
  today: string
  /** How many days back to start (default 371, the heatmap's 53 weeks). */
  days?: number
  seed?: number
}

const TASK_TITLES: readonly { course: number; title: string; pomodoros: number }[] = [
  { course: 0, title: 'C182 · Unit 1: How computers work (45 min)', pomodoros: 2 },
  { course: 0, title: 'C182 · Unit 2: Operating systems (40 min)', pomodoros: 2 },
  { course: 0, title: 'C182 · Unit 3: Networks and the internet (60 min)', pomodoros: 2 },
  { course: 0, title: 'C182 · Unit 4: Security basics (45 min)', pomodoros: 2 },
  { course: 1, title: 'C779 · Unit 1: HTML structure (30 min)', pomodoros: 1 },
  { course: 1, title: 'C779 · Unit 2: CSS layout (45 min)', pomodoros: 2 },
  { course: 1, title: 'C779 · Unit 3: Flexbox and grid (60 min)', pomodoros: 3 },
  { course: 1, title: 'C779 · Unit 4: Forms and validation (45 min)', pomodoros: 2 },
  { course: 2, title: 'D278 · Unit 1: Variables and types (45 min)', pomodoros: 2 },
  { course: 2, title: 'D278 · Unit 2: Loops and branches (60 min)', pomodoros: 3 },
  { course: 2, title: 'D278 · Unit 3: Functions (45 min)', pomodoros: 2 },
  { course: 3, title: 'C172 · Unit 1: Network models (45 min)', pomodoros: 2 },
  { course: 3, title: 'C172 · Unit 2: IP addressing (60 min)', pomodoros: 3 },
  { course: 3, title: 'Review 14 flashcards (~10 min)', pomodoros: 1 },
]

/**
 * Builds the history. About 80 % of recent days have focus, fewer the further back (a student who
 * started a year ago), mostly morning and evening pomodoros, a few 50-minute sessions, and now and then
 * a session stopped early that does not count.
 */
export function buildProgressSample({
  today,
  days = 371,
  seed = 7,
}: ProgressSampleOptions): ProgressSample {
  const rand = rng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T
  const sessions: Session[] = []
  const streakDays: StreakDay[] = []
  let n = 0

  const session = (
    day: string,
    hour: number,
    minute: number,
    minutes: number,
    extra: Partial<Session> & { course?: number } = {},
  ): Session => {
    n += 1
    const startedAt = newYorkMs(day, hour, minute)
    const course = extra.course ?? -1
    const counted = extra.counted ?? true
    const actual = counted ? minutes : Math.round(minutes * 0.4)
    const { course: _course, ...rest } = extra
    return {
      id: `prog-s${n}`,
      createdAt: startedAt,
      updatedAt: startedAt + actual * 60_000,
      kind: 'focus',
      mode: minutes === 25 ? 'pomodoro' : 'custom',
      status: 'completed',
      taskId: null,
      goalId: course >= 0 ? GOAL_ID : rand() < 0.08 ? GOAL_ID : null,
      milestoneId: course >= 0 ? (COURSES[course]?.id ?? null) : null,
      day,
      startedAt,
      endedAt: startedAt + actual * 60_000,
      plannedMinutes: minutes,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: actual,
      round: 1,
      interrupted: !counted,
      counted,
      note: null,
      ...rest,
    }
  }

  const courseAt = (): number => {
    const r = rand()
    let acc = 0
    for (let i = 0; i < COURSES.length; i++) {
      acc += COURSES[i]?.share ?? 0
      if (r < acc) return i
    }
    return COURSES.length - 1
  }

  for (let back = days - 1; back >= 0; back--) {
    const day = addDays(today, -back)
    const age = back / days
    const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6
    const chance = (weekend ? 0.55 : 0.85) * (1 - 0.7 * age) + 0.05
    if (rand() > chance) continue

    const count = 1 + Math.floor(rand() * (weekend ? 3 : 4))
    // One block a day: mostly a morning start, sometimes an evening one; sessions follow 70 minutes apart.
    const start =
      rand() < 0.45 ? 19 * 60 + pick([0, 15, 30]) : 8 * 60 + pick([0, 15, 30, 60, 90, 150])
    let minutesToday = 0
    let counted = 0
    for (let i = 0; i < count; i++) {
      const at = start + i * 70
      const minutes = rand() < 0.2 ? 50 : 25
      const early = rand() < 0.05
      sessions.push(
        session(day, Math.floor(at / 60), at % 60, minutes, {
          course: courseAt(),
          counted: !early,
        }),
      )
      if (!early) {
        minutesToday += minutes
        counted += 1
      }
    }
    if (counted > 0) {
      streakDays.push({
        id: day,
        createdAt: newYorkMs(day, 23, 0),
        updatedAt: newYorkMs(day, 23, 0),
        day,
        focusMinutes: minutesToday,
        focusSessions: counted,
        pomodoros: Math.floor(minutesToday / 25),
        tasksDone: 0,
        dailyGoalTarget: 6,
        dailyGoalHit: Math.floor(minutesToday / 25) >= 6,
        qualified: true,
        xp: minutesToday,
      })
    }
  }

  // Finished tasks over the last 12 weeks, each with the time it took (an estimate that is sometimes
  // right and sometimes a bit off), for "tasks per week" and "estimate accuracy".
  const tasks: Task[] = []
  const window = 12 * 7
  let t = 0
  for (let back = window - 1; back >= 0; back--) {
    const day = addDays(today, -back)
    if (diffDays(today, day) < 0) continue
    const perDay = rand() < 0.55 ? 1 + Math.floor(rand() * (rand() < 0.25 ? 3 : 2)) : 0
    for (let k = 0; k < perDay; k++) {
      const spec = pick(TASK_TITLES)
      t += 1
      const id = `prog-task-${t}`
      const completedAt = newYorkMs(day, 9 + Math.floor(rand() * 12), pick([5, 20, 45]))
      const course = COURSES[spec.course]
      const drift = rand()
      // Mostly on target, sometimes half a pomodoro over or under, rarely far off.
      const actualPomodoros =
        drift < 0.6
          ? spec.pomodoros
          : drift < 0.85
            ? spec.pomodoros + (rand() < 0.5 ? 1 : -1)
            : spec.pomodoros + 2
      const worked = Math.max(1, actualPomodoros)
      tasks.push({
        id,
        createdAt: completedAt - 86_400_000,
        updatedAt: completedAt,
        title: spec.title,
        notes: [],
        status: 'done',
        priority: 0,
        doDate: day,
        doTime: null,
        durationMinutes: null,
        dueDate: null,
        dueTime: null,
        estimatePomodoros: spec.pomodoros,
        estimateMinutes: null,
        tags: course ? [course.code] : [],
        goalId: GOAL_ID,
        milestoneId: course?.id ?? null,
        unitId: null,
        source: 'user',
        scheduleKey: null,
        schedulePinned: false,
        skippedOn: null,
        orderInDay: 0,
        subtasks: [],
        recurrence: null,
        seriesId: null,
        order: t * 1024,
        boardOrder: t * 1024,
        startedAt: null,
        completedAt,
        completedDay: day,
        autoSlot: false,
        kind: 'task',
        assessmentId: null,
        sync: null,
      })
      for (let p = 0; p < worked; p++) {
        const startedAt = completedAt - (worked - p) * 30 * 60_000
        sessions.push(
          session(day, 0, 0, 25, {
            taskId: id,
            course: spec.course,
            startedAt,
            endedAt: startedAt + 25 * 60_000,
          }),
        )
      }
    }
  }

  return { sessions, tasks, streakDays }
}
