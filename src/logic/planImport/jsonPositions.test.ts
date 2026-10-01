import { describe, expect, it } from 'vitest'
import { LineTable, scanJson } from './jsonPositions'

const scan = (text: string) => scanJson(text, new LineTable(text))

describe('LineTable', () => {
  it('maps offsets to 1-based lines and columns', () => {
    const t = new LineTable('ab\ncd\n\nef')
    expect(t.at(0)).toEqual({ offset: 0, line: 1, column: 1 })
    expect(t.at(4)).toEqual({ offset: 4, line: 2, column: 2 })
    expect(t.at(6)).toMatchObject({ line: 3, column: 1 })
    expect(t.at(8)).toMatchObject({ line: 4, column: 2 })
    expect(t.lineCount).toBe(4)
    expect(t.lineRange(2)).toEqual({ start: 3, end: 5 })
    expect(t.lineRange(4)).toEqual({ start: 7, end: 9 })
  })
})

describe('scanJson positions', () => {
  const text = `{
  "goal": { "name": "X" },
  "courses": [
    { "code": "C182" },
    {
      "code": "C779",
      "estimatedHours": 30
    }
  ]
}`
  it('records the line of every value and property name, through nested arrays', () => {
    const r = scan(text)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.index.valueAt([]).line).toBe(1)
    expect(r.index.valueAt(['goal', 'name']).line).toBe(2)
    expect(r.index.valueAt(['courses', 0]).line).toBe(4)
    expect(r.index.valueAt(['courses', 1]).line).toBe(5)
    expect(r.index.valueAt(['courses', 1, 'estimatedHours'])).toMatchObject({ line: 7, column: 25 })
    expect(r.index.keyAt(['courses', 1, 'estimatedHours'])).toMatchObject({ line: 7, column: 7 })
    expect(r.index.has(['courses', 1, 'code'])).toBe(true)
    expect(r.index.has(['courses', 2])).toBe(false)
  })

  it('falls back to the nearest existing ancestor for a missing field', () => {
    const r = scan(text)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.index.valueAt(['courses', 0, 'estimatedHours']).line).toBe(4)
    expect(r.index.valueAt(['nope', 'deeper']).line).toBe(1)
  })

  it('scans only the given span but reports positions in the whole text', () => {
    const prose = 'Here you go:\n```json\n{ "a": 1 }\n```\n'
    const start = prose.indexOf('{')
    const r = scanJson(prose, new LineTable(prose), start, start + 10)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.index.valueAt(['a'])).toMatchObject({ line: 3, column: 8 })
  })

  it('handles escapes, unicode and numbers', () => {
    const r = scan('{"a\\u0062": "q\\"x", "n": -1.5e3, "t": true, "z": null, "e": [], "o": {}}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index.has(['ab'])).toBe(true)
  })
})

describe('scanJson syntax errors', () => {
  const err = (text: string) => {
    const r = scan(text)
    if (r.ok) throw new Error('expected a syntax error')
    return r
  }

  it('reports a missing comma on the line of the previous value', () => {
    const r = err('{\n  "a": 1\n  "b": 2\n}')
    expect(r.error.message).toMatch(/comma/i)
    expect(r.pos.line).toBe(2)
    expect(r.pos.column).toBe(9)
  })

  it('reports a trailing comma at the comma', () => {
    const r = err('{\n  "a": [1, 2,],\n  "b": 2\n}')
    expect(r.error.message).toMatch(/Trailing comma/)
    expect(r.pos).toMatchObject({ line: 2, column: 13 })
  })

  it('reports a truncated reply at its last line', () => {
    const r = err('{\n  "a": [\n    1,\n    2')
    expect(r.error.message).toMatch(/ends too soon/)
    expect(r.pos.line).toBe(4)
  })

  it('explains single quotes, curly quotes, comments and bare words', () => {
    expect(err("{ 'a': 1 }").error.message).toMatch(/double quotes/)
    expect(err('{ "a": “x” }').error.message).toMatch(/straight double quotes/)
    expect(err('{\n // note\n "a": 1 }').error.message).toMatch(/Comments/)
    expect(err('{ "a": undefined }').error.message).toMatch(/"undefined" is not valid JSON/)
  })

  it('rejects bad numbers, unterminated strings and bad escapes', () => {
    expect(err('{ "a": 01 }').error.message).toMatch(/not a valid JSON number/)
    expect(err('{ "a": 1. }').error.message).toMatch(/not a valid JSON number/)
    const open = err('{\n "a": "oops,\n "b": 1 }')
    expect(open.error.message).toMatch(/closing quote/)
    expect(open.pos.line).toBe(2)
    expect(err('{ "a": "\\q" }').error.message).toMatch(/Invalid escape/)
  })

  it('needs a colon and a quoted property name', () => {
    expect(err('{ "a" 1 }').error.message).toMatch(/":"/)
    expect(err('{ a: 1 }').error.message).toMatch(/property name/)
  })

  it('stops absurdly deep nesting instead of overflowing the stack', () => {
    expect(err(`{"a":${'['.repeat(200)}`).error.message).toMatch(/nested too deeply/)
  })
})
