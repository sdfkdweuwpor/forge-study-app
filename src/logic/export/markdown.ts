/** Tasks as Markdown checklists, grouped by do date or by goal. */
import { format } from 'date-fns'
import type { ISODate, Task } from '@/db/types'
import { toPlainText } from '@/logic/blocks'
import { fromISODate } from '@/logic/dates'
import { makeNames, selectTasks, taskDay, type ExportLookups, type TaskSelection } from './select'

export type MarkdownGrouping = 'date' | 'goal'

export interface MarkdownOptions extends TaskSelection {
  /** Default `date`. */
  groupBy?: MarkdownGrouping
  /** Shown as the `#` title when set. */
  title?: string
}

const dayLabel = (d: ISODate): string => format(fromISODate(d), 'EEE MMM d')
const dayHeading = (d: ISODate): string => format(fromISODate(d), 'EEEE, MMM d, yyyy')

/** Markdown-special characters in a title are left alone (it is the user's own text); newlines are not. */
const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()

function meta(t: Task, tagNames: boolean, code: string, groupedByDate: boolean): string {
  const parts: string[] = []
  const due =
    t.dueDate === null
      ? ''
      : `due ${dayLabel(t.dueDate)}${t.dueTime === null ? '' : ` ${t.dueTime}`}`
  if (due !== '') parts.push(due)
  if (t.doTime !== null && t.doDate !== null) parts.push(`at ${t.doTime}`)
  if (!groupedByDate && t.doDate !== null) parts.push(`do ${dayLabel(t.doDate)}`)
  if (tagNames) for (const tag of t.tags) parts.push(`#${tag.replace(/\s+/g, '-')}`)
  if (code !== '') parts.push(code)
  if (t.durationMinutes !== null) parts.push(`${t.durationMinutes} min`)
  else if (t.estimateMinutes !== null) parts.push(`${t.estimateMinutes} min`)
  if (t.status === 'done' && t.completedDay !== null) parts.push(`done ${dayLabel(t.completedDay)}`)
  return parts.length === 0 ? '' : ` — ${parts.join(' · ')}`
}

function line(t: Task, code: string, groupedByDate: boolean): string[] {
  const box = t.status === 'done' ? 'x' : ' '
  const out = [`- [${box}] ${oneLine(t.title)}${meta(t, true, code, groupedByDate)}`]
  const notes = toPlainText(t.notes).trim()
  if (notes !== '') for (const l of notes.split('\n')) out.push(l === '' ? '' : `  ${l}`)
  for (const s of t.subtasks) out.push(`  - [${s.done ? 'x' : ' '}] ${oneLine(s.title)}`)
  return out
}

export function tasksToMarkdown(
  tasks: readonly Task[],
  ctx: ExportLookups & MarkdownOptions,
): string {
  const names = makeNames(ctx)
  const picked = selectTasks(tasks, ctx)
  const byDate = (ctx.groupBy ?? 'date') === 'date'
  const groups = new Map<string, Task[]>()
  const add = (key: string, t: Task): void => {
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  for (const t of picked) {
    if (byDate) add(taskDay(t) ?? '', t)
    else add(names.goalTitle(t.goalId), t)
  }
  // Dates arrive sorted with "" (no date) last; goals sort by name with "No goal" last.
  const keys = [...groups.keys()]
  if (byDate) keys.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0))
  else keys.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  const out: string[] = [`# ${ctx.title ?? 'Forge tasks'}`, '']
  if (picked.length === 0) {
    out.push('_No tasks match._', '')
    return out.join('\n')
  }
  for (const key of keys) {
    const heading = byDate
      ? key === ''
        ? 'No date'
        : dayHeading(key)
      : key === ''
        ? 'No goal'
        : key
    out.push(`## ${heading}`, '')
    for (const t of groups.get(key) ?? [])
      out.push(...line(t, names.courseCode(t.milestoneId), byDate))
    out.push('')
  }
  return out.join('\n')
}
