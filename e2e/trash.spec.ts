import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { readTable } from './idb'

/**
 * Phase 11c: the Trash, on the WGU sample with the clock fixed at Tue 2026-09-29 09:30 New York. A task
 * (or a goal) is deleted the way a person does it, found in the Trash, restored (with Undo), deleted forever
 * or swept with Empty trash; and the 30-day purge is checked by moving the clock, not by waiting.
 */

const UNIT3 = 'C779 · Unit 3: CSS layout (30 min)'
const UNIT3_ID = 'task-c779-u3-3'
const GOAL = 'B.S. Computer Science — WGU'

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
// Several toasts can be up at once (the delete's and the restore's); each has its own Undo.
const undoOf = (page: Page, text: string) =>
  toasts(page)
    .locator('[data-variant]')
    .filter({ hasText: text })
    .getByRole('button', { name: 'Undo' })
const row = (page: Page, title: string): Locator =>
  page.getByRole('main').getByRole('listitem').filter({ hasText: title })
const restoreButton = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: `Restore “${title}”` })

interface TaskRow {
  id: string
  title: string
  goalId: string | null
}
interface TrashRow {
  id: string
  title: string
  entityTable: string
  expiresAt: number
}

const tasks = (page: Page) => readTable<TaskRow>(page, 'tasks')
const trash = (page: Page) => readTable<TrashRow>(page, 'trash')

/** Deletes a task from its own page, the way a person does. */
async function trashTaskOnItsPage(page: Page, id: string): Promise<void> {
  await gotoApp(page, `/task/${id}`, 'wgu')
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(toasts(page)).toContainText('to the trash')
}

/** Deletes the first two tasks of the Inbox with the keyboard, waiting for each to land. */
async function trashTwoInboxTasks(page: Page): Promise<void> {
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible()
  await page.keyboard.press('j')
  await page.keyboard.press('ControlOrMeta+Backspace')
  await expect.poll(async () => (await trash(page)).length).toBe(1)
  await page.keyboard.press('ControlOrMeta+Backspace')
  await expect.poll(async () => (await trash(page)).length).toBe(2)
}

async function openTrashWithKeys(page: Page): Promise<void> {
  await page.keyboard.press('o')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/trash$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible()
}

test.describe('the Trash page', () => {
  test('delete a task, find it in the Trash, restore it, and it is back', async ({ page }) => {
    await trashTaskOnItsPage(page, UNIT3_ID)
    const before = (await tasks(page)).length
    expect((await tasks(page)).some((t) => t.id === UNIT3_ID)).toBe(false)

    await openTrashWithKeys(page) // `o t`
    await expect(page.getByRole('heading', { level: 2, name: /^Tasks/ })).toBeVisible()
    const item = row(page, UNIT3)
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('Deleted today')
    await expect(item).toContainText('Deletes in 30 days')

    await restoreButton(page, UNIT3).click()
    await expect(toasts(page)).toContainText(`Restored “${UNIT3}”`)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    await expect(page.getByText('Deleted items stay here for 30 days.')).toBeVisible()

    expect(await trash(page)).toEqual([])
    const back = await tasks(page)
    expect(back).toHaveLength(before + 1)
    expect(back.find((t) => t.id === UNIT3_ID)).toMatchObject({
      title: UNIT3,
      goalId: 'goal-wgu-bscs',
    })

    // ...and on the Tasks page too.
    await page.goto('/tasks/all')
    await expect(row(page, UNIT3).first()).toBeVisible()
  })

  test('Undo puts a restored item straight back in the Trash', async ({ page }) => {
    await trashTaskOnItsPage(page, UNIT3_ID)
    await openTrashWithKeys(page)
    await restoreButton(page, UNIT3).click()
    await expect(row(page, UNIT3)).toHaveCount(0)

    await undoOf(page, 'Restored').click()
    await expect(row(page, UNIT3)).toHaveCount(1)
    await expect(row(page, UNIT3)).toContainText('Deletes in 30 days')
    expect((await tasks(page)).some((t) => t.id === UNIT3_ID)).toBe(false)
    expect(await trash(page)).toHaveLength(1)
  })

  test('the palette opens it, and the empty state says how long things stay', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('open trash')
    await page.getByRole('option', { name: /Open Trash/ }).click()
    await expect(page).toHaveURL(/\/trash$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    await expect(page.getByText('Deleted items stay here for 30 days.')).toBeVisible()
    // Nothing to search or empty yet.
    await expect(page.getByRole('searchbox', { name: 'Search the Trash' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Empty trash' })).toHaveCount(0)
  })

  test('is reachable from Settings, Data', async ({ page }) => {
    await gotoApp(page, '/settings/data', 'wgu')
    await page.getByRole('link', { name: 'Open Trash' }).click()
    await expect(page).toHaveURL(/\/trash$/)
  })

  test('keys: j and k move, r restores, f searches, Mod+Backspace asks before deleting forever', async ({
    page,
  }) => {
    await trashTwoInboxTasks(page)
    const titles = (await trash(page)).map((t) => t.title)

    await openTrashWithKeys(page)
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(2)

    // Search: `f` goes to the field, words narrow the list, Esc clears it.
    await page.keyboard.press('f')
    const search = page.getByRole('searchbox', { name: 'Search the Trash' })
    await expect(search).toBeFocused()
    await search.fill('zzz nothing like this')
    await expect(
      page.getByRole('heading', { level: 2, name: /^No deleted items match/ }),
    ).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(2)
    const [first] = titles
    await search.fill((first ?? '').split(' ')[0] ?? '')
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible()
    await search.press('Escape')
    await page.locator('body').click({ position: { x: 5, y: 5 } })

    // j / k move the current row and focus its Restore button; r restores it.
    await page.keyboard.press('j')
    const currentTitle = await page
      .locator('[data-trash-id][data-current="true"] span[title]')
      .getAttribute('title')
    expect(titles).toContain(currentTitle)
    await page.keyboard.press('r')
    await expect(toasts(page)).toContainText('Restored')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1)
    expect((await trash(page)).map((t) => t.title)).not.toContain(currentTitle)

    // Mod+Backspace asks first, with Cancel focused; Esc backs out and nothing is deleted.
    await page.keyboard.press('ControlOrMeta+Backspace')
    const dialog = page.getByRole('dialog', { name: /^Delete “.*” forever\?$/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await trash(page)).toHaveLength(1)

    await page.keyboard.press('ControlOrMeta+Backspace')
    await dialog.getByRole('button', { name: 'Delete forever' }).click()
    await expect(toasts(page)).toContainText('forever')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    expect(await trash(page)).toEqual([])
  })

  test('Empty trash needs the words typed, and deletes everything for good', async ({ page }) => {
    await trashTwoInboxTasks(page)

    // From the palette: it opens the dialog, it does not delete.
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('empty trash')
    await page.getByRole('option', { name: /Empty Trash/ }).click()
    await expect(page).toHaveURL(/\/trash\?do=empty$/)
    const dialog = page.getByRole('dialog', { name: 'Empty the Trash?' })
    await expect(dialog).toBeVisible()
    expect(await trash(page)).toHaveLength(2)

    const confirm = dialog.getByRole('button', { name: 'Delete 2 items' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type “empty trash”/).fill('empty')
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type “empty trash”/).fill('Empty Trash')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(dialog).toBeHidden()
    await expect(toasts(page)).toContainText('Emptied the Trash · 2 items deleted')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    expect(await trash(page)).toEqual([])
    await expect(page).toHaveURL(/\/trash$/)
  })

  test('a task trashed before its goal comes back with the goal, and Undo takes both back', async ({
    page,
  }) => {
    await trashTaskOnItsPage(page, UNIT3_ID)
    await page.goto('/goals/goal-wgu-bscs')
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Move to trash' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect.poll(async () => (await trash(page)).length).toBe(2)

    await page.goto('/trash')
    // Grouped by type, and the page says what will happen before anyone clicks.
    await expect(page.getByRole('heading', { level: 2, name: /^Tasks/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^Goals/ })).toBeVisible()
    const taskRow = row(page, UNIT3)
    await expect(taskRow).toContainText(
      `Also brings back its goal “${GOAL}”, which is in the Trash.`,
    )
    const goalRow = row(page, GOAL).filter({ hasText: 'Includes' })
    await expect(goalRow).toContainText(/Includes \d+ courses?, \d+ units?, \d+ tasks?/)

    await taskRow.getByRole('button', { name: /^Restore/ }).click()
    await expect(toasts(page)).toContainText(`Restored “${UNIT3}”`)
    await expect(toasts(page)).toContainText(`Also brought back its goal “${GOAL}”.`)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    expect(await trash(page)).toEqual([])
    expect(await readTable(page, 'goals')).toHaveLength(1)
    expect((await tasks(page)).find((t) => t.id === UNIT3_ID)?.goalId).toBe('goal-wgu-bscs')

    await undoOf(page, 'Restored').click()
    await expect(row(page, UNIT3)).toHaveCount(1)
    await expect(row(page, GOAL).filter({ hasText: 'Includes' })).toHaveCount(1)
    expect(await readTable(page, 'goals')).toHaveLength(0)
    expect(await trash(page)).toHaveLength(2)
  })
})

test.describe('the 30-day purge, with a moving clock', () => {
  const purgedDay = (page: Page) =>
    page.evaluate(() => window.localStorage.getItem('forge:trash:purged-day'))

  test('an item is kept until the day it is due, then removed at the next start', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Trashed at the fixed "now": Tue 2026-09-29 09:30. It is due on Thu 2026-10-29 at 09:30.
    await trashTaskOnItsPage(page, UNIT3_ID)
    const [entry] = await trash(page)
    expect(entry?.expiresAt).toBe(new Date('2026-10-29T09:30:00-04:00').getTime())

    // The day before: the start-up chore runs (it records the day), and the item is still there.
    await page.clock.setFixedTime(new Date('2026-10-28T12:00:00-04:00'))
    await page.goto('/trash')
    await expect(row(page, UNIT3)).toContainText('Deletes tomorrow')
    await expect.poll(() => purgedDay(page), { timeout: 20_000 }).toBe('2026-10-28')
    expect(await trash(page)).toHaveLength(1)

    // The morning it is due, before its time: still there.
    await page.clock.setFixedTime(new Date('2026-10-29T08:00:00-04:00'))
    await page.goto('/trash')
    await expect(row(page, UNIT3)).toContainText('Deletes today')
    await expect.poll(() => purgedDay(page), { timeout: 20_000 }).toBe('2026-10-29')
    expect(await trash(page)).toHaveLength(1)

    // A later start the same day does not purge again (once a day), even after its time has passed...
    await page.clock.setFixedTime(new Date('2026-10-29T10:00:00-04:00'))
    await page.reload()
    await page.waitForTimeout(3500)
    expect(await trash(page)).toHaveLength(1)

    // ...and the next day it is gone.
    await page.clock.setFixedTime(new Date('2026-10-30T09:00:00-04:00'))
    await page.goto('/trash')
    await expect.poll(() => purgedDay(page), { timeout: 20_000 }).toBe('2026-10-30')
    expect(await trash(page)).toEqual([])
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }),
    ).toBeVisible()
    // The task itself did not come back.
    expect((await tasks(page)).some((t) => t.id === UNIT3_ID)).toBe(false)
  })

  test('across the autumn DST change the label counts calendar days', async ({ page }) => {
    // Trashed Thu 2026-10-15; the clocks fall back on Sun 2026-11-01. Due Sat 2026-11-14 at 09:30.
    await page.clock.setFixedTime(new Date('2026-10-15T09:30:00-04:00'))
    await trashTaskOnItsPage(page, UNIT3_ID)
    const [entry] = await trash(page)
    expect(entry?.expiresAt).toBe(new Date('2026-11-14T09:30:00-05:00').getTime())

    await page.clock.setFixedTime(new Date('2026-11-01T12:00:00-05:00'))
    await page.goto('/trash')
    await expect(row(page, UNIT3)).toContainText('Deletes in 13 days')
    await page.clock.setFixedTime(new Date('2026-10-31T23:59:00-04:00'))
    await page.goto('/trash')
    await expect(row(page, UNIT3)).toContainText('Deletes in 14 days')
  })
})
