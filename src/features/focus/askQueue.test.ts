import { describe, expect, it } from 'vitest'
import { answered, ask, withdraw } from './askQueue'

describe('the line of end-of-session questions', () => {
  it('a new question waits behind the one on screen instead of replacing it', () => {
    const queue = ask(ask([], 'a'), 'b')
    expect(queue).toEqual(['a', 'b'])
    expect(queue[0]).toBe('a')
  })

  it('a question already in line is not asked twice (the same session heard of from two places)', () => {
    const queue = ['a', 'b'] as const
    expect(ask(queue, 'a')).toBe(queue)
    expect(ask(queue, 'b')).toBe(queue)
  })

  it('answering the one on screen brings up the next; answering any other changes nothing', () => {
    expect(answered(['a', 'b', 'c'], 'a')).toEqual(['b', 'c'])
    expect(answered(['a'], 'a')).toEqual([])
    const queue = ['a', 'b'] as const
    expect(answered(queue, 'b')).toBe(queue)
    expect(answered(queue, 'zzz')).toBe(queue)
    // A second "close" for the same question (Esc while it fades out) must not eat the next one.
    expect(answered(answered(['a', 'b'], 'a'), 'a')).toEqual(['b'])
  })

  it('withdrawing takes a question out wherever it stands', () => {
    expect(withdraw(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(withdraw(['a', 'b'], 'a')).toEqual(['b'])
    const queue = ['a'] as const
    expect(withdraw(queue, 'x')).toBe(queue)
  })
})
