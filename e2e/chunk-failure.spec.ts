import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'

/**
 * Code that is fetched on demand can fail to arrive: offline on a first visit (no service worker yet), a
 * tab left open across a deploy. A page or a slot card that cannot load has its own boundary (smoke.spec.ts
 * covers a page). These cover the things nobody navigated to: the blocker's sync runner (mounted by a
 * provider a moment after the first screen), the command palette and the "?" sheet (fetched on a key press),
 * and the crash screen's export code. None of them may take the app down, and none may blame the database.
 */

test.use({
  // What the browser itself logs for a request that was refused or an import that failed.
  ignoreConsoleErrors: ['Failed to load resource', 'Failed to fetch dynamically imported module'],
})

/** Refuses every request for a built chunk (`assets/<name>-<hash>.js`) and counts the attempts. */
async function blockChunk(page: Page, name: string): Promise<{ attempts: () => number }> {
  let attempts = 0
  await page.route(new RegExp(`/assets/${name}-[^/]*\\.js$`), (route) => {
    attempts += 1
    return route.abort()
  })
  return { attempts: () => attempts }
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const crashHeading = (page: Page) => page.getByRole('heading', { name: 'Something went wrong' })

test.describe('a chunk that cannot be fetched (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the blocker sync runner failing leaves the whole app running', async ({ page }) => {
    const sync = await blockChunk(page, 'BlockerSync')
    await gotoApp(page, '/', 'wgu')
    // The provider mounts the runner about 400 ms after the first screen; wait until it has tried.
    await expect.poll(sync.attempts).toBeGreaterThan(0)

    // The app around it is alive: the sidebar still navigates and the next page renders.
    await nav(page).getByRole('link', { name: 'Goals', exact: true }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible()
    await expect(crashHeading(page)).toHaveCount(0)
  })

  test('the command palette failing to load says so and leaves the app as it was', async ({
    page,
  }) => {
    const palette = await blockChunk(page, 'PaletteOverlay')
    await gotoApp(page, '/', 'wgu')
    await expect(nav(page)).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await expect.poll(palette.attempts).toBeGreaterThan(0)

    const toast = page.getByRole('region', { name: 'Notifications', exact: true })
    await expect(toast.getByText(/Couldn.t open the command palette/)).toBeVisible()
    await expect(toast.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(crashHeading(page)).toHaveCount(0)
    // Nothing is left half open: the sidebar is still there and Escape is not waiting on a ghost.
    await expect(nav(page)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await nav(page).getByRole('link', { name: 'Tasks', exact: true }).click()
    await expect(page).toHaveURL(/\/tasks/)
  })

  test('the shortcut sheet failing to load says so and leaves the app as it was', async ({
    page,
  }) => {
    const sheet = await blockChunk(page, 'ShortcutSheet')
    await gotoApp(page, '/', 'wgu')
    await expect(nav(page)).toBeVisible()

    await page.keyboard.press('?')
    await expect.poll(sheet.attempts).toBeGreaterThan(0)

    const toast = page.getByRole('region', { name: 'Notifications', exact: true })
    await expect(toast.getByText(/Couldn.t open the shortcut list/)).toBeVisible()
    await expect(crashHeading(page)).toHaveCount(0)
    await expect(nav(page)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test.describe('on the crash screen', () => {
    test.use({
      ignoreConsoleErrors: ['Failed', 'Cannot read properties of null', 'The above error occurred'],
    })

    test('"Export my data" blames the network, not the database, when its code is gone', async ({
      page,
    }) => {
      await gotoApp(page, '/', 'wgu')
      // A settings row that has lost a section: what makes the root crash screen appear (see snapshots.spec.ts).
      const [settings] = await readTable<Record<string, unknown>>(page, 'settings')
      await putRows(page, 'settings', [{ ...settings, appearance: null }])
      const exportCode = await blockChunk(page, 'exportData')
      await page.goto('/')
      await expect(crashHeading(page)).toBeVisible()
      // The screen asks for the export code as soon as it is up, instead of when the button is pressed.
      await expect.poll(exportCode.attempts).toBeGreaterThan(0)

      await page.getByRole('button', { name: 'Export my data' }).click()
      const status = page.getByRole('status').filter({ hasText: 'Could not load the export tool' })
      await expect(status).toBeVisible()
      await expect(status).not.toContainText('database')
    })
  })
})
