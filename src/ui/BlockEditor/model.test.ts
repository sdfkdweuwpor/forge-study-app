import { describe, expect, it } from 'vitest'
import type { Block } from '@/logic/blocks'
import { RECENT, edited, initialModel, reconcile } from './model'

const doc = (text: string): Block[] => [{ id: 'a', type: 'p', text }]

describe('reconcile', () => {
  it('the same value changes nothing', () => {
    const value = doc('one')
    const model = initialModel(value)
    expect(reconcile(model, value)).toBe(model)
  })

  it('equal content with a new identity keeps the document and remembers the value', () => {
    const model = initialModel(doc('one'))
    const next = reconcile(model, doc('one'))
    expect(next.doc).toBe(model.doc)
    expect(next.epoch).toBe(0)
    const again = doc('one')
    expect(reconcile(next, again).seen).toBe(again)
  })

  it('an edit handed back is not news, even when the parent copies it', () => {
    let model = initialModel(doc(''))
    const typed = doc('C182')
    model = edited(model, typed)
    const next = reconcile(model, [...typed])
    expect(next.doc).toBe(typed)
    expect(next.epoch).toBe(0)
  })

  it('a late echo of an older state does not undo what was typed since', () => {
    let model = initialModel(doc(''))
    const first = doc('C')
    const second = doc('C18')
    const third = doc('C182')
    model = edited(edited(edited(model, first), second), third)
    // A debounced save finishes and the parent passes back the state from two edits ago.
    const next = reconcile(model, doc('C'))
    expect(next.doc).toBe(third)
    expect(next.epoch).toBe(0)
  })

  it('a different document from outside replaces the text and clears history', () => {
    let model = initialModel(doc('C182 notes'))
    model = edited(model, doc('C182 notes, edited'))
    const other = doc('D278 notes')
    const next = reconcile(model, other)
    expect(next.doc).toBe(other)
    expect(next.epoch).toBe(1)
    expect(next.recent).toEqual([])
  })

  it('after an outside change the old states no longer count as echoes', () => {
    let model = initialModel(doc(''))
    model = edited(model, doc('typed'))
    model = reconcile(model, doc('replaced'))
    const back = reconcile(model, doc('typed'))
    expect(back.doc).toEqual(doc('typed'))
    expect(back.epoch).toBe(2)
  })

  it('clearing the document from outside is an outside change too', () => {
    const model = initialModel(doc('something'))
    const next = reconcile(model, [])
    expect(next.doc).toEqual([])
    expect(next.epoch).toBe(1)
  })
})

describe('edited', () => {
  it('shows the edit and marks it as the last value seen', () => {
    const model = initialModel(doc('a'))
    const next = edited(model, doc('ab'))
    expect(next.doc).toEqual(doc('ab'))
    expect(next.seen).toBe(next.doc)
    expect(next.recent).toHaveLength(1)
  })

  it('remembers a bounded number of states', () => {
    let model = initialModel(doc(''))
    for (let i = 0; i < RECENT + 25; i++) model = edited(model, doc(String(i)))
    expect(model.recent).toHaveLength(RECENT)
  })
})
