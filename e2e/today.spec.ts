import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 3E: the Today screen. Sample data (`?seed=wgu`) is dated around the fixed clock, Tue
 * 2026-09-29 09:30, so today has three pieces of goal work, two tasks of your own and three
 * rolled-over tasks (1, 2 and 3 days overdue), and nothing is finished yet.
 */

const NOW_TITLE = 'C779 · Unit 3: CSS layout (45 min)'
const SECOND_TITLE = 'C779 · Unit 3: CSS layout (30 min)'
const MENTOR = 'Email mentor about term plan'

const nowCard = (page: Page) => page.locator('[aria-labelledby="now-title"]')
const nowTitle = (page: Page) => page.locator('#now-title')
const group = (page: Page, label: string) =>
  page.getByRole('region', { name: new RegExp(`^${label}`) })
const rows = (region: Locator) => region.getByRole('listitem')
const xpToday = (page: Page) => page.getByText('earned today').locator('..')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

test.describe('Today', () => {
  test('shows the greeting, the Now card, the groups and the aside', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Good morning — Tuesday, Sep 29',
    )

    // The Now card: the task already in progress, with the three actions.
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)
    await expect(nowCard(page)).toContainText('In progress')
    await expect(nowCard(page)).toContainText('45 min')
    await expect(nowCard(page).getByRole('button', { name: 'Start focus' })).toBeVisible()
    await expect(nowCard(page).getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(nowCard(page).getByRole('button', { name: 'Skip' })).toBeVisible()

    // Groups, in the brief's order, with the sample counts. Nothing is finished yet.
    await expect(rows(group(page, 'From your goals'))).toHaveCount(3)
    await expect(rows(group(page, 'Your tasks'))).toHaveCount(2)
    await expect(rows(group(page, 'Rolled over'))).toHaveCount(3)
    await expect(group(page, 'Completed today')).toHaveCount(0)
    await expect(group(page, 'From your goals').getByText('C779').first()).toBeVisible()

    // The stat row: daily goal from settings (6), no streak and no XP yet.
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 6 pomodoros',
    )
    await expect(page.getByText('day streak').locator('..')).toContainText('0')
    await expect(xpToday(page)).toContainText('0 XP')

    // The aside: the nearest target and a 14-day heatmap.
    await expect(page.getByRole('heading', { name: 'Upcoming target' })).toBeVisible()
    await expect(page.getByText('16 days', { exact: true })).toBeVisible()
    await expect(page.getByText('D278')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Activity, oldest day first' }).getByRole('img'),
    ).toHaveCount(14)
  })

  test('rolled over tasks say how many days overdue, most urgent first', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    const rolled = group(page, 'Rolled over')
    await expect(rolled).toBeVisible()
    await expect(rows(rolled)).toHaveText([
      /Reply to Financial Aid.*1 day overdue/,
      /Renew library card.*3 days overdue/,
      /C779 · Unit 2.*2 days overdue/,
    ])
    await expect(rolled.getByRole('button', { name: 'Move all to today' })).toBeVisible()
  })

  test('completing a task moves it to Completed today and adds XP; Undo puts it back', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    const yours = group(page, 'Your tasks')
    await expect(rows(yours)).toHaveCount(2)
    await expect(group(page, 'Completed today')).toHaveCount(0)
    await expect(xpToday(page)).toContainText('0 XP')

    await yours.getByRole('checkbox', { name: `Done: ${MENTOR}` }).click()

    // The row plays its motion and leaves, and the toast reports the XP.
    await expect(toasts(page)).toContainText(`Completed “${MENTOR}”`)
    await expect(toasts(page)).toContainText('+20 XP')
    await expect(rows(yours)).toHaveCount(1)

    const completed = group(page, 'Completed today')
    await expect(completed.getByRole('button', { name: /Completed today\s*1/ })).toBeVisible()
    await expect(xpToday(page)).toContainText('+20 XP')
    await expect(completed.getByRole('button', { name: /Completed today/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(completed.getByRole('listitem')).toHaveCount(0)

    // Open the disclosure: the finished row is there, with its time and XP.
    await completed.getByRole('button', { name: /Completed today/ }).click()
    await expect(rows(completed)).toHaveCount(1)
    await expect(rows(completed)).toContainText(MENTOR)
    await expect(rows(completed)).toContainText('+20 XP')

    // Undo: the task is back where it was and the XP is gone.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(rows(yours)).toHaveCount(2)
    await expect(group(page, 'Completed today')).toHaveCount(0)
    await expect(xpToday(page)).toContainText('0 XP')
    await expect(xpToday(page)).not.toContainText('+')
  })

  test('Done on the Now card completes the task and the next one becomes Now', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)
    await nowCard(page).getByRole('button', { name: 'Done' }).click()

    await expect(nowTitle(page)).toHaveText(SECOND_TITLE)
    await expect(rows(group(page, 'From your goals'))).toHaveCount(2)
    await expect(
      group(page, 'Completed today').getByRole('button', { name: /Completed today\s*1/ }),
    ).toBeVisible()
    await expect(xpToday(page)).toContainText('+')
  })

  test('Skip drops the Now task for today, and Undo brings it back', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await nowCard(page).getByRole('button', { name: 'Skip' }).click()
    await expect(toasts(page)).toContainText('for today')
    await expect(nowTitle(page)).toHaveText(SECOND_TITLE)
    await expect(rows(group(page, 'From your goals'))).toHaveCount(2)

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)
    await expect(rows(group(page, 'From your goals'))).toHaveCount(3)
  })

  test('shift+n skips and shift+t moves the rolled-over tasks', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)

    await page.keyboard.press('Shift+N')
    await expect(toasts(page)).toContainText('for today')
    await expect(nowTitle(page)).toHaveText(SECOND_TITLE)

    await page.keyboard.press('Shift+T')
    await expect(toasts(page)).toContainText('Moved 3 tasks to today')
    await expect(group(page, 'Rolled over')).toHaveCount(0)
  })

  test('Move all to today reschedules the rolled-over tasks, and Undo restores them', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await group(page, 'Rolled over').getByRole('button', { name: 'Move all to today' }).click()

    await expect(toasts(page)).toContainText('Moved 3 tasks to today')
    await expect(group(page, 'Rolled over')).toHaveCount(0)
    await expect(rows(group(page, 'Your tasks'))).toHaveCount(4)
    await expect(rows(group(page, 'From your goals'))).toHaveCount(4)

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(rows(group(page, 'Rolled over'))).toHaveCount(3)
    await expect(rows(group(page, 'Your tasks'))).toHaveCount(2)
  })

  test('j, k and x work on the rows, and shift+x completes the Now task', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(rows(group(page, 'From your goals'))).toHaveCount(3)

    // j, j selects the second row of the first group; x completes it.
    await page.keyboard.press('j')
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText(`Completed “${SECOND_TITLE}”`)
    await expect(rows(group(page, 'From your goals'))).toHaveCount(2)

    // k walks back up; the shortcut sheet lists Today's own keys.
    await page.keyboard.press('k')
    await page.keyboard.press('?')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toContainText('Complete the Now task')
    await expect(sheet).toContainText('Move all rolled-over tasks to today')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    await page.keyboard.press('Shift+X')
    await expect(toasts(page)).toContainText(`Completed “${NOW_TITLE}”`)
  })

  test('Start focus opens the Focus route for the Now task', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await nowCard(page).getByRole('button', { name: 'Start focus' }).click()
    await expect(page).toHaveURL(/\/focus\?task=task-c779-u3-2$/)
  })

  test('with nothing left, the Now card says so and offers quick add', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)
    const skip = nowCard(page).getByRole('button', { name: 'Skip' })
    for (let i = 0; i < 12 && (await skip.count()) > 0; i++) {
      const was = await nowTitle(page).innerText()
      await skip.click()
      await expect(nowTitle(page)).not.toHaveText(was)
    }
    await expect(page.getByRole('heading', { name: 'You’re clear for now' })).toBeVisible()
    await expect(group(page, 'From your goals')).toHaveCount(0)
    await expect(group(page, 'Rolled over')).toHaveCount(0)

    await nowCard(page).getByRole('button', { name: 'Add a task' }).click()
    await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
  })

  test('the palette moves rolled-over tasks from any page', async ({ page }) => {
    await gotoApp(page, '/tasks/all', 'wgu')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('rolled-over')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/$/)
    await expect(toasts(page)).toContainText('Moved 3 tasks to today')
    await expect(group(page, 'Rolled over')).toHaveCount(0)
  })

  test('Esc still closes the tablet drawer, and clears a selected row when there is one', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await gotoApp(page, '/', 'wgu')
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)

    // Today's list shortcuts must not swallow the Escape that belongs to the drawer.
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    // With a row selected, Escape clears the selection instead.
    await page.keyboard.press('j')
    const first = rows(group(page, 'From your goals')).first()
    await expect(first.locator('[data-selected]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(first.locator('[data-selected]')).toHaveCount(0)
  })

  test('a brand-new user gets a friendly empty state with both first steps', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good morning')
    await expect(page.getByRole('heading', { name: 'A clear day to plan' })).toBeVisible()
    await expect(nowCard(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Add a task' }).click()
    await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeHidden()

    await page.getByRole('button', { name: 'Create a goal' }).click()
    await expect(page).toHaveURL(/\/goals\/new$/)
  })

  test('the date wraps under the greeting on a phone and nothing scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/', 'wgu')
    await expect(nowTitle(page)).toHaveText(NOW_TITLE)
    const date = page.locator('main time')
    const title = page.locator('main h1 > span').first()
    const [dateBox, titleBox] = await Promise.all([date.boundingBox(), title.boundingBox()])
    expect(dateBox && titleBox && dateBox.y > titleBox.y + titleBox.height - 1).toBe(true)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
