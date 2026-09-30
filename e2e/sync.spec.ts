import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  devices,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { FIXED_NOW, TIME_ZONE, expect, gotoApp, test as base } from './fixtures'
import { readTable } from './idb'
import {
  FakeSupabase,
  FAKE_PROJECT_REF,
  FAKE_PROJECT_URL,
  fakeJwt,
  fakeSecretKey,
  type Link,
} from './support/fakeSupabase'

/**
 * Phase 12B6: cloud sync end to end (PLAN §4.7.8), against `e2e/support/fakeSupabase.ts`, a fake Supabase
 * project served through `page.route` over the same `SyncServerModel` the repo tests use. One fake project
 * per test; a "device" is a browser context (its own IndexedDB, its own clock), so two devices are two
 * contexts on one project. Nothing here reaches a real Supabase host, and every device fails its test on a
 * console error, a page error or a request to anywhere but the app and the fake project.
 *
 * Waiting is always for something to be true (a status line, a row on the server, a table on the device);
 * there are no fixed sleeps. The page clock is frozen (`FIXED_NOW`), so the engine's timers (a 3 s write
 * delay, a 15 s backoff) run on real time and the specs bypass them on purpose: the palette's "Sync now",
 * the `online` event.
 */

const EMAIL = 'ana.reyes@example.com'
const MENTOR = 'Email mentor about term plan'
const MENTOR_ID = 'task-email-mentor'
const LIBRARY = 'Renew library card'
const LIBRARY_ID = 'task-library-card'
/** The first sync waits for the browser to be idle after sign-in; give it room on a busy machine. */
const SYNC_WAIT = 30_000
const DESKTOP = { width: 1440, height: 900 }
/** What the browser logs when a request to the project is cut off (`setOffline`). */
const REFUSED = 'net::ERR_INTERNET_DISCONNECTED'

// ─── Devices ────────────────────────────────────────────────────────────────

interface Device {
  readonly page: Page
  readonly context: BrowserContext
  /** The device's connection to the fake project. */
  readonly link: Link
  /** Cuts the project off (and tells the page, as the browser does) or plugs it back in. */
  setOffline(offline: boolean): Promise<void>
}

interface DeviceOptions {
  /** This device's clock runs this far ahead of the e2e clock (a phone a minute fast). */
  clockOffsetMs?: number
  /** Substrings of console errors this test provokes on purpose (a refused request logs one). */
  ignoreConsoleErrors?: readonly string[]
}

/** A 1x1 transparent PNG: what every favicon lookup gets (the Blocker page asks DuckDuckGo). */
const FAVICON_STUB = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/** One fake Supabase project and the devices (browser contexts) of the person who uses it. */
class Cloud {
  readonly server: FakeSupabase
  private readonly open: {
    context: BrowserContext
    problems: string[]
    external: string[]
  }[] = []

  constructor(
    private readonly browser: Browser,
    private readonly baseURL: string,
    keyKind: 'publishable' | 'anonJwt',
  ) {
    this.server = new FakeSupabase({ keyKind })
  }

  async device(options: DeviceOptions = {}): Promise<Device> {
    const context = await this.browser.newContext({
      ...devices['Desktop Chrome'],
      viewport: DESKTOP,
      baseURL: this.baseURL,
      timezoneId: TIME_ZONE,
      locale: 'en-US',
      serviceWorkers: 'block',
    })
    const link = await this.server.attach(context)
    await context.route('https://icons.duckduckgo.com/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: FAVICON_STUB }),
    )
    await context.clock.setFixedTime(new Date(FIXED_NOW.getTime() + (options.clockOffsetMs ?? 0)))
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('forge:onboarding:skip', '1')
      } catch {
        // A frame with an opaque origin has no storage; the app is not there anyway.
      }
    })
    const page = await context.newPage()
    const problems: string[] = []
    const external: string[] = []
    const ignore = options.ignoreConsoleErrors ?? []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !ignore.some((part) => msg.text().includes(part))) {
        problems.push(`console.error: ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
    const appHost = new URL(this.baseURL).host
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (!/^https?:$/.test(url.protocol)) return
      // Supabase hosts are the fake project's business (`strayHosts` catches any other one); the favicon
      // host is stubbed and only the Blocker page asks for it.
      const known =
        url.host === appHost ||
        url.host.endsWith('.supabase.co') ||
        url.host === 'icons.duckduckgo.com'
      if (!known) external.push(request.url())
    })
    this.open.push({ context, problems, external })
    return {
      page,
      context,
      link,
      setOffline: async (offline) => {
        link.offline = offline
        // The browser's own word for it, the `offline` and `online` events the engine listens to.
        // (`context.setOffline` would also stop the app's own lazy chunks, which the installed app
        // serves from its cache; here only the project is unreachable.)
        await Promise.all(
          context
            .pages()
            .map((p) =>
              p.evaluate(
                (type) => window.dispatchEvent(new Event(type)),
                offline ? 'offline' : 'online',
              ),
            ),
        )
      },
    }
  }

  /** After a failed test: what the pages logged goes into the report, and the contexts are closed. */
  async abandon(testInfo: TestInfo): Promise<void> {
    const logged = this.open.flatMap(({ problems }) => problems)
    if (logged.length > 0) {
      await testInfo.attach('page-problems', { body: logged.join('\n'), contentType: 'text/plain' })
    }
    await Promise.all(this.open.map(({ context }) => context.close()))
  }

  /** The end of a test: nothing logged an error, and nothing else was contacted. */
  async finish(): Promise<void> {
    try {
      for (const { problems, external } of this.open) {
        expect(problems, 'the page logged errors').toEqual([])
        expect(external, 'the app reached a host it should not').toEqual([])
      }
      expect(this.server.strayHosts, 'another *.supabase.co host was contacted').toEqual([])
    } finally {
      await Promise.all(this.open.map(({ context }) => context.close()))
    }
  }
}

const test = base.extend<{ cloud: Cloud; keyKind: 'publishable' | 'anonJwt' }>({
  keyKind: ['publishable', { option: true }],
  cloud: async ({ browser, baseURL, keyKind }, use, testInfo) => {
    const cloud = new Cloud(browser, baseURL ?? 'http://localhost:4173', keyKind)
    let done = false
    try {
      await use(cloud)
      done = true
    } finally {
      // After a failed test the contexts are still closed; the assertions only run after a passing one.
      if (done) await cloud.finish()
      else await cloud.abandon(testInfo)
    }
  },
})

test.describe.configure({ timeout: 90_000 })

// ─── What the screen offers ─────────────────────────────────────────────────

const section = (page: Page): Locator => page.getByRole('region', { name: 'Sync', exact: true })
const toasts = (page: Page): Locator =>
  page.getByRole('region', { name: 'Notifications', exact: true })
const paletteInput = (page: Page): Locator =>
  page.getByRole('combobox', { name: 'Command palette' })
/** The status line of an enabled device: "Synced · just now". */
const statusLine = (page: Page): Locator =>
  section(page).getByRole('status').filter({ hasText: /\S/ })
const syncedLine = (page: Page): Locator =>
  section(page)
    .getByRole('status')
    .filter({ hasText: /^Synced/ })

/** Opens an app path (once, with a seed, on a device that has data of its own). */
async function open(device: Device, path: string, seed?: 'wgu' | 'empty'): Promise<void> {
  await gotoApp(device.page, path, seed)
}

/** "Set up sync" → the project's address and anon key → "Check connection" → the email step. */
async function saveProject(page: Page, key: string, url = FAKE_PROJECT_URL): Promise<void> {
  const box = section(page)
  await box.getByRole('button', { name: 'Set up sync' }).click()
  await box.getByLabel('Project URL').fill(url)
  await box.getByLabel('Anon (public) key', { exact: true }).fill(key)
  await box.getByRole('button', { name: 'Check connection' }).click()
  await expect(box.getByLabel('Email', { exact: true })).toBeVisible()
}

/** The email step: type the address and send the link. Waits for the "we sent it" step. */
async function requestEmail(page: Page, email: string): Promise<void> {
  const box = section(page)
  await box.getByLabel('Email', { exact: true }).fill(email)
  await box.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(box.getByText('We sent a sign-in link to')).toBeVisible()
}

/** Everything a person does to bring a device in: project, email, the code from the email. */
async function connect(
  device: Device,
  cloud: Cloud,
  options: { path?: string; seed?: 'wgu' | 'empty'; email?: string } = {},
): Promise<void> {
  const { page } = device
  const email = options.email ?? EMAIL
  await open(device, options.path ?? '/settings/sync', options.seed)
  await saveProject(page, cloud.server.anonKey)
  await requestEmail(page, email)
  const box = section(page)
  await box.getByLabel('Code from the email').fill(cloud.server.lastEmail(email).code)
  await box.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })
}

/** "Sync now" from the command palette (works on any page, and is what a keyboard user does). */
async function syncNow(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  await paletteInput(page).fill('Sync now')
  await page.getByRole('option', { name: /^Sync now/ }).click()
  await expect(paletteInput(page)).toHaveCount(0)
}

interface TaskRow {
  id: string
  title: string
  status: string
}
interface XpRow {
  id: string
  key: string
  amount: number
}

const tasksOf = (page: Page) => readTable<TaskRow>(page, 'tasks')
const taskOf = async (page: Page, id: string): Promise<TaskRow | undefined> =>
  (await tasksOf(page)).find((t) => t.id === id)

// ─── 1. Setting up ──────────────────────────────────────────────────────────

test.describe('setting up the project (1440)', () => {
  test('a wrong address or key is explained on the spot, and nothing is sent', async ({
    cloud,
  }) => {
    const device = await cloud.device()
    const { page } = device
    await open(device, '/settings/sync')
    await expect(section(page)).toContainText('Keep Forge the same on your laptop and phone')
    await section(page).getByRole('button', { name: 'Set up sync' }).click()
    const url = section(page).getByLabel('Project URL')
    const key = section(page).getByLabel('Anon (public) key', { exact: true })

    // A custom domain can never work (the app's security policy names *.supabase.co).
    await url.fill('https://sync.example.com')
    await url.blur()
    await expect(section(page)).toContainText(
      'Forge can only reach addresses ending in .supabase.co.',
    )
    await url.fill('http://forgetestforgetestfo.supabase.co')
    await url.blur()
    await expect(section(page)).toContainText('Supabase addresses start with https://.')
    await url.fill('forgetestforgetestfo.supabase.co/rest/v1/')
    await url.blur()
    await expect(section(page)).not.toContainText('Supabase addresses start with https://.')
    await expect(section(page)).not.toContainText('Forge can only reach addresses')

    // Keys that must never be put in an app are refused, and the message never repeats the key.
    const secret = fakeSecretKey()
    await key.fill(secret)
    await key.blur()
    await expect(section(page)).toContainText(
      'This is a secret key. It must never be put in an app. Use the anon (public) key from Project Settings → API.',
    )
    await expect(section(page)).not.toContainText(secret)
    await key.fill(fakeJwt('service_role'))
    await key.blur()
    await expect(section(page)).toContainText(
      'This is a secret key. It must never be put in an app.',
    )
    await key.fill(fakeJwt('anon', 'abcdefghijklmnopqrst'))
    await key.blur()
    await expect(section(page)).toContainText('This key belongs to another project.')
    await key.fill('not a key')
    await key.blur()
    await expect(section(page)).toContainText("That doesn't look like a Supabase key.")

    // "Check connection" with nothing usable does not ask the network either.
    await url.fill('')
    await key.fill('')
    // (Leave the field first: its error disappears on blur, which moves the button under the pointer.)
    await key.blur()
    await section(page).getByRole('button', { name: 'Check connection' }).click()
    await expect(section(page)).toContainText(/Enter your project.s address/)
    await expect(section(page)).toContainText('Paste the anon (public) key')
    expect(cloud.server.requests).toHaveLength(0)
    expect(await readTable(page, 'syncState')).toEqual([])
  })

  test('Check connection asks the project; only one that answers is saved', async ({ cloud }) => {
    const device = await cloud.device({
      ignoreConsoleErrors: ['Failed to load resource'],
    })
    const { page } = device
    const { server } = cloud
    await open(device, '/settings/sync')
    const box = section(page)
    await box.getByRole('button', { name: 'Set up sync' }).click()
    const check = box.getByRole('button', { name: 'Check connection' })
    const fill = async (url: string, key: string) => {
      await box.getByLabel('Project URL').fill(url)
      await box.getByLabel('Anon (public) key', { exact: true }).fill(key)
    }

    // A key this project did not issue.
    await fill(FAKE_PROJECT_URL, ['sb', 'publishable', 'OTHERprojectkey0123456789'].join('_'))
    await check.click()
    await expect(box).toContainText("Supabase didn't accept this key.")
    expect(await readTable(page, 'syncState')).toEqual([])

    // A project with email sign-in switched off.
    server.emailEnabled = false
    await fill(FAKE_PROJECT_URL, server.anonKey)
    await check.click()
    await expect(box).toContainText('Email sign-in is switched off in this project.')
    expect(await readTable(page, 'syncState')).toEqual([])
    server.emailEnabled = true

    // An address that is a valid project URL but not one that answers.
    await fill('https://abcdefghijklmnopqrst.supabase.co', server.anonKey)
    await check.click()
    await expect(box).toContainText("Can't reach Supabase. Check your internet connection")
    expect(server.strayHosts).toEqual(['abcdefghijklmnopqrst.supabase.co'])
    server.strayHosts.length = 0
    expect(await readTable(page, 'syncState')).toEqual([])

    // The right one: saved on this device, and the email step follows.
    await fill(FAKE_PROJECT_URL, server.anonKey)
    await check.click()
    await expect(toasts(page)).toContainText('Connected to your project')
    await expect(box.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(box).toContainText(`${FAKE_PROJECT_REF}.supabase.co`)
    const [saved] = await readTable<{ url: string; anonKey: string; enabled: boolean }>(
      page,
      'syncState',
    )
    expect(saved).toMatchObject({ url: FAKE_PROJECT_URL, anonKey: server.anonKey, enabled: false })

    // Sync is still off: the project check is the only thing that was asked.
    expect(server.requests.every((r) => r.path === '/auth/v1/settings')).toBe(true)
    await page.reload()
    await expect(section(page)).toContainText(`${FAKE_PROJECT_REF}.supabase.co`)
  })
})

// ─── 2. Signing in ──────────────────────────────────────────────────────────

test.describe('signing in (1440)', () => {
  test('the 6-digit code signs in, and the first sync runs', async ({ cloud }) => {
    // The wrong code below is refused with a 403, which the browser logs.
    const device = await cloud.device({ ignoreConsoleErrors: ['status of 403'] })
    const { page } = device
    const { server } = cloud
    await open(device, '/settings/sync', 'wgu')
    await saveProject(page, server.anonKey)
    const box = section(page)

    // Anything that is not an address is refused under the field; nothing is sent.
    await box.getByLabel('Email', { exact: true }).fill('ana at example')
    await box.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(box).toContainText('Enter the email address you sign in with.')
    expect(server.calls('/auth/v1/otp')).toHaveLength(0)

    await requestEmail(page, EMAIL)
    // The request is a PKCE one: a challenge (never the verifier), the redirect back to Settings → Sync.
    const [otp] = server.calls('/auth/v1/otp', 'POST')
    expect(otp?.body).toMatchObject({
      email: EMAIL,
      create_user: true,
      data: {},
      code_challenge_method: 's256',
    })
    expect((otp?.body as { code_challenge: string }).code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(otp?.query.get('redirect_to')).toBe(`${new URL(page.url()).origin}/settings/sync`)
    expect(otp?.headers.apikey).toBe(server.anonKey)
    // A publishable key is the apikey only, never a bearer.
    expect(otp?.headers.authorization).toBeUndefined()
    await expect(box).toContainText(`We sent a sign-in link to ${EMAIL}.`)
    await expect(box.getByRole('button', { name: /^Send again/ })).toBeDisabled()

    // A wrong code is explained; the right one signs in.
    const code = box.getByLabel('Code from the email')
    await code.fill('12')
    await box.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(box).toContainText('Type the code from the email: 6 to 10 digits.')
    await code.fill('000000')
    await box.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(box).toContainText('That code or link has expired or was already used.')
    // Spaces from a mail app are fine.
    const digits = server.lastEmail(EMAIL).code
    await code.fill(`${digits.slice(0, 3)} ${digits.slice(3)}`)
    await box.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })

    await expect(box).toContainText(EMAIL)
    await expect(box.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expect(box.getByRole('button', { name: 'Sign out and stop syncing' })).toBeVisible()
    // What the device holds is on the server: the seeded tasks, the goal, the settings.
    const rows = server.rows(EMAIL)
    expect(rows.filter((r) => r.tbl === 'tasks').length).toBeGreaterThan(20)
    expect(server.data(EMAIL, 'tasks', MENTOR_ID)).toMatchObject({ title: MENTOR })
    expect(server.data(EMAIL, 'goals', 'goal-wgu-bscs')).not.toBeNull()
    expect(server.row(EMAIL, 'settings', 'app')).toBeDefined()
    // The project is asked for its clock once, and the data calls carry the session, not the key.
    expect(server.calls('/rest/v1/rpc/forge_now')).toHaveLength(1)
    for (const call of server.restCalls) {
      expect(call.headers.authorization).toMatch(/^Bearer fake-access-\d+$/)
      expect(call.headers.apikey).toBe(server.anonKey)
    }
    // Never a token on screen or in the address.
    const access = /^Bearer (.+)$/.exec(server.restCalls[0]?.headers.authorization ?? '')?.[1] ?? ''
    expect(access).not.toBe('')
    await expect(page.locator('body')).not.toContainText(access)
    expect(page.url()).not.toContain(access)
    // The pending sign-in (and its PKCE verifier) is gone once it is used.
    const [state] = await readTable<{ pendingLogin: unknown; enabled: boolean; phase: string }>(
      page,
      'syncState',
    )
    expect(state).toMatchObject({ pendingLogin: null, enabled: true, phase: 'steady' })
  })

  test('the link from the email signs in and the address loses ?code', async ({ cloud }) => {
    const device = await cloud.device()
    const { page } = device
    const { server } = cloud
    await open(device, '/settings/sync')
    await saveProject(page, server.anonKey)
    await requestEmail(page, EMAIL)
    const mail = server.lastEmail(EMAIL)
    // What Supabase sends back to `redirect_to`.
    await page.goto(`${new URL(mail.redirectTo).pathname}?code=${mail.authCode}`)
    await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).pathname).toBe('/settings/sync')
    const [exchange] = server.calls('/auth/v1/token', 'POST')
    expect(exchange?.query.get('grant_type')).toBe('pkce')
    expect(exchange?.body).toMatchObject({ auth_code: mail.authCode })
    // The verifier the exchange sent hashes to the challenge the email request sent (the fake checks it).
    expect((exchange?.body as { code_verifier: string }).code_verifier).toMatch(
      /^[A-Za-z0-9_-]{64}$/,
    )
  })

  test('a link that cannot work says what to do instead', async ({ cloud }) => {
    const device = await cloud.device()
    const other = await cloud.device()
    const { page } = device
    const { server } = cloud

    // Expired or used: GoTrue sends ?error=… back.
    await open(device, '/settings/sync?error=access_denied&error_code=otp_expired')
    await expect(section(page)).toContainText(
      'That link has expired or was already used. Send a new one.',
    )
    expect(new URL(page.url()).search).toBe('')

    // Opened in a browser that never asked for one (no PKCE verifier there).
    await open(device, '/settings/sync')
    await saveProject(page, server.anonKey)
    await requestEmail(page, EMAIL)
    const mail = server.lastEmail(EMAIL)
    await open(other, `/settings/sync?code=${mail.authCode}`)
    await expect(section(other.page)).toContainText(
      'This link was opened in a different browser than the one that asked for it. Type the code from the email instead',
    )
    expect(server.calls('/auth/v1/token')).toHaveLength(0)
    await expect(section(other.page).getByRole('button', { name: 'Set up sync' })).toBeVisible()
  })

  test('the email limit and a closed project are explained calmly', async ({ cloud }) => {
    const device = await cloud.device({ ignoreConsoleErrors: ['Failed to load resource'] })
    const { page } = device
    const { server } = cloud
    await open(device, '/settings/sync')
    await saveProject(page, server.anonKey)
    const box = section(page)

    server.emailRateLimited = true
    await box.getByLabel('Email', { exact: true }).fill(EMAIL)
    await box.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(box).toContainText('Supabase limits how many sign-in emails it sends.')
    await expect(box.getByLabel('Email', { exact: true })).toHaveValue(EMAIL)
    server.emailRateLimited = false

    // "Allow new users to sign up" is off and this address has no account.
    server.signupsOpen = false
    await box.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(box).toContainText("This project isn't accepting new accounts")
    server.signupsOpen = true

    await requestEmail(page, EMAIL)
    // "Use another email" goes back a step, and the project stays.
    await box.getByRole('button', { name: 'Use another email' }).click()
    await expect(box.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(box).toContainText(`${FAKE_PROJECT_REF}.supabase.co`)
  })

  test.describe('with a legacy anon key', () => {
    test.use({ keyKind: 'anonJwt' })

    test('the key doubles as the bearer before sign-in, never after', async ({ cloud }) => {
      const device = await cloud.device()
      const { server } = cloud
      await connect(device, cloud, { seed: 'wgu' })
      const before = server.calls('/auth/v1/otp')[0]
      expect(before?.headers.authorization).toBe(`Bearer ${server.anonKey}`)
      for (const call of server.restCalls) {
        expect(call.headers.authorization).toMatch(/^Bearer fake-access-\d+$/)
      }
      expect(server.data(EMAIL, 'tasks', MENTOR_ID)).not.toBeNull()
    })
  })
})

// ─── 3. The first sync ──────────────────────────────────────────────────────

test.describe('the first sync (1440)', () => {
  test('a device with data takes a "Before sync" snapshot first and keeps everything', async ({
    cloud,
  }) => {
    const device = await cloud.device()
    const { page } = device
    const { server } = cloud
    await open(device, '/settings/snapshots', 'wgu')
    const before = await tasksOf(page)
    expect(before.length).toBeGreaterThan(20)
    await connect(device, cloud, { path: '/settings/sync' })

    // The snapshot is in Settings → Snapshots, taken before anything was merged.
    await page.goto('/settings/snapshots')
    const snapshots = page.getByRole('region', { name: 'Snapshots', exact: true })
    const list = snapshots.getByRole('list', { name: 'Snapshots' })
    const item = list.getByRole('listitem').filter({ hasText: 'Before sync' })
    await expect(item).toHaveCount(1)
    await expect(item).toContainText(/\d+ tasks?/)
    // Nothing was lost locally, and all of it is in the cloud.
    expect((await tasksOf(page)).map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort())
    const remote = server.rows(EMAIL).filter((r) => r.tbl === 'tasks' && !r.deleted)
    expect(remote.map((r) => r.id).sort()).toEqual(before.map((t) => t.id).sort())
  })

  test('a new device gets the account’s data, and its Today shows it', async ({ cloud }) => {
    const first = await cloud.device()
    await connect(first, cloud, { seed: 'wgu' })
    const second = await cloud.device()
    await connect(second, cloud)

    await open(second, '/')
    await expect(second.page.getByText(MENTOR).first()).toBeVisible({ timeout: SYNC_WAIT })
    const mine = (await tasksOf(first.page)).map((t) => t.id).sort()
    await expect
      .poll(async () => (await tasksOf(second.page)).map((t) => t.id).sort())
      .toEqual(mine)
    // The account's settings came along: this device does not greet a returning person with the tour.
    await expect(second.page).not.toHaveURL(/\/welcome/)
    // An empty device had nothing to protect, so it took no snapshot.
    await second.page.goto('/settings/snapshots')
    await expect(
      second.page.getByRole('region', { name: 'Snapshots', exact: true }),
    ).not.toContainText('Before sync')
  })
})

// ─── 4. Two devices ─────────────────────────────────────────────────────────

test.describe('two devices (1440)', () => {
  test('finishing a task on one shows it done on the other, with the XP once', async ({
    cloud,
  }) => {
    const laptop = await cloud.device()
    const phone = await cloud.device()
    const { server } = cloud
    await connect(laptop, cloud, { seed: 'wgu' })
    await connect(phone, cloud)
    await open(phone, '/tasks/inbox')
    await expect(phone.page.getByText(MENTOR).first()).toBeVisible({ timeout: SYNC_WAIT })

    // The laptop finishes the task on Today, then syncs.
    await open(laptop, '/')
    await laptop.page.getByRole('checkbox', { name: `Done: ${MENTOR}` }).click()
    await expect(toasts(laptop.page)).toContainText(`Completed “${MENTOR}”`)
    await syncNow(laptop.page)
    await expect.poll(() => server.data(EMAIL, 'tasks', MENTOR_ID)?.status).toBe('done')
    // The XP for it is written a moment after the task: wait until that has reached the cloud too.
    const xpKey = `task:${MENTOR_ID}`
    const xpInCloud = () =>
      server
        .rows(EMAIL)
        .filter((r) => r.tbl === 'xpEvents' && (r.data as XpRow | null)?.key === xpKey)
    await expect.poll(() => xpInCloud().length, { timeout: SYNC_WAIT }).toBe(1)

    // The phone pulls it: done there too, and it did not announce or pay anything for it.
    await syncNow(phone.page)
    await expect.poll(async () => (await taskOf(phone.page, MENTOR_ID))?.status).toBe('done')
    const laptopXp = (await readTable<XpRow>(laptop.page, 'xpEvents')).filter(
      (e) => e.key === xpKey,
    )
    await expect
      .poll(async () =>
        (await readTable<XpRow>(phone.page, 'xpEvents')).filter((e) => e.key === xpKey),
      )
      .toEqual(laptopXp)
    expect(laptopXp).toHaveLength(1)
    await expect(toasts(phone.page).locator('[data-variant]')).toHaveCount(0)
    // Both devices hold the same XP log, which is the server's.
    const ids = async (d: Device) =>
      (await readTable<XpRow>(d.page, 'xpEvents')).map((e) => e.id).sort()
    expect(await ids(phone)).toEqual(await ids(laptop))
    expect(
      server
        .rows(EMAIL)
        .filter((r) => r.tbl === 'xpEvents' && !r.deleted)
        .map((r) => r.id)
        .sort(),
    ).toEqual(await ids(laptop))
  })

  test('a title changed on the phone reaches the laptop', async ({ cloud }) => {
    const laptop = await cloud.device()
    const phone = await cloud.device()
    const { server } = cloud
    await connect(laptop, cloud, { seed: 'wgu' })
    await connect(phone, cloud)
    await open(laptop, '/tasks/inbox')
    await open(phone, '/tasks/inbox')

    const row = phone.page.getByRole('main').getByRole('listitem').filter({ hasText: LIBRARY })
    await row.getByRole('button', { name: /\. Edit task title$/ }).click()
    await phone.page.keyboard.press('ControlOrMeta+a')
    await phone.page.keyboard.type('Renew library card at the Portland branch')
    await phone.page.keyboard.press('Enter')
    await syncNow(phone.page)
    await expect
      .poll(() => server.data(EMAIL, 'tasks', LIBRARY_ID)?.title)
      .toBe('Renew library card at the Portland branch')
    await syncNow(laptop.page)
    await expect(
      laptop.page.getByRole('main').getByRole('listitem').filter({ hasText: 'Portland branch' }),
    ).toHaveCount(1, { timeout: SYNC_WAIT })
    expect((await taskOf(laptop.page, LIBRARY_ID))?.title).toBe(
      'Renew library card at the Portland branch',
    )
  })

  test('a deleted task leaves the other device too, and restoring it brings it back', async ({
    cloud,
  }) => {
    const laptop = await cloud.device()
    const phone = await cloud.device()
    const { server } = cloud
    await connect(laptop, cloud, { seed: 'wgu' })
    await connect(phone, cloud)
    await open(phone, '/tasks/inbox')
    await expect(phone.page.getByText(LIBRARY).first()).toBeVisible({ timeout: SYNC_WAIT })

    // The laptop moves it to the Trash.
    await open(laptop, `/task/${LIBRARY_ID}`)
    await laptop.page.getByRole('button', { name: 'Move to trash' }).click()
    await expect(toasts(laptop.page)).toContainText('to the trash')
    await syncNow(laptop.page)
    await expect.poll(() => server.row(EMAIL, 'tasks', LIBRARY_ID)?.deleted).toBe(true)
    expect(server.row(EMAIL, 'tasks', LIBRARY_ID)?.data).toBeNull()

    // The phone: gone from its list, present in its Trash.
    await syncNow(phone.page)
    await expect.poll(async () => taskOf(phone.page, LIBRARY_ID)).toBeUndefined()
    await expect(phone.page.getByText(LIBRARY)).toHaveCount(0)
    await phone.page.goto('/trash')
    const restore = phone.page.getByRole('button', { name: `Restore “${LIBRARY}”` })
    await expect(restore).toBeVisible({ timeout: SYNC_WAIT })

    // Restoring on the phone brings it back to the laptop.
    await restore.click()
    await expect(toasts(phone.page)).toContainText(`Restored “${LIBRARY}”`)
    await syncNow(phone.page)
    await expect.poll(() => server.row(EMAIL, 'tasks', LIBRARY_ID)?.deleted).toBe(false)
    await syncNow(laptop.page)
    await expect.poll(async () => (await taskOf(laptop.page, LIBRARY_ID))?.title).toBe(LIBRARY)
  })

  test('both edit the same task while apart: the later change wins on both', async ({ cloud }) => {
    const apart = { ignoreConsoleErrors: [REFUSED] }
    const laptop = await cloud.device(apart)
    // The phone's clock runs a minute ahead, so its edit is the later one whichever syncs first.
    const phone = await cloud.device({ ...apart, clockOffsetMs: 60_000 })
    const { server } = cloud
    await connect(laptop, cloud, { seed: 'wgu' })
    await connect(phone, cloud)
    await open(laptop, '/tasks/inbox')
    await open(phone, '/tasks/inbox')
    await expect(phone.page.getByText(LIBRARY).first()).toBeVisible({ timeout: SYNC_WAIT })

    const rename = async (d: Device, title: string) => {
      const row = d.page.getByRole('main').getByRole('listitem').filter({ hasText: LIBRARY })
      await row.getByRole('button', { name: /\. Edit task title$/ }).click()
      await d.page.keyboard.press('ControlOrMeta+a')
      await d.page.keyboard.type(title)
      await d.page.keyboard.press('Enter')
      await expect(d.page.getByRole('textbox', { name: 'Task title' })).toHaveCount(0)
      await expect.poll(async () => (await taskOf(d.page, LIBRARY_ID))?.title).toBe(title)
    }
    await laptop.setOffline(true)
    await phone.setOffline(true)
    await rename(laptop, 'Renew library card (laptop)')
    await rename(phone, 'Renew library card (phone)')

    // The laptop reconnects first, so the server briefly holds the earlier edit.
    await laptop.setOffline(false)
    await syncNow(laptop.page)
    await expect
      .poll(() => server.data(EMAIL, 'tasks', LIBRARY_ID)?.title)
      .toBe('Renew library card (laptop)')
    await phone.setOffline(false)
    await syncNow(phone.page)
    await expect
      .poll(() => server.data(EMAIL, 'tasks', LIBRARY_ID)?.title)
      .toBe('Renew library card (phone)')
    await syncNow(laptop.page)
    await expect
      .poll(async () => (await taskOf(laptop.page, LIBRARY_ID))?.title)
      .toBe('Renew library card (phone)')
    expect((await taskOf(phone.page, LIBRARY_ID))?.title).toBe('Renew library card (phone)')
  })
})

// ─── 5. Offline, a paused project, an expired sign-in ───────────────────────

/** A link of the main navigation (the sidebar), so the page changes without a reload. */
const navLink = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

test.describe('when it cannot sync (1440)', () => {
  test('offline keeps the edit on the device, and going back online sends it', async ({
    cloud,
  }) => {
    const device = await cloud.device({ ignoreConsoleErrors: [REFUSED] })
    const { page } = device
    const { server } = cloud
    await connect(device, cloud, { seed: 'wgu' })
    await open(device, '/tasks/inbox')
    await expect(page.getByText(LIBRARY).first()).toBeVisible()

    await device.setOffline(true)
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: LIBRARY })
    await row.getByRole('button', { name: /\. Edit task title$/ }).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renew library card before Friday')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await taskOf(page, LIBRARY_ID))?.title)
      .toBe('Renew library card before Friday')
    await navLink(page, 'Settings').click()

    // The status says so, calmly, the edit waits in the outbox, and the cloud still has the old title.
    await expect(statusLine(page)).toHaveText(
      "Offline. Changes will sync when you're back online.",
      {
        timeout: SYNC_WAIT,
      },
    )
    expect((await readTable(page, 'syncOutbox')).length).toBeGreaterThan(0)
    expect(server.data(EMAIL, 'tasks', LIBRARY_ID)?.title).toBe(LIBRARY)

    // The browser says it is back: the engine does not wait out its backoff.
    await device.setOffline(false)
    await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })
    await expect
      .poll(() => server.data(EMAIL, 'tasks', LIBRARY_ID)?.title)
      .toBe('Renew library card before Friday')
    expect(await readTable(page, 'syncOutbox')).toEqual([])
  })

  test('a project that keeps answering with a server error is called paused, calmly', async ({
    cloud,
  }) => {
    const device = await cloud.device({ ignoreConsoleErrors: ['status of 540'] })
    const { page } = device
    const { server } = cloud
    await connect(device, cloud, { seed: 'wgu' })
    const rows = server.rows(EMAIL).length

    // A free project that was paused answers 540 to everything. One answer is not proof of that; it takes
    // a few cycles in a row, and each `online` event (what a person coming back to the tab causes too)
    // starts the next one without waiting out the backoff.
    server.restStatus = 540
    const paused = statusLine(page).filter({ hasText: 'Your Supabase project may be paused.' })
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await expect(paused).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: SYNC_WAIT })
    await expect(paused).toHaveText(
      'Your Supabase project may be paused. Free projects pause after a week without use; restore it from the Supabase dashboard.',
    )
    // It says what to do, not what went wrong; nothing is lost, and "Sync now" is the way back.
    await expect(statusLine(page)).not.toContainText(/error|failed|lost|wrong|problem/i)
    await expect(section(page).getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expect(
      section(page).getByRole('button', { name: 'Sign out and stop syncing' }),
    ).toBeVisible()
    expect(server.rows(EMAIL)).toHaveLength(rows)

    // The project is restored from the dashboard: one press and it is synced again.
    server.restStatus = null
    await section(page).getByRole('button', { name: 'Sync now' }).click()
    await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })
    await expect(section(page)).not.toContainText('may be paused')
  })

  test('an expired sign-in asks to sign in again, keeps the edits, and sends them afterwards', async ({
    cloud,
  }) => {
    const device = await cloud.device({ ignoreConsoleErrors: ['Failed to load resource'] })
    const { page } = device
    const { server } = cloud
    await connect(device, cloud, { seed: 'wgu' })
    const first = (await readTable<{ deviceId: string }>(page, 'syncState'))[0]?.deviceId

    // The session is gone on the server (revoked, or a refresh token used twice).
    server.revokeSessions()
    await syncNow(page)
    await expect(statusLine(page)).toHaveText(
      'Sign in again to keep syncing. Your changes are kept on this device.',
      { timeout: SYNC_WAIT },
    )
    await expect(section(page).getByLabel('Email', { exact: true })).toHaveValue(EMAIL)
    await expect(section(page).getByRole('button', { name: 'Sync now' })).toHaveCount(0)
    // Nothing on the device was touched.
    expect((await tasksOf(page)).length).toBeGreaterThan(20)

    // An edit made while signed out is queued, not lost.
    await open(device, '/tasks/inbox')
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: LIBRARY })
    await row.getByRole('button', { name: /\. Edit task title$/ }).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renew library card by mail')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readTable(page, 'syncOutbox')).length).toBeGreaterThan(0)

    // Signing in again is not a new first sync: same device, same account, and the edit goes up.
    await open(device, '/settings/sync')
    await requestEmail(page, EMAIL)
    await section(page).getByLabel('Code from the email').fill(server.lastEmail(EMAIL).code)
    await section(page).getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(syncedLine(page)).toBeVisible({ timeout: SYNC_WAIT })
    await expect
      .poll(() => server.data(EMAIL, 'tasks', LIBRARY_ID)?.title)
      .toBe('Renew library card by mail')
    expect((await readTable<{ deviceId: string }>(page, 'syncState'))[0]?.deviceId).toBe(first)
    expect(await readTable(page, 'syncOutbox')).toEqual([])
  })
})

// ─── 6. Turning it off, and the dialogs that care ───────────────────────────

const SPREADS = 'Sync is on: this also replaces the data on your other devices.'
const RESET_NOTE =
  'Sync will be turned off on this device. Your other devices and the cloud copy keep their data.'

test.describe('turning sync off (1440)', () => {
  test('signing out keeps every row on the device and in the cloud, and stops tracking', async ({
    cloud,
  }) => {
    const device = await cloud.device()
    const { page } = device
    const { server } = cloud
    await connect(device, cloud, { seed: 'wgu' })
    const ids = (await tasksOf(page)).map((t) => t.id).sort()
    const inCloud = server.rows(EMAIL).length
    const box = section(page)

    // The confirmation says what stays, starts on Cancel, and Esc leaves sync on.
    await box.getByRole('button', { name: 'Sign out and stop syncing' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign out and stop syncing?' })
    await expect(dialog).toContainText(
      'Forge stops syncing on this device. Everything stays on this device, and your cloud copy stays in your Supabase project.',
    )
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(syncedLine(page)).toBeVisible()

    await box.getByRole('button', { name: 'Sign out and stop syncing' }).click()
    await dialog.getByRole('button', { name: 'Stop syncing' }).click()
    await expect(toasts(page)).toContainText('Sync is off on this device')
    await expect(box.getByRole('button', { name: 'Send sign-in link' })).toBeVisible()
    // The project and the address stay, so signing in again is one step.
    await expect(box.getByLabel('Email', { exact: true })).toHaveValue(EMAIL)
    await expect(box).toContainText(`${FAKE_PROJECT_REF}.supabase.co`)

    // The session ends on the server (this device only), and nothing local or remote changed.
    await expect.poll(() => server.calls('/auth/v1/logout', 'POST')).toHaveLength(1)
    expect(server.calls('/auth/v1/logout')[0]?.query.get('scope')).toBe('local')
    expect((await tasksOf(page)).map((t) => t.id).sort()).toEqual(ids)
    expect(server.rows(EMAIL)).toHaveLength(inCloud)
    const [state] = await readTable<{
      enabled: boolean
      session: unknown
      phase: string
      url: string
      anonKey: string
    }>(page, 'syncState')
    expect(state).toMatchObject({
      enabled: false,
      session: null,
      phase: 'off',
      url: FAKE_PROJECT_URL,
      anonKey: server.anonKey,
    })
    expect(await readTable(page, 'syncOutbox')).toEqual([])

    // An edit from now on is not tracked, so nothing is queued to go anywhere.
    await open(device, '/tasks/inbox')
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: LIBRARY })
    await row.getByRole('button', { name: /\. Edit task title$/ }).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renew library card for next year')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await taskOf(page, LIBRARY_ID))?.title)
      .toBe('Renew library card for next year')
    expect(await readTable(page, 'syncOutbox')).toEqual([])
    expect(server.data(EMAIL, 'tasks', LIBRARY_ID)?.title).toBe(LIBRARY)
  })

  test('import, restore and reset say what they do to the other devices while sync is on', async ({
    cloud,
  }, testInfo) => {
    const device = await cloud.device()
    const { page } = device
    await connect(device, cloud, { seed: 'wgu', path: '/settings/snapshots' })

    // Restoring a snapshot.
    const snapshots = page.getByRole('region', { name: 'Snapshots', exact: true })
    await snapshots.getByRole('button', { name: 'Take snapshot now' }).click()
    await expect(toasts(page)).toContainText('Snapshot saved')
    await snapshots
      .getByRole('button', { name: /^Restore the snapshot from/ })
      .first()
      .click()
    const restore = page.getByRole('dialog', { name: 'Restore this snapshot?' })
    await expect(restore).toContainText(SPREADS)
    await restore.getByRole('button', { name: 'Cancel' }).click()
    await expect(restore).toBeHidden()

    // Importing a backup.
    await page.goto('/settings/data')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON' }).click(),
    ])
    const backup = testInfo.outputPath('forge-backup.json')
    await download.saveAs(backup)
    await page.locator('input[type="file"]').setInputFiles(backup)
    const preview = page.getByRole('dialog', { name: 'Import this backup?' })
    await expect(preview).toContainText(SPREADS)
    await preview.getByRole('button', { name: 'Cancel' }).click()
    await expect(preview).toBeHidden()

    // Resetting this device: it turns sync off here and leaves the others alone.
    await page.getByRole('button', { name: 'Reset…' }).click()
    const reset = page.getByRole('dialog', { name: 'Reset Forge?' })
    await expect(reset).toContainText(RESET_NOTE)
    await reset.getByRole('button', { name: 'Cancel' }).click()
    await expect(reset).toBeHidden()

    // With sync off the same dialogs do not mention it.
    await page.goto('/settings/sync')
    await section(page).getByRole('button', { name: 'Sign out and stop syncing' }).click()
    await page
      .getByRole('dialog', { name: 'Sign out and stop syncing?' })
      .getByRole('button', { name: 'Stop syncing' })
      .click()
    await expect(toasts(page)).toContainText('Sync is off on this device')
    await page.goto('/settings/data')
    await page.locator('input[type="file"]').setInputFiles(backup)
    const plain = page.getByRole('dialog', { name: 'Import this backup?' })
    await expect(plain).toBeVisible()
    await expect(plain).not.toContainText('Sync is on')
    await plain.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Reset…' }).click()
    await expect(page.getByRole('dialog', { name: 'Reset Forge?' })).not.toContainText(
      'Sync will be turned off',
    )
  })

  test('resetting a device that syncs leaves the cloud copy as it was', async ({ cloud }) => {
    const device = await cloud.device()
    const { page } = device
    const { server } = cloud
    await connect(device, cloud, { seed: 'wgu', path: '/settings/data' })
    const inCloud = server.rows(EMAIL)
    expect(inCloud.length).toBeGreaterThan(20)

    await page.getByRole('button', { name: 'Reset…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset Forge?' })
    await dialog.getByLabel(/Type “reset forge”/).fill('reset forge')
    await dialog.getByRole('button', { name: 'Reset everything' }).click()
    await expect(page).toHaveURL(/\/welcome$/)

    // This device is empty and no longer syncs; the cloud still has everything.
    expect(await readTable(page, 'tasks')).toEqual([])
    expect(await readTable(page, 'syncState')).toEqual([])
    expect(await readTable(page, 'syncOutbox')).toEqual([])
    expect(server.rows(EMAIL)).toEqual(inCloud)
  })
})

// ─── 7. Smaller things ──────────────────────────────────────────────────────

test.describe('around the section (1440)', () => {
  test('the palette offers Sync settings always and Sync now only while sync is on', async ({
    cloud,
  }) => {
    const device = await cloud.device()
    const { page } = device
    await open(device, '/')
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('sync')
    await expect(page.getByRole('option', { name: /^Sync settings/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /^Sync now/ })).toHaveCount(0)
    await page.getByRole('option', { name: /^Sync settings/ }).click()
    await expect(page).toHaveURL(/\/settings\/sync$/)
    await expect(section(page).getByRole('button', { name: 'Set up sync' })).toBeVisible()

    await connect(device, cloud)
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('sync')
    await expect(page.getByRole('option', { name: /^Sync now/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /^Sync settings/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(paletteInput(page)).toHaveCount(0)
  })

  test('"What sync can’t do" is on the page, closed until asked for', async ({ cloud }) => {
    const device = await cloud.device()
    const { page } = device
    await open(device, '/settings/sync')
    const limits = section(page).locator('details').filter({ hasText: 'What sync can’t do' })
    await expect(limits).toHaveCount(1)
    await expect(limits).not.toHaveAttribute('open', '')
    await limits.getByText('What sync can’t do').click()
    await expect(limits).toContainText('One item, one winner.')
    await expect(limits).toContainText('PDFs stay on the device they were added on.')
  })

  test('a device whose clock is off is told so, plainly', async ({ cloud }) => {
    const device = await cloud.device()
    const { page } = device
    // The project's clock is seven minutes ahead of this device's.
    cloud.server.clockOffsetMs = 7 * 60_000
    await connect(device, cloud, { seed: 'wgu' })
    await expect(section(page)).toContainText(
      "This device's clock is 7 minutes behind. Sync keeps the newest change by time, so set the clock to update automatically.",
    )
  })

  test('"Copy setup SQL" puts the README’s SQL on the clipboard', async ({ cloud, baseURL }) => {
    const device = await cloud.device()
    const { page } = device
    await device.context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: baseURL ?? 'http://localhost:4173',
    })
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8')
    const afterHeading = readme.slice(readme.indexOf('### Set up sync'))
    const block = /```sql\n([\s\S]*?)```/.exec(afterHeading)?.[1]
    expect(block, 'the README has no setup SQL').toContain('create table if not exists')

    await open(device, '/settings/sync')
    await section(page).getByRole('button', { name: 'Set up sync' }).click()
    await section(page).getByRole('button', { name: 'Copy setup SQL' }).click()
    await expect(toasts(page)).toContainText('Copied the setup SQL')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(block)
    // Nothing was sent to anyone to do it.
    expect(cloud.server.requests).toHaveLength(0)
  })
})
