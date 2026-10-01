/**
 * A tiny JSON scanner that knows *where* things are. `JSON.parse` gives values but no positions, and
 * its error text differs between browsers, so this reads the text itself:
 * - on valid JSON it records the line and column of every value and every property name, keyed by
 *   path (`["courses", 2, "estimatedHours"]`), so a Zod issue can be shown on its line of the paste;
 * - on invalid JSON it stops at the first syntax error with a plain-English message and the offset.
 *
 * Positions are offsets into the *original* text (`scanJson` takes a start and end so the caller can
 * scan only the object it extracted from Claude's reply). Lines and columns are 1-based.
 */

export type PathKey = string | number

export interface Pos {
  offset: number
  line: number
  column: number
}

/** Offset → line and column, by binary search over the line starts. */
export class LineTable {
  private readonly starts: number[] = [0]

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1)
  }

  get lineCount(): number {
    return this.starts.length
  }

  at(offset: number): Pos {
    const target = Math.max(0, Math.min(offset, this.text.length))
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((this.starts[mid] ?? 0) <= target) lo = mid
      else hi = mid - 1
    }
    return { offset: target, line: lo + 1, column: target - (this.starts[lo] ?? 0) + 1 }
  }

  /** Offsets of a line's first character and of its end (before the line break). `line` is 1-based. */
  lineRange(line: number): { start: number; end: number } {
    const i = Math.max(0, Math.min(line - 1, this.starts.length - 1))
    const start = this.starts[i] ?? 0
    const next = this.starts[i + 1]
    return { start, end: next === undefined ? this.text.length : next - 1 }
  }
}

export interface JsonSyntaxError {
  message: string
  offset: number
}

export interface JsonIndex {
  /** Where the value at `path` starts; a path that does not exist falls back to its nearest ancestor. */
  valueAt(path: readonly PathKey[]): Pos
  /** Where the property name of the member at `path` starts, when it exists. */
  keyAt(path: readonly PathKey[]): Pos | undefined
  /** Whether the value at `path` exists in the text. */
  has(path: readonly PathKey[]): boolean
}

export type ScanResult =
  { ok: true; index: JsonIndex } | { ok: false; error: JsonSyntaxError; pos: Pos }

interface Node {
  value: number
  key: number | undefined
}

class Fail extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message)
  }
}

const MAX_DEPTH = 64
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r'

/**
 * Scans `text[start, end)` as one JSON value. Never throws.
 * `lines` maps offsets to positions in the whole text (build it once and share it).
 */
export function scanJson(
  text: string,
  lines: LineTable,
  start = 0,
  end = text.length,
): ScanResult {
  const nodes = new Map<string, Node>()
  const path: PathKey[] = []
  let i = start
  /** Where the previous value ended: a missing comma is reported there, not at the next token. */
  let lastValueEnd = start

  const lastContent = (): number => {
    let at = end - 1
    while (at > start && isSpace(text[at])) at--
    return at
  }
  const ended = (): never => {
    throw new Fail('The JSON ends too soon: a value, "}" or "]" is missing', lastContent())
  }

  const skip = (): void => {
    for (;;) {
      const c = text[i]
      if (i >= end || c === undefined) return
      if (isSpace(c)) i++
      else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
        throw new Fail('Comments are not allowed in JSON; delete this line', i)
      } else return
    }
  }

  const string = (): string => {
    const opened = i
    i++
    let out = ''
    for (;;) {
      if (i >= end) throw new Fail('This string is missing its closing quote', opened)
      const c = text[i] ?? ''
      if (c === '"') {
        i++
        return out
      }
      if (c === '\n' || c === '\r') {
        throw new Fail('This string is missing its closing quote', opened)
      }
      if (c === '\\') {
        const e = text[i + 1] ?? ''
        const plain = ESCAPES[e]
        if (plain !== undefined) {
          out += plain
          i += 2
        } else if (e === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Fail('Invalid \\u escape in string', i)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else throw new Fail(`Invalid escape "\\${e}" in string`, i)
      } else if (c < ' ') {
        throw new Fail('Control characters must be escaped inside a string', i)
      } else {
        out += c
        i++
      }
    }
  }

  const number = (): void => {
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    const after = m ? text[i + m[0].length] : undefined
    if (!m || m.index !== i || (after !== undefined && /[\w.+-]/.test(after))) {
      const token = /^[\w.+-]+/.exec(text.slice(i, end))?.[0] ?? text.charAt(i)
      throw new Fail(`"${token}" is not a valid JSON number`, i)
    }
    i += m[0].length
  }

  const word = (): void => {
    const token = /^[A-Za-z_]+/.exec(text.slice(i, end))?.[0] ?? ''
    if (token === 'true' || token === 'false' || token === 'null') {
      i += token.length
      return
    }
    throw new Fail(
      token
        ? `"${token}" is not valid JSON; use true, false, null, a number or a "string"`
        : `Unexpected "${text.charAt(i)}"`,
      i,
    )
  }

  /** A comma, or the closing bracket; anything else means a comma is missing. */
  const separator = (close: '}' | ']'): boolean => {
    skip()
    const c = text[i]
    if (i >= end || c === undefined) return ended()
    if (c === ',') {
      const comma = i
      i++
      skip()
      if (text[i] === close) throw new Fail(`Trailing comma: remove it before "${close}"`, comma)
      return true
    }
    if (c === close) {
      i++
      return false
    }
    throw new Fail(`A comma or "${close}" is missing after this value`, lastValueEnd)
  }

  const object = (): void => {
    i++
    skip()
    if (text[i] === '}') {
      i++
      return
    }
    do {
      skip()
      if (i >= end) ended()
      if (text[i] !== '"') {
        const c = text.charAt(i)
        throw new Fail(
          c === "'"
            ? 'Property names need double quotes, not single quotes'
            : 'Expected a property name in double quotes',
          i,
        )
      }
      const keyAt = i
      const name = string()
      skip()
      if (text[i] !== ':') throw new Fail('Expected ":" after the property name', i)
      i++
      path.push(name)
      value(keyAt)
      path.pop()
    } while (separator('}'))
  }

  const array = (): void => {
    i++
    skip()
    if (text[i] === ']') {
      i++
      return
    }
    let n = 0
    do {
      path.push(n++)
      value(undefined)
      path.pop()
    } while (separator(']'))
  }

  const value = (keyAt: number | undefined): void => {
    skip()
    if (i >= end) ended()
    if (path.length > MAX_DEPTH) throw new Fail('These brackets are nested too deeply', i)
    nodes.set(JSON.stringify(path), { value: i, key: keyAt })
    const c = text.charAt(i)
    if (c === '{') object()
    else if (c === '[') array()
    else if (c === '"') string()
    else if (c === '-' || (c >= '0' && c <= '9')) number()
    else if (c === "'") throw new Fail('Strings need double quotes, not single quotes', i)
    else if ('“”‘’'.includes(c)) {
      throw new Fail(`Curly quote ${c}: JSON needs straight double quotes (")`, i)
    } else word()
    lastValueEnd = i
  }

  try {
    value(undefined)
    skip()
    if (i < end) throw new Fail('Unexpected text after the end of the JSON object', i)
  } catch (e) {
    if (e instanceof Fail) {
      return { ok: false, error: { message: e.message, offset: e.offset }, pos: lines.at(e.offset) }
    }
    throw e
  }

  const nearest = (p: readonly PathKey[]): Node | undefined => {
    for (let n = p.length; n >= 0; n--) {
      const node = nodes.get(JSON.stringify(p.slice(0, n)))
      if (node) return node
    }
    return undefined
  }
  return {
    ok: true,
    index: {
      valueAt: (p) => lines.at((nearest(p) ?? { value: start }).value),
      keyAt: (p) => {
        const key = nodes.get(JSON.stringify(p))?.key
        return key === undefined ? undefined : lines.at(key)
      },
      has: (p) => nodes.has(JSON.stringify(p)),
    },
  }
}
