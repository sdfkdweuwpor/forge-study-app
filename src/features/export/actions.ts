import { dayOf } from '@/logic/dates'
import {
  calendarEvents,
  exportFilename,
  tasksToCsv,
  tasksToMarkdown,
  toIcs,
  type MarkdownGrouping,
  type TaskScope,
} from '@/logic/export'
import { copyText } from '@/lib/clipboard'
import { downloadText } from '@/lib/download'
import { loadExportData } from './queries'

export interface TaskExportOptions {
  scope: TaskScope
  groupBy: MarkdownGrouping
}
export interface CalendarExportOptions {
  /** Empty = every goal. */
  goalIds: string[]
  includeEveryday: boolean
  includeDeadlines: boolean
  /** `null` = everything from today on. */
  weeks: number | null
}

export const DEFAULT_TASK_EXPORT: TaskExportOptions = { scope: 'all', groupBy: 'date' }
export const DEFAULT_CALENDAR_EXPORT: CalendarExportOptions = {
  goalIds: [],
  includeEveryday: false,
  includeDeadlines: false,
  weeks: null,
}

/** Result of an export, worded for a toast or a status line. */
export interface ExportOutcome {
  ok: boolean
  message: string
}

const CSV_MIME = 'text/csv;charset=utf-8'
const MD_MIME = 'text/markdown;charset=utf-8'
const ICS_MIME = 'text/calendar;charset=utf-8'

async function guard(run: () => Promise<ExportOutcome>): Promise<ExportOutcome> {
  try {
    return await run()
  } catch {
    return { ok: false, message: 'Couldn’t read your data for export. Try again.' }
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function exportTasksCsv(
  opts: TaskExportOptions = DEFAULT_TASK_EXPORT,
): Promise<ExportOutcome> {
  return guard(async () => {
    const now = Date.now()
    const data = await loadExportData()
    const csv = tasksToCsv(data.tasks, { ...data, scope: opts.scope, bom: true })
    const filename = exportFilename('tasks', dayOf(now), 'csv')
    downloadText(filename, csv, CSV_MIME)
    return { ok: true, message: `Saved ${filename}` }
  })
}

async function markdownFor(opts: TaskExportOptions): Promise<{ text: string; now: number }> {
  const now = Date.now()
  const data = await loadExportData()
  return {
    text: tasksToMarkdown(data.tasks, { ...data, scope: opts.scope, groupBy: opts.groupBy }),
    now,
  }
}

export function exportTasksMarkdown(
  opts: TaskExportOptions = DEFAULT_TASK_EXPORT,
): Promise<ExportOutcome> {
  return guard(async () => {
    const { text, now } = await markdownFor(opts)
    const filename = exportFilename('tasks', dayOf(now), 'md')
    downloadText(filename, text, MD_MIME)
    return { ok: true, message: `Saved ${filename}` }
  })
}

export function copyTasksMarkdown(
  opts: TaskExportOptions = DEFAULT_TASK_EXPORT,
): Promise<ExportOutcome> {
  return guard(async () => {
    const { text } = await markdownFor(opts)
    const ok = await copyText(text)
    return ok
      ? { ok: true, message: 'Copied tasks as Markdown' }
      : { ok: false, message: 'Couldn’t reach the clipboard. Download the file instead.' }
  })
}

async function icsFor(
  opts: CalendarExportOptions,
): Promise<{ text: string; now: number; count: number }> {
  const now = Date.now()
  const data = await loadExportData()
  const events = calendarEvents(data, { ...opts, today: dayOf(now) })
  return { text: toIcs(events, { calName: 'Forge study plan', now }), now, count: events.length }
}

export function downloadCalendar(
  opts: CalendarExportOptions = DEFAULT_CALENDAR_EXPORT,
): Promise<ExportOutcome> {
  return guard(async () => {
    const { text, now, count } = await icsFor(opts)
    const filename = exportFilename('calendar', dayOf(now), 'ics')
    downloadText(filename, text, ICS_MIME)
    return { ok: true, message: `Saved ${filename} (${plural(count, 'event')})` }
  })
}

export function copyCalendar(
  opts: CalendarExportOptions = DEFAULT_CALENDAR_EXPORT,
): Promise<ExportOutcome> {
  return guard(async () => {
    const { text, count } = await icsFor(opts)
    const ok = await copyText(text)
    return ok
      ? { ok: true, message: `Copied calendar data (${plural(count, 'event')})` }
      : { ok: false, message: 'Couldn’t reach the clipboard. Download the file instead.' }
  })
}
