/** Tasks as CSV (RFC 4180): CRLF rows, fields quoted only when they must be, `"` doubled. */
import type { Task } from '@/db/types'
import { toPlainText } from '@/logic/blocks'
import { makeNames, selectTasks, type ExportLookups, type TaskSelection } from './select'

export const CSV_COLUMNS = [
  'title',
  'status',
  'priority',
  'do date',
  'do time',
  'duration min',
  'due date',
  'due time',
  'estimate pomodoros',
  'tags',
  'goal',
  'course code',
  'kind',
  'recurrence',
  'completed at',
  'notes',
] as const

export interface CsvOptions extends TaskSelection {
  /** Prefix a UTF-8 byte order mark so Excel reads accents and quotes correctly. Default false. */
  bom?: boolean
}

const BOM = String.fromCharCode(0xfeff)
const PRIORITY = ['none', 'low', 'medium', 'high', 'urgent'] as const
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A spreadsheet reads a cell starting with one of these as a formula (or as a command, in old Excel). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One field, quoted when it holds a comma, quote, CR or LF, or edge whitespace. A field that starts with
 * `=`, `+`, `-`, `@`, a tab or a CR gets a leading `'`, so opening the file in Excel or Sheets shows the
 * text instead of running it (CSV formula injection: a task titled `=HYPERLINK(...)` must stay a title).
 */
export function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',')
}

export function describeRecurrence(rule: Task['recurrence']): string {
  if (rule === null) return ''
  if (rule.freq === 'daily') return rule.interval > 1 ? `every ${rule.interval} days` : 'daily'
  if (rule.freq === 'weekdays') return 'weekdays'
  const days = rule.byWeekday.map((d) => WEEKDAYS[d] ?? '').filter(Boolean)
  const on = days.length > 0 ? ` on ${days.join(' ')}` : ''
  const base = rule.freq === 'weekly' ? 'weekly' : 'custom'
  return `${rule.interval > 1 ? `every ${rule.interval} weeks` : base}${on}`
}

/** Local `YYYY-MM-DD HH:mm`, in the machine's time zone. */
export function formatStamp(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function tasksToCsv(tasks: readonly Task[], ctx: ExportLookups & CsvOptions): string {
  const names = makeNames(ctx)
  const rows = selectTasks(tasks, ctx).map((t) =>
    csvRow([
      t.title,
      t.status,
      PRIORITY[t.priority] ?? String(t.priority),
      t.doDate ?? '',
      t.doDate === null ? '' : (t.doTime ?? ''),
      t.durationMinutes === null ? '' : String(t.durationMinutes),
      t.dueDate ?? '',
      t.dueDate === null ? '' : (t.dueTime ?? ''),
      t.estimatePomodoros === null ? '' : String(t.estimatePomodoros),
      t.tags.join('; '),
      names.goalTitle(t.goalId),
      names.courseCode(t.milestoneId),
      t.kind,
      describeRecurrence(t.recurrence),
      formatStamp(t.completedAt),
      toPlainText(t.notes),
    ]),
  )
  const text = [csvRow(CSV_COLUMNS), ...rows].join('\r\n') + '\r\n'
  return ctx.bom === true ? BOM + text : text
}
