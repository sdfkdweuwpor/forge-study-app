import { describe, expect, it } from 'vitest'
import { clusterPoints, type ScatterPoint } from './cluster'

const p = (id: string, planned: number, actual: number): ScatterPoint => ({
  id,
  label: `Task ${id}`,
  planned,
  actual,
})

describe('clusterPoints', () => {
  it('puts tasks with the same numbers on one dot', () => {
    const out = clusterPoints([p('a', 2, 2), p('b', 2, 2), p('c', 2, 3)])
    expect(out.map((c) => [c.planned, c.actual, c.points.length])).toEqual([
      [2, 2, 2],
      [2, 3, 1],
    ])
  })

  it('orders by estimate, then by actual (the arrow-key order)', () => {
    const out = clusterPoints([p('a', 3, 1), p('b', 1, 2), p('c', 1, 1), p('d', 2, 2)])
    expect(out.map((c) => `${c.planned}/${c.actual}`)).toEqual(['1/1', '1/2', '2/2', '3/1'])
  })

  it('says whether a dot is within ±20 %', () => {
    const out = clusterPoints([p('a', 5, 6), p('b', 5, 7), p('c', 2, 2)])
    expect(out.map((c) => c.within)).toEqual([true, true, false])
  })

  it('keeps the tasks of a dot in the order given', () => {
    const [only] = clusterPoints([p('b', 1, 1), p('a', 1, 1)])
    expect(only?.points.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('is empty for no points', () => {
    expect(clusterPoints([])).toEqual([])
  })
})
