/**
 * The text behind "Copy error details" on the crash screens (pure). It says what went wrong and where,
 * without anything the person wrote: no task titles, notes or settings, only the error, the app version, the
 * page path and the browser. It is short enough to paste into a message.
 */
import type { Millis } from '@/db/types'

export interface ReportedProblem {
  at: Millis
  message: string
  /** A component stack or the name of the place that logged it. */
  detail?: string
}

export interface ErrorReportInput {
  error: { name?: string; message: string; stack?: string }
  /** Where it happened, in a few words ("the app", "a page", "start-up"). */
  where: string
  appVersion: string
  userAgent: string
  /** The page path, with the query. */
  url: string
  at: Millis
  /** Problems logged earlier in this session, oldest first. */
  recent?: readonly ReportedProblem[]
}

const STACK_LINES = 12
const RECENT_LINES = 5
const MAX_LINE = 300
const MAX_TOTAL = 4000

const clip = (text: string, max = MAX_LINE): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** A multi-line string cut to `lines` lines, each clipped, with a marker when lines were dropped. */
function head(text: string, lines: number): string[] {
  const all = text.split('\n').map((l) => clip(l.trimEnd()))
  return all.length <= lines
    ? all
    : [...all.slice(0, lines), `… (${all.length - lines} more lines)`]
}

export function buildErrorReport(i: ErrorReportInput): string {
  const name = i.error.name && i.error.name !== 'Error' ? `${i.error.name}: ` : ''
  const lines: string[] = [
    'Forge error report',
    `When: ${new Date(i.at).toISOString()}`,
    `Where: ${i.where}`,
    `Page: ${clip(i.url)}`,
    `Version: ${i.appVersion}`,
    `Browser: ${clip(i.userAgent)}`,
    '',
    `${name}${clip(i.error.message || 'Unknown error')}`,
  ]
  if (i.error.stack) {
    // The first line of a stack repeats the message in most browsers.
    const stack = i.error.stack.split('\n')
    const body = stack[0]?.includes(i.error.message) ? stack.slice(1) : stack
    lines.push(...head(body.join('\n'), STACK_LINES))
  }
  const recent = (i.recent ?? []).slice(-RECENT_LINES)
  if (recent.length > 0) {
    lines.push('', 'Earlier in this session:')
    for (const r of recent) {
      const detail = r.detail ? ` (${clip(r.detail.split('\n')[0]?.trim() ?? '', 80)})` : ''
      lines.push(`- ${new Date(r.at).toISOString()} ${clip(r.message, 160)}${detail}`)
    }
  }
  const text = lines.join('\n')
  return text.length <= MAX_TOTAL ? text : `${text.slice(0, MAX_TOTAL - 1)}…`
}
