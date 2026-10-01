/**
 * Checks that span courses: unique codes, prerequisites that exist, and no prerequisite cycles.
 * Runs on a plan that already passed the schema. `known` lists courses a merge target already holds,
 * so a partial re-import may depend on them (and a cycle through them is caught).
 */
import type { Plan } from './schema'
import { closestMatch } from './suggest'

export type PathKey = string | number

export interface RelationIssue {
  path: PathKey[]
  /** Completes "<path> …". */
  message: string
}

export interface KnownCourse {
  code: string
  prerequisites: readonly string[]
}

const coursePath = (i: number, ...rest: PathKey[]): PathKey[] => ['courses', i, ...rest]

export function checkRelations(plan: Plan, known: readonly KnownCourse[] = []): RelationIssue[] {
  const issues: RelationIssue[] = []
  const firstIndex = new Map<string, number>()

  plan.courses.forEach((course, i) => {
    const first = firstIndex.get(course.code)
    if (first === undefined) firstIndex.set(course.code, i)
    else {
      issues.push({
        path: coursePath(i, 'code'),
        message: `is already used by courses[${first}]; course codes must be unique`,
      })
    }
  })

  const codes = new Set([...firstIndex.keys(), ...known.map((k) => k.code)])
  const where = known.length > 0 ? 'in this plan or the goal' : 'in this plan'

  plan.courses.forEach((course, i) => {
    course.prerequisites?.forEach((code, k) => {
      if (code === course.code) {
        issues.push({
          path: coursePath(i, 'prerequisites', k),
          message: 'lists its own course as a prerequisite',
        })
      } else if (!codes.has(code)) {
        const near = closestMatch(code, codes)
        issues.push({
          path: coursePath(i, 'prerequisites', k),
          message:
            `refers to "${code}", which is not a course ${where}` +
            (near ? `; did you mean "${near}"?` : ''),
        })
      }
    })
  })

  return [...issues, ...findCycles(plan, known, firstIndex)]
}

/** Depth-first search over "needs" edges; each distinct cycle is reported once, on a course of the plan. */
function findCycles(
  plan: Plan,
  known: readonly KnownCourse[],
  firstIndex: ReadonlyMap<string, number>,
): RelationIssue[] {
  const edges = new Map<string, string[]>()
  for (const course of plan.courses) {
    edges.set(course.code, [...(edges.get(course.code) ?? []), ...(course.prerequisites ?? [])])
  }
  for (const k of known) if (!edges.has(k.code)) edges.set(k.code, [...k.prerequisites])

  const issues: RelationIssue[] = []
  const reported = new Set<string>()
  const done = new Set<string>()
  const stack: string[] = []

  const report = (cycle: string[]): void => {
    const key = [...new Set(cycle)].sort().join('|')
    if (reported.has(key)) return
    reported.add(key)
    // Point at an edge of the cycle that lives in the plan (existing courses have no line to point at).
    for (let n = 0; n < cycle.length - 1; n++) {
      const from = cycle[n]
      const to = cycle[n + 1]
      const i = from === undefined ? undefined : firstIndex.get(from)
      if (from === undefined || to === undefined || i === undefined) continue
      const k = plan.courses[i]?.prerequisites?.indexOf(to) ?? -1
      if (k < 0) continue
      issues.push({
        path: coursePath(i, 'prerequisites', k),
        message: `closes a prerequisite cycle: ${cycle.join(' needs ')}`,
      })
      return
    }
  }

  const visit = (code: string): void => {
    stack.push(code)
    for (const next of edges.get(code) ?? []) {
      if (next === code || !edges.has(next) || done.has(next)) continue
      const back = stack.indexOf(next)
      if (back >= 0) report([...stack.slice(back), next])
      else visit(next)
    }
    stack.pop()
    done.add(code)
  }

  for (const code of edges.keys()) if (!done.has(code)) visit(code)
  return issues
}
