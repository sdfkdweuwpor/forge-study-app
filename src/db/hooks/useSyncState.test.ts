import { describe, expect, it } from 'vitest'
import { defaultSyncState } from '../defaults'
import type { SyncStateRow } from '../types'
import { toSyncStateView } from './useSyncState'

const signedIn = (): SyncStateRow => ({
  ...defaultSyncState({
    url: 'https://abcdefghijklmnopqrst.supabase.co',
    anonKey: ['sb', 'publishable', 'TESTKEY'].join('_'),
    email: 'ana@example.com',
  }),
  enabled: true,
  phase: 'steady',
  deviceId: 'device-a',
  accountUserId: 'user-1',
  session: {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: 1,
    userId: 'user-1',
    email: 'ana@example.com',
  },
  pendingLogin: { email: 'ana@example.com', codeVerifier: 'test-verifier', requestedAt: 5 },
  lastSyncAt: 10,
  lastAttemptAt: 11,
  clockSkewMs: -1200,
})

describe('toSyncStateView', () => {
  it('shows status and configuration, and none of the secrets', () => {
    const view = toSyncStateView(signedIn())
    expect(view).toMatchObject({
      enabled: true,
      phase: 'steady',
      email: 'ana@example.com',
      signedIn: true,
      pendingLogin: { email: 'ana@example.com', requestedAt: 5 },
      lastSyncAt: 10,
      clockSkewMs: -1200,
    })
    const text = JSON.stringify(view)
    for (const secret of ['test-access-token', 'test-refresh-token', 'test-verifier']) {
      expect(text).not.toContain(secret)
    }
  })

  it('says a device with no session is signed out, and one never set up is off', () => {
    expect(toSyncStateView({ ...signedIn(), session: null, pendingLogin: null })).toMatchObject({
      signedIn: false,
      pendingLogin: null,
    })
    expect(toSyncStateView(defaultSyncState())).toMatchObject({
      enabled: false,
      phase: 'off',
      signedIn: false,
    })
  })
})
