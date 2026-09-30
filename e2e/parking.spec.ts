import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'

/**
 * Phase 11a: the distraction parking lot. `p` during focus opens a tiny input, Enter parks the thought,
 * and it is sorted afterwards from the end dialog or the Today card. Like focus.spec.ts these run on
 * `page.clock`, which starts at 09:30 and lets `fastForward` end a session at once.
 */

test.use({ fixedClock: false })

const MENTOR = 'Email mentor about term plan'
const THOUGHT = 'Look up the C182 OA schedule'

const endDialog = (page: Page) => page.getByRole('dialog', { name: 'Done with this task?' })
const popover = (page: Page) => page.getByRole('dialog', { name: 'Park a thought' })
const thoughtInput = (page: Page) => page.getByRole('textbox', { name: /Thought or urge/ })
const toggle = (page: Page) => page.getByTestId('timer-toggle')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

interface StoredParking {
  id: string
  text: string
  sessionId: string | null
  status: 'open' | 'done' | 'converted'
  taskId: string | null
}
interface StoredSession {
  id: string
  status: string
}
interface StoredTask {
  id: string
  title: string
  doDate: string | null
}

async function openApp(page: Page, path = '/focus'): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await gotoApp(page, path, 'wgu')
  if (path === '/focus') await expect(page.getByTestId('timer-display')).toBeVisible()
  await page.clock.setSystemTime(FIXED_NOW)
}

/** Links a task and starts a pomodoro on the Focus page. */
async function startFocus(page: Page): Promise<void> {
  await page.getByTestId('task-picker').click()
  await page.getByRole('combobox', { name: 'Search open tasks' }).fill(MENTOR)
  await page.getByRole('option', { name: MENTOR }).first().click()
  await page.getByTestId('timer-start').click()
  await expect(toggle(page)).toHaveText('Pause')
}

const parked = (page: Page) => readTable<StoredParking>(page, 'parkingLot')

test.describe('Parking lot', () => {
  test('p parks a thought during focus; the end dialog lists it and Convert to task makes the task', async ({
    page,
  }) => {
    await openApp(page)
    await startFocus(page)
    // Where keyboard focus is now (the Pause button, which the click gave it) is where it should return to.
    await expect(toggle(page)).toBeFocused()

    await page.keyboard.press('p')
    await expect(popover(page)).toBeVisible()
    await expect(popover(page)).toContainText('Thought or urge? Park it here.')
    await expect(thoughtInput(page)).toBeFocused()

    await page.keyboard.type(THOUGHT)
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect(page.getByTestId('parking-notice')).toContainText('Parked')
    await expect(toggle(page)).toBeFocused()

    // Saved with the running session, still open.
    await expect.poll(async () => (await parked(page)).length).toBe(1)
    const [row] = await parked(page)
    const [running] = await readTable<StoredSession>(page, 'sessions')
    expect(row).toMatchObject({ text: THOUGHT, status: 'open', taskId: null })
    expect(row?.sessionId).toBe(running?.id)
    // The page did not react to the key: the timer is still running.
    await expect(toggle(page)).toHaveText('Pause')

    // The Focus page's aside says how many this session has.
    await expect(page.getByText('1 parked this session')).toBeVisible()

    await page.clock.fastForward('25:00')
    const dialog = endDialog(page)
    await expect(dialog).toBeVisible()
    const section = dialog.getByRole('region', { name: 'Parked during this session' })
    await expect(section).toContainText('Parked during this session (1)')
    await expect(section.getByTestId('parked-item')).toHaveText(THOUGHT)

    // Collapsible, and calm about it.
    const heading = section.getByRole('button', { name: /Parked during this session/ })
    await expect(heading).toHaveAttribute('aria-expanded', 'true')
    await heading.click()
    await expect(section.getByTestId('parked-item')).toBeHidden()
    await heading.click()
    await expect(section.getByTestId('parked-item')).toBeVisible()

    await section.getByRole('button', { name: 'Convert to task' }).click()
    await expect(toasts(page)).toContainText('Added to your tasks')
    await expect(dialog.getByText('Everything you parked is sorted.')).toBeVisible()
    await expect(section).toBeHidden()

    const tasks = (await readTable<StoredTask>(page, 'tasks')).filter((t) => t.title === THOUGHT)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.doDate).toBeNull()
    expect(await parked(page)).toMatchObject([{ status: 'converted', taskId: tasks[0]?.id }])

    // It is in the Inbox for real.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.goto('/tasks/inbox')
    await expect(page.getByText(THOUGHT).first()).toBeVisible()
  })

  test('Undo on the toast takes the task back and the thought is waiting again', async ({
    page,
  }) => {
    await openApp(page, '/')
    await putRows(page, 'parkingLot', [
      {
        id: 'p1',
        createdAt: 1,
        updatedAt: 1,
        text: THOUGHT,
        sessionId: null,
        status: 'open',
        taskId: null,
      },
    ])
    await gotoApp(page, '/')
    const card = page.getByTestId('parked-card')
    await expect(card).toContainText('Parked thoughts (1)')

    await card.getByRole('button', { name: 'Convert to task' }).click()
    await expect(toasts(page)).toContainText('Added to your tasks')
    await expect(card).toContainText('Parked thoughts (0)')
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(card).toContainText('Parked thoughts (1)')
    expect(
      (await readTable<StoredTask>(page, 'tasks')).filter((t) => t.title === THOUGHT),
    ).toHaveLength(0)
    expect(await parked(page)).toMatchObject([{ status: 'open', taskId: null }])
  })

  test('full-screen focus: p opens the box inside it, Esc closes only the box, Enter parks', async ({
    page,
  }) => {
    await openApp(page)
    await startFocus(page)
    await page.keyboard.press('f')
    const fs = page.getByTestId('fullscreen-focus')
    await expect(fs).toBeVisible()

    await page.keyboard.press('p')
    await expect(fs.getByTestId('parking-popover')).toBeVisible()
    // Focus stays in the box: the view's own keyboard trap does not pull it out.
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('an idea that will not be kept')
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(fs).toBeVisible()
    expect(await parked(page)).toHaveLength(0)

    await page.keyboard.press('p')
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('buy oat milk')
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect(fs).toBeVisible()
    await expect(fs.getByTestId('parking-notice')).toBeVisible()
    await expect.poll(async () => (await parked(page)).map((p) => p.text)).toEqual(['buy oat milk'])

    // Focus went back inside the view, not to the page behind it; Esc then leaves full screen.
    const inside = await page.evaluate(() =>
      document.querySelector('[data-testid="fullscreen-focus"]')?.contains(document.activeElement),
    )
    expect(inside).toBe(true)
    await page.keyboard.press('Escape')
    await expect(fs).toBeHidden()
  })

  test('a thought that was typed is kept when you click away', async ({ page }) => {
    await openApp(page)
    await startFocus(page)
    await page.keyboard.press('p')
    await page.keyboard.type('email the registrar')
    await page.getByTestId('round-counter').click()
    await expect(popover(page)).toBeHidden()
    await expect
      .poll(async () => (await parked(page)).map((p) => p.text))
      .toEqual(['email the registrar'])
  })

  test('an empty box parks nothing', async ({ page }) => {
    await openApp(page)
    await startFocus(page)
    await page.keyboard.press('p')
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    expect(await parked(page)).toHaveLength(0)
    await expect(page.getByTestId('parking-notice')).toHaveCount(0)
  })

  test('on another page p works while a session runs, from the mini timer and the palette', async ({
    page,
  }) => {
    const nav = page.getByRole('navigation', { name: 'Main' })
    await openApp(page)
    // With nothing running, p on Today does nothing.
    await nav.getByRole('link', { name: 'Today', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.keyboard.press('p')
    await expect(popover(page)).toHaveCount(0)
    await expect(page.getByTestId('sidebar-park')).toHaveCount(0)

    await nav.getByRole('link', { name: 'Focus', exact: true }).click()
    await startFocus(page)
    await nav.getByRole('link', { name: 'Today', exact: true }).click()
    await expect(page.getByTestId('mini-timer')).toBeVisible()

    await page.getByTestId('sidebar-park').click()
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('renew the library book')
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()

    await page.keyboard.press('p')
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('check the D278 due date')
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()

    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('Park a thought')
    await page
      .getByRole('option', { name: /Park a thought/ })
      .first()
      .click()
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('sign up for the study group')
    await page.keyboard.press('Enter')

    // Rows come back in key order, so compare without regard to it.
    await expect
      .poll(async () => (await parked(page)).map((p) => p.text).sort())
      .toEqual(['check the D278 due date', 'renew the library book', 'sign up for the study group'])
    // All three belong to the running session, and the Today card lists them.
    const [running] = await readTable<StoredSession>(page, 'sessions')
    for (const item of await parked(page)) expect(item.sessionId).toBe(running?.id)
    await expect(page.getByTestId('parked-card')).toContainText('Parked thoughts (3)')
  })

  test('the palette offers the parking commands only when they help, so "prog" still finds Progress', async ({
    page,
  }) => {
    const options = page.getByRole('option')
    await openApp(page, '/')
    // Nothing running and nothing parked: neither command is listed, and a page name is not crowded out.
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('park')
    await expect(options.filter({ hasText: 'Park a thought' })).toHaveCount(0)
    await input.fill('prog')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('Go to Progress')
    await page.keyboard.press('Escape')

    // On the Focus page "Park a thought" is offered even with nothing running.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Focus', exact: true })
      .click()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('park')
    await expect(options.filter({ hasText: 'Park a thought' })).toHaveCount(1)
    await expect(options.filter({ hasText: 'Review parked thoughts' })).toHaveCount(0)
  })

  test('the Park a thought button on the Focus page works without a keyboard', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('park-open').click()
    await expect(thoughtInput(page)).toBeFocused()
    await page.keyboard.type('read the syllabus')
    await page.keyboard.press('Enter')
    // No session was running, so it is parked on none.
    await expect
      .poll(async () => await parked(page))
      .toMatchObject([{ text: 'read the syllabus', sessionId: null }])
    await expect(page.getByTestId('park-open')).toBeFocused()
  })
})

test.describe('Parked thoughts on Today', () => {
  const seeded: ReadonlyArray<readonly [id: string, text: string]> = [
    ['p1', 'Look up the C182 OA schedule'],
    ['p2', 'Ask about the D278 proctoring rules'],
    ['p3', 'Email Dr. Okafor about the C779 project'],
  ]
  const rows = seeded.map(([id, text], i) => ({
    id,
    createdAt: 1000 + i,
    updatedAt: 1000 + i,
    text,
    sessionId: null,
    status: 'open',
    taskId: null,
  }))

  test('lists what is waiting; Done and Delete each offer Undo; the card folds away', async ({
    page,
  }) => {
    await openApp(page, '/')
    await putRows(page, 'parkingLot', rows)
    await gotoApp(page, '/')
    const card = page.getByTestId('parked-card')
    await expect(card).toContainText('Parked thoughts (3)')
    // Oldest first.
    await expect(card.getByTestId('parked-item')).toHaveText(rows.map((r) => r.text))

    await card.getByTestId('parked-item').first().getByRole('button', { name: 'Done' }).click()
    await expect(card).toContainText('Parked thoughts (2)')
    await expect(toasts(page)).toContainText('Marked done')
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(card).toContainText('Parked thoughts (3)')

    await card.getByTestId('parked-item').nth(1).getByRole('button', { name: 'Delete' }).click()
    await expect(card).toContainText('Parked thoughts (2)')
    await expect(card).not.toContainText('D278 proctoring')
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(card).toContainText('D278 proctoring')

    const toggleCard = card.getByRole('button', { name: /Parked thoughts/ })
    await toggleCard.click()
    await expect(card.getByTestId('parked-list')).toBeHidden()
    await toggleCard.click()
    await expect(card.getByTestId('parked-list')).toBeVisible()
    await expect(card.getByTestId('parked-item')).toHaveCount(3)
  })

  test('says so calmly when nothing is parked', async ({ page }) => {
    await openApp(page, '/')
    const card = page.getByTestId('parked-card')
    await expect(card).toContainText('Parked thoughts (0)')
    await expect(card).toContainText('Nothing parked.')
    await expect(card.getByTestId('parked-list')).toHaveCount(0)
  })

  test('"Review parked thoughts" in the palette lands on the card from another page', async ({
    page,
  }) => {
    await openApp(page, '/goals')
    await putRows(page, 'parkingLot', rows)
    await gotoApp(page, '/goals')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('Review parked')
    await page.getByRole('option', { name: /Review parked thoughts/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByTestId('parked-card').getByRole('button', { name: /Parked thoughts/ }),
    ).toBeFocused()
  })

  test('at 375 px there is no horizontal scroll and the buttons stay in reach', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openApp(page, '/')
    await putRows(page, 'parkingLot', rows)
    await gotoApp(page, '/')
    const card = page.getByTestId('parked-card')
    await expect(card.getByTestId('parked-item')).toHaveCount(3)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await card
      .getByTestId('parked-item')
      .first()
      .getByRole('button', { name: 'Convert to task' })
      .click()
    await expect(card).toContainText('Parked thoughts (2)')
  })
})
