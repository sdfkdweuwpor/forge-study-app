import type { Page, Route } from '@playwright/test'
import { FIXED_NOW } from '../../e2e/fixtures'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

/**
 * Settings → Sync (Phase 12B5), every state the section has: off, the setup form and its refusals, the
 * email step, waiting for the email, the link coming back (expired, opened elsewhere, signing in), the
 * first sync, and on in its calm and its needs-you faces. There is no network in this sandbox, so:
 *
 *  - Supabase is faked with `page.route` on a `https://<20 chars>.supabase.co` origin (the CSP lets the
 *    page reach that host; a route sees a request only after it did). It answers the preflight too, because
 *    the page sends `apikey` and `Authorization`.
 *  - States are staged by writing `syncState` straight into IndexedDB and reloading, which is what
 *    a device in that state would hold.
 *  - A second tab plays "the tab that syncs": it holds the `forge:sync` Web Lock, so the page under test is
 *    a follower (it runs no cycle of its own and would otherwise change what it shows) and it says, over the
 *    BroadcastChannel the tabs share, what the leader would say (a retry time, a paused project, the first
 *    sync's count).
 *
 * No key-shaped text sits in this file: the anon key is assembled at run time.
 */

const NOW = FIXED_NOW.getTime()
const MIN = 60_000
const PROJECT = 'https://forgetestforgetestfo.supabase.co'
const REF = 'forgetestforgetestfo'
const USER = '3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10'
const LINK_CODE = '9d1e5c2a-7b34-4f08-a6c1-2e8b0f7d3a59'

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const ANON_KEY = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ role: 'anon', ref: REF }),
  'c2hvdA',
].join('.')
const SERVICE_KEY = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ role: 'service_role', ref: REF }),
  'c2hvdA',
].join('.')

/** Finite animations and transitions have ended. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
  await page.mouse.move(0, 0)
}

// ─── Fake Supabase ──────────────────────────────────────────────────────────

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'apikey, authorization, content-type, prefer, x-supabase-api-version, x-client-info',
  'access-control-expose-headers': 'Retry-After',
}

type Answer = { status: number; body?: unknown } | 'hang'

/** Answers every call to the project with `answer(url)`; `hang` never answers. */
async function fakeSupabase(page: Page, answer: (url: URL) => Answer): Promise<void> {
  await page.route(`${PROJECT}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    const reply = answer(new URL(request.url()))
    if (reply === 'hang') return
    await route.fulfill({
      status: reply.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: reply.body === undefined ? '' : JSON.stringify(reply.body),
    })
  })
}

// ─── Staging ────────────────────────────────────────────────────────────────

const session = {
  accessToken: 'shot-access',
  refreshToken: 'shot-refresh',
  expiresAt: NOW + 50 * MIN,
  userId: USER,
  email: 'ana@example.com',
}

/** A `syncState` row: sync off, the project saved. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'device',
  enabled: false,
  url: PROJECT,
  anonKey: ANON_KEY,
  email: 'ana@example.com',
  session: null,
  pendingLogin: null,
  deviceId: null,
  accountUserId: null,
  phase: 'off',
  pullCursor: 0,
  maxSeenStamp: 0,
  lastSyncAt: null,
  lastAttemptAt: null,
  lastError: null,
  clockSkewMs: null,
  ...over,
})

/** Sync on, steady, last synced 12 minutes ago. */
const on = (over: Record<string, unknown> = {}) =>
  row({
    enabled: true,
    session,
    deviceId: 'device-laptop',
    accountUserId: USER,
    phase: 'steady',
    lastSyncAt: NOW - 12 * MIN,
    lastAttemptAt: NOW - 12 * MIN,
    ...over,
  })

const waitingRow = () =>
  row({
    pendingLogin: {
      email: 'ana@example.com',
      codeVerifier: 'shot-verifier',
      requestedAt: NOW - 20_000,
    },
  })

const engineSays = (over: Record<string, unknown> = {}) => ({
  type: 'engine',
  state: { running: false, retryAt: null, paused: false, progress: null, ...over },
})

/**
 * Loads `/settings/sync` as a device holding `state` (none: a fresh one). With `leader`, a second tab holds
 * the sync lock, so this page is a follower, and says `leader` over the channel.
 */
async function open(
  page: Page,
  state: object | null,
  opts: { path?: string; leader?: Record<string, unknown>; outbox?: number } = {},
): Promise<void> {
  const holder = await page.context().newPage()
  await holder.goto('/404.html')
  await holder.evaluate(() => {
    void navigator.locks.request('forge:sync', () => new Promise<void>(() => undefined))
  })
  if (state !== null) await putRows(page, 'syncState', [state])
  if (opts.outbox) {
    await putRows(
      page,
      'syncOutbox',
      Array.from({ length: opts.outbox }, (_, i) => ({
        tbl: 'tasks',
        id: `task-c182-u${i + 1}-1`,
        at: NOW - i * 1000,
      })),
    )
  }
  await page.goto(opts.path ?? '/settings/sync')
  await page.getByRole('heading', { level: 2, name: 'Sync' }).waitFor()
  if (opts.leader) {
    const message = engineSays(opts.leader)
    // The page's engine starts a moment after first paint; say it until the page has heard.
    for (let i = 0; i < 20; i++) {
      await holder.evaluate((m) => {
        const channel = new BroadcastChannel('forge:sync')
        channel.postMessage(m)
        channel.close()
      }, message)
      await page.waitForTimeout(100)
    }
  }
  await settle(page)
}

const SECTION = '#settings-sync'

/** The browser logs a staged 4xx answer, or a request made while offline; these shots stage one on purpose. */
const STAGED_FAILURES = ['Failed to load resource']

// ─── The shots ──────────────────────────────────────────────────────────────

const list: ShotList = {
  feature: 'sync',
  shots: [
    // Off, nothing saved: what sync is, and the way in.
    {
      name: 'off',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: settle,
    },
    { name: 'off-page', path: '/settings/sync?seed=wgu', waitFor: 'main h1', prepare: settle },
    {
      name: 'loading',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        // The section's code arrives late: the heading is real, the rows are placeholders.
        await page.route('**/assets/SyncSection-*.js', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 20_000))
          await route.continue().catch(() => undefined)
        })
        await page.goto('/settings/sync')
        await page.getByRole('status', { name: 'Loading sync settings' }).first().waitFor()
        await settle(page)
      },
    },

    // Setting up.
    {
      name: 'setup-form',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Set up sync' }).click()
        await page.getByLabel('Project URL').waitFor()
        await settle(page)
      },
    },
    {
      name: 'setup-refused',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Set up sync' }).click()
        await page.getByLabel('Project URL').fill('http://localhost:54321')
        await page.getByLabel('Anon (public) key').fill(SERVICE_KEY)
        await page.getByLabel('Project URL').focus()
        await page.getByLabel('Anon (public) key').focus()
        await page.getByRole('button', { name: 'Show key' }).focus()
        await page.getByText('must never be put in an app').waitFor()
        await settle(page)
      },
    },
    {
      name: 'setup-sql',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Set up sync' }).click()
        await page.getByText('Show the SQL').click()
        await page.getByLabel('Setup SQL').waitFor()
        await settle(page)
      },
    },
    {
      name: 'setup-check-failed',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      ignoreConsoleErrors: STAGED_FAILURES,
      prepare: async (page) => {
        await fakeSupabase(page, () => ({ status: 401, body: { message: 'Invalid API key' } }))
        await page.getByRole('button', { name: 'Set up sync' }).click()
        await page.getByLabel('Project URL').fill(PROJECT)
        await page.getByLabel('Anon (public) key').fill(ANON_KEY)
        await page.getByRole('button', { name: 'Check connection' }).click()
        await page.getByRole('alert').filter({ hasText: 'anon (public) key' }).waitFor()
        await settle(page)
      },
    },

    // Off, the project saved: the email step, and waiting for the email.
    {
      name: 'configured',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, row({ email: null }))
        await page.getByRole('button', { name: 'Send sign-in link' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'configured-rate-limited',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      ignoreConsoleErrors: STAGED_FAILURES,
      prepare: async (page) => {
        await fakeSupabase(page, () => ({
          status: 429,
          body: { error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' },
        }))
        await open(page, row({ email: null }))
        await page.getByLabel('Email').fill('ana@example.com')
        await page.getByRole('button', { name: 'Send sign-in link' }).click()
        await page.getByText('limits how many sign-in emails').waitFor()
        await settle(page)
      },
    },
    {
      name: 'waiting',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, waitingRow())
        await page.getByLabel('Code from the email').waitFor()
        await settle(page)
      },
    },
    {
      name: 'waiting-wrong-code',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      ignoreConsoleErrors: STAGED_FAILURES,
      prepare: async (page) => {
        await fakeSupabase(page, () => ({
          status: 403,
          body: { error_code: 'otp_expired', msg: 'Token has expired or is invalid' },
        }))
        await open(page, waitingRow())
        await page.getByLabel('Code from the email').fill('482913')
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await page.getByText('expired or was already used').waitFor()
        await settle(page)
      },
    },

    // The link coming back.
    {
      name: 'link-expired',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, row(), {
          path: '/settings/sync?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        })
        await page.getByText('That link has expired').waitFor()
        await settle(page)
      },
    },
    {
      name: 'link-other-browser',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, row(), { path: `/settings/sync?code=${LINK_CODE}` })
        await page.getByText('opened in a different browser').waitFor()
        await settle(page)
      },
    },
    {
      name: 'link-signing-in',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await fakeSupabase(page, () => 'hang')
        await open(page, waitingRow(), { path: `/settings/sync?code=${LINK_CODE}` })
        await page.getByText('Signing you in…').waitFor()
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => !window.location.search.includes('code='))
      },
    },

    // On.
    {
      name: 'first-sync',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, on({ phase: 'bootstrap', lastSyncAt: null, lastAttemptAt: NOW }), {
          leader: { running: true, progress: { step: 'merge', rows: 1240 } },
        })
        await page.getByText('1,240 items so far').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-synced',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, on())
        await page.getByText('Synced', { exact: true }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-synced-page',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await open(page, on())
        await page.getByText('Synced', { exact: true }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-syncing',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, on(), { leader: { running: true } })
        await page.getByText('Syncing…').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-pending',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, on(), { outbox: 3 })
        await page.getByText('3 changes waiting').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-offline',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      ignoreConsoleErrors: STAGED_FAILURES,
      prepare: async (page) => {
        await open(page, on(), { outbox: 3 })
        await page.context().setOffline(true)
        await page.getByText("Offline. Changes will sync when you're back online.").waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-retry',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        const lastError = {
          kind: 'rateLimited',
          message: 'Supabase is asking Forge to slow down. It will try again shortly.',
          at: NOW - 30_000,
        }
        await open(page, on({ lastError, lastAttemptAt: NOW - 30_000 }), {
          leader: { retryAt: NOW + 5 * MIN },
        })
        await page.getByText('in 5 minutes.').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-paused',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        const lastError = {
          kind: 'server',
          message: "Supabase isn't answering right now. Forge will try again.",
          at: NOW - 30_000,
        }
        await open(page, on({ lastError, lastAttemptAt: NOW - 30_000 }), {
          leader: { retryAt: NOW + 15 * MIN, paused: true },
        })
        await page.getByText('may be paused').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-signed-out',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        const lastError = {
          kind: 'signedOut',
          message: 'Sign in again to keep syncing. Your changes are kept on this device.',
          at: NOW - MIN,
        }
        await open(page, on({ session: null, lastError }), { outbox: 5 })
        await page.getByRole('button', { name: 'Send sign-in link' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-setup-needed',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        const lastError = {
          kind: 'setup',
          message: "The forge_rows table isn't in your project yet. Run the setup SQL.",
          at: NOW - MIN,
        }
        await open(page, on({ lastError }))
        await page.getByText('The forge_rows table isn').waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-update-needed',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        const lastError = {
          kind: 'updateNeeded',
          message:
            'Another device runs a newer Forge. Reload to update this one; sync picks up where it left off.',
          at: NOW - MIN,
        }
        await open(page, on({ lastError }))
        await page.getByRole('button', { name: 'Reload' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'on-clock-warning',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await open(page, on({ clockSkewMs: 7 * MIN }))
        await page.getByText('clock is 7 minutes behind').waitFor()
        await settle(page)
      },
    },
    {
      name: 'sign-out-dialog',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await open(page, on())
        await page.getByRole('button', { name: 'Sign out and stop syncing' }).click()
        await page.getByRole('dialog', { name: 'Sign out and stop syncing?' }).waitFor()
        await settle(page)
      },
    },

    // What sync can't do, and the free plan.
    {
      name: 'limits',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await page.getByText('What sync can’t do').click()
        await page.getByText('One item, one winner.').waitFor()
        await settle(page)
      },
    },
    {
      name: 'free-plan',
      path: '/settings/sync?seed=wgu',
      waitFor: 'main h1',
      element: SECTION,
      prepare: async (page) => {
        await page.getByText('About the free plan').click()
        await page.getByText('Free projects pause after a week').waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
