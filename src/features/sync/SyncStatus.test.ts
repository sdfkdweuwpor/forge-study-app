import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { SyncStateView } from '@/db/hooks/useSyncState'
import type { SyncError, SyncErrorKind } from '@/db/types'
import { ToastContext, type ToastApi } from '@/ui/Toast/ToastContext'
import { IDLE_ENGINE, setEngineState } from './engineState'
import { SyncStatus } from './SyncStatus'

/**
 * The faces of the section while sync is on, as the words and controls a person would see (server
 * rendered: the effects that start an engine do not run). The part that matters here is the first sync:
 * `phase` stays `bootstrap` until one whole cycle has worked, so a first cycle that fails must still show
 * its error and the way out, not an endless "Bringing this device together…".
 */

const NOW = 1_790_000_000_000
const toast: ToastApi = {
  show: () => '',
  success: () => '',
  error: () => '',
  xp: () => '',
  dismiss: () => undefined,
  dismissAll: () => undefined,
}

const view = (over: Partial<SyncStateView> = {}): SyncStateView => ({
  enabled: true,
  phase: 'bootstrap',
  url: 'https://forgetestforgetestfo.supabase.co',
  anonKey: ['test', 'anon', 'key'].join('-'),
  email: 'ana@example.com',
  signedIn: true,
  pendingLogin: null,
  lastSyncAt: null,
  lastAttemptAt: NOW,
  lastError: null,
  clockSkewMs: null,
  ...over,
})

const failed = (kind: SyncErrorKind, message = 'x'): SyncError => ({ kind, message, at: NOW })

const render = (v: SyncStateView): string =>
  renderToString(
    createElement(ToastContext.Provider, { value: toast }, createElement(SyncStatus, { view: v })),
  )

const FIRST_SYNC = 'Bringing this device together'
const SIGN_OUT = 'Sign out and stop syncing'

describe('SyncStatus: the first sync', () => {
  afterEach(() => setEngineState({ ...IDLE_ENGINE }))

  it('shows the promise, the progress and the way out while nothing has gone wrong', () => {
    const html = render(view())
    expect(html).toContain(FIRST_SYNC)
    expect(html).toContain('Getting started')
    expect(html).toContain(SIGN_OUT)
    // Not "a snapshot was taken": a device with no data takes none.
    expect(html).toContain('If this device has data, a snapshot is taken first.')
    expect(html).not.toContain('A snapshot was taken')
  })

  it('shows the progress count the leader reports', () => {
    setEngineState({ ...IDLE_ENGINE, running: true, progress: { step: 'merge', rows: 1240 } })
    expect(render(view())).toContain('1,240 items so far')
  })

  it('a first cycle that found the setup SQL missing shows the error and "Copy setup SQL"', () => {
    const html = render(view({ lastError: failed('setup') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('forge_rows table')
    expect(html).toContain('Copy setup SQL')
    expect(html).toContain('Sync now')
    expect(html).toContain(SIGN_OUT)
  })

  it('a first cycle refused for missing access rules shows the error and "Copy setup SQL"', () => {
    const html = render(view({ lastError: failed('forbidden') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('access rules')
    expect(html).toContain('Copy setup SQL')
    expect(html).toContain(SIGN_OUT)
  })

  it('a first cycle that could not reach the network says so, calmly, and can be left', () => {
    const html = render(view({ lastError: failed('offline') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('Offline.')
    expect(html).toContain('Sync now')
    expect(html).toContain(SIGN_OUT)
  })

  it('a first cycle that hit a server error says it will try again', () => {
    const html = render(view({ lastError: failed('server') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('Trying again')
    expect(html).toContain(SIGN_OUT)
  })

  it('a project that keeps answering with server errors is called paused, in a first sync too', () => {
    setEngineState({ ...IDLE_ENGINE, paused: true, retryAt: NOW + 15 * 60_000 })
    const html = render(view({ lastError: failed('server') }))
    expect(html).toContain('may be paused')
    expect(html).toContain(SIGN_OUT)
  })

  it('a first cycle that needs a newer Forge offers to reload', () => {
    const html = render(view({ lastError: failed('updateNeeded') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('Reload')
    expect(html).toContain(SIGN_OUT)
  })

  it('a first sync whose session ended asks for the email again', () => {
    const html = render(view({ signedIn: false, lastError: failed('signedOut') }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('Send sign-in link')
    expect(html).toContain(SIGN_OUT)
  })

  it('a device that has caught up shows the calm status line, not the first sync', () => {
    const html = render(view({ phase: 'steady', lastSyncAt: NOW - 60_000 }))
    expect(html).not.toContain(FIRST_SYNC)
    expect(html).toContain('Synced')
    expect(html).toContain(SIGN_OUT)
  })
})
