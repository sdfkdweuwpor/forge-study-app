import { describe, expect, it } from 'vitest'
import { indexAcross, rowsToDraw, takePerGroup } from './progressiveList'

describe('rowsToDraw', () => {
  it('draws the page, or everything when the list is shorter', () => {
    expect(rowsToDraw(30, 100, -1)).toBe(30)
    expect(rowsToDraw(2000, 100, -1)).toBe(100)
    expect(rowsToDraw(0, 100, -1)).toBe(0)
  })

  it('always reaches the selected row', () => {
    expect(rowsToDraw(2000, 100, 99)).toBe(100)
    expect(rowsToDraw(2000, 100, 100)).toBe(101)
    expect(rowsToDraw(2000, 100, 1999)).toBe(2000)
  })
})

describe('takePerGroup', () => {
  it('fills groups in order', () => {
    expect(takePerGroup([3, 4, 5], 5)).toEqual([3, 2, 0])
    expect(takePerGroup([3, 4, 5], 12)).toEqual([3, 4, 5])
    expect(takePerGroup([3, 4, 5], 50)).toEqual([3, 4, 5])
    expect(takePerGroup([0, 2], 1)).toEqual([0, 1])
    expect(takePerGroup([2], -1)).toEqual([0])
  })
})

describe('indexAcross', () => {
  const groups = [{ tasks: [{ id: 'a' }, { id: 'b' }] }, { tasks: [] }, { tasks: [{ id: 'c' }] }]
  it('counts across groups', () => {
    expect(indexAcross(groups, 'a')).toBe(0)
    expect(indexAcross(groups, 'c')).toBe(2)
    expect(indexAcross(groups, 'x')).toBe(-1)
    expect(indexAcross(groups, null)).toBe(-1)
  })
})
