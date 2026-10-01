import { createElement, type MouseEvent, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPath, getUrl, pushUrl } from './location'
import { Link, appPath, href, navigateToUrl, navigate, setQuery } from './router'

interface FakeWindow {
  location: { pathname: string; search: string }
  history: { pushState: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn> }
  addEventListener: () => void
  removeEventListener: () => void
  dispatchEvent: () => boolean
}

/** A minimal `window` (the test environment is node): a location the tests can set and a history that records. */
function stubBrowser(base: string, at: string): FakeWindow {
  vi.stubEnv('BASE_URL', base)
  const url = new URL(at, 'https://example.test')
  const win: FakeWindow = {
    location: { pathname: url.pathname, search: url.search },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }
  vi.stubGlobal('window', win)
  return win
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const BASES = [
  { name: 'root base (Netlify)', base: '/', prefix: '' },
  {
    name: '/forge-study-app/ (GitHub Pages)',
    base: '/forge-study-app/',
    prefix: '/forge-study-app',
  },
] as const

describe.each(BASES)('the router under the $name', ({ base, prefix }) => {
  it('reports the location without the base', () => {
    stubBrowser(base, `${prefix}/tasks/inbox?sort=due`)
    expect(getUrl()).toBe('/tasks/inbox?sort=due')
    expect(currentPath()).toBe('/tasks/inbox')
  })

  it('reads the base itself as Today', () => {
    stubBrowser(base, `${prefix}/`)
    expect(getUrl()).toBe('/')
    expect(currentPath()).toBe('/')
  })

  it('appPath is base-less and href carries the base', () => {
    stubBrowser(base, `${prefix}/`)
    expect(appPath('today')).toBe('/')
    expect(appPath('tasks', { list: 'inbox' })).toBe('/tasks/inbox')
    expect(appPath('goal', { goalId: 'g-c182' }, { quickadd: '1' })).toBe(
      '/goals/g-c182?quickadd=1',
    )
    expect(href('today')).toBe(`${prefix}/`)
    expect(href('tasks', { list: 'inbox' })).toBe(`${prefix}/tasks/inbox`)
    expect(href('settings', { section: 'snapshots' })).toBe(`${prefix}/settings/snapshots`)
  })

  it('pushUrl adds the base to the address it gives the browser', () => {
    const win = stubBrowser(base, `${prefix}/`)
    expect(pushUrl('/tasks/inbox?x=1')).toBe(true)
    expect(win.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null,
      '',
      `${prefix}/tasks/inbox?x=1`,
    )
    expect(pushUrl('/world', true)).toBe(true)
    expect(win.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', `${prefix}/world`)
  })

  it('navigate and navigateToUrl take base-less paths, and an href() result, without doubling the base', () => {
    const win = stubBrowser(base, `${prefix}/`)
    navigate('goal', { goalId: 'g1' })
    navigateToUrl('/progress')
    navigateToUrl(href('rewards'))
    expect(win.history.pushState.mock.calls.map((c) => c[2])).toEqual([
      `${prefix}/goals/g1`,
      `${prefix}/progress`,
      `${prefix}/rewards`,
    ])
  })

  it('pushUrl to the page already showing does nothing', () => {
    const win = stubBrowser(base, `${prefix}/tasks?x=1`)
    expect(pushUrl('/tasks?x=1')).toBe(true)
    expect(pushUrl(`${prefix}/tasks?x=1`)).toBe(true)
    expect(win.history.pushState).not.toHaveBeenCalled()
  })

  it('still refuses anything that is not an app path', () => {
    const win = stubBrowser(base, `${prefix}/`)
    for (const bad of [
      '//evil.test/x',
      '/\\evil.test',
      'https://evil.test/',
      'tasks',
      `${prefix}//evil.test`,
    ]) {
      expect(pushUrl(bad)).toBe(false)
    }
    expect(win.history.pushState).not.toHaveBeenCalled()
  })

  it('setQuery keeps the current page and merges the query, without doubling the base', () => {
    const win = stubBrowser(base, `${prefix}/goals/g1?tab=plan`)
    setQuery({ import: '1' }, false)
    expect(win.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null,
      '',
      `${prefix}/goals/g1?tab=plan&import=1`,
    )
    win.location.search = '?tab=plan&import=1'
    setQuery({ import: undefined })
    expect(win.history.replaceState).toHaveBeenCalledExactlyOnceWith(
      null,
      '',
      `${prefix}/goals/g1?tab=plan`,
    )
  })
})

describe.each(BASES)('Link under the $name', ({ base, prefix }) => {
  const link = (): ReactElement =>
    createElement(Link, { to: 'tasks', params: { list: 'inbox' }, query: { sort: 'due' } }, 'Inbox')

  it('renders a real href that carries the base', () => {
    stubBrowser(base, `${prefix}/`)
    expect(renderToStaticMarkup(link())).toBe(`<a href="${prefix}/tasks/inbox?sort=due">Inbox</a>`)
  })

  it('navigates in place with the base-less path, so the base is added exactly once', () => {
    const win = stubBrowser(base, `${prefix}/`)
    const anchor = Link({ to: 'tasks', params: { list: 'inbox' }, children: 'Inbox' })
    const preventDefault = vi.fn()
    anchor.props.onClick({
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault,
    } as unknown as MouseEvent<HTMLAnchorElement>)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(win.history.pushState).toHaveBeenCalledExactlyOnceWith(null, '', `${prefix}/tasks/inbox`)
  })

  it('leaves a modified click to the browser, which opens the based href in a new tab', () => {
    const win = stubBrowser(base, `${prefix}/`)
    const anchor = Link({ to: 'goals', children: 'Goals' })
    const preventDefault = vi.fn()
    anchor.props.onClick({
      button: 0,
      defaultPrevented: false,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault,
    } as unknown as MouseEvent<HTMLAnchorElement>)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(win.history.pushState).not.toHaveBeenCalled()
    expect(anchor.props.href).toBe(`${prefix}/goals`)
  })
})
