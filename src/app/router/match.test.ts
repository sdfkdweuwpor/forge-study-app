import { describe, expect, it } from 'vitest'
import { buildPath, buildQuery, isAppPath, matchRoute, parseQuery } from './match'
import { ROUTES, type RouteName } from './routes'

describe('matchRoute', () => {
  it('matches the root and static routes', () => {
    expect(matchRoute('/')).toEqual({ name: 'today', params: {} })
    expect(matchRoute('/focus')).toEqual({ name: 'focus', params: {} })
    expect(matchRoute('/focus/')).toEqual({ name: 'focus', params: {} })
  })

  it('handles optional last segments', () => {
    expect(matchRoute('/tasks')).toEqual({ name: 'tasks', params: {} })
    expect(matchRoute('/tasks/upcoming')).toEqual({ name: 'tasks', params: { list: 'upcoming' } })
    expect(matchRoute('/rewards/badges')).toEqual({ name: 'rewards', params: { tab: 'badges' } })
    expect(matchRoute('/review')).toEqual({ name: 'weeklyReview', params: {} })
    expect(matchRoute('/review/2026-09-28')).toEqual({
      name: 'weeklyReview',
      params: { weekStart: '2026-09-28' },
    })
  })

  it('prefers literal segments over params', () => {
    expect(matchRoute('/goals/new').name).toBe('goalNew')
    expect(matchRoute('/goals/abc').name).toBe('goal')
    expect(matchRoute('/tasks/views/v1')).toEqual({ name: 'taskView', params: { viewId: 'v1' } })
  })

  it('extracts multiple params', () => {
    expect(matchRoute('/goals/g1/courses/c182')).toEqual({
      name: 'course',
      params: { goalId: 'g1', courseId: 'c182' },
    })
    expect(matchRoute('/goals/g1/courses/c182/review').name).toBe('cardReview')
  })

  it('decodes params', () => {
    expect(matchRoute('/task/a%20b').params).toEqual({ taskId: 'a b' })
    expect(matchRoute('/task/%E0%A4%A').params).toEqual({ taskId: '%E0%A4%A' })
  })

  it('falls back to notFound', () => {
    expect(matchRoute('/nope').name).toBe('notFound')
    expect(matchRoute('/focus/extra').name).toBe('notFound')
    expect(matchRoute('/goals/g1/courses').name).toBe('notFound')
  })

  it('resolves every concrete route path to itself', () => {
    const sample: Record<string, string> = {
      list: 'inbox',
      viewId: 'v',
      taskId: 't',
      goalId: 'g',
      courseId: 'c',
      weekStart: '2026-09-28',
      tab: 'shop',
      section: 'appearance',
      kind: 'morning',
    }
    for (const name of Object.keys(ROUTES) as RouteName[]) {
      if (name === 'notFound') continue
      const path = buildPath(ROUTES[name].path, sample)
      expect(matchRoute(path).name, path).toBe(name)
    }
  })
})

describe('buildPath / query', () => {
  it('drops absent optional params and encodes values', () => {
    expect(buildPath('/tasks/:list?')).toBe('/tasks')
    expect(buildPath('/tasks/:list?', { list: 'inbox' })).toBe('/tasks/inbox')
    expect(buildPath('/task/:taskId', { taskId: 'a b/c' })).toBe('/task/a%20b%2Fc')
    expect(buildPath('/')).toBe('/')
  })

  it('throws when a required param is missing', () => {
    expect(() => buildPath('/goals/:goalId')).toThrow(/goalId/)
  })

  it('builds and parses query strings', () => {
    expect(buildQuery({ layout: 'board', tag: undefined, peek: '' })).toBe('?layout=board')
    expect(buildQuery()).toBe('')
    expect(parseQuery('?layout=board&tag=C182')).toEqual({ layout: 'board', tag: 'C182' })
  })
})

describe('isAppPath', () => {
  it('accepts app-relative paths with query and hash', () => {
    expect(isAppPath('/')).toBe(true)
    expect(isAppPath('/tasks/inbox')).toBe(true)
    expect(isAppPath('/tasks?layout=board&tag=C182')).toBe(true)
    expect(isAppPath('/goals/g1/courses/C779#notes')).toBe(true)
  })

  it('refuses anything that could leave the app', () => {
    expect(isAppPath('//evil.example/steal')).toBe(false)
    expect(isAppPath('/\\evil.example')).toBe(false)
    expect(isAppPath('https://evil.example/')).toBe(false)
    expect(isAppPath('javascript:alert(1)')).toBe(false)
    expect(isAppPath('tasks/inbox')).toBe(false)
    expect(isAppPath('')).toBe(false)
    expect(isAppPath('?tab=all')).toBe(false)
  })

  it('refuses control characters, which URL parsers strip before resolving', () => {
    expect(isAppPath('/\t/evil.example')).toBe(false)
    expect(isAppPath('/\n/evil.example')).toBe(false)
    expect(isAppPath('/tasks\u0000')).toBe(false)
  })
})
