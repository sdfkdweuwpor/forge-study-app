/**
 * The BlockEditor document model (pure). A document is a `Block[]` (the type notes already use in
 * `db/types`): p / h1–h3 / bullet / todo / callout / divider. This file holds everything the editor
 * decides without touching the DOM: inline formatting, splitting and merging on Enter/Backspace,
 * the slash menu and plain-text extraction for search.
 *
 * Ids: `@/lib/ids` is off-limits here, so helpers that create a block take an optional `newId`
 * factory. Without one they derive a unique id from the neighbouring block (`<id>-1`, `<id>-2` …).
 */
import type { Block, BlockType, ID } from '@/db/types'
import { fuzzyScore } from './fuzzy'

export type { Block, BlockType } from '@/db/types'
export type BlockDoc = readonly Block[]

/** All block types the editor can render. */
export const BLOCK_TYPES: readonly BlockType[] = [
  'p',
  'h1',
  'h2',
  'h3',
  'bullet',
  'todo',
  'callout',
  'divider',
]

/** Result of an edit that moves the caret: the new document plus where to put the cursor. */
export interface BlockEdit {
  doc: Block[]
  /** Block that should receive focus. */
  focusId: ID
  /** Caret offset (UTF-16 units) inside that block's text. */
  caret: number
}

// ─── Inline formatting ──────────────────────────────────────────────────────

export interface InlineSpan {
  text: string
  bold: boolean
  italic: boolean
  code: boolean
  /** Only ever an http(s) or mailto URL; `null` for plain text. */
  href: string | null
}

interface InlineStyle {
  bold: boolean
  italic: boolean
  code: boolean
  href: string | null
}

const ESCAPABLE = '\\`*[]()'

function hasSpaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 32 || code === 127 || code === 160) return true
  }
  return false
}

/** True for absolute `http:`/`https:` URLs with a host, and `mailto:` addresses. Nothing else. */
export function isSafeUrl(url: string): boolean {
  const value = url.trim()
  if (value.length === 0 || hasSpaceOrControl(value)) return false
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return true
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
  } catch {
    return false
  }
}

interface LinkMatch {
  labelStart: number
  labelEnd: number
  href: string
  end: number
}

/** `[label](url)` starting at `i`; balanced parentheses are allowed inside the URL. */
function matchLink(src: string, i: number, to: number): LinkMatch | null {
  let j = i + 1
  while (j < to && src[j] !== ']') {
    if (src[j] === '\\') j++
    else if (src[j] === '[') return null
    j++
  }
  if (j >= to || src[j + 1] !== '(' || j === i + 1) return null
  let depth = 1
  let k = j + 2
  while (k < to && depth > 0) {
    const c = src[k]
    if (c === '\\') k++
    else if (c === '(') depth++
    else if (c === ')') depth--
    k++
  }
  if (depth !== 0) return null
  const href = src.slice(j + 2, k - 1).trim()
  if (!isSafeUrl(href)) return null
  return { labelStart: i + 1, labelEnd: j, href, end: k }
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c)

/**
 * Index of the closing emphasis marker for an opener whose content starts at `from`, or -1.
 * Skips escapes, code spans and links. A closer must follow a non-space character. For `**`, the
 * *last* two stars of a longer run close (so `***a***` is bold + italic); for `*`, a run of odd
 * length closes with its last star and even runs (bold markers) are skipped.
 */
function findClose(src: string, from: number, to: number, marker: '*' | '**'): number {
  for (let j = from; j < to; j++) {
    const c = src[j]
    if (c === '\\') {
      j++
    } else if (c === '`') {
      const end = src.indexOf('`', j + 1)
      if (end !== -1 && end < to) j = end
    } else if (c === '[') {
      const link = matchLink(src, j, to)
      if (link) j = link.end - 1
    } else if (c === '*') {
      let r = j
      while (r < to && src[r] === '*') r++
      const run = r - j
      const closes = j > from && !isSpace(src[j - 1])
      if (marker === '**' && run >= 2 && closes) return r - 2
      if (marker === '*' && run % 2 === 1 && closes) return r - 1
      j = r - 1
    }
  }
  return -1
}

function parseInto(
  src: string,
  from: number,
  to: number,
  style: InlineStyle,
  out: InlineSpan[],
): void {
  let buffer = ''
  const flush = (): void => {
    if (buffer !== '') out.push({ text: buffer, ...style })
    buffer = ''
  }
  let i = from
  while (i < to) {
    const c = src[i] as string
    if (c === '\\' && i + 1 < to && ESCAPABLE.includes(src[i + 1] as string)) {
      buffer += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      if (end !== -1 && end < to && end > i + 1) {
        flush()
        out.push({ text: src.slice(i + 1, end), ...style, code: true })
        i = end + 1
        continue
      }
    }
    if (c === '[' && style.href === null) {
      const link = matchLink(src, i, to)
      if (link) {
        flush()
        parseInto(src, link.labelStart, link.labelEnd, { ...style, href: link.href }, out)
        i = link.end
        continue
      }
    }
    if (c === '*') {
      if (src[i + 1] === '*') {
        const close = findClose(src, i + 2, to, '**')
        if (close > i + 2) {
          flush()
          parseInto(src, i + 2, close, { ...style, bold: true }, out)
          i = close + 2
          continue
        }
      } else if (!isSpace(src[i + 1])) {
        const close = findClose(src, i + 1, to, '*')
        if (close > i + 1) {
          flush()
          parseInto(src, i + 1, close, { ...style, italic: true }, out)
          i = close + 1
          continue
        }
      }
    }
    buffer += c
    i++
  }
  flush()
}

/**
 * Parses inline formatting into flat spans: `**bold**`, `*italic*`, `` `code` ``, `[label](url)`.
 * Bold and italic nest (`***both***`); code spans are literal; link labels may contain bold/italic.
 * Links only survive for http, https and mailto URLs (anything else, such as `javascript:`, is left
 * as literal text). A backslash escapes `\ ` * [ ] ( )`. Unmatched markers stay literal. Adjacent
 * spans with the same style are merged.
 */
export function parseInline(text: string): InlineSpan[] {
  const raw: InlineSpan[] = []
  parseInto(text, 0, text.length, { bold: false, italic: false, code: false, href: null }, raw)
  const merged: InlineSpan[] = []
  for (const span of raw) {
    if (span.text === '') continue
    const last = merged[merged.length - 1]
    if (
      last &&
      last.bold === span.bold &&
      last.italic === span.italic &&
      last.code === span.code &&
      last.href === span.href
    ) {
      last.text += span.text
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/** `text` with inline syntax removed (what a reader sees). */
export function stripInline(text: string): string {
  return parseInline(text)
    .map((span) => span.text)
    .join('')
}

// ─── Document helpers ───────────────────────────────────────────────────────

/** Plain text of the whole document for search: one line per block, dividers skipped, no markup. */
export function toPlainText(doc: BlockDoc): string {
  const lines: string[] = []
  for (const block of doc) {
    if (block.type === 'divider') continue
    lines.push(stripInline(block.text))
  }
  return lines.join('\n')
}

function freshId(doc: BlockDoc, base: ID, newId?: () => ID): ID {
  const taken = new Set(doc.map((b) => b.id))
  if (newId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId()
      if (!taken.has(id)) return id
    }
  }
  let n = 1
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** A block of `type` with the fields that type carries (`checked` for todo, none for divider text). */
function blockOf(id: ID, type: BlockType, text: string): Block {
  if (type === 'divider') return { id, type, text: '' }
  if (type === 'todo') return { id, type, text, checked: false }
  return { id, type, text }
}

/** Converts a block to another type in place, keeping its text (dropped for a divider). */
export function changeBlockType(doc: BlockDoc, id: ID, type: BlockType): Block[] {
  return doc.map((block) => {
    if (block.id !== id) return block
    const next = blockOf(block.id, type, block.text)
    if (type === 'todo' && block.type === 'todo') next.checked = block.checked ?? false
    if (type === 'callout' && block.emoji !== undefined) next.emoji = block.emoji
    return next
  })
}

const LIST_LIKE: ReadonlySet<BlockType> = new Set<BlockType>(['bullet', 'todo'])

/** What Enter at the end of a block of this type creates next. */
function continuationType(type: BlockType): BlockType {
  return LIST_LIKE.has(type) ? type : 'p'
}

/**
 * Enter at `offset` inside block `id`. The text before the caret stays; the text after moves to a new
 * block below (bullets and to-dos continue the list; everything else continues as a paragraph).
 *  - Enter on an empty bullet/to-do/callout turns it into a paragraph (leaves the list).
 *  - Enter at the very start of a non-empty block inserts an empty block above, caret stays put.
 *  - Enter on a divider adds a paragraph after it.
 * Formatting markers split across the caret are not repaired (`**a|b**` becomes two unmatched runs).
 */
export function splitBlock(doc: BlockDoc, id: ID, offset: number, newId?: () => ID): BlockEdit {
  const index = doc.findIndex((b) => b.id === id)
  const block = doc[index]
  if (!block) return { doc: [...doc], focusId: id, caret: 0 }
  const at = Math.min(Math.max(0, Math.floor(offset)), block.text.length)
  const insertAt = (position: number, ...blocks: Block[]): Block[] => [
    ...doc.slice(0, position),
    ...blocks,
    ...doc.slice(position),
  ]

  if (block.type === 'divider') {
    const created = blockOf(freshId(doc, id, newId), 'p', '')
    return { doc: insertAt(index + 1, created), focusId: created.id, caret: 0 }
  }

  const emptyExitable =
    block.text === '' &&
    (block.type === 'bullet' || block.type === 'todo' || block.type === 'callout')
  if (emptyExitable) {
    return { doc: changeBlockType(doc, id, 'p'), focusId: id, caret: 0 }
  }

  if (at === 0 && block.text !== '') {
    const created = blockOf(freshId(doc, id, newId), block.type, '')
    return { doc: insertAt(index, created), focusId: id, caret: 0 }
  }

  const created = blockOf(
    freshId(doc, id, newId),
    continuationType(block.type),
    block.text.slice(at),
  )
  const head: Block = { ...block, text: block.text.slice(0, at) }
  const next = [...doc.slice(0, index), head, created, ...doc.slice(index + 1)]
  return { doc: next, focusId: created.id, caret: 0 }
}

/**
 * Backspace at the very start of block `id`: joins its text onto the previous block (caret lands at
 * the join). A previous divider is deleted instead, and a divider itself is deleted with focus
 * moving up. Returns `null` for the first block (nothing to merge into).
 */
export function mergeWithPrevious(doc: BlockDoc, id: ID): BlockEdit | null {
  const index = doc.findIndex((b) => b.id === id)
  const block = doc[index]
  const prev = doc[index - 1]
  if (!block || !prev) return null

  if (block.type === 'divider') {
    return {
      doc: [...doc.slice(0, index), ...doc.slice(index + 1)],
      focusId: prev.id,
      caret: prev.type === 'divider' ? 0 : prev.text.length,
    }
  }
  if (prev.type === 'divider') {
    return {
      doc: [...doc.slice(0, index - 1), ...doc.slice(index)],
      focusId: block.id,
      caret: 0,
    }
  }
  const merged: Block = { ...prev, text: prev.text + block.text }
  return {
    doc: [...doc.slice(0, index - 1), merged, ...doc.slice(index + 1)],
    focusId: prev.id,
    caret: prev.text.length,
  }
}

// ─── Slash menu ─────────────────────────────────────────────────────────────

export type SlashCommandId = 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'todo' | 'callout' | 'divider'

export interface SlashCommand {
  id: SlashCommandId
  /** What the menu shows. */
  label: string
  description: string
  /** Typed after `/` to find it: `/todo`, `/heading`, `/h1`… */
  aliases: readonly string[]
  type: BlockType
}

/** Menu order. `/heading` finds the three heading levels; `/h1 /h2 /h3` pick one. */
export const slashCommands: readonly SlashCommand[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain paragraph',
    aliases: ['text', 'paragraph', 'p', 'plain'],
    type: 'p',
  },
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    aliases: ['h1', 'heading', 'title'],
    type: 'h1',
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    aliases: ['h2', 'heading', 'subheading'],
    type: 'h2',
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    aliases: ['h3', 'heading'],
    type: 'h3',
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    description: 'A simple list item',
    aliases: ['bullet', 'list', 'ul'],
    type: 'bullet',
  },
  {
    id: 'todo',
    label: 'To-do',
    description: 'A checkbox item',
    aliases: ['todo', 'task', 'checkbox', 'checklist'],
    type: 'todo',
  },
  {
    id: 'callout',
    label: 'Callout',
    description: 'Highlight a note',
    aliases: ['callout', 'note', 'info'],
    type: 'callout',
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'A horizontal rule',
    aliases: ['divider', 'hr', 'line', 'separator'],
    type: 'divider',
  },
]

/** The query typed after a leading `/` (no spaces yet), or `null` when the text is not a slash command. */
export function slashQuery(text: string): string | null {
  return /^\/\S*$/.test(text) ? text.slice(1) : null
}

/**
 * Slash commands matching what was typed after `/` (a leading `/` in `query` is ignored). An empty
 * query lists everything in menu order. Otherwise ranked by the best fuzzy match over the id,
 * aliases and label, exact and prefix matches first; ties keep menu order.
 */
export function filterSlash(query: string): SlashCommand[] {
  const q = query.replace(/^\//, '').trim().toLowerCase()
  if (q === '') return [...slashCommands]
  const ranked: Array<{ command: SlashCommand; score: number; order: number }> = []
  slashCommands.forEach((command, order) => {
    let best: number | null = null
    for (const term of [command.id, ...command.aliases, command.label]) {
      const found = fuzzyScore(q, term)
      if (!found) continue
      const lower = term.toLowerCase()
      const bonus = lower === q ? 1000 : lower.startsWith(q) ? 100 : 0
      const score = found.score + bonus
      if (best === null || score > best) best = score
    }
    if (best !== null) ranked.push({ command, score: best, order })
  })
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.map((r) => r.command)
}

/**
 * Runs a slash command on block `id`: the `/query` text is cleared and the block becomes the chosen
 * type. A divider also gets an empty paragraph after it so the caret has somewhere to go.
 */
export function applySlashCommand(
  doc: BlockDoc,
  id: ID,
  command: SlashCommandId,
  newId?: () => ID,
): BlockEdit {
  const spec = slashCommands.find((c) => c.id === command)
  const index = doc.findIndex((b) => b.id === id)
  const block = doc[index]
  if (!spec || !block) return { doc: [...doc], focusId: id, caret: 0 }

  const converted = blockOf(id, spec.type, '')
  if (spec.type === 'callout' && block.emoji !== undefined) converted.emoji = block.emoji
  const next = [...doc.slice(0, index), converted, ...doc.slice(index + 1)]
  if (spec.type !== 'divider') return { doc: next, focusId: id, caret: 0 }

  const after = doc[index + 1]
  if (after && after.type === 'p' && after.text === '') {
    return { doc: next, focusId: after.id, caret: 0 }
  }
  const created = blockOf(freshId(doc, id, newId), 'p', '')
  next.splice(index + 1, 0, created)
  return { doc: next, focusId: created.id, caret: 0 }
}
