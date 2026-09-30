import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FatalScreen, RootErrorScreen, RouteErrorView } from './ErrorScreens'

const html = (el: ReactElement): string => renderToStaticMarkup(el)
const noop = () => undefined

describe('the crash screens', () => {
  it('the root screen is calm, offers Export, Copy details, Reload and the way to a snapshot', () => {
    const out = html(
      createElement(RootErrorScreen, {
        error: new TypeError("Cannot read properties of null (reading 'theme')"),
        onRetry: noop,
      }),
    )
    expect(out).toContain('Something went wrong')
    expect(out).toContain('Your data is stored on this device and has not been touched')
    for (const label of ['Try again', 'Reload', 'Export my data', 'Copy error details']) {
      expect(out).toContain(label)
    }
    expect(out).toContain('href="/settings/snapshots"')
    expect(out).toContain('Cannot read properties of null')
  })

  it('renders an error with no message, a stack and no name', () => {
    const odd = new Error('')
    odd.name = ''
    expect(() => html(createElement(RootErrorScreen, { error: odd, onRetry: noop }))).not.toThrow()
  })

  it('a start-up failure still exports, and copies details, but does not send anyone to Settings', () => {
    const out = html(
      createElement(FatalScreen, {
        fatal: {
          kind: 'boot-failed',
          error: new Error('The database on this device could not be opened'),
        },
      }),
    )
    expect(out).toContain('Forge could not start')
    expect(out).toContain('Export my data')
    expect(out).toContain('Copy error details')
    expect(out).not.toContain('/settings/snapshots')
  })

  it('an update in another tab only asks for a Reload (nothing to export)', () => {
    const out = html(createElement(FatalScreen, { fatal: { kind: 'db-stale' } }))
    expect(out).toContain('Reload')
    expect(out).not.toContain('Export my data')
  })

  it('a page that fails keeps the app around it and offers the same way out', () => {
    const out = html(createElement(RouteErrorView, { error: new Error('boom'), onRetry: noop }))
    expect(out).toContain('This page hit a problem')
    expect(out).toContain('Export my data')
    expect(out).toContain('Copy error details')
    expect(out).toContain('href="/settings/snapshots"')
  })
})
