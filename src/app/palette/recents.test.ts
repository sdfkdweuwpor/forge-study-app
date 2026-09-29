import { describe, expect, it } from 'vitest'
import { MAX_RECENTS, parseRecents, pushRecent, recentKey, type RecentEntry } from './recents'

const cmd = (id: string): RecentEntry => ({ kind: 'command', id })
const res = (id: string, providerId = 'tasks'): RecentEntry => ({
  kind: 'result',
  providerId,
  id,
  title: `Task ${id}`,
  group: 'Tasks',
})

describe('pushRecent', () => {
  it('puts the newest first', () => {
    expect(pushRecent([cmd('a')], cmd('b'))).toEqual([cmd('b'), cmd('a')])
  })

  it('moves a repeated entry to the front instead of duplicating it', () => {
    expect(pushRecent([cmd('a'), cmd('b'), cmd('c')], cmd('c'))).toEqual([
      cmd('c'),
      cmd('a'),
      cmd('b'),
    ])
  })

  it('treats the same id from another provider or kind as a different entry', () => {
    const list = [res('1', 'tasks'), cmd('1')]
    expect(pushRecent(list, res('1', 'goals'))).toHaveLength(3)
  })

  it('caps the list', () => {
    let list: RecentEntry[] = []
    for (let i = 0; i < MAX_RECENTS + 5; i++) list = pushRecent(list, cmd(String(i)))
    expect(list).toHaveLength(MAX_RECENTS)
    expect(list[0]).toEqual(cmd(String(MAX_RECENTS + 4)))
  })
})

describe('parseRecents', () => {
  it('round-trips what pushRecent produces', () => {
    const list = pushRecent([cmd('go.today')], {
      kind: 'result',
      providerId: 'tasks',
      id: 't1',
      title: 'Read chapter 4',
      group: 'Tasks',
      subtitle: 'C182 · due tomorrow',
    })
    expect(parseRecents(JSON.stringify(list))).toEqual(list)
  })

  it('returns nothing for missing, broken or non-array data', () => {
    expect(parseRecents(null)).toEqual([])
    expect(parseRecents('')).toEqual([])
    expect(parseRecents('{oops')).toEqual([])
    expect(parseRecents('{"kind":"command","id":"x"}')).toEqual([])
  })

  it('drops malformed entries and duplicates, keeps the rest in order', () => {
    const raw = JSON.stringify([
      cmd('a'),
      null,
      42,
      { kind: 'command' },
      { kind: 'command', id: '' },
      { kind: 'result', providerId: 'tasks', id: '1' },
      { kind: 'mystery', id: 'x' },
      cmd('a'),
      res('2'),
    ])
    expect(parseRecents(raw)).toEqual([cmd('a'), res('2')])
  })

  it('never keeps more than the cap', () => {
    const raw = JSON.stringify(Array.from({ length: 30 }, (_, i) => cmd(`c${i}`)))
    expect(parseRecents(raw)).toHaveLength(MAX_RECENTS)
  })
})

describe('recentKey', () => {
  it('is stable and distinguishes kinds', () => {
    expect(recentKey(cmd('x'))).toBe('command:x')
    expect(recentKey(res('x'))).toBe('result:tasks:x')
  })
})
