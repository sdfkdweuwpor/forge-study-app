/**
 * What goes in the calendar file: study blocks, optional everyday tasks and deadlines, and the
 * dates of courses, goals and planned assessments. Pure; `toIcs` writes the result.
 *
 * UIDs are stable per source row (`<taskId>@forge`, `due-<taskId>@forge`, ...), so importing a newer
 * file into the same calendar updates events instead of duplicating them. Renamed or rescheduled rows
 * keep their UID; deleted ones simply are not in the new file (most clients keep the old copy).
 */
import type { Goal, ID, ISODate, Milestone, PlannedAssessment, Task } from '@/db/types'
import { addDays } from '@/logic/dates'
import type { IcsEvent } from './ics'

export interface CalendarSource {
  tasks: readonly Task[]
  goals: readonly Goal[]
  milestones: readonly Milestone[]
  plannedAssessments: readonly PlannedAssessment[]
}

export interface CalendarOptions {
  today: ISODate
  /** Only these goals (their blocks, courses and assessments). Empty or omitted = all. */
  goalIds?: readonly ID[]
  /**
   * Also export goals that are paused, done or archived. Default false: a calendar should show the plans
   * being worked on, not last term's finished blocks.
   */
  includeInactiveGoals?: boolean
  /** Timed tasks of kind `task` (a dentist visit at 15:00). Default false. */
  includeEveryday?: boolean
  /** All-day "Due: ..." events for everyday tasks with a deadline. Default false. */
  includeDeadlines?: boolean
  /** Course targets, goal target dates and planned assessments. Default true. */
  includeMilestones?: boolean
  /** Only the next N weeks from `today`. `null` or omitted = everything from `today` on. */
  weeks?: number | null
  /** Length used when a timed task has neither a duration nor an estimate. Default 30. */
  defaultMinutes?: number
}

const STUDY_KINDS = new Set<string>(['study', 'review', 'practiceTest'])
const ASSESSMENT_LABEL = { exam: 'Exam', project: 'Project', quiz: 'Quiz' } as const

export function calendarEvents(src: CalendarSource, opts: CalendarOptions): IcsEvent[] {
  const only = opts.goalIds !== undefined && opts.goalIds.length > 0 ? new Set(opts.goalIds) : null
  const active = new Set(src.goals.filter((g) => g.status === 'active').map((g) => g.id))
  const statusOk = (id: ID): boolean => opts.includeInactiveGoals === true || active.has(id)
  /** A goal's rows: the goal is one of those asked for, and (by default) is active. */
  const goalOk = (id: ID | null): boolean =>
    id === null ? only === null : (only === null || only.has(id)) && statusOk(id)
  /** An everyday task belongs to no goal (always in), or to one that passes `goalOk`. */
  const everydayOk = (id: ID | null): boolean => id === null || goalOk(id)
  const from = opts.today
  const to = opts.weeks == null ? null : addDays(opts.today, opts.weeks * 7 - 1)
  const inRange = (d: ISODate): boolean => d >= from && (to === null || d <= to)
  const fallback = opts.defaultMinutes ?? 30
  const codes = new Map(src.milestones.map((m) => [m.id, m.code ?? '']))
  const out: IcsEvent[] = []

  for (const t of src.tasks) {
    if (t.status === 'done') continue
    if (t.kind === 'task') {
      if (
        opts.includeEveryday === true &&
        t.doDate !== null &&
        t.doTime !== null &&
        inRange(t.doDate)
      ) {
        if (everydayOk(t.goalId)) {
          out.push({
            uid: `${t.id}@forge`,
            summary: t.title,
            date: t.doDate,
            start: t.doTime,
            durationMinutes: t.durationMinutes ?? t.estimateMinutes ?? fallback,
          })
        }
      }
      if (
        opts.includeDeadlines === true &&
        t.dueDate !== null &&
        inRange(t.dueDate) &&
        everydayOk(t.goalId)
      ) {
        out.push({
          uid: `due-${t.id}@forge`,
          summary: `Due: ${t.title}`,
          allDay: true,
          date: t.dueDate,
        })
      }
    } else if (STUDY_KINDS.has(t.kind)) {
      if (t.doDate === null || t.doTime === null || !inRange(t.doDate) || !goalOk(t.goalId))
        continue
      const code = codes.get(t.milestoneId ?? '') ?? ''
      out.push({
        uid: `${t.id}@forge`,
        summary: code !== '' && !t.title.startsWith(code) ? `${code} · ${t.title}` : t.title,
        date: t.doDate,
        start: t.doTime,
        durationMinutes: t.durationMinutes ?? t.estimateMinutes ?? fallback,
      })
    }
    // Tasks of kind assessment/milestone are covered by plannedAssessments and milestones below.
  }

  if (opts.includeMilestones !== false) {
    for (const g of src.goals) {
      if (!goalOk(g.id) || g.targetDate === null) continue
      if (inRange(g.targetDate)) {
        out.push({
          uid: `goal-${g.id}@forge`,
          summary: `Goal target: ${g.title}`,
          allDay: true,
          date: g.targetDate,
        })
      }
    }
    for (const m of src.milestones) {
      if (!goalOk(m.goalId) || m.dueDate === null || m.status === 'done' || !inRange(m.dueDate))
        continue
      const label = m.code !== null && m.code !== '' ? `${m.code} · ${m.title}` : m.title
      out.push({
        uid: `milestone-${m.id}@forge`,
        summary: `Target: ${label}`,
        allDay: true,
        date: m.dueDate,
      })
    }
    for (const a of src.plannedAssessments) {
      if (a.status !== 'planned' || a.date === null || !goalOk(a.goalId) || !inRange(a.date))
        continue
      const code = codes.get(a.milestoneId ?? '') ?? ''
      const summary = `${ASSESSMENT_LABEL[a.kind]}: ${code !== '' && !a.title.startsWith(code) ? `${code} ` : ''}${a.title}`
      const uid = `assessment-${a.id}@forge`
      if (a.time !== null) {
        out.push({
          uid,
          summary,
          date: a.date,
          start: a.time,
          durationMinutes: a.durationMinutes ?? 60,
        })
      } else {
        out.push({ uid, summary, allDay: true, date: a.date })
      }
    }
  }

  return out.sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      cmp(a.allDay === true ? '' : a.start, b.allDay === true ? '' : b.start) ||
      cmp(a.uid, b.uid),
  )
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
