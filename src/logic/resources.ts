/**
 * The resource library of a course (BRIEF §5.11), pure: what counts as a link Forge will open, the title a
 * link or PDF gets when none is typed, what a PDF must be to be stored, the "is there room?" check, and the
 * list rules (status filter, counts, manual order). The database side is `db/repos/resources.ts`.
 *
 * Links are the one place where a stored string becomes something a click can run, so `parseWebUrl` (what may
 * be added) and `safeHref` (what may be drawn as a link, even from an imported backup) accept http and https
 * and nothing else.
 */
import type { Resource } from '@/db/types'
import { evenOrders, ORDER_STEP } from './order'
import { formatBytes } from './retention'

// ─── Links ──────────────────────────────────────────────────────────────────

export type UrlProblem = 'empty' | 'blocked' | 'invalid'

export type UrlResult = { ok: true; url: string } | { ok: false; problem: UrlProblem }

/** Calm, one-line messages for `UrlProblem`. */
export const URL_MESSAGES: Record<UrlProblem, string> = {
  empty: 'Paste a link to add it.',
  blocked: 'Only web links can be added: they start with http:// or https://.',
  invalid: 'That doesn’t look like a web address. Try something like https://example.com.',
}

/** A scheme at the start: `https:`, `javascript:`, `mailto:`. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i
/** `localhost:3000/docs`: a host and port, which look like a scheme but are not one. */
const HOST_PORT = /^[^\s/?#:@]+:\d+(?:[/?#]|$)/
/** Whitespace and control characters anywhere: no URL has them, and `java\tscript:` is a known way round a check. */
// eslint-disable-next-line no-control-regex
const SPACE_OR_CONTROL = /[\u0000- \u007f-\u009f]/

/**
 * Turns what a person typed or pasted into a web URL, or says why not. `https://` is added when there is
 * no scheme (`developer.mozilla.org/docs` works); any other scheme (`javascript:`, `data:`, `file:`,
 * `ftp:`, `mailto:`, `blob:`) is `blocked`, whatever its case or spacing. The result is `URL.href`.
 */
export function parseWebUrl(input: string): UrlResult {
  const text = input.trim()
  if (text === '') return { ok: false, problem: 'empty' }
  if (SPACE_OR_CONTROL.test(text)) return { ok: false, problem: 'invalid' }

  const scheme = SCHEME.exec(text)
  const hasScheme = scheme !== null && !HOST_PORT.test(text)
  if (hasScheme) {
    const name = (scheme[1] ?? '').toLowerCase()
    if (name !== 'http' && name !== 'https') return { ok: false, problem: 'blocked' }
  }

  let url: URL
  try {
    url = new URL(hasScheme ? text : `https://${text.replace(/^\/\//, '')}`)
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, problem: 'blocked' }
  const host = url.hostname
  if (host === '') return { ok: false, problem: 'invalid' }
  // "hello" is not a link. With a scheme typed, an intranet name like http://wiki/ is the person's call.
  if (!hasScheme && !host.includes('.') && host !== 'localhost' && !host.startsWith('[')) {
    return { ok: false, problem: 'invalid' }
  }
  return { ok: true, url: url.href }
}

/**
 * The address to put in an `href`, or `null` when a stored value must not be a link. Rows come from the
 * database, which a restored backup or an old version may have filled with anything, so a resource is only
 * drawn as a link when this says so.
 */
export function safeHref(stored: string | null | undefined): string | null {
  if (!stored) return null
  try {
    const url = new URL(stored)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Longest derived title. */
export const TITLE_MAX = 60

function truncate(text: string, max = TITLE_MAX): string {
  const chars = Array.from(text)
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The host without `www.` (and with its port when it has one): what the row shows under a link's title. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/**
 * The title a link gets when none is typed: the host and the path, no scheme, query or trailing slash.
 * `https://www.wgu.edu/online-it-degrees/` is `wgu.edu/online-it-degrees`.
 */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = decode(parsed.pathname).replace(/\/+$/, '')
    return truncate(`${hostLabel(url)}${path}`)
  } catch {
    return truncate(url.trim())
  }
}

// ─── Notes ──────────────────────────────────────────────────────────────────

/** The first line of a note, for when its title is left empty. */
export function titleFromNote(body: string): string {
  const first = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '')
  return first === undefined ? 'Untitled note' : truncate(first)
}

/**
 * A short one-line look at a note's body for its row: the first line, cut to `max`. A line equal to
 * `exclude` (the title, when it was made from the body) is skipped, so the row does not say it twice.
 */
export function notePreview(body: string, max = 140, exclude?: string): string {
  const first = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && line !== exclude?.trim())
  return first === undefined ? '' : truncate(first, max)
}

// ─── PDFs ───────────────────────────────────────────────────────────────────

/** The most a single PDF may weigh. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024

export type PdfProblem = 'type' | 'empty' | 'tooBig'

export interface FileFacts {
  name: string
  type: string
  size: number
}

/** Some systems label a PDF with no type at all, or as a plain stream; the name then decides. */
const UNSURE_TYPES = new Set(['', 'application/octet-stream', 'application/x-pdf'])

/** True for a file that says it is a PDF (by its type, or by `.pdf` when the system gave none). */
export function looksLikePdf(file: Pick<FileFacts, 'name' | 'type'>): boolean {
  const type = file.type.toLowerCase()
  if (type === 'application/pdf') return true
  return UNSURE_TYPES.has(type) && /\.pdf$/i.test(file.name.trim())
}

/** What is wrong with a file that is offered as a PDF, or `null` when it can be stored. */
export function pdfProblem(file: FileFacts): PdfProblem | null {
  if (!looksLikePdf(file)) return 'type'
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_PDF_BYTES) return 'tooBig'
  return null
}

/** The friendly sentence for `pdfProblem`, naming the file. */
export function pdfProblemMessage(
  problem: PdfProblem,
  file: Pick<FileFacts, 'name' | 'size'>,
): string {
  const name = `“${file.name}”`
  switch (problem) {
    case 'type':
      return `${name} isn’t a PDF. Only PDF files can be added here.`
    case 'empty':
      return `${name} is empty, so there is nothing to save.`
    case 'tooBig':
      return `${name} is ${formatBytes(file.size)}. PDFs up to ${formatBytes(MAX_PDF_BYTES)} can be added. A smaller copy, or a link to it, works too.`
  }
}

/** Splits offered files into those that can be stored and a sentence for each that cannot. */
export function partitionPdfs<T extends FileFacts>(
  files: readonly T[],
): { accepted: T[]; problems: string[] } {
  const accepted: T[] = []
  const problems: string[] = []
  for (const file of files) {
    const problem = pdfProblem(file)
    if (problem === null) accepted.push(file)
    else problems.push(pdfProblemMessage(problem, file))
  }
  return { accepted, problems }
}

/**
 * A real PDF starts with `%PDF-` (the spec allows a little junk before it; readers look in the first
 * kilobyte). Checked on the bytes, because a file's name and type are only what the sender claims.
 */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024)
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]
  for (let i = 0; i + magic.length <= head.length; i++) {
    if (magic.every((byte, j) => head[i + j] === byte)) return true
  }
  return false
}

/** "C182 Study Guide" from `C182_Study_Guide.pdf`. */
export function titleFromFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
  return base === '' ? 'Untitled PDF' : truncate(base, 100)
}

// ─── Room to save ───────────────────────────────────────────────────────────

/** What `navigator.storage.estimate()` returns. Either number can be missing. */
export interface StorageEstimateLike {
  usage?: number
  quota?: number
}

/** Free space to keep after a save; below this the person is told first. */
export const STORAGE_HEADROOM_BYTES = 50 * 1024 * 1024

/** Bytes the browser will still give this site, or `null` when it does not say. */
export function freeStorageBytes(estimate: StorageEstimateLike | null | undefined): number | null {
  const usage = estimate?.usage
  const quota = estimate?.quota
  if (typeof usage !== 'number' || typeof quota !== 'number') return null
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null
  return Math.max(0, quota - usage)
}

/** Whether saving `needBytes` would leave less than `STORAGE_HEADROOM_BYTES` free. Unknown space is not low. */
export function storageIsLow(
  estimate: StorageEstimateLike | null | undefined,
  needBytes: number,
): boolean {
  const free = freeStorageBytes(estimate)
  return free !== null && free < needBytes + STORAGE_HEADROOM_BYTES
}

/** The sentence shown before saving when space is low. */
export function lowStorageMessage(
  estimate: StorageEstimateLike | null | undefined,
  needBytes: number,
  count = 1,
): string {
  const free = freeStorageBytes(estimate)
  const what = count === 1 ? 'this PDF is' : `these ${count} PDFs are`
  const room =
    free === null
      ? 'Your browser is short on space for Forge'
      : `Your browser has about ${formatBytes(free)} left for Forge`
  return `${room}, and ${what} ${formatBytes(needBytes)}. It may not fit.`
}

// ─── The list ───────────────────────────────────────────────────────────────

export type ResourceKind = Resource['kind']
export type ResourceFilter = 'all' | 'toRead' | 'done'

export const KIND_LABELS: Record<ResourceKind, string> = { link: 'Link', pdf: 'PDF', note: 'Note' }

export const FILTER_LABELS: Record<ResourceFilter, string> = {
  all: 'All',
  toRead: 'To read',
  done: 'Done',
}

export interface StatusCounts {
  all: number
  toRead: number
  done: number
}

export function countByStatus(rows: readonly Pick<Resource, 'status'>[]): StatusCounts {
  let done = 0
  for (const r of rows) if (r.status === 'done') done++
  return { all: rows.length, toRead: rows.length - done, done }
}

/** The tab a course opens on: To read while anything waits, else All. */
export function defaultFilter(counts: StatusCounts): ResourceFilter {
  return counts.toRead > 0 ? 'toRead' : 'all'
}

export function filterResources<T extends Pick<Resource, 'status'>>(
  rows: readonly T[],
  filter: ResourceFilter,
): T[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.status === filter)
}

/** Manual order, then oldest first, then id, so the order never depends on how the rows were read. */
export function sortResources<T extends Pick<Resource, 'id' | 'order' | 'createdAt'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** The order for a resource added after `rows`: one step past the last. */
export function nextOrder(rows: readonly Pick<Resource, 'order'>[]): number {
  if (rows.length === 0) return 0
  return Math.max(...rows.map((r) => r.order)) + ORDER_STEP
}

/**
 * Puts the listed rows in the given order without disturbing the others. The listed rows swap the
 * positions they already hold, so a reorder made while a filter hides some rows leaves those where they
 * were. Ids that are not rows, and repeats, are ignored. Only rows whose number changes are returned;
 * when two held positions are equal the listed rows are renumbered 0, 1024, 2048 ….
 */
export function resourceReorderPlan(
  rows: readonly Pick<Resource, 'id' | 'order'>[],
  orderedIds: readonly string[],
): { id: string; order: number }[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ids = orderedIds.filter((id, i) => byId.has(id) && orderedIds.indexOf(id) === i)
  const slots = ids.map((id) => byId.get(id)?.order ?? 0).sort((a, b) => a - b)
  const crowded = slots.some((slot, i) => i > 0 && slot === slots[i - 1])
  const targets = crowded ? evenOrders(ids.length) : slots
  const changes: { id: string; order: number }[] = []
  ids.forEach((id, i) => {
    const order = targets[i] ?? 0
    if (byId.get(id)?.order !== order) changes.push({ id, order })
  })
  return changes
}
