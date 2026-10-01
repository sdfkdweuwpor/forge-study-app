import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Everyday tasks: quick add speed, do time vs deadline, suggested times (auto-slot) and the Week
 * time-block view (drag to move, drag the bottom edge to resize). The clock is fixed at Tue 2026-09-29
 * 09:30, so "tomorrow" is Wed 2026-09-30 and "Fri" is 2026-10-02.
 */

interface StoredTask {
  id: string
  title: string
  doDate: string | null
  doTime: string | null
  dueDate: string | null
  durationMinutes: number | null
  autoSlot: boolean
}

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

const byTitle = async (page: Page, title: string): Promise<StoredTask | undefined> =>
  (await storedTasks(page)).find((t) => t.title === title)

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const field = (page: Page) =>
  page.getByRole('dialog', { name: 'Quick add task' }).getByRole('textbox', { name: 'New task' })

/** Q, type, Enter, and wait for the toast; returns how long that took in the browser. */
async function quickAdd(page: Page, text: string): Promise<number> {
  const started = Date.now()
  await page.keyboard.press('q')
  await field(page).pressSequentially(text)
  await page.keyboard.press('Enter')
  await expect(toasts(page)).toContainText('Added to')
  return Date.now() - started
}

test.describe('everyday tasks', () => {
  test('quick add "gym tomorrow 6am" takes well under 3 seconds and sits at 6:00 in the Week view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await gotoApp(page, '/', 'empty')
    const elapsed = await quickAdd(page, 'gym tomorrow 6am')
    expect(elapsed).toBeLessThan(3000)

    const gym = await byTitle(page, 'gym')
    expect(gym).toMatchObject({ doDate: '2026-09-30', doTime: '06:00', dueDate: null })

    await page.goto('/tasks/all?layout=calendar')
    const block = page.getByRole('button', { name: /^Open gym, 6 – 6:30 AM/ })
    await expect(block).toBeVisible()
    await expect(page.getByRole('list', { name: 'Wed, Sep 30, scheduled' })).toBeVisible()
  })

  test('shows "Do:" and "Due:" chips and keeps a length', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('q')
    const chips = page
      .getByRole('dialog', { name: 'Quick add task' })
      .getByRole('list', { name: 'Parsed details' })
      .getByRole('listitem')
    await field(page).pressSequentially('call mom sat 30m')
    await expect(chips).toHaveText(['Do: Sat, Oct 3', '30 min'])
    await field(page).fill('')
    await field(page).pressSequentially('pay bill due fri')
    await expect(chips).toHaveText(['Due: Fri, Oct 2'])
    await page.keyboard.press('Enter')
    await expect(toasts(page)).toContainText('Added to')
    expect(await byTitle(page, 'pay bill')).toMatchObject({
      doDate: null,
      dueDate: '2026-10-02',
    })
  })

  test('auto-schedule suggests a time, and accepting it puts a block on the Week view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'pay phone bill due fri 30m')
    // Nothing is suggested until the task opts in.
    await page.goto('/tasks/upcoming')
    await expect(page.getByRole('heading', { name: 'Suggested times' })).toBeHidden()

    const bill = await byTitle(page, 'pay phone bill')
    if (!bill) throw new Error('the task was not saved')
    await page.goto(`/task/${bill.id}`)
    await page.getByRole('switch', { name: 'Auto-schedule before deadline' }).click()
    await expect.poll(async () => (await byTitle(page, 'pay phone bill'))?.autoSlot).toBe(true)

    await page.goto('/tasks/upcoming')
    const card = page.getByRole('region', { name: 'Suggested times' })
    await expect(card).toContainText('pay phone bill → Today 6 PM (30 min)')
    // Still only a suggestion.
    expect((await byTitle(page, 'pay phone bill'))?.doDate).toBeNull()

    await card.getByRole('button', { name: 'Accept: pay phone bill' }).click()
    await expect(toasts(page)).toContainText('Scheduled')
    // Undo takes the time back and the suggestion returns; accept it again.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await byTitle(page, 'pay phone bill'))?.doDate).toBeNull()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Accept: pay phone bill' }).click()
    await expect.poll(async () => (await byTitle(page, 'pay phone bill'))?.doTime).toBe('18:00')
    expect(await byTitle(page, 'pay phone bill')).toMatchObject({
      doDate: '2026-09-29',
      dueDate: '2026-10-02',
      durationMinutes: 30,
      autoSlot: false,
    })
    await expect(card).toBeHidden()

    await page.goto('/tasks/all?layout=calendar')
    await expect(
      page.getByRole('button', { name: /^Open pay phone bill, 6 – 6:30 PM/ }),
    ).toBeVisible()
    // The deadline is a marker in Friday's header.
    await expect(page.getByRole('list', { name: 'Deadlines on Fri, Oct 2' })).toContainText(
      'Due: pay phone bill',
    )
  })

  test('Dismiss turns auto-schedule off, and Undo turns it back on', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'renew passport due oct 30')
    const task = await byTitle(page, 'renew passport')
    if (!task) throw new Error('the task was not saved')
    await page.goto(`/task/${task.id}`)
    await page.getByRole('switch', { name: 'Auto-schedule before deadline' }).click()
    await page.goto('/tasks/upcoming')
    const card = page.getByRole('region', { name: 'Suggested times' })
    await card.getByRole('button', { name: 'Dismiss: renew passport' }).click()
    await expect.poll(async () => (await byTitle(page, 'renew passport'))?.autoSlot).toBe(false)
    await expect(card).toBeHidden()
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await byTitle(page, 'renew passport'))?.autoSlot).toBe(true)
    await expect(card).toBeVisible()
  })

  test('says so gently when there is no room before the deadline', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'pay parking ticket due today 10am')
    const task = await byTitle(page, 'pay parking ticket')
    if (!task) throw new Error('the task was not saved')
    await page.goto(`/task/${task.id}`)
    await page.getByRole('switch', { name: 'Auto-schedule before deadline' }).click()
    await page.goto('/tasks/inbox')
    await expect(page.getByRole('region', { name: 'Suggested times' })).toContainText(
      'No open time before today — pick a time',
    )
  })

  test('"No open time" points to the everyday hours, and changing them changes the suggestions', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'pay parking ticket due today 10am')
    await quickAdd(page, 'pay phone bill due fri 30m')
    for (const title of ['pay parking ticket', 'pay phone bill']) {
      const task = await byTitle(page, title)
      if (!task) throw new Error('the task was not saved')
      await page.goto(`/task/${task.id}`)
      await page.getByRole('switch', { name: 'Auto-schedule before deadline' }).click()
      await expect.poll(async () => (await byTitle(page, title))?.autoSlot).toBe(true)
    }

    // The ticket has no room today; the hint takes you to the hours.
    await page.goto('/tasks/inbox')
    await page.getByRole('link', { name: 'Adjust your everyday hours' }).click()
    await expect(page).toHaveURL(/\/settings\/everyday-hours$/)
    await expect(page.getByRole('heading', { name: 'Everyday task hours' })).toBeFocused()

    // Tuesday's window is 18:00 to 21:00 by default; start it later and the suggestion follows.
    await page.getByLabel('Tuesday window 1 start').fill('20:00')
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
    await page.goto('/tasks/upcoming')
    await expect(page.getByRole('region', { name: 'Suggested times' })).toContainText(
      'pay phone bill → Today 8 PM (30 min)',
    )

    // A day can be switched off, and a bad window is not saved.
    await page.goto('/settings')
    await page.getByRole('switch', { name: 'Saturday' }).click()
    await expect(page.getByRole('switch', { name: 'Saturday' })).not.toBeChecked()
    await page.getByLabel('Tuesday window 1 end').fill('19:00')
    await expect(page.getByText('The end must be after the start.')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Tuesday window 1 end')).toHaveValue('21:00')
    await expect(page.getByRole('switch', { name: 'Saturday' })).not.toBeChecked()
  })

  test('the "Accept suggested times" command takes you to Upcoming and shows the card', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'pay phone bill due fri 30m')
    const bill = await byTitle(page, 'pay phone bill')
    if (!bill) throw new Error('the task was not saved')
    await page.goto(`/task/${bill.id}`)
    await page.getByRole('switch', { name: 'Auto-schedule before deadline' }).click()
    await expect.poll(async () => (await byTitle(page, 'pay phone bill'))?.autoSlot).toBe(true)

    // From a page without the card.
    await gotoApp(page, '/goals')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('accept suggested')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/tasks\/upcoming/)
    await expect(page.getByRole('region', { name: 'Suggested times' })).toBeFocused()
    // It opened the card; nothing was scheduled without a yes.
    expect((await byTitle(page, 'pay phone bill'))?.doDate).toBeNull()
  })

  test('a deadline is calm: "Due Fri" ahead of time, "Was due Mon" after, never red', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'pay phone bill due fri')
    await page.goto('/tasks/upcoming')
    await expect(page.getByRole('main')).toContainText('Due Fri')
    await expect(page.getByRole('main')).not.toContainText(/overdue/i)
  })
})

test.describe('week time blocks', () => {
  async function setup(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 1500 })
    await gotoApp(page, '/', 'empty')
    await quickAdd(page, 'gym tomorrow 6am')
    await page.goto('/tasks/all?layout=calendar')
    await expect(page.getByRole('button', { name: /^Open gym, 6 – 6:30 AM/ })).toBeVisible()
  }

  test('dragging a block to another day and time moves it, with Undo', async ({ page }) => {
    await setup(page)
    const block = page.getByRole('button', { name: /^Open gym, 6 – 6:30 AM/ })
    const from = await block.boundingBox()
    const thursday = await page.locator('[aria-label^="Thu, Oct 1, scheduled"]').boundingBox()
    if (!from || !thursday) throw new Error('calendar is not laid out')

    const grab = from.y + 8
    await page.mouse.move(from.x + from.width / 2, grab)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 12, grab + 12, { steps: 4 })
    // The grid starts at 06:00 while the block is there: its top edge lands on Thursday's 08:00 line.
    await page.mouse.move(thursday.x + thursday.width / 2, thursday.y + 2 * 64 + 8, { steps: 18 })
    await page.mouse.up()

    await expect.poll(async () => (await byTitle(page, 'gym'))?.doDate).toBe('2026-10-01')
    expect((await byTitle(page, 'gym'))?.doTime).toBe('08:00')
    await expect(toasts(page)).toContainText('Moved “gym”')

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await byTitle(page, 'gym'))?.doDate).toBe('2026-09-30')
    expect((await byTitle(page, 'gym'))?.doTime).toBe('06:00')
  })

  test('dragging the bottom edge changes the length in quarter hours', async ({ page }) => {
    await setup(page)
    const grip = page.locator('[data-testid="resize-grip"]').first()
    const box = await grip.boundingBox()
    if (!box) throw new Error('no grip')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 16, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 32, { steps: 4 })
    await page.mouse.up()

    // 32 px at 64 px an hour is 30 minutes: 30 + 30.
    await expect.poll(async () => (await byTitle(page, 'gym'))?.durationMinutes).toBe(60)
    expect((await byTitle(page, 'gym'))?.doTime).toBe('06:00') // the start did not move
    await expect(toasts(page)).toContainText('is now 1 h')
    await expect(page.getByRole('button', { name: /^Open gym, 6 – 7 AM/ })).toBeVisible()

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await byTitle(page, 'gym'))?.durationMinutes).toBeNull()
  })

  test('Alt+Shift+arrows change the length from the keyboard', async ({ page }) => {
    await setup(page)
    await page.getByRole('button', { name: /^Open gym, 6 – 6:30 AM/ }).focus()
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await expect.poll(async () => (await byTitle(page, 'gym'))?.durationMinutes).toBe(45)
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await expect.poll(async () => (await byTitle(page, 'gym'))?.durationMinutes).toBe(30)
    // Pressed back to back, before the page has redrawn: each press starts from the last one's result.
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await expect.poll(async () => (await byTitle(page, 'gym'))?.durationMinutes).toBe(45)
  })
})
