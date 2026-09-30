import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { APP_URL, DEFAULT_EXTENSION_ID } from '../extension/src/shared/config'
import type { BlockerConfig, SessionState } from '../extension/src/shared/protocol'
import { UNLOCK_PHRASE } from '../extension/src/shared/unlock'

/**
 * Loads the built extension (extension/dist) into Chromium and drives it for real: the redirect,
 * the blocked page, the popup, the app messaging and the emergency unlock. Nothing touches the
 * network: DNR redirects happen before it, and pages the extension lets through are stubbed.
 *
 * Extensions only load in Chromium's new headless mode (`channel: 'chromium'`), not in the old
 * headless shell. If this environment cannot load one, every test here skips with the reason.
 *
 * Playwright's clock belongs to the whole browser context, so the tests that move time run in their
 * own browser (the second describe) and cannot skew the others. Every browser starts from a fresh
 * `build-extension.mjs` run, which rewrites extension/dist, so the file runs in one worker, in order,
 * even under `fullyParallel`.
 */
test.describe.configure({ mode: 'serial' })

const root = path.resolve(import.meta.dirname, '..')
const extPath = path.join(root, 'extension', 'dist')
const shots = path.join(root, 'screenshots', 'ext')

/** The chrome.* surface these tests call from inside pages. */
interface ChromeLike {
  runtime: {
    sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void
  }
  storage: {
    local: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>
      clear(): Promise<void>
    }
  }
  declarativeNetRequest: { getDynamicRules(): Promise<{ id: number }[]> }
  tabs: object
}
declare const chrome: ChromeLike

const DEFAULT_BLOCKLIST = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'facebook.com',
  'snapchat.com',
  'netflix.com',
  'twitch.tv',
  'pinterest.com',
]

const BASE_CONFIG: BlockerConfig = {
  mode: 'always',
  blocklist: DEFAULT_BLOCKLIST,
  allowlist: [],
  schedule: [],
  motivation: ['One focused hour beats a distracted evening.'],
}

/** A tiny "app" on http://localhost:<port>: a page that may message the extension, and a page that frames blocked.html. */
function startServer(extId: string): Promise<Server> {
  const instance = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    if (request.url === '/frame') {
      response.end(
        `<!doctype html><title>Framing page</title><iframe title="framed" src="chrome-extension://${extId}/blocked.html?site=instagram.com#https://www.instagram.com/"></iframe>`,
      )
    } else {
      response.end(
        '<!doctype html><title>Forge app stand-in</title><p>C182 reading list</p><a href="https://www.instagram.com/p/C182?x=1&y=2#frag">instagram link</a> <a href="https://www.instagram.com/" target="_blank" rel="noopener">instagram in a new tab</a>',
      )
    }
  })
  return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)))
}

/** One Chromium with the extension loaded, the stand-in app, and helpers to talk to both. */
interface Harness {
  context: BrowserContext
  extId: string
  port: number
  /** A page on http://localhost that messages the extension the way the Forge app does. */
  app: Page
  sync(config: Partial<BlockerConfig>): Promise<unknown>
  session(value: SessionState | null): Promise<unknown>
  appMessage(message: unknown): Promise<unknown>
  /** Reads `chrome.storage.local` through an extension page. */
  stored(key: string): Promise<unknown>
  ruleCount(): Promise<number>
  reset(): Promise<void>
  close(): Promise<void>
}

async function startHarness(): Promise<Harness> {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.mjs')], {
    cwd: root,
    stdio: 'pipe',
  })
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'forge-ext-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  })
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  const extId = new URL(worker.url()).host

  const server = await startServer(extId)
  const port = (server.address() as AddressInfo).port

  // Pages the extension lets through must not need the network.
  await context.route(/^https:\/\/([^/]+\.)?(instagram|youtube)\.com\//, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Stub: the real site</title>',
    }),
  )

  const control = await context.newPage()
  await control.goto(`chrome-extension://${extId}/popup.html`)
  const app = await context.newPage()
  await app.goto(`http://localhost:${port}/`)

  const appMessage = (message: unknown): Promise<unknown> =>
    app.evaluate(
      ([id, msg]) =>
        new Promise<unknown>((resolve) => {
          chrome.runtime.sendMessage(id, msg, resolve)
        }),
      [extId, message] as [string, unknown],
    )
  const harness: Harness = {
    context,
    extId,
    port,
    app,
    appMessage,
    sync: (config) => appMessage({ v: 1, type: 'sync', config: { ...BASE_CONFIG, ...config } }),
    session: (value) => appMessage({ v: 1, type: 'session', session: value }),
    stored: (key) => control.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key),
    ruleCount: () =>
      control.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length),
    // A clean slate: default config, no session, no unlocks, no events.
    reset: async () => {
      await control.evaluate(() => chrome.storage.local.clear())
      await harness.sync({})
      await harness.session(null)
    },
    close: async () => {
      await context.close()
      server.close()
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
  return harness
}

/** Starts a harness for the tests of the current describe block; they skip if extensions cannot load here. */
function useExtension(): () => Harness {
  let harness: Harness | null = null
  let skipReason: string | null = null
  test.beforeAll(async () => {
    try {
      harness = await startHarness()
    } catch (error) {
      const why = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
      skipReason = `Extensions cannot be loaded in this environment: ${why}`
    }
  })
  test.afterAll(async () => {
    await harness?.close()
  })
  test.beforeEach(async () => {
    test.skip(skipReason !== null, skipReason ?? '')
    await harness?.reset()
  })
  return () => {
    if (harness === null) throw new Error('The extension browser is not running')
    return harness
  }
}

test.describe('Chrome extension', () => {
  const ext = useExtension()

  test('loads with the stable extension ID and installs one rule per default domain', async () => {
    const h = ext()
    expect(h.extId).toBe(DEFAULT_EXTENSION_ID)
    await expect.poll(() => h.ruleCount()).toBe(DEFAULT_BLOCKLIST.length)
  })

  test('redirects a blocked site to blocked.html and keeps the whole original URL', async () => {
    const h = ext()
    const page = await h.context.newPage()
    await page.goto('https://www.instagram.com/p/C182?x=1&y=2#frag')
    const url = new URL(page.url())
    expect(url.protocol).toBe('chrome-extension:')
    expect(url.host).toBe(h.extId)
    expect(url.pathname).toBe('/blocked.html')
    expect(url.searchParams.get('site')).toBe('instagram.com')
    expect(url.hash).toBe('#https://www.instagram.com/p/C182?x=1&y=2#frag')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('instagram.com is blocked')
    await expect(page.getByText('One focused hour beats a distracted evening.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to work' })).toBeVisible()
    await expect.poll(() => h.stored('dailyAttempts')).toMatchObject({ count: 1 })
    await page.close()
  })

  test('counts a click through from another page, but not a reload or a framed blocked page', async () => {
    const h = ext()
    const page = await h.context.newPage()
    await page.goto(`http://localhost:${h.port}/`)
    await page.getByRole('link', { name: 'instagram link' }).click()
    await expect(page).toHaveURL(/blocked\.html/)
    // The referrer survives the redirect, so it cannot be what tells a real attempt apart.
    expect(await page.evaluate(() => document.referrer)).toContain(`localhost:${h.port}`)
    await expect.poll(() => h.stored('dailyAttempts')).toMatchObject({ count: 1 })

    await page.reload()
    await page.goto(`http://localhost:${h.port}/frame`)
    const framed = page.frames().find((f) => f.url().startsWith('chrome-extension://'))
    expect(framed).toBeDefined()
    await expect(framed?.locator('h1') ?? page.locator('h1')).toHaveText('instagram.com is blocked')
    await expect(
      framed?.getByRole('button', { name: 'I need access' }) ?? page.locator('button'),
    ).toBeHidden()
    await page.waitForTimeout(500)
    expect(await h.stored('dailyAttempts')).toMatchObject({ count: 1 })
    await page.close()
  })

  test('Back to work goes back when there is history, and closes a tab opened straight onto the site', async () => {
    const h = ext()
    const page = await h.context.newPage()
    await page.goto(`http://localhost:${h.port}/`)
    await page.getByRole('link', { name: 'instagram link' }).click()
    await expect(page).toHaveURL(/blocked\.html/)
    await page.getByRole('button', { name: 'Back to work' }).click()
    await expect(page).toHaveURL(`http://localhost:${h.port}/`)
    await page.close()

    // A tab opened straight onto a blocked site has no history to go back to, so it is closed.
    const opener = await h.context.newPage()
    await opener.goto(`http://localhost:${h.port}/`)
    const opened = opener.waitForEvent('popup')
    await opener.getByRole('link', { name: 'instagram in a new tab' }).click()
    const tab = await opened
    await expect(tab).toHaveURL(/blocked\.html/)
    const closed = tab.waitForEvent('close')
    await tab.getByRole('button', { name: 'Back to work' }).click()
    await closed
    await opener.close()
  })

  test('answers the app on localhost and refuses malformed messages', async () => {
    const h = ext()
    expect(await h.appMessage({ v: 1, type: 'ping' })).toEqual({ ok: true, version: '1.0.0' })
    expect(await h.appMessage({ v: 1, type: 'sync', config: { mode: 'sometimes' } })).toMatchObject(
      { ok: false },
    )
    expect(await h.appMessage({ v: 1, type: 'session', session: { active: 'yes' } })).toMatchObject(
      { ok: false },
    )
    expect(await h.appMessage({ v: 2, type: 'ping' })).toMatchObject({ ok: false })
    expect(await h.stored('config')).toMatchObject({ mode: 'always', blocklist: DEFAULT_BLOCKLIST })

    const viaLoopback = await h.context.newPage()
    await viaLoopback.goto(`http://127.0.0.1:${h.port}/`)
    const reply = await viaLoopback.evaluate(
      (id) =>
        new Promise<unknown>((resolve) => {
          chrome.runtime.sendMessage(id, { v: 1, type: 'ping' }, resolve)
        }),
      h.extId,
    )
    expect(reply).toEqual({ ok: true, version: '1.0.0' })
    await viaLoopback.close()
  })

  test('getEvents returns what was logged, with a cursor that never runs ahead of it', async () => {
    const h = ext()
    const page = await h.context.newPage()
    await page.goto('https://www.instagram.com/')
    await expect.poll(() => h.stored('dailyAttempts')).toMatchObject({ count: 1 })
    const first = (await h.appMessage({ v: 1, type: 'getEvents', since: 0 })) as {
      ok: boolean
      events: { id: string; at: number; kind: string; domain: string }[]
      cursor: number
    }
    expect(first.ok).toBe(true)
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({ kind: 'blocked', domain: 'instagram.com' })
    expect(first.cursor).toBe(first.events[0]?.at)
    expect(await h.appMessage({ v: 1, type: 'getEvents', since: first.cursor })).toEqual({
      ok: true,
      events: [],
      cursor: first.cursor,
    })
    await page.close()
  })

  test('focus mode blocks only while a session is running, and stops at endsAt', async () => {
    const h = ext()
    await h.sync({ mode: 'focus' })
    const page = await h.context.newPage()
    await page.goto('https://www.instagram.com/')
    await expect(page).toHaveTitle('Stub: the real site')

    await h.session({
      active: true,
      endsAt: Date.now() + 60_000,
      taskTitle: 'C182 Unit 3 practice',
    })
    await page.goto('https://www.instagram.com/')
    await expect(page).toHaveURL(/blocked\.html/)
    await expect(page.getByText('C182 Unit 3 practice')).toBeVisible()
    await expect(page.getByRole('timer')).toHaveText(/^(00:5\d|01:00)$/)

    // The app closed before it could say the session ended: endsAt alone must unblock.
    await h.session({ active: true, endsAt: Date.now() - 1_000, taskTitle: 'C182 Unit 3 practice' })
    await page.goto('https://www.instagram.com/')
    await expect(page).toHaveTitle('Stub: the real site')
    await page.close()
  })

  test('unblocks by itself when a session ends, even if the app never says so', async () => {
    const h = ext()
    await h.sync({ mode: 'focus' })
    await h.session({ active: true, endsAt: Date.now() + 2_000, taskTitle: 'C182 Unit 3 practice' })
    await expect.poll(() => h.ruleCount()).toBe(DEFAULT_BLOCKLIST.length)
    // The worker's alarm fires at endsAt and rebuilds the rules without any message from the app.
    await expect.poll(() => h.ruleCount(), { timeout: 20_000 }).toBe(0)
    const page = await h.context.newPage()
    await page.goto('https://www.instagram.com/')
    await expect(page).toHaveTitle('Stub: the real site')
    await page.close()
  })

  test('an allowlisted lecture loads while the rest of the site stays blocked', async () => {
    const h = ext()
    await h.sync({ allowlist: ['youtube.com/watch?v=lecture-c779'] })
    const page = await h.context.newPage()
    await page.goto('https://www.youtube.com/watch?v=lecture-c779&t=90s')
    await expect(page).toHaveTitle('Stub: the real site')
    await page.goto('https://www.youtube.com/watch?v=something-else')
    await expect(page).toHaveURL(/blocked\.html\?site=youtube\.com/)
    await page.close()
  })

  test('the popup shows today, the mode and the session, and Open Forge opens the app', async () => {
    const h = ext()
    await h.sync({ mode: 'focus' })
    await h.session({
      active: true,
      endsAt: Date.now() + 25 * 60_000,
      taskTitle: 'C779 Web Development',
    })
    const blocked = await h.context.newPage()
    await blocked.goto('https://www.instagram.com/')
    await expect.poll(() => h.stored('dailyAttempts')).toMatchObject({ count: 1 })
    await blocked.close()

    const popup = await h.context.newPage()
    await popup.setViewportSize({ width: 320, height: 420 })
    await popup.goto(`chrome-extension://${h.extId}/popup.html`)
    await expect(popup.getByText('1 win today')).toBeVisible()
    await expect(popup.getByText('During focus sessions')).toBeVisible()
    await expect(popup.getByText('C779 Web Development')).toBeVisible()
    await expect(popup.getByRole('timer')).toHaveText(/^2[45]:\d\d$/)

    // Open Forge asks Chrome for a tab on the app; record the call instead of loading the real site.
    await popup.evaluate(() => {
      const opened: string[] = []
      Object.assign(window, { opened })
      Object.assign(chrome.tabs, {
        create: (props: { url: string }) => {
          opened.push(props.url)
          return Promise.resolve()
        },
      })
    })
    await popup.getByRole('button', { name: 'Open Forge' }).click()
    expect(await popup.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([
      APP_URL,
    ])
    await popup.close()
  })
})

test.describe('Chrome extension: time', () => {
  const ext = useExtension()

  test('emergency unlock: 60 seconds, the exact phrase, then the original page', async () => {
    const h = ext()
    const page = await h.context.newPage()
    await page.clock.install()
    await page.goto('https://www.instagram.com/p/C182?x=1&y=2#frag')
    await page.getByRole('button', { name: 'I need access' }).click()
    await expect(page.getByRole('heading', { name: 'Take a breath' })).toBeVisible()
    await page.clock.fastForward(30_000)
    await expect(page.getByRole('heading', { name: 'Take a breath' })).toBeVisible()
    await page.clock.fastForward(31_000)

    const input = page.getByLabel('Type the phrase exactly')
    await expect(input).toBeFocused()
    mkdirSync(shots, { recursive: true })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: path.join(shots, `blocked-phrase-${scheme}.png`) })
    }
    await page.emulateMedia({ colorScheme: null })
    await input.fill('i choose distraction over my goals')
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/blocked\.html/) // wrong case: nothing happens

    await input.fill(UNLOCK_PHRASE)
    await page.waitForURL('https://www.instagram.com/p/C182?x=1&y=2#frag')
    await expect(page).toHaveTitle('Stub: the real site')

    // Five minutes for that domain only, and it is in the log.
    expect(await h.stored('unlocks')).toEqual([
      { domain: 'instagram.com', until: expect.any(Number) },
    ])
    const events = (await h.stored('events')) as { kind: string; unlockMinutes?: number }[]
    expect(events.at(-1)).toMatchObject({ kind: 'unlock', unlockMinutes: 5 })
    await page.goto('https://www.instagram.com/')
    await expect(page).toHaveTitle('Stub: the real site')
    await page.goto('https://www.reddit.com/')
    await expect(page).toHaveURL(/blocked\.html\?site=reddit\.com/)
    await page.close()
  })

  test('screenshots of blocked.html and popup.html, light and dark', async () => {
    const h = ext()
    mkdirSync(shots, { recursive: true })
    const now = Date.now()
    await h.sync({ mode: 'focus', motivation: ['One focused hour beats a distracted evening.'] })
    await h.session({
      active: true,
      endsAt: now + (24 * 60 + 31) * 1000,
      taskTitle: 'C182: Read chapter 4 and take notes',
    })
    for (const scheme of ['light', 'dark'] as const) {
      const page = await h.context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.clock.setFixedTime(now)
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto('https://www.instagram.com/')
      await expect(page.getByRole('timer')).toHaveText('24:31')
      await page.screenshot({ path: path.join(shots, `blocked-${scheme}.png`) })

      await page.setViewportSize({ width: 375, height: 667 })
      await page.screenshot({ path: path.join(shots, `blocked-${scheme}-375.png`) })

      await page.setViewportSize({ width: 1280, height: 720 })
      await page.getByRole('button', { name: 'I need access' }).click()
      await expect(page.getByRole('heading', { name: 'Take a breath' })).toBeVisible()
      await page.screenshot({ path: path.join(shots, `blocked-wait-${scheme}.png`) })
      await page.close()

      const popup = await h.context.newPage()
      await popup.emulateMedia({ colorScheme: scheme })
      await popup.clock.setFixedTime(now)
      await popup.setViewportSize({ width: 320, height: 200 })
      await popup.goto(`chrome-extension://${h.extId}/popup.html`)
      await expect(popup.getByRole('timer')).toHaveText('24:31')
      await popup.screenshot({ path: path.join(shots, `popup-${scheme}.png`), fullPage: true })
      await popup.close()
    }
  })
})
