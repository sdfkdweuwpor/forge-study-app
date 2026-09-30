import { describe, expect, it } from 'vitest'
import { deepEqual } from './deepEqual'
import { replaceEqualDeep, rowSharer, shareRows, valueSharer } from './share'

describe('replaceEqualDeep', () => {
  it('returns the previous value when the new one is equal, whatever the key order', () => {
    const prev = { a: 1, b: [1, 2, { c: 'x' }], d: null, e: { f: NaN } }
    const next = { e: { f: NaN }, d: null, b: [1, 2, { c: 'x' }], a: 1 }
    expect(replaceEqualDeep(prev, next)).toBe(prev)
  })

  it('keeps unchanged branches and replaces changed ones', () => {
    const prev = { tags: ['a'], timer: { pomodoroMin: 25 }, name: 'x' }
    const next = { tags: ['a'], timer: { pomodoroMin: 30 }, name: 'x' }
    const out = replaceEqualDeep(prev, next)
    expect(out).not.toBe(prev)
    expect(out.tags).toBe(prev.tags)
    expect(out.timer).toBe(next.timer)
    expect(out).toEqual(next)
  })

  it('treats added, removed and changed keys and array lengths as changes', () => {
    expect(replaceEqualDeep({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(replaceEqualDeep({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 })
    const prev = [1, 2, 3]
    expect(replaceEqualDeep(prev, [1, 2])).toEqual([1, 2])
    expect(replaceEqualDeep(prev, [1, 2, 3])).toBe(prev)
    // A key that is present with `undefined` differs from a missing key.
    expect(replaceEqualDeep({ a: undefined }, { b: undefined })).toEqual({ b: undefined })
  })

  it('never shares what is not JSON-like', () => {
    const prev = { at: new Date(0), m: new Map([[1, 2]]) }
    const next = { at: new Date(0), m: new Map([[1, 2]]) }
    const out = replaceEqualDeep(prev, next)
    expect(out.at).toBe(next.at)
    expect(out.m).toBe(next.m)
  })

  it('agrees with deepEqual on random JSON', () => {
    let seed = 7
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    const gen = (depth: number): unknown => {
      const k = rnd(depth > 2 ? 3 : 5)
      if (k === 0) return rnd(3)
      if (k === 1) return ['x', 'y', null][rnd(3)]
      if (k === 2) return rnd(2) === 0
      if (k === 3) return Array.from({ length: rnd(3) }, () => gen(depth + 1))
      return Object.fromEntries(Array.from({ length: rnd(3) }, (_, i) => [`k${i + rnd(2)}`, gen(depth + 1)]))
    }
    for (let i = 0; i < 400; i++) {
      const a = gen(0)
      const b = gen(0)
      const out = replaceEqualDeep(a, b)
      expect(deepEqual(out, b)).toBe(true)
      if (deepEqual(a, b)) expect(out).toBe(a)
    }
  })
})

describe('shareRows', () => {
  const row = (id: string, v = 0) => ({ id, v, tags: ['t'] })

  it('returns the previous array when every row is unchanged and in place', () => {
    const prev = [row('a'), row('b')]
    expect(shareRows(prev, [row('a'), row('b')])).toBe(prev)
  })

  it('matches rows by id, so an insertion keeps every other row', () => {
    const prev = [row('a'), row('c')]
    const out = shareRows(prev, [row('a'), row('b'), row('c')])
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[2]).toBe(prev[1])
    expect(out[1]).toEqual(row('b'))
  })

  it('replaces only the rows that changed, keeping their unchanged parts', () => {
    const prev = [row('a'), row('b')]
    const out = shareRows(prev, [row('a'), row('b', 1)])
    expect(out[0]).toBe(prev[0])
    expect(out[1]).not.toBe(prev[1])
    expect(out[1]?.tags).toBe(prev[1]?.tags)
  })

  it('a new order is a new array of the same rows', () => {
    const prev = [row('a'), row('b')]
    const out = shareRows(prev, [row('b'), row('a')])
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[1])
    expect(out[1]).toBe(prev[0])
  })
})

describe('sharers', () => {
  it('remember the last result', () => {
    const rows = rowSharer<{ id: string; v: number }>()
    const first = rows([{ id: 'a', v: 1 }])
    expect(rows([{ id: 'a', v: 1 }])).toBe(first)
    const second = rows([{ id: 'a', v: 2 }])
    expect(second).not.toBe(first)
    expect(rows([{ id: 'a', v: 2 }])).toBe(second)

    const value = valueSharer<{ n: number[] }>()
    const v1 = value({ n: [1] })
    expect(value({ n: [1] })).toBe(v1)
  })

  it('share 2,500 task-sized rows in a few milliseconds', () => {
    const make = () =>
      Array.from({ length: 2500 }, (_, i) => ({
        id: `t${i}`,
        title: `Task ${i}`,
        notes: [{ id: 'n', type: 'p', text: 'x' }],
        tags: ['C182'],
        subtasks: [],
        status: 'done',
        doDate: '2026-09-01',
        completedAt: i,
      }))
    const share = rowSharer<ReturnType<typeof make>[number]>()
    const first = share(make())
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const next = make()
      const t0 = performance.now()
      expect(share(next)).toBe(first)
      best = Math.min(best, performance.now() - t0)
    }
    // Typically 1–3 ms; the bound only catches a quadratic slip.
    expect(best).toBeLessThan(250)
  })
})
