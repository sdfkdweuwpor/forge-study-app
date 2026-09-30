/**
 * Turns whatever the user pasted (Claude's whole reply, fences and chatter included) into a validated
 * plan, or into a list of problems that each carry the line and column in the *pasted text*:
 *
 *   extract the `{ … }` → scan it for syntax errors and positions → JSON.parse → drop null/blank
 *   members → Zod → cross-course checks → map every issue path to a line via `jsonPositions`.
 *
 * Messages read like "courses[2].estimatedHours must be a positive number", built from the schema's
 * own documentation (`reference.ts`), so they never disagree with the schema reference.
 */
import type { z } from 'zod'
import { LineTable, scanJson, type JsonIndex, type PathKey, type Pos } from './jsonPositions'
import { fieldDoc, fieldDocs, generalPath } from './reference'
import { checkRelations, type KnownCourse } from './relations'
import { planSchema, type Plan } from './schema'
import { closestMatch } from './suggest'

export interface PlanIssue {
  /** 1-based, in the pasted text. */
  line: number
  column: number
  /** `courses[2].estimatedHours`; empty for problems with the JSON itself. */
  path: string
  /** Full sentence fragment, starting with the path where there is one. */
  message: string
}

export interface ParseOptions {
  /** Courses already in the goal being merged into: prerequisites may refer to them. */
  known?: readonly KnownCourse[]
}

export type ParseResult =
  { ok: true; plan: Plan; warnings: PlanIssue[] } | { ok: false; errors: PlanIssue[] }

// ── Extraction ──────────────────────────────────────────────────────────────────────────────────

/**
 * The span of the JSON object inside `text`: from the first `{` that opens an object (`{ "…`), to its
 * matching `}`. Code fences and prose around it are simply outside the span. An unbalanced object (a
 * reply cut off mid-way) runs to the end, minus a trailing fence, so the syntax error lands on real text.
 */
export function extractJson(text: string): { start: number; end: number } | null {
  const opening = /\{\s*"/.exec(text)
  const start = opening ? opening.index : text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      // A raw line break ends a string that lost its closing quote, so one typo cannot swallow the rest.
      else if (c === '"' || c === '\n') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return { start, end: i + 1 }
  }
  const fence = text.lastIndexOf('```')
  const end = fence > start && text.slice(fence + 3).trim() === '' ? fence : text.length
  return { start, end }
}

// ── Cleaning ────────────────────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `null` and blank strings count as "left out" (models often write `"cus": null`). */
function dropEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropEmpty)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null && !(typeof v === 'string' && v.trim() === ''))
      .map(([k, v]) => [k, dropEmpty(v)]),
  )
}

function valueAt(root: unknown, path: readonly PathKey[]): unknown {
  let cur = root
  for (const key of path) {
    if (Array.isArray(cur) && typeof key === 'number') cur = cur[key]
    else if (isRecord(cur) && typeof key === 'string') cur = cur[key]
    else return undefined
  }
  return cur
}

// ── Wording ─────────────────────────────────────────────────────────────────────────────────────

/** `["courses", 2, "estimatedHours"]` → `courses[2].estimatedHours`. */
export function pathText(path: readonly PathKey[]): string {
  return path.reduce<string>(
    (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc === '' ? key : `${acc}.${key}`),
    '',
  )
}

/** Names of the fields an object at this generalised path may have (for "did you mean …?"). */
function knownKeys(general: string): string[] {
  return fieldDocs()
    .filter((d) => {
      const cut = d.path.lastIndexOf('.')
      return (cut < 0 ? '' : d.path.slice(0, cut)) === general
    })
    .map((d) => d.path.slice(d.path.lastIndexOf('.') + 1))
}

interface Located {
  path: PathKey[]
  /** Report at the property name (unknown keys) instead of the value. */
  atKey: boolean
  text: string
}

function describeIssue(issue: z.core.$ZodIssue, cleaned: unknown): Located[] {
  const path = issue.path.filter((k): k is PathKey => typeof k !== 'symbol')
  const at = pathText(path)

  if (issue.code === 'unrecognized_keys') {
    const options = knownKeys(generalPath(path))
    return issue.keys.map((key) => {
      const near = closestMatch(key, options)
      return {
        path: [...path, key],
        atKey: true,
        text: `${pathText([...path, key])} is not a known field${near ? `; did you mean "${near}"?` : ''}`,
      }
    })
  }
  if (issue.code === 'custom') return [{ path, atKey: false, text: `${at} ${issue.message}`.trim() }]
  if (path.length === 0) {
    return [
      {
        path,
        atKey: false,
        text: 'The plan must be a JSON object with "forgePlan", "goal" and "courses"',
      },
    ]
  }

  const doc = fieldDoc(generalPath(path))
  const text =
    valueAt(cleaned, path) === undefined
      ? `${at} ${doc?.missing ?? 'is required'}`
      : `${at} must be ${doc?.expects ?? 'valid'}`
  return [{ path, atKey: false, text }]
}

const hoursText = (hours: number): string => `${Math.round(hours * 10) / 10} h`

/** Units that all carry estimates replace the course's own hours in the scheduler (DECISIONS). */
function unitWarnings(plan: Plan): { path: PathKey[]; text: string }[] {
  const out: { path: PathKey[]; text: string }[] = []
  plan.courses.forEach((course, i) => {
    const units = course.units
    if (!units || units.length === 0) return
    let minutes = 0
    for (const u of units) {
      const m = u.estimatedMinutes ?? (u.estimatedHours === undefined ? undefined : u.estimatedHours * 60)
      if (m === undefined) return
      minutes += m
    }
    const hours = minutes / 60
    if (Math.abs(hours - course.estimatedHours) / course.estimatedHours > 0.1) {
      out.push({
        path: ['courses', i, 'estimatedHours'],
        text:
          `courses[${i}] (${course.code}): its units add up to ${hoursText(hours)} but estimatedHours is ` +
          `${hoursText(course.estimatedHours)}. Forge plans from the units' total.`,
      })
    }
  })
  return out
}

// ── Entry point ─────────────────────────────────────────────────────────────────────────────────

const byPosition = (a: PlanIssue, b: PlanIssue): number =>
  a.line - b.line || a.column - b.column || a.message.localeCompare(b.message)

function locate(index: JsonIndex, item: Located | { path: PathKey[]; text: string }): PlanIssue {
  const atKey = 'atKey' in item && item.atKey
  const pos: Pos = (atKey ? index.keyAt(item.path) : undefined) ?? index.valueAt(item.path)
  return {
    line: pos.line,
    column: pos.column,
    path: pathText(item.path),
    message: item.text,
  }
}

const fail = (errors: PlanIssue[]): ParseResult => ({ ok: false, errors: errors.sort(byPosition) })

export function parsePlan(text: string, options: ParseOptions = {}): ParseResult {
  const span = extractJson(text)
  if (!span) {
    return fail([
      {
        line: 1,
        column: 1,
        path: '',
        message: 'No JSON found. Paste Claude’s reply; the plan starts with “{”.',
      },
    ])
  }

  const lines = new LineTable(text)
  const scan = scanJson(text, lines, span.start, span.end)
  if (!scan.ok) {
    return fail([{ line: scan.pos.line, column: scan.pos.column, path: '', message: scan.error.message }])
  }

  let raw: unknown
  try {
    raw = JSON.parse(text.slice(span.start, span.end))
  } catch (e) {
    // The scanner accepted it, so this is a disagreement between the two; still report it in place.
    const pos = lines.at(span.start)
    return fail([
      {
        line: pos.line,
        column: pos.column,
        path: '',
        message: e instanceof Error ? e.message : 'This is not valid JSON',
      },
    ])
  }

  const cleaned = dropEmpty(raw)
  const parsed = planSchema.safeParse(cleaned)
  if (!parsed.success) {
    return fail(
      parsed.error.issues.flatMap((issue) => describeIssue(issue, cleaned)).map((i) => locate(scan.index, i)),
    )
  }

  const relations = checkRelations(parsed.data, options.known)
  if (relations.length > 0) {
    return fail(
      relations.map((r) =>
        locate(scan.index, { path: r.path, text: `${pathText(r.path)} ${r.message}` }),
      ),
    )
  }

  const warnings = unitWarnings(parsed.data)
    .map((w) => locate(scan.index, w))
    .sort(byPosition)
  return { ok: true, plan: parsed.data, warnings }
}
