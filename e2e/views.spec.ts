import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 3D: the Board and Calendar layouts of the Tasks screen and saved views. The clock is fixed at
 * Tue 2026-09-29 09:30; the WGU seed has one task in Doing and a week of dated work.
 */

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const column = (page: Page, id: 'todo' | 'doing' | 'done') => page.locator(`[data-column="${id}"]`)

interface StoredTask {
  status: string
  doDate: string | null
  doTime: string | null
  schedulePinned: boolean
  boardOrder: number
}

interface StoredView {
  name: string
  icon: string
  layout: string
  filter: Record<string, unknown>
}

/** Reads one row straight from IndexedDB, so the assertion does not depend on the UI under test. */
async function stored<T>(page: Page, table: string, id: string): Promise<T | undefined> {
  return page.evaluate(
    ([name, key]) =>
      new Promise<T | undefined>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const get = db.transaction(name!).objectStore(name!).get(key!)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            db.close()
            resolve(get.result as T | undefined)
          }
        }
      }),
    [table, id] as const,
  )
}

async function allViews(page: Page): Promise<StoredView[]> {
  return page.evaluate(
    () =>
      new Promise<StoredView[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('savedViews').objectStore('savedViews').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result as StoredView[])
          }
        }
      }),
  )
}

const task = (page: Page, id: string) => stored<StoredTask>(page, 'tasks', id)

test.describe('board', () => {
  test('the layout switch and v b / v l change the layout and are remembered', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
    await page.keyboard.press('v')
    await page.keyboard.press('b')
    await expect(page).toHaveURL(/layout=board/)
    await expect(column(page, 'doing')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Board' })).toBeChecked()

    // Back on the list later, the list remembers its layout.
    await page.goto('/tasks/inbox')
    await expect(column(page, 'todo')).toBeVisible()

    await page.keyboard.press('v')
    await page.keyboard.press('l')
    await expect(page).not.toHaveURL(/layout=/)
    await expect(column(page, 'todo')).toHaveCount(0)
  })

  test('dragging a card with the mouse moves it to another column, with Undo', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    const card = column(page, 'todo')
      .getByRole('listitem')
      .filter({ hasText: 'Renew library card' })
    await expect(card).toBeVisible()
    const from = await card.boundingBox()
    const into = await column(page, 'doing').locator('ul').boundingBox()
    if (!from || !into) throw new Error('board is not laid out')

    await page.mouse.move(from.x + from.width / 2, from.y + 16)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 24, from.y + 40, { steps: 4 })
    await page.mouse.move(into.x + into.width / 2, into.y + 160, { steps: 16 })
    await page.mouse.up()

    await expect(column(page, 'doing').getByText('Renew library card')).toBeVisible()
    await expect(toasts(page)).toContainText('Moved “Renew library card” to Doing')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(column(page, 'todo').getByText('Renew library card')).toBeVisible()
  })

  test('the keyboard moves a card: grip, Space, arrows, Space; the drop is announced and finishes a task', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    const doing = column(page, 'doing').getByRole('listitem').first()
    await expect(doing).toContainText('CSS layout (45 min)')

    // Each key waits for the announcement of the one before it, not for a fixed delay: dnd-kit measures
    // the columns after the pick-up, and a busy page can take longer than any timeout chosen here.
    await doing.getByRole('button', { name: /^Move / }).focus()
    await page.keyboard.press('Space')
    // The pick-up is announced ("Picked up …"), then at once as "… is over Doing".
    await expect(
      page.getByText(/^(Picked up .*|.*)CSS layout \(45 min\)(\.| is over Doing)/),
    ).toBeAttached()
    // dnd-kit starts listening for arrow keys a tick after the pick-up, so an arrow pressed at once can be
    // lost. Done is the last column, so pressing again until it is announced cannot overshoot.
    await expect(async () => {
      await page.keyboard.press('ArrowRight')
      await expect(page.getByText(/CSS layout \(45 min\) is over Done/)).toBeAttached({
        timeout: 400,
      })
    }).toPass({ timeout: 5000 })
    await page.keyboard.press('Space')

    await expect(column(page, 'done').getByText('C779 · Unit 3: CSS layout (45 min)')).toBeVisible()
    await expect(page.getByText(/^Moved .*CSS layout \(45 min\).* to Done\.$/)).toBeAttached()
    // Completing goes through completeTask, so XP is awarded and the toast says so.
    await expect(toasts(page)).toContainText(/Completed .*CSS layout/)
    await expect(toasts(page)).toContainText(/\+\d+ XP/)
  })

  test('Alt+→ moves the selected card to the next column', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    const card = column(page, 'todo')
      .getByRole('listitem')
      .filter({ hasText: 'Renew library card' })
    await card.getByText('Renew library card').hover()
    await card.locator('button[aria-label^="Open"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(column(page, 'doing').getByText('Renew library card')).toBeVisible()
  })

  test('has an empty state, and no horizontal page scroll on a phone', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox?layout=board', 'empty')
    await expect(page.getByRole('heading', { name: 'Inbox zero' })).toBeVisible()

    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    await expect(column(page, 'todo')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('calendar', () => {
  const stamp = 'task-c779-u3-2' // Today 10:00, 45 min

  test('shows the week, and ← → t move between weeks', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    const range = page.locator('h2[aria-live="polite"]')
    await expect(range).toHaveText('Sep 28 – Oct 4, 2026')
    await expect(page.getByText('(today)')).toBeAttached()
    await page.keyboard.press('ArrowRight')
    await expect(range).toHaveText('Oct 5 – 11, 2026')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(range).toHaveText('Sep 21 – 27, 2026')
    await page.keyboard.press('t')
    await expect(range).toHaveText('Sep 28 – Oct 4, 2026')
  })

  test('Alt+arrows reschedule the focused task, pin it, and keep focus', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    const block = page.getByRole('button', { name: /^Open C779 · Unit 3: CSS layout \(45 min\)/ })
    await block.first().focus()

    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(async () => (await task(page, stamp))?.doDate).toBe('2026-09-30')
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(async () => (await task(page, stamp))?.doTime).toBe('10:15')
    expect((await task(page, stamp))?.schedulePinned).toBe(true)
    await expect(toasts(page)).toContainText('Wed, Sep 30, 10:15 AM')
    await expect(
      page.getByRole('button', { name: /^Open C779 · Unit 3: CSS layout \(45 min\), 10:15/ }),
    ).toBeFocused()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await task(page, stamp))?.doDate).toBe('2026-09-29')
    expect((await task(page, stamp))?.doTime).toBe('10:00')
  })

  test('dragging a block to another day and time reschedules it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1500 })
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    const block = page.getByRole('button', { name: /^Open C779 · Unit 3: CSS layout \(45 min\)/ })
    const from = await block.first().boundingBox()
    const thursday = await page.locator('[aria-label^="Thu, Oct 1, scheduled"]').boundingBox()
    if (!from || !thursday) throw new Error('calendar is not laid out')

    const grab = from.y + 10
    const hour = 64
    await page.mouse.move(from.x + from.width / 2, grab)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 12, grab + 12, { steps: 4 })
    // The block's top edge lands on the 15:00 line of Thursday's column.
    await page.mouse.move(thursday.x + thursday.width / 2, thursday.y + 8 * hour + 10, {
      steps: 18,
    })
    await page.mouse.up()

    await expect.poll(async () => (await task(page, stamp))?.doDate).toBe('2026-10-01')
    expect((await task(page, stamp))?.doTime).toBe('15:00')
    expect((await task(page, stamp))?.schedulePinned).toBe(true)
  })

  test('dropping a timed block in the all-day strip clears its time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    const block = page.getByRole('button', { name: /^Open C779 · Unit 3: CSS layout \(45 min\)/ })
    const from = await block.first().boundingBox()
    const strip = await page.locator('[aria-label^="Wed, Sep 30, all day"]').boundingBox()
    if (!from || !strip) throw new Error('calendar is not laid out')

    await page.mouse.move(from.x + from.width / 2, from.y + 10)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 12, from.y - 10, { steps: 4 })
    await page.mouse.move(strip.x + strip.width / 2, strip.y + 12, { steps: 16 })
    await page.mouse.up()

    await expect.poll(async () => (await task(page, stamp))?.doDate).toBe('2026-09-30')
    expect((await task(page, stamp))?.doTime).toBeNull()
  })

  test('shows three days on a phone and pages by them', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    await expect(page.locator('h2[aria-live="polite"]')).toHaveText('Sep 29 – Oct 1, 2026')
    await expect(page.locator('[aria-label$="scheduled"]')).toHaveCount(3)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: 'Next days' }).click()
    await expect(page.locator('h2[aria-live="polite"]')).toHaveText('Oct 2 – 4, 2026')
  })
})

test.describe('saved views', () => {
  test('save the filters as a view, then it lists in the sidebar and keeps its layout', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all?priority=3,4', 'wgu')
    await page.getByRole('button', { name: 'Save view' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save view' })
    await expect(dialog.getByLabel('Name')).toHaveValue('High priority')
    await dialog.getByLabel('Name').fill('Urgent this term')
    await dialog.getByRole('button', { name: 'Fire' }).click()
    await dialog.getByRole('button', { name: 'Save view' }).click()

    await expect(page).toHaveURL(/\/tasks\/views\/[\w-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Urgent this term')
    const link = page.getByRole('link', { name: /Urgent this term/ })
    await expect(link).toHaveAttribute('aria-current', 'page')
    const views = await allViews(page)
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ name: 'Urgent this term', icon: '🔥', layout: 'list' })
    expect(views[0]?.filter).toEqual({ priority: [3, 4] })

    // Switch to the board: the view is edited, and Update stores the layout.
    await page.keyboard.press('v')
    await page.keyboard.press('b')
    await expect(column(page, 'todo')).toBeVisible()
    await page.getByRole('button', { name: 'Update view' }).click()
    await expect.poll(async () => (await allViews(page))[0]?.layout).toBe('board')
    await expect(page.getByRole('button', { name: 'Update view' })).toHaveCount(0)

    // A link to the view opens it as a board without any address-bar state.
    await page.goto(new URL(page.url()).pathname)
    await expect(column(page, 'todo')).toBeVisible()
  })

  test('rename inline and delete with Undo from the sidebar', async ({ page }) => {
    await gotoApp(page, '/tasks/all?priority=3,4', 'wgu')
    await page.getByRole('button', { name: 'Save view' }).click()
    await page
      .getByRole('dialog', { name: 'Save view' })
      .getByRole('button', { name: 'Save view' })
      .click()
    await expect(page).toHaveURL(/\/tasks\/views\//)

    await page.getByRole('button', { name: /^Actions for High priority/ }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'View name' }).fill('Focus list')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('link', { name: /Focus list/ })).toBeVisible()
    expect((await allViews(page))[0]?.name).toBe('Focus list')

    await page.getByRole('button', { name: /^Actions for Focus list/ }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Delete view' }).click()
    await expect(toasts(page)).toContainText('Deleted view “Focus list”')
    await expect.poll(async () => (await allViews(page)).length).toBe(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await allViews(page)).length).toBe(1)
    await expect(page.getByRole('link', { name: /Focus list/ })).toBeVisible()
  })

  test('a view that does not exist says so instead of failing', async ({ page }) => {
    await gotoApp(page, '/tasks/views/no-such-view', 'wgu')
    await expect(page.getByRole('heading', { name: 'View not found', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Go to All tasks' }).click()
    await expect(page).toHaveURL(/\/tasks\/all$/)
  })
})
