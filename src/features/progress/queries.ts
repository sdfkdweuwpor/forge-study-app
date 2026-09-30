/**
 * Reads for the Progress page. The one file in this feature that may import the Dexie instance. Every
 * page number comes from `sessions` (counted focus), `tasks` (finished) and `streakDays` (through 7A's
 * `useStreak`), each bounded by date so a long history stays cheap.
 *
 * The `load*` functions are plain async reads (tested against fake-indexeddb); the `use*` hooks wrap
 * them in live queries. A hook is `undefined` only while its first read is loading, and a failed read
 * throws to the nearest error boundary like any live query.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '@/db/db'
import { useSettings } from '@/db/hooks/useSettings'
import type { ISODate, TagColor } from '@/db/types'
import { tagColor } from '@/logic/tagColor'
import { countedMinutes, type NamedRef, type StatSession, type StatTask } from '@/logic/stats'

/** The smallest and largest possible ISO day, to bound an index scan on `[kind+day]`. */
const FIRST_DAY = ''
const LAST_DAY = '￿'

const toStatSession = (s: StatSession): StatSession => ({
  id: s.id,
  kind: s.kind,
  status: s.status,
  counted: s.counted,
  day: s.day,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  actualMinutes: s.actualMinutes,
  pausedMs: s.pausedMs,
  taskId: s.taskId,
  goalId: s.goalId,
  milestoneId: s.milestoneId,
})

/** Counted focus sessions whose day is in `[from, to]`, trimmed to what the statistics read. */
export async function loadFocusSessions(from: ISODate, to: ISODate): Promise<StatSession[]> {
  const rows = await db.sessions
    .where('[kind+day]')
    .between(['focus', from], ['focus', to], true, true)
    .toArray()
  return rows.filter((s) => countedMinutes(s) > 0).map(toStatSession)
}

const toStatTask = (t: StatTask): StatTask => ({
  id: t.id,
  status: t.status,
  completedAt: t.completedAt,
  completedDay: t.completedDay,
  estimatePomodoros: t.estimatePomodoros,
})

/** Tasks finished on a day in `[from, to]`. */
export async function loadDoneTasks(from: ISODate, to: ISODate): Promise<StatTask[]> {
  const rows = await db.tasks.where('completedDay').between(from, to, true, true).toArray()
  return rows.filter((t) => t.status === 'done').map(toStatTask)
}

/** A finished task with its name, for the tooltip. */
export type TitledTask = StatTask & { title: string }

export interface AccuracyInputs {
  tasks: TitledTask[]
  sessions: StatSession[]
}

/**
 * Finished tasks in `[from, to]` that have an estimate, and every counted session logged on them (a
 * session may be from before the window: a task can take weeks).
 */
export async function loadAccuracyInputs(from: ISODate, to: ISODate): Promise<AccuracyInputs> {
  const rows = await db.tasks.where('completedDay').between(from, to, true, true).toArray()
  const done: TitledTask[] = rows
    .filter((t) => t.status === 'done' && (t.estimatePomodoros ?? 0) > 0)
    .map((t) => ({ ...toStatTask(t), title: t.title }))
  if (done.length === 0) return { tasks: [], sessions: [] }
  const logged = await db.sessions
    .where('taskId')
    .anyOf(done.map((t) => t.id))
    .toArray()
  return { tasks: done, sessions: logged.filter((s) => countedMinutes(s) > 0).map(toStatSession) }
}

export interface LifetimeTotals {
  /** Counted focus minutes, ever. */
  focusMinutes: number
  /** Counted focus sessions, ever. */
  sessions: number
  /** Tasks finished, ever. */
  tasksDone: number
}

/** All-time counts for the header. Streams the focus sessions instead of holding them. */
export async function loadLifetimeTotals(): Promise<LifetimeTotals> {
  let minutes = 0
  let sessions = 0
  await db.sessions
    .where('[kind+day]')
    .between(['focus', FIRST_DAY], ['focus', LAST_DAY], true, true)
    .each((s) => {
      const m = countedMinutes(s)
      if (m > 0) {
        minutes += m
        sessions += 1
      }
    })
  const tasksDone = await db.tasks.where('status').equals('done').count()
  return { focusMinutes: Math.round(minutes), sessions, tasksDone }
}

export interface RefRows {
  goals: { id: string; title: string }[]
  courses: { id: string; code: string | null; title: string }[]
}

/** The goals and courses a session can point at. */
export async function loadRefRows(): Promise<RefRows> {
  const [goals, milestones] = await Promise.all([db.goals.toArray(), db.milestones.toArray()])
  return {
    goals: goals.map((g) => ({ id: g.id, title: g.title })),
    courses: milestones.map((m) => ({ id: m.id, code: m.code, title: m.title })),
  }
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Counted focus sessions from `from` to `to` (days), live. */
export function useFocusSessions(from: ISODate, to: ISODate): StatSession[] | undefined {
  return useLiveQuery(() => loadFocusSessions(from, to), [from, to])
}

/** Tasks finished from `from` to `to`, live. */
export function useDoneTasks(from: ISODate, to: ISODate): StatTask[] | undefined {
  return useLiveQuery(() => loadDoneTasks(from, to), [from, to])
}

/** Estimated tasks finished in the window, with the time logged on them, live. */
export function useAccuracyInputs(from: ISODate, to: ISODate): AccuracyInputs | undefined {
  return useLiveQuery(() => loadAccuracyInputs(from, to), [from, to])
}

/** Lifetime focus minutes, sessions and finished tasks, live. */
export function useLifetimeTotals(): LifetimeTotals | undefined {
  return useLiveQuery(loadLifetimeTotals)
}

export interface TimeRefs {
  goals: NamedRef[]
  courses: NamedRef[]
}

/** A tag colour for a chart bar: red reads as alarm, and a bar is never that, so it becomes pink. */
const chartColor = (color: TagColor): TagColor => (color === 'red' ? 'pink' : color)

/**
 * Goals and courses as named, coloured rows. A course takes the colour of its code tag (`C779`), as
 * everywhere else in the app, so the bars match the chips; a goal takes one from its title.
 */
export function useTimeRefs(): TimeRefs | undefined {
  const rows = useLiveQuery(loadRefRows)
  const settings = useSettings()
  const overrides = settings?.tagColors
  return useMemo(() => {
    if (!rows) return undefined
    return {
      goals: rows.goals.map((g) => ({
        id: g.id,
        title: g.title,
        color: chartColor(tagColor(g.title, overrides)),
      })),
      courses: rows.courses.map((c) => ({
        id: c.id,
        title: c.code ? `${c.code} ${c.title}` : c.title,
        color: chartColor(tagColor(c.code ?? c.title, overrides)),
      })),
    }
  }, [rows, overrides])
}
