import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SyncStateView } from '@/db/hooks/useSyncState'
import { SyncStatus } from './SyncStatus'

const view = (over: Partial<SyncStateView>): SyncStateView => ({
  enabled: true,
  phase: 'bootstrap',
  url: 'https://forgetestforgetestfo.supabase.co',
  anonKey: 'k',
  email: 'ana@example.com',
  signedIn: true,
  pendingLogin: null,
  lastSyncAt: null,
  lastAttemptAt: 1,
  lastError: { kind: 'setup', message: 'The forge_rows table isn\'t in your project yet. Run the setup SQL.', at: 2 },
  clockSkewMs: null,
  ...over,
})

describe('scratch', () => {
  it('bootstrap + setup error', () => {
    const html = renderToString(createElement(SyncStatus, { view: view({}) }))
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    expect(html).toContain('Bringing this device')
    expect(html).not.toContain('Copy setup SQL')
    expect(html).not.toContain('Sign out')
  })
})
