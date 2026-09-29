/**
 * Course order (pure): Kahn's algorithm over prerequisites with a fixed priority, so the order is
 * deterministic and a prerequisite's work always comes first.
 *
 * Priority among courses that are ready: `active` first, then `order`, then `code`, then `id`.
 * - Done courses are not scheduled; a prerequisite pointing at one is satisfied.
 * - A prerequisite id that matches no course raises `UNKNOWN_PREREQ` and is ignored.
 * - A cycle raises one `PREREQ_CYCLE` per strongly connected component. The order still completes: when
 *   nothing is ready, the best-priority course whose only unmet prerequisites are inside its own cycle
 *   is released, so courses that merely depend on a cycle still come after it.
 */
import type { CourseStatus, SchedulerIssue } from './types'

export interface TopoCourse {
  id: string
  code: string | null
  order: number
  status: CourseStatus
  prerequisiteIds: readonly string[]
}

export interface TopoResult<T> {
  order: T[]
  issues: SchedulerIssue[]
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Ready-queue priority: active first, then order, code (none last), id. */
export function comparePriority(a: TopoCourse, b: TopoCourse): number {
  const act = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
  if (act !== 0) return act
  if (a.order !== b.order) return a.order - b.order
  if (a.code !== b.code) {
    if (a.code === null) return 1
    if (b.code === null) return -1
    const c = cmpStr(a.code, b.code)
    if (c !== 0) return c
  }
  return cmpStr(a.id, b.id)
}

/** Order used to list cycle members in an issue: `order`, then code, then id. */
function compareCyclePosition(a: TopoCourse, b: TopoCourse): number {
  if (a.order !== b.order) return a.order - b.order
  return cmpStr(a.code ?? '', b.code ?? '') || cmpStr(a.id, b.id)
}

/** Tarjan's strongly connected components over `ids`, following `edges` (prerequisite → dependent). */
function stronglyConnected(ids: readonly string[], edges: ReadonlyMap<string, string[]>): string[][] {
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []

  // Iterative DFS, so a long prerequisite chain cannot overflow the call stack.
  for (const root of ids) {
    if (idx.has(root)) continue
    const work: Array<{ v: string; i: number }> = [{ v: root, i: 0 }]
    idx.set(root, index)
    low.set(root, index)
    index++
    stack.push(root)
    onStack.add(root)
    while (work.length > 0) {
      const frame = work[work.length - 1] as { v: string; i: number }
      const next = edges.get(frame.v) ?? []
      if (frame.i < next.length) {
        const w = next[frame.i] as string
        frame.i++
        if (!idx.has(w)) {
          idx.set(w, index)
          low.set(w, index)
          index++
          stack.push(w)
          onStack.add(w)
          work.push({ v: w, i: 0 })
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v) as number, idx.get(w) as number))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.v, Math.min(low.get(parent.v) as number, low.get(frame.v) as number))
      if (low.get(frame.v) === idx.get(frame.v)) {
        const comp: string[] = []
        let w: string | undefined
        do {
          w = stack.pop()
          if (w === undefined) break
          onStack.delete(w)
          comp.push(w)
        } while (w !== frame.v)
        out.push(comp)
      }
    }
  }
  return out
}

/**
 * Courses to schedule (done ones dropped) in prerequisite order, plus any `UNKNOWN_PREREQ` and
 * `PREREQ_CYCLE` issues. Input order does not matter: the result depends only on the data.
 */
export function orderCourses<T extends TopoCourse>(courses: readonly T[]): TopoResult<T> {
  const issues: SchedulerIssue[] = []
  const byId = new Map<string, T>()
  for (const c of [...courses].sort((a, b) => cmpStr(a.id, b.id))) {
    if (!byId.has(c.id)) byId.set(c.id, c)
  }
  const open = [...byId.values()].filter((c) => c.status !== 'done').sort(comparePriority)
  const openIds = new Set(open.map((c) => c.id))

  // prerequisite → dependents, and each course's unmet prerequisites.
  const dependents = new Map<string, string[]>()
  const unmet = new Map<string, Set<string>>()
  for (const c of open) {
    const needs = new Set<string>()
    for (const p of [...new Set(c.prerequisiteIds)].sort(cmpStr)) {
      const pre = byId.get(p)
      if (!pre) {
        issues.push({ code: 'UNKNOWN_PREREQ', courseId: c.id, prerequisiteId: p })
        continue
      }
      if (pre.status === 'done') continue
      needs.add(p)
      const list = dependents.get(p) ?? []
      list.push(c.id)
      dependents.set(p, list)
    }
    unmet.set(c.id, needs)
  }

  const components = stronglyConnected(
    open.map((c) => c.id),
    dependents,
  )
  const componentOf = new Map<string, number>()
  components.forEach((comp, i) => {
    for (const id of comp) componentOf.set(id, i)
  })
  const cycles = components
    .filter((comp) => {
      const only = comp[0]
      return comp.length > 1 || (only !== undefined && unmet.get(only)?.has(only) === true)
    })
    .map((comp) =>
      comp
        .map((id) => byId.get(id) as T)
        .sort(compareCyclePosition)
        .map((c) => c.id),
    )
    .sort((a, b) =>
      compareCyclePosition(byId.get(a[0] as string) as T, byId.get(b[0] as string) as T),
    )
  for (const courseIds of cycles) issues.push({ code: 'PREREQ_CYCLE', courseIds })

  const order: T[] = []
  const done = new Set<string>()
  const release = (id: string): void => {
    done.add(id)
    order.push(byId.get(id) as T)
    for (const d of dependents.get(id) ?? []) unmet.get(d)?.delete(id)
  }

  while (order.length < open.length) {
    // `open` is sorted by priority, so the first ready course is the best one.
    const ready = open.find((c) => !done.has(c.id) && (unmet.get(c.id)?.size ?? 0) === 0)
    if (ready) {
      release(ready.id)
      continue
    }
    // Stalled on a cycle: release the best course whose unmet prerequisites all sit in its own cycle.
    const breaker = open.find((c) => {
      if (done.has(c.id)) return false
      const own = componentOf.get(c.id)
      for (const p of unmet.get(c.id) ?? []) if (componentOf.get(p) !== own) return false
      return true
    })
    // A stalled graph always has such a course (a source component of the remaining graph).
    release((breaker ?? (open.find((c) => !done.has(c.id)) as T)).id)
  }

  return { order: order.filter((c) => openIds.has(c.id)), issues }
}
