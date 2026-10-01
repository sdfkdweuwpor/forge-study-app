import { describe, expect, it } from 'vitest'
import type { Block } from '@/logic/blocks'
import {
  GROUP_MS,
  MAX_STEPS,
  caretAfterRestore,
  commonPrefix,
  emptyHistory,
  record,
  redo,
  undo,
  type Snapshot,
} from './history'

const snap = (text: string, focusId: string | null = 'a', caret = text.length): Snapshot => ({
  doc: [{ id: 'a', type: 'p', text }],
  focusId,
  caret,
})

describe('record', () => {
  it('pushes the state before each edit and clears redo', () => {
    let h = record(emptyHistory, snap('one'), null, 0)
    h = record(h, snap('two'), null, 10)
    expect(h.past.map((s) => s.doc[0]?.text)).toEqual(['one', 'two'])
    const stepped = undo(h, snap('three'))
    if (!stepped) throw new Error('expected a step')
    expect(record(stepped.history, snap('x'), null, 20).future).toEqual([])
  })

  it('groups edits with the same key inside the time window', () => {
    let h = record(emptyHistory, snap(''), 'ins:a', 0)
    h = record(h, snap('a'), 'ins:a', 200)
    h = record(h, snap('ab'), 'ins:a', 900)
    expect(h.past).toHaveLength(1)
    expect(h.past[0]?.doc[0]?.text).toBe('')
  })

  it('starts a new group after a pause, a different key or a keyless edit', () => {
    let h = record(emptyHistory, snap(''), 'ins:a', 0)
    h = record(h, snap('a'), 'ins:a', 200 + GROUP_MS)
    expect(h.past).toHaveLength(2)
    h = record(h, snap('ab'), 'del:a', 300 + GROUP_MS)
    expect(h.past).toHaveLength(3)
    h = record(h, snap('abc'), null, 400 + GROUP_MS)
    h = record(h, snap('abcd'), null, 410 + GROUP_MS)
    expect(h.past).toHaveLength(5)
  })

  it('keeps at most MAX_STEPS snapshots', () => {
    let h = emptyHistory
    for (let i = 0; i < MAX_STEPS + 20; i++) h = record(h, snap(String(i)), null, i)
    expect(h.past).toHaveLength(MAX_STEPS)
    expect(h.past[0]?.doc[0]?.text).toBe('20')
  })
})

describe('undo / redo', () => {
  it('walks back and forth', () => {
    let h = record(emptyHistory, snap('one'), null, 0)
    h = record(h, snap('two'), null, 10)
    const first = undo(h, snap('three'))
    expect(first?.snapshot.doc[0]?.text).toBe('two')
    if (!first) throw new Error('expected a step')
    const second = undo(first.history, snap('two'))
    expect(second?.snapshot.doc[0]?.text).toBe('one')
    if (!second) throw new Error('expected a step')
    expect(undo(second.history, snap('one'))).toBeNull()

    const again = redo(second.history, snap('one'))
    expect(again?.snapshot.doc[0]?.text).toBe('two')
    if (!again) throw new Error('expected a step')
    const last = redo(again.history, snap('two'))
    expect(last?.snapshot.doc[0]?.text).toBe('three')
    if (!last) throw new Error('expected a step')
    expect(redo(last.history, snap('three'))).toBeNull()
  })

  it('nothing to undo or redo on an empty history', () => {
    expect(undo(emptyHistory, snap('x'))).toBeNull()
    expect(redo(emptyHistory, snap('x'))).toBeNull()
  })

  it('an undo ends the current typing group', () => {
    let h = record(emptyHistory, snap(''), 'ins:a', 0)
    const step = undo(h, snap('a'))
    if (!step) throw new Error('expected a step')
    h = record(step.history, snap(''), 'ins:a', 100)
    expect(h.past).toHaveLength(1)
  })
})

describe('commonPrefix / caretAfterRestore', () => {
  it('measures the shared start of two strings', () => {
    expect(commonPrefix('hello', 'help')).toBe(3)
    expect(commonPrefix('', 'x')).toBe(0)
    expect(commonPrefix('same', 'same')).toBe(4)
  })

  it('puts the caret where the text changed', () => {
    const restored: Snapshot = {
      doc: [{ id: 'a', type: 'p', text: 'Read chapter' }],
      focusId: 'a',
      caret: 0,
    }
    const current: Block[] = [{ id: 'a', type: 'p', text: 'Read chapter 4 today' }]
    expect(caretAfterRestore(restored, current)).toEqual({ focusId: 'a', caret: 12 })
  })

  it('uses the snapshot caret when only structure changed', () => {
    const restored: Snapshot = {
      doc: [{ id: 'a', type: 'h1', text: 'Title' }],
      focusId: 'a',
      caret: 0,
    }
    const current: Block[] = [{ id: 'a', type: 'p', text: 'Title' }]
    expect(caretAfterRestore(restored, current)).toEqual({ focusId: 'a', caret: 0 })
  })
})
