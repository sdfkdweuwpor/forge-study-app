import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '@/logic/fuzzy'

function score(query: string, text: string): number {
  const found = fuzzyScore(query, text)
  if (!found) throw new Error(`expected "${query}" to match "${text}"`)
  return found.score
}

describe('fuzzyScore: matching', () => {
  it('matches a subsequence and reports where', () => {
    const found = fuzzyScore('rdchp', 'Read chapter 4')
    expect(found).not.toBeNull()
    const text = 'Read chapter 4'
    expect(found?.matches.map((i) => text[i]?.toLowerCase()).join('')).toBe('rdchp')
    expect(found?.matches).toEqual([...(found?.matches ?? [])].sort((a, b) => a - b))
  })

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'Read chapter 4')).toBeNull()
    expect(fuzzyScore('dr', 'Read')).toBeNull() // right letters, wrong order
    expect(fuzzyScore('reead', 'Read')).toBeNull() // needs two e's
    expect(fuzzyScore('abc', 'ab')).toBeNull() // longer than the text
    expect(fuzzyScore('a', '')).toBeNull()
  })

  it('ignores case', () => {
    expect(fuzzyScore('READ', 'read chapter')?.matches).toEqual([0, 1, 2, 3])
    expect(fuzzyScore('read', 'READ CHAPTER')?.matches).toEqual([0, 1, 2, 3])
  })

  it('an empty or blank query matches everything with score 0', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, matches: [] })
    expect(fuzzyScore('   ', 'anything')).toEqual({ score: 0, matches: [] })
    expect(fuzzyScore('', '')).toEqual({ score: 0, matches: [] })
  })

  it('ignores whitespace inside the query', () => {
    expect(fuzzyScore('read ch', 'Read chapter 4')?.matches).toEqual([0, 1, 2, 3, 5, 6])
    expect(fuzzyScore('startfocus', 'Start focus')).not.toBeNull()
    expect(fuzzyScore('start focus', 'Start focus')).not.toBeNull()
  })

  it('handles non-ASCII text without folding accents', () => {
    expect(fuzzyScore('caf', 'Café au lait')?.matches).toEqual([0, 1, 2])
    expect(fuzzyScore('cafe', 'Café au lait')).toBeNull()
    expect(fuzzyScore('ét', 'Étude')?.matches).toEqual([0, 1]) // É matches é
  })

  it('finds indices in the original string even with surrogate pairs', () => {
    const text = '😀 focus'
    const found = fuzzyScore('fo', text)
    expect(found?.matches.map((i) => text[i]).join('')).toBe('fo')
  })
})

describe('fuzzyScore: ranking', () => {
  it('prefers matches that start words', () => {
    expect(score('sf', 'Start focus')).toBeGreaterThan(score('sf', 'Safari'))
  })

  it('prefers consecutive characters', () => {
    expect(score('read', 'Read chapter')).toBeGreaterThan(score('read', 'Really eat a dog'))
  })

  it('prefers smaller gaps', () => {
    expect(score('ab', 'a b')).toBeGreaterThan(score('ab', 'a......b'))
    expect(score('ab', 'ab')).toBeGreaterThan(score('ab', 'a b'))
  })

  it('prefers matching case exactly', () => {
    expect(score('C182', 'C182 Intro')).toBeGreaterThan(score('C182', 'c182 intro'))
  })

  it('rewards camelCase humps', () => {
    const found = fuzzyScore('gt', 'goToday')
    expect(found?.matches).toEqual([0, 2])
    expect(score('gt', 'goToday')).toBeGreaterThan(score('gt', 'gotoday'))
  })

  it('prefers a match at the start of the text over one later on', () => {
    expect(score('read', 'Read chapter')).toBeGreaterThan(score('read', 'Please read chapter'))
  })

  it('prefers shorter texts when the match is otherwise equal', () => {
    expect(score('focus', 'Focus')).toBeGreaterThan(score('focus', 'Focus session settings'))
  })

  it('picks the best alignment, not the first one found', () => {
    // A greedy scan would take a@0 b@3; the tight "ab" at the end is better.
    expect(fuzzyScore('ab', 'a xb ab')?.matches).toEqual([5, 6])
    expect(fuzzyScore('abc', 'a_b_c abc')?.matches).toEqual([6, 7, 8])
  })

  it('matches the same character more than once', () => {
    expect(fuzzyScore('aa', 'banana')?.matches).toHaveLength(2)
    expect(fuzzyScore('nn', 'banana')?.matches).toEqual([2, 4])
    expect(fuzzyScore('nnn', 'banana')).toBeNull()
  })
})

describe('fuzzyFilter', () => {
  const items = [
    'Start focus session',
    'Toggle theme',
    'New task',
    'Go to today',
    'Go to goals',
    'Open settings',
    'Focus mode',
    'Read chapter 4',
  ]
  const same = (s: string): string => s

  it('filters and ranks best first', () => {
    const out = fuzzyFilter(items, 'focus', same)
    expect(out.map((r) => r.item)).toEqual(['Focus mode', 'Start focus session'])
    expect(out[0]?.score).toBeGreaterThan(out[1]?.score ?? Infinity)
  })

  it('returns the match indices for highlighting', () => {
    const results = fuzzyFilter(items, 'thm', same)
    expect(results.map((r) => r.item)).toEqual(['Toggle theme'])
    const found = results[0]
    expect(found?.matches).toHaveLength(3)
    expect(found?.matches.map((i) => 'Toggle theme'[i]?.toLowerCase()).join('')).toBe('thm')
  })

  it('an empty query returns the first `limit` items in order', () => {
    expect(fuzzyFilter(items, '', same, 3).map((r) => r.item)).toEqual(items.slice(0, 3))
    expect(fuzzyFilter(items, '  ', same).map((r) => r.item)).toEqual(items)
    expect(fuzzyFilter(items, '', same)[0]).toEqual({ item: items[0], score: 0, matches: [] })
  })

  it('applies the limit after ranking', () => {
    const out = fuzzyFilter(items, 'o', same, 2)
    expect(out).toHaveLength(2)
    const all = fuzzyFilter(items, 'o', same)
    expect(out.map((r) => r.item)).toEqual(all.slice(0, 2).map((r) => r.item))
  })

  it('a limit of 0 or less returns nothing', () => {
    expect(fuzzyFilter(items, 'o', same, 0)).toEqual([])
    expect(fuzzyFilter(items, '', same, -1)).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(fuzzyFilter(items, 'zzz', same)).toEqual([])
    expect(fuzzyFilter([], 'a', same)).toEqual([])
  })

  it('breaks ties by shorter text, then original order', () => {
    const tied = ['ab', 'ab', 'ab']
    expect(
      fuzzyFilter(
        tied.map((t, i) => ({ t, i })),
        'ab',
        (x) => x.t,
      ).map((r) => r.item.i),
    ).toEqual([0, 1, 2])
  })

  it('works on objects through getText', () => {
    const commands = [
      { id: 'a', title: 'Start focus' },
      { id: 'b', title: 'Stop focus' },
    ]
    const out = fuzzyFilter(commands, 'sta', (c) => c.title)
    expect(out.map((r) => r.item.id)).toEqual(['a'])
  })

  it('does not mutate its input', () => {
    const copy = [...items]
    fuzzyFilter(items, 'o', same)
    expect(items).toEqual(copy)
  })

  it('is deterministic across repeated calls (scratch buffers are reset)', () => {
    const first = fuzzyFilter(items, 'ot', same)
    fuzzyFilter(['x'.repeat(500), 'y'], 'xx', same) // grows the shared buffers
    expect(fuzzyFilter(items, 'ot', same)).toEqual(first)
  })

  it('handles 5,000 items comfortably', () => {
    const words = [
      'read',
      'chapter',
      'flashcards',
      'review',
      'essay',
      'lab',
      'report',
      'quiz',
      'notes',
      'C182',
      'C779',
      'D278',
    ]
    const big = Array.from({ length: 5000 }, (_, i) => {
      const a = words[i % words.length] ?? ''
      const b = words[(i * 7 + 3) % words.length] ?? ''
      const c = words[(i * 13 + 5) % words.length] ?? ''
      return `${a} ${b} ${c} ${i}`
    })
    const start = performance.now()
    const out = fuzzyFilter(big, 'rvw', same, 50)
    fuzzyFilter(big, 'flrv', same, 50)
    fuzzyFilter(big, 'zq', same, 50)
    const elapsed = performance.now() - start
    expect(out.length).toBe(50)
    expect(elapsed).toBeLessThan(1500) // generous: ~10-30 ms in practice; catches quadratic blow-ups
  })
})
