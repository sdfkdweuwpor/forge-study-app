import { describe, expect, it } from 'vitest'
import type { Block } from '@/logic/blocks'
import { docHash } from './docHash'

const doc = (): Block[] => [
  { id: 'a', type: 'h1', text: 'C182 notes' },
  { id: 'b', type: 'todo', text: 'Read chapter 4', checked: false },
  { id: 'c', type: 'callout', text: 'Exam Friday', emoji: '📌' },
]

describe('docHash', () => {
  it('is the same for equal content, whatever the object identity', () => {
    expect(docHash(doc())).toBe(docHash(doc()))
    expect(docHash([])).toBe(docHash([]))
  })

  it('changes with any field of any block', () => {
    const base = docHash(doc())
    const edits: Array<(d: Block[]) => void> = [
      (d) => void (d[0] = { id: 'a', type: 'h2', text: 'C182 notes' }),
      (d) => void (d[0] = { id: 'a', type: 'h1', text: 'C182 note' }),
      (d) => void (d[0] = { id: 'z', type: 'h1', text: 'C182 notes' }),
      (d) => void (d[1] = { id: 'b', type: 'todo', text: 'Read chapter 4', checked: true }),
      (d) => void (d[2] = { id: 'c', type: 'callout', text: 'Exam Friday', emoji: '💡' }),
      (d) => void d.pop(),
      (d) => void d.reverse(),
    ]
    const seen = new Set<number>([base])
    for (const edit of edits) {
      const d = doc()
      edit(d)
      seen.add(docHash(d))
    }
    expect(seen.size).toBe(edits.length + 1)
  })

  it('keeps field boundaries apart', () => {
    const a: Block[] = [{ id: 'ab', type: 'p', text: 'c' }]
    const b: Block[] = [{ id: 'a', type: 'p', text: 'bc' }]
    expect(docHash(a)).not.toBe(docHash(b))
  })

  it('tells unset and false apart', () => {
    const unset: Block[] = [{ id: 'a', type: 'todo', text: '' }]
    const unchecked: Block[] = [{ id: 'a', type: 'todo', text: '', checked: false }]
    expect(docHash(unset)).not.toBe(docHash(unchecked))
  })
})
