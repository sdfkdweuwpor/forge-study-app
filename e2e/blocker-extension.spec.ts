import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { DEFAULT_EXTENSION_ID } from '../extension/src/shared/config'
import type { BlockerConfig } from '../extension/src/shared/protocol'
import { securityHeaders } from '../security-headers.mjs'

/**
 * The real thing, end to end: the built app (served from `dist/` with the production headers) and the
 * built extension (extension/dist) in one Chromium. The Blocker page finds the extension, a site added
 * in the app reaches it and is redirected to blocked.html, a blocked attempt comes back as a win, and
 * the focus timer switches focus-mode blocking on and off.
 *
 * Needs a built app: `npm run e2e` builds it first; run alone with `npm run build` and then
 * `npx playwright test --config extension/playwright.config.ts`. `E2E_APP_DIST` names another build
 * folder. Extensions only load in Chromium's new headless mode, so the tests skip with the reason where
 * this environment cannot load one (as e2e/extension.spec.ts does). Nothing touches the network:
 * redirects happen before it, and the pages the extension lets through are stubbed.
 *
 * The extension is loaded from a private copy of extension/dist, so a rebuild by another spec cannot
 * pull files out from under this browser, and this spec never rebuilds a complete build.
 */
test.describe.configure({ mode: 'serial' })

const root = path.resolve(import.meta.dirname, '..')
const extDist = path.join(root, 'extension', 'dist')
const appDist = path.resolve(root, process.env['E2E_APP_DIST'] ?? 'dist')
const extVersion = (
  JSON.parse(readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')) as {
    version: string
  }
).version

/** The chrome.* surface these tests call from inside an extension page. */
interface ChromeLike {
  storage: { local: { get(keys: string): Promise<Record<string, unknown>> } }
  declarativeNetRequest: { getDynamicRules(): Promise<{ id: number }[]> }
}
declare const chrome: ChromeLike

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Serves the built app the way Netlify does: the files, the production headers, and index.html for app routes. */
function serveApp(): Promise<Server> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const candidate = path.join(appDist, path.normalize(pathname))
    const inside = candidate === appDist || candidate.startsWith(appDist + path.sep)
    const isFile = inside && existsSync(candidate) && statSync(candidate).isFile()
    const file = isFile ? candidate : path.join(appDist, 'index.html')
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value)
    response.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream')
    response.setHeader('cache-control', 'no-store')
    response.end(readFileSync(file))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** Makes sure extension/dist is complete (building it only when it is not) and copies it aside. */
function privateExtensionCopy(dir: string): string {
  const complete = () =>
    existsSync(path.join(extDist, 'manifest.json')) &&
    existsSync(path.join(extDist, 'js', 'background', 'sw.js')) &&
    existsSync(path.join(extDist, 'blocked.html'))
  if (!complete()) {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.mjs')], {
      cwd: root,
      stdio: 'pipe',
    })
  }
  const target = path.join(dir, 'extension')
  mkdirSync(target, { recursive: true })
  cpSync(extDist, target, { recursive: true })
  return target
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface Harness {
  context: BrowserContext
  appUrl: string
  extId: string
  /** The app page, with errors collected. */
  app: Page
  problems: string[]
  stored<T>(key: string): Promise<T>
  ruleCount(): Promise<number>
  close(): Promise<void>
}

async function start(): Promise<Harness> {
  if (!existsSync(path.join(appDist, 'index.html'))) {
    throw new Error(`no built app in ${appDist} (run npm run build first)`)
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-app-ext-'))
  const extPath = privateExtensionCopy(dir)
  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
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

  const server = await serveApp()
  const appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  await context.route('https://icons.duckduckgo.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  )
  await context.route(/^https:\/\/([^/]+\.)?(instagram|khanacademy)\.(com|org)\//, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Stub: the real site</title>',
    }),
  )

  const control = await context.newPage()
  await control.goto(`chrome-extension://${extId}/popup.html`)

  const app = await context.newPage()
  const problems: string[] = []
  app.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
  })
  app.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

  // A fresh profile is a first launch: leave the welcome flow the way a person would, so the pages
  // below open as themselves. (This spec serves a production build, which has no test bypass.)
  await app.goto(`${appUrl}/welcome`)
  await app.getByRole('button', { name: 'Skip setup' }).click()
  await app.waitForURL(`${appUrl}/`)

  return {
    context,
    appUrl,
    extId,
    app,
    problems,
    stored: <T>(key: string) =>
      control.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T>,
    ruleCount: () =>
      control.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length),
    close: async () => {
      await context.close()
      server.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

let harness: Harness | null = null
let skipReason: string | null = null

test.beforeAll(async () => {
  try {
    harness = await start()
  } catch (error) {
    const why = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
    skipReason = `Cannot run the app with the extension here: ${why}`
  }
})
test.afterAll(async () => {
  await harness?.close()
})
test.beforeEach(() => {
  test.skip(skipReason !== null, skipReason ?? '')
})

function h(): Harness {
  if (harness === null) throw new Error('The browser is not running')
  return harness
}

test('the Blocker page finds the extension, syncs a new site, and a blocked attempt comes back as a win', async () => {
  const { app, appUrl, context, extId } = h()
  await app.goto(`${appUrl}/blocker`)
  const sites = app.getByRole('list', { name: 'Blocked sites' }).getByRole('listitem')
  await expect(sites).toHaveCount(11)

  // Connected, with the version of the extension that is really loaded.
  expect(extId).toBe(DEFAULT_EXTENSION_ID)
  await expect(app.getByText(`Connected · v${extVersion}`)).toBeVisible()
  await expect(app.getByText('Not installed')).toHaveCount(0)

  // The app's list, mode and motivation lines reached the extension.
  await expect
    .poll(() => h().stored<BlockerConfig | undefined>('config'))
    .toMatchObject({
      mode: 'focus',
      blocklist: expect.arrayContaining(['instagram.com', 'youtube.com']),
    })
  const initial = await h().stored<BlockerConfig>('config')
  expect(initial.blocklist).toHaveLength(11)
  expect(initial.motivation).toHaveLength(5)

  // Always on, then add a site.
  await app.getByRole('radio', { name: 'Always' }).click()
  await expect.poll(async () => (await h().stored<BlockerConfig>('config')).mode).toBe('always')
  await app
    .getByRole('textbox', { name: 'Add a site to block' })
    .fill('https://www.khanacademy.org/math')
  await app.getByRole('textbox', { name: 'Add a site to block' }).press('Enter')
  await expect(sites).toHaveCount(12)
  await expect
    .poll(async () => (await h().stored<BlockerConfig>('config')).blocklist)
    .toContain('khanacademy.org')
  await expect.poll(() => h().ruleCount()).toBe(12)

  // Going there lands on the extension's blocked page, in the app's voice.
  const tab = await context.newPage()
  await tab.goto('https://www.khanacademy.org/')
  const url = new URL(tab.url())
  expect(url.protocol).toBe('chrome-extension:')
  expect(url.host).toBe(extId)
  expect(url.pathname).toBe('/blocked.html')
  expect(url.searchParams.get('site')).toBe('khanacademy.org')
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('khanacademy.org is blocked')
  const line = (await tab.locator('#motivation').textContent())?.trim() ?? ''
  expect(initial.motivation).toContain(line)
  await tab.close()

  // The attempt is a win in the app (Check again pulls events right away).
  await app.bringToFront()
  await app.getByRole('button', { name: 'Check again' }).click()
  await expect(app.getByText('You tried Khanacademy once today, that’s 1 win')).toBeVisible()
  await expect(app.getByText('win today', { exact: true })).toBeVisible()

  // Removing the site takes the block away.
  await app.getByRole('button', { name: 'Remove khanacademy.org' }).click()
  await expect(sites).toHaveCount(11)
  await expect.poll(() => h().ruleCount()).toBe(11)
  const free = await context.newPage()
  await free.goto('https://www.khanacademy.org/')
  await expect(free).toHaveURL('https://www.khanacademy.org/')
  await free.close()

  expect(h().problems).toEqual([])
})

test('focus mode follows the timer: blocked while a session runs, free when it ends', async () => {
  const { app, appUrl, context, extId } = h()
  await app.goto(`${appUrl}/blocker`)
  await expect(app.getByText(`Connected · v${extVersion}`)).toBeVisible()
  await app.getByRole('radio', { name: 'During focus' }).click()
  await expect.poll(async () => (await h().stored<BlockerConfig>('config')).mode).toBe('focus')
  // No session, so nothing is blocked.
  await expect.poll(() => h().ruleCount()).toBe(0)
  const before = await context.newPage()
  await before.goto('https://www.instagram.com/')
  await expect(before).toHaveURL('https://www.instagram.com/')
  await before.close()

  // Start a focus session in the app.
  await app.goto(`${appUrl}/focus`)
  await expect(app.getByTestId('timer-display')).toBeVisible()
  await app.getByTestId('timer-start').click()
  await expect(app.getByTestId('timer-toggle')).toHaveText('Pause')
  await expect.poll(() => h().ruleCount()).toBe(11)
  await expect
    .poll(() => h().stored<{ active: boolean; endsAt: number | null } | null>('session'))
    .toMatchObject({ active: true })

  const blocked = await context.newPage()
  await blocked.goto('https://www.instagram.com/')
  expect(new URL(blocked.url()).host).toBe(extId)
  await expect(blocked.getByRole('heading', { level: 1 })).toHaveText('instagram.com is blocked')
  await blocked.close()

  // Stop it: the block lifts.
  await app.getByTestId('timer-stop').click()
  await app
    .getByRole('dialog', { name: 'Done with this task?' })
    .waitFor({ timeout: 1500 })
    .then(() => app.keyboard.press('Escape'))
    .catch(() => undefined)
  await expect.poll(() => h().ruleCount()).toBe(0)
  const after = await context.newPage()
  await after.goto('https://www.instagram.com/')
  await expect(after).toHaveURL('https://www.instagram.com/')
  await after.close()

  expect(h().problems).toEqual([])
})
