import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 3F: the Tasks screen end to end, on the WGU sample data with the clock fixed at Tue
 * 2026-09-29 09:30 (so "tomorrow" is 2026-09-30). The last two groups are regressions for the
 * shortcut scope model: page shortcuts stay quiet under any overlay, and Esc closes the overlay
 * in front (the tablet drawer, the phone More sheet, the palette) before the page gets it.
 */

const BRIEF_EXAMPLE = 'Read chapter 4 tomorrow 2p #C182 !high ~2'
const MENTOR = 'Email mentor about term plan'
const LIBRARY = 'Renew library card'
const PROCTOR = 'Book a proctoring slot for the D278 exam'
// Another, finished task shares this title, so the calendar block is found by its time too.
const UNIT3_PM = /^Open C779 · Unit 3: CSS layout \(30 min\), 2 – 2:30 PM/

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const undo = (page: Page) => toasts(page).getByRole('button', { name: 'Undo' })
const quickAdd = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })
const quickAddField = (page: Page) => quickAdd(page).getByRole('textbox', { name: 'New task' })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })
const shortcutSheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' })
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' })
const moreSheet = (page: Page) => page.getByRole('dialog', { name: 'More' })
const column = (page: Page, id: 'todo' | 'doing' | 'done') => page.locator(`[data-column="${id}"]`)
const xpToday = (page: Page) => page.getByText('earned today').locator('..')

/** A list row by (part of) its title. */
const rowOf = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('main').getByRole('listitem').filter({ hasText: title })
const selectedRow = (page: Page) => page.getByRole('main').locator('[data-selected]')
const titleButton = (row: Locator) => row.getByRole('button', { name: /\. Edit task title$/ })

/** The visible title of a row, from its accessible name ("<title>. Edit task title"). */
async function titleOf(row: Locator): Promise<string> {
  const name = (await titleButton(row).first().getAttribute('aria-label')) ?? ''
  return name.replace(/\. Edit task title$/, '')
}

interface StoredTask {
  id: string
  title: string
  status: string
  doDate: string | null
  doTime: string | null
  dueDate: string | null
  priority: number
}

interface StoredXp {
  amount: number
  key: string
}

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction(name).objectStore(name).getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result as T[])
          }
        }
      }),
    table,
  )
}

const storedTasks = (page: Page) => readTable<StoredTask>(page, 'tasks')
const storedTask = async (page: Page, id: string) =>
  (await storedTasks(page)).find((t) => t.id === id)
const xpNet = async (page: Page, key?: string) =>
  (await readTable<StoredXp>(page, 'xpEvents'))
    .filter((e) => key === undefined || e.key === key)
    .reduce((sum, e) => sum + e.amount, 0)

/** Takes keyboard focus off whatever an overlay focused, so a key press lands on the page body. */
async function blurActive(page: Page): Promise<void> {
  // Overlays re-assert their focus for a frame or two after opening; let that settle first.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      }),
  )
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)
}

test.describe('quick add on the Tasks screen', () => {
  test("the brief's example lands in Upcoming with its chips", async ({ page }) => {
    await gotoApp(page, '/tasks/upcoming', 'wgu')
    await expect(page.getByRole('heading', { name: 'Upcoming', level: 1 })).toBeVisible()
    await expect(rowOf(page, 'Read chapter 4')).toHaveCount(0)

    await page.keyboard.press('q')
    await expect(quickAddField(page)).toBeFocused()
    await quickAddField(page).pressSequentially(BRIEF_EXAMPLE)
    await page.keyboard.press('Enter')
    await expect(quickAdd(page)).toBeHidden()
    await expect(toasts(page)).toContainText('Added to Upcoming')

    const row = rowOf(page, 'Read chapter 4')
    await expect(row).toHaveCount(1)
    await expect(titleButton(row)).toHaveAccessibleName('Read chapter 4. Edit task title')
    // Course, date and time, estimate and priority, as chips on the row.
    await expect(row).toContainText('C182')
    await expect(row).toContainText('Tomorrow, 2 PM')
    await expect(row).toContainText('~2')
    await expect(row.getByRole('img', { name: 'Priority: High' })).toBeVisible()

    const stored = (await storedTasks(page)).find((t) => t.title === 'Read chapter 4')
    expect(stored).toMatchObject({ doDate: '2026-09-30', doTime: '14:00', priority: 3 })
  })
})

test.describe('completing', () => {
  test('complete, then Undo from the toast: the XP nets to zero', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const before = await xpNet(page)
    const row = rowOf(page, MENTOR)
    await expect(row).toBeVisible()

    await row.getByRole('checkbox', { name: `Done: ${MENTOR}` }).click()
    await expect(toasts(page)).toContainText(`Completed “${MENTOR}”`)
    await expect(toasts(page)).toContainText('+20 XP')
    await expect.poll(() => xpNet(page)).toBe(before + 20)

    await undo(page).click()
    await expect(toasts(page)).not.toContainText('Completed')
    await expect.poll(() => xpNet(page)).toBe(before)
    // Append-only log: the award is still there, cancelled by a reversal under the same key.
    expect(await xpNet(page, 'task:task-email-mentor')).toBe(0)
    expect((await storedTask(page, 'task-email-mentor'))?.status).toBe('todo')
    await expect(rowOf(page, MENTOR)).toBeVisible()

    // The Today screen agrees: nothing earned.
    await page.keyboard.press('g')
    await page.keyboard.press('t')
    await expect(page).toHaveURL(/\/$/)
    await expect(xpToday(page)).toContainText('0 XP')
    await expect(xpToday(page)).not.toContainText('+')
  })
})

test.describe('editing a title in place', () => {
  test('click, type, Enter saves; Esc puts the old title back', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const field = page.getByRole('textbox', { name: 'Task title' })

    // Enter commits.
    await titleButton(rowOf(page, LIBRARY)).click()
    await expect(field).toBeFocused()
    await expect(page).not.toHaveURL(/peek=/) // clicking the text edits; it does not open the task
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renew library card at the Portland branch')
    await page.keyboard.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rowOf(page, 'Portland branch')).toHaveCount(1)
    await expect
      .poll(async () => (await storedTask(page, 'task-library-card'))?.title)
      .toBe('Renew library card at the Portland branch')

    // Esc reverts, and does not also clear the selection or close anything.
    await titleButton(rowOf(page, 'Portland branch')).click()
    await expect(field).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Something else entirely')
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(rowOf(page, 'Something else')).toHaveCount(0)
    await expect(rowOf(page, 'Portland branch')).toHaveCount(1)
    expect((await storedTask(page, 'task-library-card'))?.title).toBe(
      'Renew library card at the Portland branch',
    )
  })
})

test.describe('the keyboard on the Inbox', () => {
  test('j and k move the selection, x completes and hands the selection to the next row', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const rows = page.getByRole('main').getByRole('listitem')
    await expect(rows.first()).toBeVisible()
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))
    await expect(selectedRow(page)).toHaveCount(0)

    await page.keyboard.press('j')
    await expect(selectedRow(page)).toHaveCount(1)
    expect(await titleOf(selectedRow(page))).toBe(first)
    await page.keyboard.press('j')
    expect(await titleOf(selectedRow(page))).toBe(second)
    await page.keyboard.press('ArrowUp')
    expect(await titleOf(selectedRow(page))).toBe(first)
    await page.keyboard.press('k') // already at the top: stays
    expect(await titleOf(selectedRow(page))).toBe(first)

    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText('Completed')
    await expect(toasts(page)).toContainText(first.slice(0, 20))
    await expect
      .poll(async () => (await storedTasks(page)).find((t) => t.title === first)?.status)
      .toBe('done')
    // The selection moved on before the row left, so the keyboard keeps its place.
    await expect.poll(async () => titleOf(selectedRow(page))).toBe(second)

    await undo(page).click()
    await expect
      .poll(async () => (await storedTasks(page)).find((t) => t.title === first)?.status)
      .not.toBe('done')
  })
})

test.describe('the command palette', () => {
  test('finds a task with a fuzzy query and opens it', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    await expect(paletteInput(page)).toBeFocused()
    await paletteInput(page).fill('bk prctr d278')

    const hit = page.getByRole('option', { name: /Book a proctoring slot/ })
    await expect(hit).toBeVisible()
    await expect(page.getByRole('group', { name: 'Tasks' })).toContainText(PROCTOR)
    await page.keyboard.press('Enter')

    await expect(paletteInput(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/task\/task-proctor-d278$/)
    await expect(page.getByRole('main')).toContainText(PROCTOR)
  })
})

test.describe('the board', () => {
  test('the keyboard drags a card from To do to Doing: grip, Space, →, Space', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    const card = column(page, 'todo').getByRole('listitem').filter({ hasText: LIBRARY })
    await expect(card).toBeVisible()
    expect((await storedTask(page, 'task-library-card'))?.status).toBe('todo')

    await card.getByRole('button', { name: /^Move / }).focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    await page.keyboard.press('Space')

    await expect(column(page, 'doing').getByText(LIBRARY)).toBeVisible()
    await expect(column(page, 'todo').getByText(LIBRARY)).toHaveCount(0)
    await expect(page.getByText(/^Moved .*Renew library card.* to Doing\.$/)).toBeAttached()
    await expect(toasts(page)).toContainText(`Moved “${LIBRARY}” to Doing`)
    await expect
      .poll(async () => (await storedTask(page, 'task-library-card'))?.status)
      .toBe('doing')

    await undo(page).click()
    await expect(column(page, 'todo').getByText(LIBRARY)).toBeVisible()
    await expect
      .poll(async () => (await storedTask(page, 'task-library-card'))?.status)
      .toBe('todo')
  })
})

test.describe('the calendar', () => {
  test('Alt+→ reschedules the focused task to the next day, and Undo restores it', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    await page.getByRole('button', { name: UNIT3_PM }).focus()
    expect((await storedTask(page, 'task-c779-u3-3'))?.doDate).toBe('2026-09-29')

    await page.keyboard.press('Alt+ArrowRight')
    await expect
      .poll(async () => (await storedTask(page, 'task-c779-u3-3'))?.doDate)
      .toBe('2026-09-30')
    expect((await storedTask(page, 'task-c779-u3-3'))?.doTime).toBe('14:00')
    await expect(toasts(page)).toContainText('Wed, Sep 30')
    await expect(
      page
        .locator('[aria-label^="Wed, Sep 30, scheduled"]')
        .getByRole('button', { name: UNIT3_PM }),
    ).toBeVisible()

    await undo(page).click()
    await expect
      .poll(async () => (await storedTask(page, 'task-c779-u3-3'))?.doDate)
      .toBe('2026-09-29')
  })
})

test.describe('the trash', () => {
  test('mod+backspace moves the selected task to the trash, and Undo brings it back', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const rows = page.getByRole('main').getByRole('listitem')
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    const trashed = await titleOf(rows.nth(0))

    await page.keyboard.press('j')
    expect(await titleOf(selectedRow(page))).toBe(trashed)
    await page.keyboard.press('ControlOrMeta+Backspace')

    await expect(toasts(page)).toContainText('to the trash')
    await expect(toasts(page)).toContainText(trashed.slice(0, 20))
    await expect(rows).toHaveCount(count - 1)
    expect((await storedTasks(page)).some((t) => t.title === trashed)).toBe(false)
    expect(await readTable(page, 'trash')).toHaveLength(1)

    await undo(page).click()
    await expect(rows).toHaveCount(count)
    expect((await storedTasks(page)).some((t) => t.title === trashed)).toBe(true)
    expect(await readTable(page, 'trash')).toHaveLength(0)
  })
})

// ── Regressions: the shortcut scope model ───────────────────────────────────────────────────────

test.describe('shortcut scopes: page keys are quiet under an overlay', () => {
  const overlays: { name: string; open: (page: Page) => Promise<void> }[] = [
    {
      name: 'the command palette',
      open: async (page) => {
        await page.keyboard.press('ControlOrMeta+k')
        await expect(paletteInput(page)).toBeFocused()
      },
    },
    {
      name: 'quick add',
      open: async (page) => {
        await page.keyboard.press('q')
        await expect(quickAddField(page)).toBeFocused()
      },
    },
    {
      name: 'the shortcut sheet',
      open: async (page) => {
        await page.keyboard.press('?')
        // The dialog moves focus into its filter a frame after it opens.
        await expect(
          shortcutSheet(page).getByRole('searchbox', { name: 'Filter shortcuts' }),
        ).toBeFocused()
      },
    },
  ]

  for (const overlay of overlays) {
    test(`with ${overlay.name} open, x and j do nothing to the task list, even off its input`, async ({
      page,
    }) => {
      await gotoApp(page, '/tasks/inbox', 'wgu')
      const rows = page.getByRole('main').getByRole('listitem')
      await expect(rows.first()).toBeVisible()
      await page.keyboard.press('j')
      const selected = await titleOf(selectedRow(page))
      const statusBefore = (await storedTasks(page)).find((t) => t.title === selected)?.status

      await overlay.open(page)
      await blurActive(page)
      await page.keyboard.press('x')
      await page.keyboard.press('j')
      await page.keyboard.press('Control+Backspace')
      // Give a wrongly fired handler time to write.
      await page.waitForTimeout(300)

      await expect(toasts(page)).not.toContainText('Completed')
      await expect(toasts(page)).not.toContainText('trash')
      expect((await storedTasks(page)).find((t) => t.title === selected)?.status).toBe(statusBefore)
      expect(await readTable(page, 'trash')).toHaveLength(0)
      expect(await titleOf(selectedRow(page))).toBe(selected)

      // Esc closes the overlay, not the selection; the next Esc is the page's.
      await page.keyboard.press('Escape')
      await expect(paletteInput(page)).toHaveCount(0)
      await expect(quickAdd(page)).toHaveCount(0)
      await expect(shortcutSheet(page)).toBeHidden()
      expect(await titleOf(selectedRow(page))).toBe(selected)
      await page.keyboard.press('Escape')
      await expect(selectedRow(page)).toHaveCount(0)

      // With the overlay gone, the page's keys work again.
      await page.keyboard.press('j')
      await page.keyboard.press('x')
      await expect(toasts(page)).toContainText('Completed')
    })
  }
})

test.describe('shortcut scopes: Esc closes the overlay in front of the page', () => {
  test('at 800px, Esc on the Tasks page closes the open drawer and keeps the selection', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await expect(rowOf(page, MENTOR)).toBeVisible()
    await page.keyboard.press('j')
    await expect(selectedRow(page)).toHaveCount(1)
    const selected = await titleOf(selectedRow(page))

    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(drawer(page)).toBeVisible()
    // The page underneath is dead: no selection moves, nothing completes.
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    await page.waitForTimeout(200)
    await expect(toasts(page)).not.toContainText('Completed')
    expect(await titleOf(selectedRow(page))).toBe(selected)

    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    // The page's own Esc did not run: the selection is still there...
    expect(await titleOf(selectedRow(page))).toBe(selected)
    // ...and now that nothing is open, the next Esc is the page's.
    await page.keyboard.press('Escape')
    await expect(selectedRow(page)).toHaveCount(0)
  })

  test('on a phone, Esc closes the More sheet before the Tasks page gets it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await expect(rowOf(page, MENTOR)).toBeVisible()
    await page.keyboard.press('j')
    await expect(selectedRow(page)).toHaveCount(1)

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'More' })
      .click()
    await expect(moreSheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreSheet(page)).toBeHidden()
    await expect(selectedRow(page)).toHaveCount(1)
  })

  test('with the palette open on top of the Tasks page, Esc closes the palette only', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await expect(rowOf(page, MENTOR)).toBeVisible()
    await page.keyboard.press('j')
    await expect(selectedRow(page)).toHaveCount(1)

    await page.keyboard.press('ControlOrMeta+k')
    await expect(paletteInput(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(paletteInput(page)).toHaveCount(0)
    await expect(selectedRow(page)).toHaveCount(1)
  })
})

test.describe('shortcut scopes: a ui Modal blocks the keys beneath it', () => {
  test('g t and q do nothing while a dialog is open; they work again once it closes', async ({
    page,
  }) => {
    await gotoApp(page, '/design#modal')
    await page.getByRole('button', { name: 'Small: confirm' }).first().click()
    const dialog = page.getByRole('dialog', { name: /Move “C779 Web Development Foundations”/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Move to trash' })).toBeFocused()

    await page.keyboard.press('g')
    await page.keyboard.press('t')
    await page.keyboard.press('q')
    await page.waitForTimeout(200)
    await expect(page).toHaveURL(/\/design/)
    await expect(quickAdd(page)).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('g')
    await page.keyboard.press('t')
    await expect(page).toHaveURL(/\/$/)
  })
})

// ── Regressions: the Phase 3 review ─────────────────────────────────────────────────────────────

const peekPanel = (page: Page) => page.getByRole('complementary', { name: 'Task details' })
const peekHeading = (page: Page) => peekPanel(page).getByRole('heading', { level: 2 })

test.describe('the peek panel keeps one task per title editor', () => {
  test('j to the next task, then e and Enter, leaves that task’s title alone', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const rows = page.getByRole('main').getByRole('listitem')
    await expect(rows.first()).toBeVisible()
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))
    expect(second).not.toBe(first)
    const before = await storedTasks(page)

    await rows
      .nth(0)
      .getByRole('button', { name: `Open ${first}`, exact: true })
      .click()
    await expect(peekHeading(page)).toContainText(first)
    // The same panel now shows the next task; its title editor must start from that task's title.
    await page.keyboard.press('j')
    await expect(peekHeading(page)).toContainText(second)
    await page.keyboard.press('e')
    const field = page.getByRole('textbox', { name: 'Task title' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue(second)
    await page.keyboard.press('Enter')
    await expect(field).toHaveCount(0)
    await page.waitForTimeout(200)

    const after = await storedTasks(page)
    expect(after.map((t) => t.title).sort()).toEqual(before.map((t) => t.title).sort())
  })
})

test.describe('the peek title editor starts from the current title', () => {
  test('after renaming in the list, e in the peek edits the new title, and Enter keeps it', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const row = rowOf(page, LIBRARY)
    await row.getByRole('button', { name: `Open ${LIBRARY}`, exact: true }).click()
    await expect(peekHeading(page)).toContainText(LIBRARY)

    // Rename in the list while the peek shows the same task.
    await titleButton(row).click()
    const inRow = page.getByRole('textbox', { name: 'Task title' })
    await expect(inRow).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renew library card online')
    await page.keyboard.press('Enter')
    await expect(peekHeading(page)).toContainText('Renew library card online')

    // `e` opens the peek's editor; it must hold the title as it is now, not as it was when the peek opened.
    await page.keyboard.press('e')
    const field = peekPanel(page).getByRole('textbox', { name: 'Task title' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Renew library card online')
    await page.keyboard.press('Enter')
    await expect(field).toHaveCount(0)
    await page.waitForTimeout(200)
    expect((await storedTask(page, 'task-library-card'))?.title).toBe('Renew library card online')
  })
})

test.describe('a row menu keeps the page keys quiet', () => {
  test('with the … menu open, x and Mod+Backspace do nothing to the task; Esc closes it and x works again', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const row = rowOf(page, MENTOR)
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
    const menu = page.getByRole('menu', { name: `Actions for ${MENTOR}` })
    await expect(menu).toBeVisible()

    // `x` is typeahead in a menu. Mod+Backspace is a key the menu does not use, so it used to reach
    // the page's "move to trash" behind the menu.
    await page.keyboard.press('x')
    await page.keyboard.press('ControlOrMeta+Backspace')
    await page.keyboard.press('Alt+ArrowDown')
    await page.waitForTimeout(300)
    await expect(toasts(page)).not.toContainText('Completed')
    await expect(toasts(page)).not.toContainText('trash')
    expect((await storedTask(page, 'task-email-mentor'))?.status).toBe('todo')
    expect(await readTable(page, 'trash')).toHaveLength(0)
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText('Completed')
  })

  test('with the date popover open, page keys stay quiet too', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const row = rowOf(page, MENTOR)
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /^Date/ }).click()
    const popover = page.getByRole('dialog', { name: 'Date' })
    await expect(popover).toBeVisible()
    await popover.getByRole('button', { name: 'Tomorrow' }).focus()

    await page.keyboard.press('x')
    await page.keyboard.press('ControlOrMeta+Backspace')
    await page.waitForTimeout(300)
    await expect(toasts(page)).not.toContainText('Completed')
    await expect(toasts(page)).not.toContainText('trash')
    expect((await storedTask(page, 'task-email-mentor'))?.status).toBe('todo')
    expect(await readTable(page, 'trash')).toHaveLength(0)
  })
})

test.describe('layout from the palette', () => {
  test('“Show tasks as a board” is remembered for the list, so the list opens as a board again', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all', 'wgu')
    await expect(page.getByRole('heading', { name: 'All', level: 1 })).toBeVisible()
    await expect(column(page, 'todo')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('Show tasks as a board')
    await page.keyboard.press('Enter')
    await expect(column(page, 'todo')).toBeVisible()

    // The sidebar's own link to this list carries no layout, so only the preference can say "board".
    await page.locator('a[data-sub]').filter({ hasText: /^All$/ }).click()
    await expect(page).not.toHaveURL(/layout=/)
    await expect(column(page, 'todo')).toBeVisible()
  })
})

test.describe('board cards', () => {
  test('pressing in the title editor or on the … button does not start a drag', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all?layout=board', 'wgu')
    const card = column(page, 'todo').getByRole('listitem').filter({ hasText: LIBRARY })
    await expect(card).toBeVisible()

    // Selecting text in the inline editor.
    await titleButton(card).click()
    const field = card.getByRole('textbox', { name: 'Task title' })
    await expect(field).toBeFocused()
    const editor = await field.boundingBox()
    if (!editor) throw new Error('the editor has no box')
    await page.mouse.move(editor.x + 6, editor.y + editor.height / 2)
    await page.mouse.down()
    await page.mouse.move(editor.x + 80, editor.y + editor.height / 2, { steps: 6 })
    await expect(page.locator('[data-dragging]')).toHaveCount(0)
    await page.mouse.up()
    await expect(field).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)

    // Pressing on the … button and moving.
    const more = card.getByRole('button', { name: 'More actions' })
    await card.hover()
    const button = await more.boundingBox()
    if (!button) throw new Error('the … button has no box')
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2)
    await page.mouse.down()
    await page.mouse.move(button.x + button.width / 2 - 40, button.y + button.height + 30, {
      steps: 6,
    })
    await expect(page.locator('[data-dragging]')).toHaveCount(0)
    await page.mouse.up()
    await expect(column(page, 'todo').getByText(LIBRARY)).toBeVisible()
  })
})

test.describe('the task page', () => {
  test('a repeating task keeps its date: no clear button, and the page says why', async ({
    page,
  }) => {
    await gotoApp(page, '/task/task-weekly-review-next', 'wgu')
    await expect(page.getByRole('heading', { name: /Weekly review/, level: 1 })).toBeVisible()
    await expect(page.getByLabel('Date', { exact: true })).not.toHaveValue('')
    await expect(page.getByText('Repeating tasks need a date.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear Date' })).toHaveCount(0)
  })

  test('clearing the date of a plain task really clears it', async ({ page }) => {
    await gotoApp(page, '/task/task-tuition', 'wgu')
    await expect(page.getByRole('heading', { name: /Pay tuition/, level: 1 })).toBeVisible()
    expect((await storedTask(page, 'task-tuition'))?.doDate).not.toBeNull()
    await page.getByRole('button', { name: 'Clear Date' }).click()
    await expect.poll(async () => (await storedTask(page, 'task-tuition'))?.doDate).toBeNull()
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue('')
    // Its deadline is a separate field and stays.
    expect((await storedTask(page, 'task-tuition'))?.dueDate).toBe('2026-10-08')
    await expect(page.getByLabel('Deadline', { exact: true })).toHaveValue('2026-10-08')
  })

  test('a deadline is its own calm chip, and can be set and cleared on the page', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/upcoming', 'wgu')
    // Pay phone bill: no day picked, due Friday. It is listed on Friday, with a "Due Fri" chip.
    const bill = rowOf(page, 'Pay phone bill')
    await expect(bill).toContainText('Due Fri')
    await expect(bill.locator('[data-tone="calm"]')).toBeVisible()

    await gotoApp(page, '/task/task-email-mentor', 'wgu')
    await page.getByLabel('Deadline', { exact: true }).fill('2026-09-29')
    await expect
      .poll(async () => (await storedTask(page, 'task-email-mentor'))?.dueDate)
      .toBe('2026-09-29')
    expect((await storedTask(page, 'task-email-mentor'))?.doDate).toBe('2026-09-29')
    await page.getByRole('button', { name: 'Clear Deadline' }).click()
    await expect.poll(async () => (await storedTask(page, 'task-email-mentor'))?.dueDate).toBeNull()
  })

  test('Status: Done to Doing takes the XP back with a toast and Undo', async ({ page }) => {
    await gotoApp(page, '/tasks/completed', 'wgu')
    const finished = (await readTable<StoredTask & { recurrence: unknown }>(page, 'tasks')).find(
      (t) => t.status === 'done' && t.recurrence === null,
    )
    if (!finished) throw new Error('the sample data has no finished one-off task')
    const key = `task:${finished.id}`
    const earned = await xpNet(page, key)
    expect(earned).toBeGreaterThan(0)

    await page.goto(`/task/${finished.id}`)
    await page.getByRole('radio', { name: 'Doing' }).click()
    await expect(toasts(page)).toContainText('to Doing')
    await expect(toasts(page)).toContainText(`−${earned} XP`)
    await expect.poll(async () => (await storedTask(page, finished.id))?.status).toBe('doing')
    expect(await xpNet(page, key)).toBe(0)

    await undo(page).click()
    await expect.poll(async () => (await storedTask(page, finished.id))?.status).toBe('done')
    await expect.poll(() => xpNet(page, key)).toBe(earned)
  })

  test('notes typed a moment ago go to the trash with the task', async ({ page }) => {
    await gotoApp(page, '/task/task-library-card', 'wgu')
    const notes = page.getByRole('group', { name: 'Notes' })
    await notes.getByRole('textbox').first().click()
    await page.keyboard.type('Bring proof of address')
    await page.getByRole('button', { name: 'Move to trash' }).click()
    await expect(toasts(page)).toContainText('to the trash')
    const trash = await readTable<{ payload: { tasks?: { notes: { text: string }[] }[] } }>(
      page,
      'trash',
    )
    expect(trash).toHaveLength(1)
    expect(trash[0]?.payload.tasks?.[0]?.notes.map((b) => b.text).join(' ')).toContain(
      'Bring proof of address',
    )
  })
})
