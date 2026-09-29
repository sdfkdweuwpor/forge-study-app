import { describe, expect, it } from 'vitest'
import { lineCenterY, lineEdges, lineEdgesFromText, type CaretGeometry } from './geometry'

/** A 24px-line block whose content box starts at y = 100 and is `lines` lines tall. */
function block(lines: number, line: number): CaretGeometry {
  const top = 100
  const bottom = top + lines * 24
  const caretTop = top + (line - 1) * 24 + 3
  return {
    caretTop,
    caretBottom: caretTop + 18,
    contentTop: top,
    contentBottom: bottom,
    lineHeight: 24,
  }
}

describe('lineEdges', () => {
  it('a one-line block is both first and last', () => {
    expect(lineEdges(block(1, 1))).toEqual({ first: true, last: true })
  })

  it('tells the lines of a wrapped block apart', () => {
    expect(lineEdges(block(3, 1))).toEqual({ first: true, last: false })
    expect(lineEdges(block(3, 2))).toEqual({ first: false, last: false })
    expect(lineEdges(block(3, 3))).toEqual({ first: false, last: true })
  })

  it('works for tall headings with one big line', () => {
    const heading: CaretGeometry = {
      caretTop: 106,
      caretBottom: 140,
      contentTop: 100,
      contentBottom: 146,
      lineHeight: 46,
    }
    expect(lineEdges(heading)).toEqual({ first: true, last: true })
  })

  it('falls back to the caret height when the line height is unknown', () => {
    const g = { ...block(2, 2), lineHeight: 0 }
    expect(lineEdges(g)).toEqual({ first: false, last: true })
  })
})

describe('lineEdgesFromText', () => {
  it('reads hard newlines', () => {
    expect(lineEdgesFromText('one', 1)).toEqual({ first: true, last: true })
    expect(lineEdgesFromText('one\ntwo\nthree', 1)).toEqual({ first: true, last: false })
    expect(lineEdgesFromText('one\ntwo\nthree', 6)).toEqual({ first: false, last: false })
    expect(lineEdgesFromText('one\ntwo\nthree', 13)).toEqual({ first: false, last: true })
    expect(lineEdgesFromText('one\ntwo', 3)).toEqual({ first: true, last: false })
    expect(lineEdgesFromText('one\ntwo', 4)).toEqual({ first: false, last: true })
  })

  it('clamps the caret and handles empty text', () => {
    expect(lineEdgesFromText('', 0)).toEqual({ first: true, last: true })
    expect(lineEdgesFromText('a\nb', 99)).toEqual({ first: false, last: true })
    expect(lineEdgesFromText('a\nb', -4)).toEqual({ first: true, last: false })
  })
})

describe('lineCenterY', () => {
  const box = { top: 100, bottom: 172, lineHeight: 24 }
  it('is the middle of the first or last line', () => {
    expect(lineCenterY(box, 'first')).toBe(112)
    expect(lineCenterY(box, 'last')).toBe(160)
  })
})
