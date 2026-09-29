import { describe, expect, it } from 'vitest'
import { activeSectionId, findDuplicateIds, groupSections, orderSections } from './sectionOrder'

const GROUPS = ['Primitives', 'Overlays', 'Composites'] as const

const section = (id: string, group: string, order: number, title = id) => ({
  id,
  title,
  group,
  order,
})

describe('orderSections', () => {
  it('sorts by group order, then by order within the group', () => {
    const sorted = orderSections(
      [
        section('date-picker', 'Composites', 10),
        section('modal', 'Overlays', 30),
        section('input', 'Primitives', 30),
        section('button', 'Primitives', 10),
        section('popover', 'Overlays', 10),
      ],
      GROUPS,
    )
    expect(sorted.map((s) => s.id)).toEqual(['button', 'input', 'popover', 'modal', 'date-picker'])
  })

  it('breaks ties by title so file discovery order never shows', () => {
    const a = [section('b', 'Primitives', 10, 'Beta'), section('a', 'Primitives', 10, 'Alpha')]
    expect(orderSections(a, GROUPS).map((s) => s.id)).toEqual(['a', 'b'])
    expect(orderSections([...a].reverse(), GROUPS).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('puts unknown groups after the known ones', () => {
    const sorted = orderSections(
      [section('x', 'Charts', 1), section('a', 'Composites', 99), section('b', 'Primitives', 5)],
      GROUPS,
    )
    expect(sorted.map((s) => s.id)).toEqual(['b', 'a', 'x'])
  })

  it('does not change its input', () => {
    const input = [section('b', 'Overlays', 1), section('a', 'Primitives', 1)]
    orderSections(input, GROUPS)
    expect(input.map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('groupSections', () => {
  it('splits into ordered groups and omits empty ones', () => {
    const groups = groupSections(
      [
        section('modal', 'Overlays', 30),
        section('button', 'Primitives', 10),
        section('popover', 'Overlays', 10),
      ],
      GROUPS,
    )
    expect(groups.map((g) => g.group)).toEqual(['Primitives', 'Overlays'])
    expect(groups[1]?.sections.map((s) => s.id)).toEqual(['popover', 'modal'])
  })

  it('returns nothing for no sections', () => {
    expect(groupSections([], GROUPS)).toEqual([])
  })
})

describe('findDuplicateIds', () => {
  it('lists each repeated id once', () => {
    expect(findDuplicateIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }])).toEqual(['a'])
  })

  it('is empty when every id is unique', () => {
    expect(findDuplicateIds([{ id: 'a' }, { id: 'b' }])).toEqual([])
  })
})

describe('activeSectionId', () => {
  const tops = (...values: number[]) => values.map((top, i) => ({ id: `s${i}`, top }))

  it('picks the last section whose top has passed the offset', () => {
    expect(activeSectionId(tops(-900, -300, 40, 700), 72)).toBe('s2')
  })

  it('picks the first section while none has reached the offset', () => {
    expect(activeSectionId(tops(300, 900), 72)).toBe('s0')
  })

  it('treats a top exactly at the offset as reached', () => {
    expect(activeSectionId(tops(-10, 72, 500), 72)).toBe('s1')
  })

  it('picks the last section once the page is scrolled past all of them', () => {
    expect(activeSectionId(tops(-3000, -2000, -100), 72)).toBe('s2')
  })

  it('has no answer without sections', () => {
    expect(activeSectionId([], 72)).toBeUndefined()
  })
})
