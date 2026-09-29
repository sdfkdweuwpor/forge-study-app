import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 3B: quick add (Q, mod+enter, the phone "+" button, the "New task" command), the command
 * palette (mod+k, "/", the sidebar button) and the "?" shortcut sheet. The clock is fixed at
 * Tue 2026-09-29 09:30, so "tomorrow" is 2026-09-30.
 */

const BRIEF_EXAMPLE = 'Read chapter 4 tomorrow 2p #C182 !high ~2'

const quickAdd = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })
const quickAddField = (page: Page) => quickAdd(page).getByRole('textbox', { name: 'New task' })
const parsedChips = (page: Page) =>
  quickAdd(page).getByRole('list', { name: 'Parsed details' }).getByRole('listitem')
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })
const shortcutSheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

interface StoredTask {
  title: string
  dueDate: string | null
  dueTime: string | null
  priority: number
  estimatePomodoros: number | null
  tags: string[]
  milestoneId: string | null
  goalId: string | null
  recurrence: { freq: string; interval: number; byWeekday: number[] } | null
}

/** Reads the tasks table straight from IndexedDB, so the assertion does not depend on any list UI. */
async function storedTasks(page: Page): Promise<StoredTask[]> {
  return page.evaluate(
    () =>
      new Promise<StoredTask[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('tasks').objectStore('tasks').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result as StoredTask[])
          }
        }
      }),
  )
}

const titled = (tasks: StoredTask[], title: string) => tasks.filter((t) => t.title === title)

test.describe('quick add', () => {
  test("the brief's example shows live chips and creates the task", async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('q')
    await expect(quickAddField(page)).toBeFocused()
    await expect(quickAddField(page)).toHaveAttribute('placeholder', BRIEF_EXAMPLE)

    await quickAddField(page).pressSequentially(BRIEF_EXAMPLE)
    // One chip per piece, in the order typed, then the course that #C182 links to.
    await expect(parsedChips(page)).toHaveText([
      'Tomorrow',
      '2:00 PM',
      '#C182',
      'High priority',
      '2 pomodoros',
      /Introduction to IT/,
    ])

    await page.keyboard.press('Enter')
    await expect(quickAdd(page)).toBeHidden()
    await expect(toasts(page)).toContainText('Added to Upcoming')
    await expect(toasts(page)).toContainText('Read chapter 4')
    await expect(toasts(page).getByRole('button', { name: 'Open' })).toBeVisible()

    const [task] = titled(await storedTasks(page), 'Read chapter 4')
    expect(task).toMatchObject({
      dueDate: '2026-09-30',
      dueTime: '14:00',
      priority: 3,
      estimatePomodoros: 2,
      tags: ['C182'],
      recurrence: null,
    })
    expect(task?.milestoneId).toBeTruthy() // linked to the C182 course
    expect(task?.goalId).toBeTruthy()

    // ...and it shows up where the toast said it would.
    await page.goto('/tasks/upcoming')
    await expect(page.getByRole('main').getByText('Read chapter 4', { exact: true })).toBeVisible()
  })

  test('the toast\'s Open button goes to the new task', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).fill('Book a proctoring slot for D278 tomorrow')
    await page.keyboard.press('Enter')
    await toasts(page).getByRole('button', { name: 'Open' }).click()
    await expect(page).toHaveURL(/\/task\/[^/]+$/)
    await expect(page.getByRole('main')).toContainText('Book a proctoring slot for D278')
    await expect(toasts(page)).not.toContainText('Added to Upcoming')
  })

  test('a task with no date lands in the Inbox; today lands in Today', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).fill('Renew library card')
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Added to Inbox')

    await page.keyboard.press('q')
    await quickAddField(page).fill('Call the registrar today at 3')
    await parsedChips(page).first().waitFor()
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Added to Today')

    const tasks = await storedTasks(page)
    expect(titled(tasks, 'Renew library card')[0]?.dueDate).toBeNull()
    expect(titled(tasks, 'Call the registrar')[0]).toMatchObject({
      dueDate: '2026-09-29',
      dueTime: '15:00',
    })
  })

  test('Shift+Enter adds and keeps the field open for the next task', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).fill('Read chapter 5 #C182')
    await page.keyboard.press('Shift+Enter')
    await expect(toasts(page)).toContainText('Added to Inbox')
    await expect(quickAdd(page)).toBeVisible()
    await expect(quickAddField(page)).toHaveValue('')
    await expect(quickAddField(page)).toBeFocused()

    await quickAddField(page).fill('Water plants daily')
    await page.keyboard.press('Shift+Enter')
    await expect(quickAddField(page)).toHaveValue('')
    await expect(quickAdd(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toBeHidden()

    const tasks = await storedTasks(page)
    expect(titled(tasks, 'Read chapter 5')).toHaveLength(1)
    expect(titled(tasks, 'Water plants')[0]?.recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      byWeekday: [],
    })
  })

  test('a title is required; nothing is created without one', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).fill('tomorrow')
    await expect(parsedChips(page)).toHaveText(['Tomorrow'])
    await page.keyboard.press('Enter')
    await expect(quickAdd(page).getByRole('alert')).toHaveText('Give the task a title first.')
    await expect(quickAdd(page)).toBeVisible()
    expect(await storedTasks(page)).toHaveLength(0)

    // Typing on clears the complaint.
    await quickAddField(page).pressSequentially(' review')
    await expect(quickAdd(page).getByRole('alert')).toHaveCount(0)
  })

  test('words like "Weekly review" stay in the title', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).fill('Weekly review')
    await expect(quickAdd(page).getByRole('list', { name: 'Parsed details' })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Added to Inbox')
    const [task] = titled(await storedTasks(page), 'Weekly review')
    expect(task?.recurrence).toBeNull()
  })

  test('mod+enter opens it from anywhere, even from the palette; Esc closes', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('Control+k')
    await expect(paletteInput(page)).toBeFocused()
    await page.keyboard.press('Control+Enter')
    await expect(quickAdd(page)).toBeVisible()
    await expect(paletteInput(page)).toHaveCount(0)
    await expect(quickAddField(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toBeHidden()
  })

  test('single-key shortcuts stay quiet while typing in the field', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    await quickAddField(page).pressSequentially('quick ? g t / questions')
    await expect(quickAddField(page)).toHaveValue('quick ? g t / questions')
    await expect(shortcutSheet(page)).toHaveCount(0)
    await expect(paletteInput(page)).toHaveCount(0)
  })

  test('the phone "+" button opens a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/', 'empty')
    await page.getByRole('button', { name: 'Quick add task' }).click()
    await expect(quickAddField(page)).toBeFocused()
    const box = await quickAdd(page).boundingBox()
    expect(box).not.toBeNull()
    // Full width, resting on the bottom edge.
    expect(box?.width).toBeGreaterThanOrEqual(374)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(811)
    await quickAddField(page).fill('Read chapter 4 tomorrow 2p')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(quickAdd(page)).toBeHidden()
    await expect(toasts(page)).toContainText('Added to Upcoming')
    // No horizontal scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('command palette', () => {
  test('mod+k opens it, "Go to" runs a page, and recents lead the next time', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('Control+k')
    await expect(paletteInput(page)).toBeFocused()
    // Empty query: actions and pages, with shortcut hints.
    await expect(page.getByRole('group', { name: 'Actions' })).toContainText('New task')
    await expect(page.getByRole('group', { name: 'Pages' })).toContainText('Go to Today')
    await expect(page.getByRole('option', { name: /New task/ })).toContainText('Q')

    await paletteInput(page).fill('prog')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(paletteInput(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/progress$/)

    await page.keyboard.press('Control+k')
    const recent = page.getByRole('group', { name: 'Recent' })
    await expect(recent).toContainText('Go to Progress')
    // mod+k again closes it.
    await page.keyboard.press('Control+k')
    await expect(paletteInput(page)).toHaveCount(0)
  })

  test('the "New task" command opens quick add; the sidebar button opens the palette', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await page.getByRole('button', { name: 'Search and commands' }).click()
    await paletteInput(page).fill('new task')
    await page.keyboard.press('Enter')
    await expect(paletteInput(page)).toHaveCount(0)
    await expect(quickAddField(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toBeHidden()
  })

  test('shows an empty state for a query nothing matches, and closes on Esc', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('zzqxv')
    // Drawn text for sighted users, plus a live-region announcement for screen readers.
    await expect(page.locator('p', { hasText: 'No results for zzqxv' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'No results for zzqxv' })).toBeAttached()
    await page.keyboard.press('Escape')
    await expect(paletteInput(page)).toHaveCount(0)
  })

  test('"/" opens it in search mode', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('/')
    await expect(paletteInput(page)).toBeFocused()
    await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Search tasks, goals, pages')
    await expect(page.getByRole('group', { name: 'Actions' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Search or run a command')
  })

  test('finds a task by a fuzzy query and opens it', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('q')
    await quickAddField(page).fill('Read chapter 4 tomorrow 2p #C182 !high ~2')
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Added to Upcoming')
    await toasts(page).getByRole('button', { name: 'Dismiss' }).click()

    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('rd chap 4')
    const hit = page.getByRole('option', { name: /Read chapter 4/ })
    await expect(hit).toBeVisible()
    await expect(page.getByRole('group', { name: 'Tasks' })).toContainText('Read chapter 4')
    await page.keyboard.press('Enter')
    await expect(paletteInput(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/(task\/|tasks)/)
  })
})

test.describe('shortcut sheet', () => {
  test('? lists every registered shortcut by group, filters, and closes on Esc', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('?')
    await expect(shortcutSheet(page)).toBeVisible()
    const filter = shortcutSheet(page).getByRole('searchbox', { name: 'Filter shortcuts' })
    await expect(filter).toBeFocused()

    for (const heading of ['General', 'Navigation', 'Tasks']) {
      await expect(shortcutSheet(page).getByRole('heading', { name: heading })).toBeVisible()
    }
    const general = shortcutSheet(page).getByRole('region', { name: 'General' })
    await expect(general).toContainText('Open the command palette')
    await expect(general).toContainText('Show keyboard shortcuts')
    await expect(shortcutSheet(page).getByRole('region', { name: 'Tasks' })).toContainText(
      'Quick add a task',
    )

    await filter.fill('go to prog')
    await expect(shortcutSheet(page).locator('dt')).toHaveText(['Go to Progress'])
    await filter.fill('zzqxv')
    await expect(shortcutSheet(page).getByText('No matching shortcuts').first()).toBeVisible()
    await shortcutSheet(page).getByRole('button', { name: 'Clear filter' }).click()
    await expect(filter).toHaveValue('')

    await page.keyboard.press('Escape')
    await expect(shortcutSheet(page)).toBeHidden()
  })

  test('the palette lists "Keyboard shortcuts" and opens the sheet', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('keyboard')
    await page.keyboard.press('Enter')
    await expect(shortcutSheet(page)).toBeVisible()
  })
})
