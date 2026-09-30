import { describe, expect, it } from 'vitest'
import { stripBase, withBase } from './base'

const PAGES = '/forge-study-app/'

describe('withBase', () => {
  it('leaves every path alone under the root base (Netlify)', () => {
    for (const path of ['/', '/tasks', '/tasks/inbox?x=1', '/?quickadd=1', '/goals/g1#top']) {
      expect(withBase(path, '/')).toBe(path)
    }
  })

  it('prefixes a base-less path under /forge-study-app/ (GitHub Pages)', () => {
    expect(withBase('/', PAGES)).toBe('/forge-study-app/')
    expect(withBase('/tasks', PAGES)).toBe('/forge-study-app/tasks')
    expect(withBase('/tasks/inbox?x=1', PAGES)).toBe('/forge-study-app/tasks/inbox?x=1')
    expect(withBase('/?quickadd=1', PAGES)).toBe('/forge-study-app/?quickadd=1')
    expect(withBase('/goals/g1#top', PAGES)).toBe('/forge-study-app/goals/g1#top')
  })

  it('treats a base with or without its trailing slash the same', () => {
    expect(withBase('/focus', '/forge-study-app')).toBe('/forge-study-app/focus')
    expect(withBase('/', '/forge-study-app')).toBe('/forge-study-app/')
  })

  it('does not touch something that is not an app path', () => {
    expect(withBase('', PAGES)).toBe('')
    expect(withBase('?x=1', PAGES)).toBe('?x=1')
    expect(withBase('https://example.com/x', PAGES)).toBe('https://example.com/x')
  })
})

describe('stripBase', () => {
  it('leaves every URL alone under the root base', () => {
    for (const url of ['/', '/tasks', '/tasks/inbox?x=1', '/forge-study-app/tasks']) {
      expect(stripBase(url, '/')).toBe(url)
    }
  })

  it('removes the prefix under /forge-study-app/', () => {
    expect(stripBase('/forge-study-app/', PAGES)).toBe('/')
    expect(stripBase('/forge-study-app/tasks', PAGES)).toBe('/tasks')
    expect(stripBase('/forge-study-app/tasks/inbox?x=1', PAGES)).toBe('/tasks/inbox?x=1')
    expect(stripBase('/forge-study-app/?quickadd=1', PAGES)).toBe('/?quickadd=1')
    expect(stripBase('/forge-study-app/goals/g1/courses/c182', PAGES)).toBe(
      '/goals/g1/courses/c182',
    )
  })

  it('reads the bare base, with no trailing slash, as the root', () => {
    expect(stripBase('/forge-study-app', PAGES)).toBe('/')
    expect(stripBase('/forge-study-app?seed=wgu', PAGES)).toBe('/?seed=wgu')
    expect(stripBase('/forge-study-app#top', PAGES)).toBe('/#top')
  })

  it('only strips at a segment boundary', () => {
    expect(stripBase('/forge-study-appendix', PAGES)).toBe('/forge-study-appendix')
    expect(stripBase('/forge-study-app2/tasks', PAGES)).toBe('/forge-study-app2/tasks')
  })

  it('returns a URL outside the base unchanged, so it lands on "not found"', () => {
    expect(stripBase('/tasks', PAGES)).toBe('/tasks')
    expect(stripBase('/other-app/tasks', PAGES)).toBe('/other-app/tasks')
  })

  it('strips only once', () => {
    expect(stripBase('/forge-study-app/forge-study-app/tasks', PAGES)).toBe(
      '/forge-study-app/tasks',
    )
  })

  it('round-trips with withBase under both bases', () => {
    for (const base of ['/', PAGES, '/forge-study-app', '/a/b/']) {
      for (const path of ['/', '/tasks', '/tasks/inbox?x=1', '/goals/g1/courses/c182#top']) {
        expect(stripBase(withBase(path, base), base)).toBe(path)
      }
    }
  })
})
