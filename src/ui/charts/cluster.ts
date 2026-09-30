import { isWithin20 } from '@/logic/stats'

export interface ScatterPoint {
  id: string
  /** The task's name. */
  label: string
  /** Estimate, in pomodoros. */
  planned: number
  /** What it took, in pomodoros. */
  actual: number
}

/** Tasks with the same numbers share one dot. */
export interface Cluster {
  planned: number
  actual: number
  /** Within ±20 % of the estimate. */
  within: boolean
  points: readonly ScatterPoint[]
}

/** Groups points by their numbers, in planned-then-actual order (the keyboard order). */
export function clusterPoints(points: readonly ScatterPoint[]): Cluster[] {
  const groups = new Map<string, ScatterPoint[]>()
  for (const p of points) {
    const key = `${p.planned}/${p.actual}`
    const group = groups.get(key)
    if (group) group.push(p)
    else groups.set(key, [p])
  }
  const out: Cluster[] = []
  for (const group of groups.values()) {
    const first = group[0]
    if (first) {
      out.push({
        planned: first.planned,
        actual: first.actual,
        within: isWithin20(first.planned, first.actual),
        points: group,
      })
    }
  }
  return out.sort((a, b) => a.planned - b.planned || a.actual - b.actual)
}
