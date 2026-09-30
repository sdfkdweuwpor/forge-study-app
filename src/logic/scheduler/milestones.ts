/**
 * Weekly milestones (pure): one marker per week that has study work, dated on that week's last study
 * day, saying which units the week finishes ("Week of Oct 5 — finish C182 Units 3–4"). A week that
 * finishes nothing says what it continues. Assessments that week are appended.
 */
import type { ISODate } from '@/db/types'
import { dayNumber, isoOfDay, weekdayOfDay } from './capacity'
import type { PlanItem, PlannerCourse } from './plannerTypes'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `'2026-10-05'` → `'Oct 5'` (fixed English month names, so titles do not depend on the locale). */
export function shortDate(d: ISODate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''} ${Number(d.slice(8, 10))}`
}

/** The first day of the week containing `day` (day numbers). */
export function weekStartOf(day: number, weekStartsOn: 0 | 1): number {
  return day - ((weekdayOfDay(day) - weekStartsOn + 7) % 7)
}

/** `[1, 2, 3, 5]` → `'1–3, 5'`. */
export function rangeLabel(ns: readonly number[]): string {
  const sorted = [...new Set(ns)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    const first = sorted[i] as number
    let last = first
    while (sorted[i + 1] === last + 1) last = sorted[++i] as number
    parts.push(first === last ? String(first) : `${first}–${last}`)
    i++
  }
  return parts.join(', ')
}

interface CourseInfo {
  label: string
  order: number
  /** unit id → 1-based position in the course; a course without units has its own id here. */
  unitNo: Map<string, number>
  synthetic: boolean
}

function courseInfo(courses: readonly PlannerCourse[]): Map<string, CourseInfo> {
  const out = new Map<string, CourseInfo>()
  courses.forEach((c, i) => {
    const units = [...c.units].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    const unitNo = new Map(units.map((u, k) => [u.id, k + 1]))
    const synthetic = units.length === 0 || (units.length === 1 && units[0]?.id === c.id)
    out.set(c.id, { label: c.code && c.code.trim() !== '' ? c.code : c.title, order: i, unitNo, synthetic })
  })
  return out
}

function describe(unitIds: ReadonlySet<string>, info: ReadonlyMap<string, CourseInfo>, courseOf: ReadonlyMap<string, string>): string {
  const byCourse = new Map<string, number[]>()
  for (const u of unitIds) {
    const c = courseOf.get(u)
    if (c === undefined) continue
    const list = byCourse.get(c) ?? []
    const n = info.get(c)?.unitNo.get(u)
    if (n !== undefined) list.push(n)
    byCourse.set(c, list)
  }
  return [...byCourse.entries()]
    .sort((a, b) => (info.get(a[0])?.order ?? 0) - (info.get(b[0])?.order ?? 0))
    .map(([c, ns]) => {
      const ci = info.get(c)
      if (!ci) return ''
      if (ci.synthetic || ns.length === 0) return ci.label
      return `${ci.label} ${ns.length > 1 ? 'Units' : 'Unit'} ${rangeLabel(ns)}`
    })
    .filter((s) => s !== '')
    .join(', ')
}

/**
 * Milestone markers, one per week with work or an assessment: what the week finishes (or continues),
 * else "review" / "review and practice test", then that week's assessments.
 */
export function weeklyMilestones(
  items: readonly PlanItem[],
  courses: readonly PlannerCourse[],
  weekStartsOn: 0 | 1,
): PlanItem[] {
  const info = courseInfo(courses)
  const courseOf = new Map<string, string>()
  const lastOfUnit = new Map<string, number>()
  interface Week {
    last: number
    units: Set<string>
    reviews: boolean
    practice: boolean
    assessments: string[]
  }
  const weeks = new Map<number, Week>()
  const week = (day: number): Week => {
    const ws = weekStartOf(day, weekStartsOn)
    let w = weeks.get(ws)
    if (!w) {
      w = { last: day, units: new Set(), reviews: false, practice: false, assessments: [] }
      weeks.set(ws, w)
    }
    w.last = Math.max(w.last, day)
    return w
  }
  const sorted = [...items].sort((a, b) => (a.doDate < b.doDate ? -1 : a.doDate > b.doDate ? 1 : 0))
  for (const it of sorted) {
    if (it.kind === 'milestone') continue
    const day = dayNumber(it.doDate)
    const w = week(day)
    if (it.kind === 'study' && it.unitId !== null && it.courseId !== null) {
      courseOf.set(it.unitId, it.courseId)
      lastOfUnit.set(it.unitId, day)
      w.units.add(it.unitId)
    } else if (it.kind === 'review') w.reviews = true
    else if (it.kind === 'practiceTest') w.practice = true
    else if (it.kind === 'assessment') w.assessments.push(it.title.replace(' · ', ' '))
  }
  const out: PlanItem[] = []
  for (const [ws, w] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
    const finished = new Set(
      [...w.units].filter((u) => {
        const last = lastOfUnit.get(u)
        return last !== undefined && weekStartOf(last, weekStartsOn) === ws
      }),
    )
    const parts: string[] = []
    if (finished.size > 0) parts.push(`finish ${describe(finished, info, courseOf)}`)
    else if (w.units.size > 0) parts.push(`continue ${describe(w.units, info, courseOf)}`)
    else if (w.practice) parts.push(w.reviews ? 'review and practice test' : 'practice test')
    else if (w.reviews) parts.push('review')
    parts.push(...w.assessments)
    const start = isoOfDay(ws)
    const target = isoOfDay(w.last)
    out.push({
      key: `milestone:${start}`,
      kind: 'milestone',
      title: `Week of ${shortDate(start)} — ${parts.join('; ')}`,
      courseId: null,
      unitId: null,
      assessmentId: null,
      doDate: target,
      startTime: null,
      durationMinutes: 0,
      dueDate: target,
      seq: null,
      seqTotal: null,
    })
  }
  return out
}
