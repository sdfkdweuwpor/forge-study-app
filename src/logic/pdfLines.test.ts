import { describe, expect, it } from 'vitest'
import { itemsToLines, pagesToText, type PdfTextItem } from './pdfLines'

const item = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, x, y, width })

describe('itemsToLines', () => {
  it('joins runs on one baseline and orders lines top to bottom', () => {
    const lines = itemsToLines([
      item('D278', 72, 700),
      item('Scripting and Programming', 110, 700.4),
      item('C182', 72, 720),
      item('Introduction to IT', 110, 720),
    ])
    expect(lines).toEqual(['C182 Introduction to IT', 'D278 Scripting and Programming'])
  })

  it('does not add a space inside a word split into runs', () => {
    expect(itemsToLines([item('Intro', 72, 700, 25), item('duction', 97, 700, 35)])).toEqual(['Introduction'])
  })

  it('sorts a line left to right and drops empty runs', () => {
    expect(itemsToLines([item('IT', 200, 500), item('  ', 100, 500), item('Intro to', 72, 500)])).toEqual([
      'Intro to IT',
    ])
  })
})

describe('pagesToText', () => {
  it('separates pages with a blank line', () => {
    expect(pagesToText([[item('Page one', 0, 10)], [], [item('Page two', 0, 10)]])).toBe('Page one\n\nPage two')
  })
})
