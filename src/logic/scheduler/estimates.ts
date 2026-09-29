/**
 * How much work is left (pure): unit estimates, and remaining minutes per unit after the chunks that
 * are done or pinned.
 */
import type { ID, Task } from '@/db/types'
import { ceilTo, DEFAULT_OPTIONS } from './capacity'

/** Minutes a pomodoro stands for when a task has no minute estimate. */
export const POMODORO_MINUTES = 25

/** Title of the one synthetic unit a course without units is scheduled as. */
export const SYNTHETIC_UNIT_TITLE = 'Study session'

/** `'unit-42:3'` → `{ unitId: 'unit-42', seq: 3 }`. The id is everything before the last colon. */
export function parseScheduleKey(key: string | null): { unitId: string; seq: number } | null {
  if (!key) return null
  const at = key.lastIndexOf(':')
  if (at <= 0) return null
  const seq = Number(key.slice(at + 1))
  if (!Number.isInteger(seq) || seq < 1) return null
  return { unitId: key.slice(0, at), seq }
}

export function scheduleKey(unitId: string, seq: number): string {
  return `${unitId}:${seq}`
}

type MinutesOf = Pick<Task, 'estimateMinutes' | 'estimatePomodoros'>

/** A task's planned minutes: its minute estimate, else pomodoros × 25, else 0. */
export function taskMinutes(task: MinutesOf): number {
  const m = task.estimateMinutes
  if (m !== null && Number.isFinite(m) && m > 0) return m
  const p = task.estimatePomodoros
  return p !== null && Number.isFinite(p) && p > 0 ? p * POMODORO_MINUTES : 0
}

/** Pomodoros shown for a chunk of `minutes`: at least one. */
export function pomodorosFor(minutes: number): number {
  return Math.max(1, Math.round(minutes / POMODORO_MINUTES))
}

type ChunkTaskRef = Pick<Task, 'scheduleKey' | 'unitId' | 'milestoneId'>

/**
 * The scheduler unit a task belongs to: the unit in its key when it has one, else its unit, else its
 * course (the synthetic unit of a course without units has the course's id).
 */
export function taskUnitId(task: ChunkTaskRef): ID | null {
  return parseScheduleKey(task.scheduleKey)?.unitId ?? task.unitId ?? task.milestoneId ?? null
}

const clean = (n: number | null | undefined): number | null =>
  n !== null && n !== undefined && Number.isFinite(n) && n >= 0 ? n : null

/**
 * Minutes per unit, parallel to `units`. A unit with an estimate keeps it. Units without one share the
 * course's leftover (course hours minus the known estimates) equally, in whole grains; the grains that
 * do not divide evenly go to the earliest of them. When nothing is left over they get 0. When every unit
 * has an estimate, their sum is the course's work and the course's own hours are not used.
 */
export function resolveUnitEstimates(
  course: { estimateHours: number },
  units: ReadonlyArray<{ estimateMinutes: number | null }>,
  grain: number = DEFAULT_OPTIONS.grain,
): number[] {
  const known = units.map((u) => clean(u.estimateMinutes))
  const unknown = known.filter((k) => k === null).length
  if (unknown === 0) return known as number[]
  const courseMinutes = (clean(course.estimateHours) ?? 0) * 60
  const knownSum = known.reduce<number>((s, k) => s + (k ?? 0), 0)
  const grains = Math.max(0, Math.floor((courseMinutes - knownSum) / grain))
  const each = Math.floor(grains / unknown)
  let extra = grains - each * unknown
  return known.map((k) => {
    if (k !== null) return k
    const g = each + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    return g * grain
  })
}

export interface UnitEstimate {
  id: string
  estimateMinutes: number
  /** A unit marked done has nothing left, whatever its chunks say. */
  done: boolean
}

export interface UnitRemaining {
  /** Estimate − done − pinned, rounded up to the grain, never negative. */
  remainingMinutes: number
  /** `usedSeqs.length`. */
  chunkSeqStart: number
  /** Chunk numbers held by done and pinned chunks, ascending. */
  usedSeqs: number[]
  doneMinutes: number
  pinnedMinutes: number
}

/**
 * Remaining work per unit (PLAN §4.1). `doneTasks` and `pinnedTasks` are the goal's scheduled chunks
 * that are finished, and open but pinned; they are matched to units by `taskUnitId`. Their minutes come
 * off the estimate and their chunk numbers are taken, so new chunks never reuse a key.
 */
export function computeRemaining(
  units: readonly UnitEstimate[],
  doneTasks: ReadonlyArray<ChunkTaskRef & MinutesOf>,
  pinnedTasks: ReadonlyArray<ChunkTaskRef & MinutesOf>,
  grain: number = DEFAULT_OPTIONS.grain,
): Map<string, UnitRemaining> {
  const acc = new Map<string, { done: number; pinned: number; seqs: Set<number> }>()
  const slot = (id: string) => {
    let a = acc.get(id)
    if (!a) {
      a = { done: 0, pinned: 0, seqs: new Set<number>() }
      acc.set(id, a)
    }
    return a
  }
  const add = (t: ChunkTaskRef & MinutesOf, field: 'done' | 'pinned'): void => {
    const id = taskUnitId(t)
    if (id === null) return
    const a = slot(id)
    a[field] += taskMinutes(t)
    const seq = parseScheduleKey(t.scheduleKey)?.seq
    if (seq !== undefined) a.seqs.add(seq)
  }
  for (const t of doneTasks) add(t, 'done')
  for (const t of pinnedTasks) add(t, 'pinned')

  const out = new Map<string, UnitRemaining>()
  for (const u of units) {
    const a = acc.get(u.id) ?? { done: 0, pinned: 0, seqs: new Set<number>() }
    const left = u.done ? 0 : Math.max(0, u.estimateMinutes - a.done - a.pinned)
    const usedSeqs = [...a.seqs].sort((x, y) => x - y)
    out.set(u.id, {
      remainingMinutes: left > 0 ? ceilTo(left, grain) : 0,
      chunkSeqStart: usedSeqs.length,
      usedSeqs,
      doneMinutes: a.done,
      pinnedMinutes: a.pinned,
    })
  }
  return out
}
