import type { Page, Request } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 10C: the installed app works offline. These specs are the only ones that let the service worker
 * run (the shared config blocks it, so it cannot answer the requests the other specs stub). The preview
 * serves the production build with the production CSP, so `worker-src 'self'` is exercised for real.
 *
 * Every spec waits for the worker to be active and controlling the page before it goes offline: a
 * reload without that would be a reload from the network.
 */

test.use({ serviceWorkers: 'allow' })

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const quickAddField = (page: Page) =>
  page.getByRole('dialog', { name: 'Quick add task' }).getByRole('textbox', { name: 'New task' })
const offlinePill = (page: Page) => page.getByTestId('offline-pill-sidebar')

/** Waits until the service worker is installed (the precache is complete), active and controlling this page. */
async function waitForControl(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? null), {
      message: 'the service worker never took control of the page',
    })
    .toBe('activated')
}

/** The script the page's controlling worker was loaded from. */
const controllerScript = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')

/**
 * Installs a second worker for the same scope, the way a deploy does. (A byte-different `sw.js` would be
 * the real thing, but Playwright cannot rewrite the browser's own update fetch, so the same file is
 * registered under another URL: the browser treats it as a newer worker.) It waits, because the app
 * never skips waiting.
 */
async function installNewerWorker(page: Page): Promise<void> {
  await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js?v=2', { scope: '/' }).then(() => undefined),
  )
  await expect
    .poll(() =>
      page.evaluate(() =>
        navigator.serviceWorker.getRegistration().then((r) => r?.waiting?.state ?? null),
      ),
    )
    .toBe('installed')
}

/** The titles of the tasks table, read straight from IndexedDB. */
async function storedTaskTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('tasks').objectStore('tasks').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve((all.result as { title: string }[]).map((t) => t.title))
          }
        }
      }),
  )
}

test.describe('offline', () => {
  test('the installed shell, Today, a new task and a deep link all work with no network', async ({
    page,
    context,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await waitForControl(page)
    await expect(offlinePill(page)).toHaveCount(0)

    // The manifest, the icons and the app shell are in the precache.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys()
      const urls: string[] = []
      for (const name of names) {
        for (const request of await (await caches.open(name)).keys())
          urls.push(new URL(request.url).pathname)
      }
      return urls
    })
    expect(cached).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/manifest.webmanifest',
        '/icons/pwa-192.png',
        '/icons/pwa-512.png',
      ]),
    )

    await context.setOffline(true)
    await page.reload()
    await page.locator('#root > *').first().waitFor()

    // Today renders from the cache, with its data, and the pill says so.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Good morning — Tuesday, Sep 29',
    )
    await expect(offlinePill(page)).toBeVisible()
    await expect(offlinePill(page)).toHaveText('Offline')

    // Tasks (a lazy route chunk) opens and a task can be created, offline.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Tasks' })
      .click()
    await expect(page).toHaveURL(/\/tasks/)
    await page.keyboard.press('q')
    await expect(quickAddField(page)).toBeFocused()
    await quickAddField(page).fill('Review C182 unit 3 notes')
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Review C182 unit 3 notes')
    await expect.poll(() => storedTaskTitles(page)).toContain('Review C182 unit 3 notes')

    // A full page load of a deep link (the SPA fallback) shows the task that was just saved.
    await page.goto('/tasks/all')
    await page.locator('#root > *').first().waitFor()
    await expect(
      page.getByRole('main').getByText('Review C182 unit 3 notes', { exact: true }),
    ).toBeVisible()

    // Back online: the pill goes away and the data is still there.
    await context.setOffline(false)
    await expect(offlinePill(page)).toHaveCount(0)
    await expect(
      page.getByRole('main').getByText('Review C182 unit 3 notes', { exact: true }),
    ).toBeVisible()
  })

  test('a waiting update shows "Update ready" once, and Reload swaps it in', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await waitForControl(page)
    await expect(toasts(page)).not.toContainText('Update ready')
    await page.evaluate(() => Object.assign(window, { staleTab: true }))

    await installNewerWorker(page)
    await expect(toasts(page)).toContainText('Update ready')
    // Nothing swapped or reloaded by itself: the page still runs, and the old worker still controls it.
    expect(await page.evaluate(() => 'staleTab' in window)).toBe(true)
    expect(await controllerScript(page)).not.toContain('v=2')

    const reloaded = page.waitForEvent('load')
    await toasts(page).getByRole('button', { name: 'Reload' }).click()
    // The newer worker took over and the page reloaded (a fresh document has lost the marker).
    await reloaded
    await page.locator('#root > *').first().waitFor()
    expect(await page.evaluate(() => 'staleTab' in window)).toBe(false)
    expect(await controllerScript(page)).toContain('v=2')
  })

  test('the prompt waits while a focus session runs and appears when it ends', async ({ page }) => {
    await gotoApp(page, '/focus', 'empty')
    await waitForControl(page)
    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-stop')).toBeVisible()

    await installNewerWorker(page)
    // The worker is waiting, and the toast is held back for as long as the session runs.
    await page.waitForTimeout(1000)
    await expect(toasts(page)).not.toContainText('Update ready')

    await page.getByTestId('timer-stop').click()
    await expect(page.getByTestId('timer-start')).toBeVisible()
    await expect(toasts(page)).toContainText('Update ready')
  })

  test('the manifest meets the install criteria and every icon and shortcut it lists exists', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')
    const response = await page.request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)
    const manifest = (await response.json()) as {
      name: string
      short_name: string
      start_url: string
      scope: string
      display: string
      icons: { src: string; sizes: string; type: string; purpose?: string }[]
      shortcuts: { name: string; url: string }[]
    }
    expect(manifest).toMatchObject({
      name: 'Forge',
      short_name: 'Forge',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    })

    // Chrome needs a 192 and a 512 icon that are not maskable-only; Android also uses maskable and monochrome.
    const has = (sizes: string, purpose: string) =>
      manifest.icons.some((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose)
    expect(has('192x192', 'any')).toBe(true)
    expect(has('512x512', 'any')).toBe(true)
    expect(has('512x512', 'maskable')).toBe(true)
    for (const icon of manifest.icons) {
      const res = await page.request.get(icon.src)
      expect(res.ok(), icon.src).toBe(true)
      expect(res.headers()['content-type']).toBe(icon.type)
    }
    expect((await page.request.get('/icons/apple-touch-icon-180.png')).ok()).toBe(true)
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/apple-touch-icon-180.png',
    )

    expect(manifest.shortcuts.map((s) => s.name)).toEqual(['Today', 'Start focus', 'Quick add'])
    for (const shortcut of manifest.shortcuts) {
      expect((await page.request.get(shortcut.url)).ok(), shortcut.url).toBe(true)
    }
  })

  test('the "Quick add" launch shortcut opens quick add once and leaves a clean URL', async ({
    page,
  }) => {
    await gotoApp(page, '/?quickadd=1', 'empty')
    await expect(quickAddField(page)).toBeFocused()
    await expect(page).not.toHaveURL(/quickadd/)
    await page.keyboard.press('Escape')
    await expect(quickAddField(page)).toBeHidden()
    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(quickAddField(page)).toBeHidden()
  })

  test.describe('favicons', () => {
    // No network in the sandbox: the lookups themselves fail (and log a failed resource load). What is
    // under test is that the worker's own CSP does not block them before they leave.
    test.use({ ignoreConsoleErrors: ['Failed to load resource'] })

    test("the worker's CSP lets it fetch Blocker favicons, so they can be cached for offline", async ({
      page,
      context,
    }) => {
      await gotoApp(page, '/', 'wgu')
      await waitForControl(page)
      const [worker] = context.serviceWorkers()
      if (!worker) throw new Error('no service worker')
      await worker.evaluate(() => {
        const g = self as unknown as { violations: string[] }
        g.violations = []
        self.addEventListener('securitypolicyviolation', (e) => {
          g.violations.push(`${e.violatedDirective} ${e.blockedURI}`)
        })
      })
      const attempted = new Promise<void>((resolve) => {
        const settle = (r: Request) => {
          if (r.url().startsWith('https://icons.duckduckgo.com/')) resolve()
        }
        page.on('requestfinished', settle)
        page.on('requestfailed', settle)
      })
      await page.goto('/blocker')
      await attempted
      expect(
        await worker.evaluate(() => (self as unknown as { violations: string[] }).violations),
      ).toEqual([])
    })
  })
})
