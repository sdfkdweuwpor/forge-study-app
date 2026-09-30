import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetAllData } from '@/db/repos/backup'
import { getSyncState, saveSyncConfig, startSync } from '@/db/repos/sync'
import { runOnce } from './engine'
import { SupabaseError } from './supabase/http'

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (claims: object): string =>
  [b64url({ alg: 'HS256', typ: 'JWT' }), b64url(claims), 'c2lnbmF0dXJl'].join('.')
const ANON_KEY = jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' })
const NOW = 1_790_000_000_000

beforeEach(resetAllData)
afterEach(resetAllData)

describe('scratch runOnce', () => {
  it('paused flag from 540 answers in first sync', async () => {
    await saveSyncConfig({ url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: ANON_KEY })
    await startSync({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 3_600_000, userId: 'u1', email: 'a@b.co' })
    const send = async () => {
      throw new SupabaseError('unavailable', 'server', 'x', { status: 540 })
    }
    const out = await runOnce(send, () => undefined, () => NOW)
    console.log(JSON.stringify(out), JSON.stringify((await getSyncState())?.phase), JSON.stringify((await getSyncState())?.lastError))
    expect(out).toMatchObject({ status: 'error', paused: true })
  })
  it('setup error in first sync keeps phase bootstrap', async () => {
    await saveSyncConfig({ url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: ANON_KEY })
    await startSync({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 3_600_000, userId: 'u1', email: 'a@b.co' })
    const send = async () => {
      throw new SupabaseError('setup', 'setup', 'x', { status: 404, code: 'PGRST202' })
    }
    const out = await runOnce(send, () => undefined, () => NOW)
    const st = await getSyncState()
    console.log('RESULT', JSON.stringify(out), st?.phase, st?.lastError?.kind, st?.session !== null)
    expect(st?.phase).toBe('bootstrap')
    expect(st?.lastError?.kind).toBe('setup')
  })
})
