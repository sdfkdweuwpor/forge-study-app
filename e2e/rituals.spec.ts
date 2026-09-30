import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'

/**
 * Phase 11g: the daily rituals, and the routine templates the morning plan uses (11i). Sample data
 * (`?seed=wgu`) is dated around the fixed clock, Tue 2026-09-29 09:30: three pieces of goal work, two
 * tasks of your own and three carried-over tasks are open today. The evening tests move the clock to 18:30.
 */

const TODAY = '2026-09-29'
const TOMORROW = '2026-09-30'
const EVENING = new Date('2026-09-29T18:30:00-04:00')

const NOW_TITLE = 'C779 · Unit 3: CSS layout (45 min)'
const SECOND_TITLE = 'C779 · Unit 3: CSS layout (30 min)'
const FLASHCARDS = 'Review 14 C779 flashcards (~10 min)'
const MENTOR = 'Email mentor about term plan'
const ADDED = 'Call the bursar about the tuition plan'

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications', exact: true })
const prompt = (page: Page) => page.getByTestId('ritual-prompt')
const top3 = (page: Page) => page.getByTestId('top3-card')
const morning = (page: Page) => page.getByRole('dialog', { name: 'Morning plan' })
const evening = (page: Page) => page.getByRole('dialog', { name: 'Evening shutdown' })
const toastFor = (page: Page, text: string) =>
  toasts(page).locator('[data-variant]').filter({ hasText: text })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

interface StoredTask {
  id: string
  title: string
  status: string
  source: string
  doDate: string | null
  doTime: string | null
  durationMinutes: number | null
  schedulePinned: boolean
}
interface StoredRitual {
  id: string
  kind: string
  day: string
  top3: string[]
  reflection: string
  completedAt: number | null
}
interface StoredXp {
  key: string
  amount: number
  source: string
}
interface StoredSettings {
  id: string
  dailyGoalPomodoros: number
}
interface StoredTemplate {
  id: string
  kind: string
  name: string
  payload: { tasks: { title: string; durationMinutes?: number; doTime?: string }[] }
}

const tasks = (page: Page) => readTable<StoredTask>(page, 'tasks')
const rituals = (page: Page) => readTable<StoredRitual>(page, 'rituals')
const templates = (page: Page) => readTable<StoredTemplate>(page, 'templates')
const settings = async (page: Page) =>
  (await readTable<StoredSettings>(page, 'settings')).find((s) => s.id === 'app')

/** What the evening XP key nets to (a reversal counts against the award). */
async function eveningNet(page: Page, day = TODAY): Promise<number> {
  const events = await readTable<StoredXp>(page, 'xpEvents')
  return events
    .filter((e) => e.key === `ritual:evening:${day}`)
    .reduce((sum, e) => sum + e.amount, 0)
}
const eveningEvents = async (page: Page, day = TODAY): Promise<number> =>
  (await readTable<StoredXp>(page, 'xpEvents')).filter((e) => e.key === `ritual:evening:${day}`)
    .length

/** What Today lists as open on the seeded day: planned for today or carried over (7 of them once one is done). */
async function todaysOpen(page: Page): Promise<StoredTask[]> {
  return (await tasks(page)).filter(
    (t) => t.status !== 'done' && t.doDate !== null && t.doDate <= TODAY,
  )
}

/** Each of those tasks' planned day, time and pin, by id: what "exactly as before" is compared with. */
async function planned(
  page: Page,
): Promise<Record<string, [string | null, string | null, boolean]>> {
  return Object.fromEntries(
    (await tasks(page))
      .filter((t) => t.status !== 'done')
      .map((t) => [
        t.id,
        [t.doDate, t.doTime, t.schedulePinned] as [string | null, string | null, boolean],
      ]),
  )
}

async function openEveningFromPrompt(page: Page): Promise<void> {
  await prompt(page).getByRole('button', { name: 'Start evening shutdown' }).click()
  await expect(evening(page)).toBeVisible()
}

test.describe('Morning plan', () => {
  test('picks the top 3 (adding a task on the way), checks the goal work, sets the goal, pins the card', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(prompt(page)).toContainText('Plan your day')
    await expect(top3(page)).toHaveCount(0)

    await prompt(page).getByRole('button', { name: 'Start morning plan' }).click()
    const dialog = morning(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Step 1 of 3')
    await expect(dialog.getByText('0 of 3 chosen')).toBeVisible()

    // Quick add inline: the task is real at once, and it is the first pick.
    const add = dialog.getByRole('textbox', { name: 'Add a task for today' })
    await add.fill(`${ADDED} 15m`)
    await add.press('Enter')
    await expect(dialog.getByRole('checkbox', { name: ADDED })).toBeChecked()
    const [added] = (await tasks(page)).filter((t) => t.title === ADDED)
    expect(added).toMatchObject({
      doDate: TODAY,
      durationMinutes: 15,
      source: 'user',
      status: 'todo',
    })

    await dialog.getByRole('checkbox', { name: NOW_TITLE }).check()
    await dialog.getByRole('checkbox', { name: FLASHCARDS }).check()
    // Three is the most: the rest wait until one is unchecked.
    await expect(dialog.getByText('Three is plenty. Uncheck one to swap.')).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Renew library card' })).toBeDisabled()
    await expect(dialog.getByRole('checkbox', { name: MENTOR })).toBeDisabled()

    // Step 2: today's goal work, read-only, with a link and a move per session.
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog).toContainText('Step 2 of 3')
    const goalWork = dialog.getByRole('list', { name: 'Goal work planned for today' })
    await expect(goalWork.getByRole('listitem')).toHaveCount(3)
    await expect(dialog).toContainText('3 sessions')
    await expect(goalWork.getByRole('link', { name: `Open ${SECOND_TITLE}` })).toBeVisible()
    const second = (await todaysOpen(page)).find((t) => t.title === SECOND_TITLE)
    await goalWork.getByRole('button', { name: `Move ${SECOND_TITLE} to tomorrow` }).click()
    await expect(goalWork.getByRole('listitem')).toHaveCount(2)
    await expect(toasts(page)).toContainText('Moved to tomorrow')
    expect((await tasks(page)).find((t) => t.id === second?.id)?.doDate).toBe(TOMORROW)
    await toastFor(page, 'Moved to tomorrow').getByRole('button', { name: 'Undo' }).click()
    await expect(goalWork.getByRole('listitem')).toHaveCount(3)
    expect((await tasks(page)).find((t) => t.id === second?.id)?.doDate).toBe(TODAY)

    // Step 3: the daily goal is the existing setting.
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog).toContainText('Step 3 of 3')
    await expect(dialog.getByRole('group', { name: 'Daily focus goal' })).toContainText('6')
    await dialog.getByRole('button', { name: 'More pomodoros' }).click()
    await expect(dialog.getByRole('group', { name: 'Daily focus goal' })).toContainText('7')
    await expect(dialog).toContainText('2 h 55 min of focus')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect(toasts(page)).toContainText('Morning plan saved')

    // Saved: the picks in order, the moment it was done, the new goal.
    const [row] = (await rituals(page)).filter((r) => r.kind === 'morning')
    expect(row?.day).toBe(TODAY)
    expect(row?.completedAt).not.toBeNull()
    const byTitle = new Map((await tasks(page)).map((t) => [t.title, t.id]))
    expect(row?.top3).toEqual([byTitle.get(ADDED), byTitle.get(NOW_TITLE), byTitle.get(FLASHCARDS)])
    expect((await settings(page))?.dailyGoalPomodoros).toBe(7)

    // On Today: the pinned card, and the prompt is gone.
    await expect(prompt(page)).toHaveCount(0)
    const card = top3(page)
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Top 3 today' })).toBeVisible()
    await expect(card).toContainText('0 of 3 done')
    await expect(card.getByRole('button', { name: ADDED })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 7 pomodoros',
    )

    // Check one off from the card: the usual completion, with its XP toast.
    await card.getByRole('checkbox', { name: `Done: ${ADDED}` }).check()
    await expect(card).toContainText('1 of 3 done')
    await expect(toasts(page)).toContainText('+10 XP')
    await expect
      .poll(async () => (await tasks(page)).find((t) => t.title === ADDED)?.status)
      .toBe('done')

    // It survives a reload.
    await page.reload()
    await expect(top3(page)).toContainText('1 of 3 done')
    await expect(top3(page).getByRole('checkbox', { name: `Done: ${ADDED}` })).toBeChecked()
  })

  test('is reachable and usable from the keyboard alone', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('w')
    await page.keyboard.press('m')
    const dialog = morning(page)
    await expect(dialog).toBeVisible()
    // Focus starts on the first task; Space picks it.
    await expect(dialog.getByRole('checkbox').first()).toBeFocused()
    await page.keyboard.press('Space')
    await expect(dialog.getByRole('checkbox').first()).toBeChecked()
    await expect(dialog.getByText('1 of 3 chosen')).toBeVisible()
    // Next moves focus to the step's heading.
    await dialog.getByRole('button', { name: 'Next' }).press('Enter')
    await expect(dialog.getByRole('heading', { name: 'Check today’s goal work' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // Nothing was saved by leaving.
    expect((await rituals(page)).filter((r) => r.kind === 'morning')).toEqual([])
    // The palette has it too.
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('morning plan')
    await page.getByRole('option', { name: /Morning plan/ }).click()
    await expect(dialog).toBeVisible()
  })

  test('a clear day says so, and an empty list offers a task or a routine', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('w')
    await page.keyboard.press('m')
    const dialog = morning(page)
    await expect(dialog.getByText('Nothing is planned for today yet.')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Add a task for today' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog.getByText('Nothing from your goals is planned for today.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    // Done with nothing picked is fine: no card, no prompt.
    await expect(top3(page)).toHaveCount(0)
  })
})

test.describe('The prompt on Today', () => {
  test('can be put away for the day, and comes back the next day', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(prompt(page)).toBeVisible()
    await prompt(page).getByRole('button', { name: 'Not today' }).click()
    await expect(prompt(page)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
    // Putting it away costs nothing: the palette still has the plan.
    await page.keyboard.press('w')
    await page.keyboard.press('m')
    await expect(morning(page)).toBeVisible()
    await page.keyboard.press('Escape')

    // The next morning it is offered again.
    await page.clock.setFixedTime(new Date('2026-09-30T09:30:00-04:00'))
    await page.goto('/')
    await expect(prompt(page)).toContainText('Plan your day')
  })

  test('follows the time of day and the settings', async ({ page }) => {
    // Between the two windows there is nothing.
    await page.clock.setFixedTime(new Date('2026-09-29T14:00:00-04:00'))
    await gotoApp(page, '/', 'wgu')
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)

    // From 17:00 it is the evening shutdown.
    await page.clock.setFixedTime(EVENING)
    await page.goto('/')
    await expect(prompt(page)).toContainText('Wrap up the day')
    await expect(prompt(page).getByRole('button', { name: 'Not tonight' })).toBeVisible()

    // Prompts can be turned off in Settings; the palette still works.
    await page.goto('/settings/rituals')
    const toggle = page.getByRole('switch', { name: 'Offer them on Today' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await page.goto('/')
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
  })
})

test.describe('Evening shutdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(EVENING)
  })

  test('reviews the day, moves what is open in one click (and undoes it), saves a line, pays +10 XP once', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(prompt(page)).toContainText('Wrap up the day')

    // Finish something, so there is a "done today".
    await page
      .getByRole('checkbox', { name: `Done: ${MENTOR}` })
      .first()
      .check()
    await expect(toasts(page)).toContainText('Completed')
    await expect
      .poll(async () => (await tasks(page)).find((t) => t.title === MENTOR)?.status)
      .toBe('done')

    const before = await planned(page)
    const open = await todaysOpen(page)
    expect(open).toHaveLength(7)
    const idOf = (title: string): string | undefined => open.find((t) => t.title === title)?.id
    const dayOf = async (id: string | undefined) =>
      (await tasks(page)).find((t) => t.id === id)?.doDate

    await openEveningFromPrompt(page)
    const dialog = evening(page)
    await expect(dialog).toContainText('Step 1 of 3')
    await expect(dialog.getByText('You finished 1 task today.')).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'Done today' })).toContainText(MENTOR)

    // Step 2: one button moves everything still open to tomorrow.
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(
      dialog.getByText('7 tasks still open. Nothing is lost by moving them on.'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Move 7 to tomorrow' }).click()
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Moved 7 tasks to tomorrow.' }),
    ).toBeVisible()
    await expect(toasts(page)).toContainText('Moved 7 tasks to tomorrow')
    const after = await planned(page)
    for (const t of open) expect(after[t.id]?.[0], t.title).toBe(TOMORROW)
    // The planned times stay; a session that was scheduled is pinned where it now sits.
    expect(after[idOf(NOW_TITLE) ?? '']?.[1]).toBe('10:00')
    expect(after[idOf(NOW_TITLE) ?? '']?.[2]).toBe(true)
    // Nothing else moved.
    for (const [id, was] of Object.entries(before)) {
      if (!open.some((t) => t.id === id)) expect(after[id], id).toEqual(was)
    }

    // Undo puts every date, time and pin back exactly as it was.
    await dialog.getByRole('status').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => planned(page)).toEqual(before)
    await expect(dialog.getByRole('button', { name: 'Move 7 to tomorrow' })).toBeEnabled()

    // Per task: leave one, send one to a day you pick, the rest go with the click.
    await dialog.getByRole('button', { name: `Leave ${SECOND_TITLE} on today` }).click()
    await expect(dialog.getByText('Staying on today')).toBeVisible()
    await dialog.getByRole('button', { name: 'Pick a date for Renew library card' }).click()
    await dialog.getByLabel('Move Renew library card to').fill('2026-10-02')
    await dialog.getByRole('button', { name: 'Move', exact: true }).click()
    await expect(dialog.getByText('Moved to Friday')).toBeVisible()
    await expect.poll(() => dayOf(idOf('Renew library card'))).toBe('2026-10-02')
    await dialog.getByRole('button', { name: 'Move 5 to tomorrow' }).click()
    await expect.poll(() => dayOf(idOf(NOW_TITLE))).toBe(TOMORROW)
    expect(await dayOf(idOf(SECOND_TITLE))).toBe(TODAY)
    expect(await dayOf(idOf('Renew library card'))).toBe('2026-10-02')

    // Step 3: a line for yourself, then finish. +10 XP once.
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog
      .getByRole('textbox', { name: /One line about today/ })
      .fill('Finished the CSS layout unit.   Steady day.')
    await dialog.getByRole('button', { name: 'Finish · +10 XP' }).click()
    await expect(dialog).toBeHidden()
    await expect(toasts(page)).toContainText('Evening shutdown done')
    await expect(toasts(page)).toContainText('+10 XP')

    const [row] = (await rituals(page)).filter((r) => r.kind === 'evening')
    expect(row).toMatchObject({
      day: TODAY,
      reflection: 'Finished the CSS layout unit. Steady day.',
    })
    expect(row?.completedAt).not.toBeNull()
    expect(await eveningNet(page)).toBe(10)
    await expect(prompt(page)).toHaveCount(0)

    // Doing it again, from the palette, pays nothing more.
    await page.keyboard.press('w')
    await page.keyboard.press('e')
    await expect(evening(page)).toBeVisible()
    await expect(evening(page)).toContainText('You closed the day at 6:30 PM.')
    await evening(page).getByRole('button', { name: 'Next' }).click()
    await evening(page).getByRole('button', { name: 'Next' }).click()
    await expect(evening(page).getByRole('textbox', { name: /One line about today/ })).toHaveValue(
      'Finished the CSS layout unit. Steady day.',
    )
    await evening(page).getByRole('button', { name: 'Save' }).click()
    await expect(evening(page)).toBeHidden()
    expect(await eveningNet(page)).toBe(10)
    expect(await eveningEvents(page)).toBe(1)
  })

  test('undoing the completion takes the XP back, and completing again pays once more, never twice', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    const finish = async (): Promise<void> => {
      await page.keyboard.press('w')
      await page.keyboard.press('e')
      const dialog = evening(page)
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Next' }).click()
      await dialog.getByRole('button', { name: 'Next' }).click()
      await dialog.getByRole('button', { name: /^(Finish · \+10 XP|Save)$/ }).click()
      await expect(dialog).toBeHidden()
    }

    await finish()
    await expect(toasts(page)).toContainText('Evening shutdown done')
    expect(await eveningNet(page)).toBe(10)

    await toastFor(page, 'Evening shutdown done').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => eveningNet(page)).toBe(0)
    expect((await rituals(page)).find((r) => r.kind === 'evening')?.completedAt).toBeNull()
    // The card is offered again: undoing a completion reopens the ritual.
    await expect(prompt(page)).toContainText('Wrap up the day')

    await finish()
    await expect.poll(() => eveningNet(page)).toBe(10)
    // Awarded, reversed, awarded: never +20.
    expect(await eveningEvents(page)).toBe(3)
    await finish()
    expect(await eveningNet(page)).toBe(10)
    expect(await eveningEvents(page)).toBe(3)
  })

  test('says so calmly when nothing was planned', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('w')
    await page.keyboard.press('e')
    const dialog = evening(page)
    await expect(dialog.getByText('Nothing checked off today, and that is fine.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(
      dialog.getByText('Nothing was planned for today. Tomorrow starts clear.'),
    ).toBeVisible()
    await expect(dialog).not.toContainText(/overdue|behind|missed/i)
  })
})

test.describe('Routines', () => {
  test('a starter is added to a day in one click, and Undo takes it away', async ({ page }) => {
    await gotoApp(page, '/settings/routines', 'wgu')
    const before = (await tasks(page)).length
    await page.getByRole('button', { name: 'Add Study day to today' }).click()
    await expect(toasts(page)).toContainText('Added 4 tasks to Today')
    await expect.poll(async () => (await tasks(page)).length).toBe(before + 4)
    const made = (await tasks(page)).filter((t) => t.source === 'template')
    expect(made.map((t) => t.title)).toEqual(
      expect.arrayContaining(['Read the next unit', 'Practice questions', 'Review flashcards']),
    )
    expect(made.every((t) => t.doDate === TODAY)).toBe(true)
    expect(made.find((t) => t.title === 'Read the next unit')).toMatchObject({
      doTime: '09:00',
      durationMinutes: 50,
    })

    await toastFor(page, 'Added 4 tasks').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await tasks(page)).length).toBe(before)
  })

  test('"Add routine…" (palette, or w r) adds it to tomorrow, with Undo', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    // The key opens the same picker; close it and use the palette, which the rest of the test drives.
    await page.keyboard.press('w')
    await page.keyboard.press('r')
    await expect(page.getByRole('dialog', { name: 'Add a routine' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add a routine' })).toBeHidden()
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('add routine')
    await page.getByRole('option', { name: /Add routine/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a routine' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'Routines' }).getByRole('listitem')).toHaveCount(
      2,
    )
    await dialog.getByRole('radio', { name: 'Tomorrow' }).click()
    await dialog.getByRole('button', { name: 'Add Weekly reset' }).click()
    await expect(dialog).toBeHidden()
    await expect(toasts(page)).toContainText('Added 5 tasks to Tomorrow')
    const made = (await tasks(page)).filter((t) => t.source === 'template')
    expect(made).toHaveLength(5)
    expect(made.every((t) => t.doDate === TOMORROW)).toBe(true)

    await toastFor(page, 'Added 5 tasks').getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(async () => (await tasks(page)).filter((t) => t.source === 'template'))
      .toHaveLength(0)
  })

  test('the morning plan can add a routine to today', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('w')
    await page.keyboard.press('m')
    const dialog = morning(page)
    await dialog.getByRole('button', { name: 'Add a routine' }).click()
    await page.getByRole('menuitem', { name: /Weekly reset/ }).click()
    await expect(toasts(page)).toContainText('Added 5 tasks to Today')
    await expect(dialog.getByRole('checkbox', { name: 'Clear the Inbox' })).toBeVisible()
  })

  test('saves today’s tasks as a routine; renames it; deletes it with Undo', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('save today')
    await page.getByRole('option', { name: /Save today/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Save as a routine' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save routine' })).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('C779 study block')
    // Keep just two of today's tasks.
    const boxes = dialog.getByRole('list', { name: 'Tasks to save' }).getByRole('checkbox')
    await expect(boxes).toHaveCount(5)
    for (const i of [2, 3, 4]) await boxes.nth(i).uncheck()
    await expect(dialog.getByText(/2 chosen/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Save routine' }).click()
    await expect(dialog).toBeHidden()
    await expect(toasts(page)).toContainText('Saved “C779 study block”')

    const [saved] = await templates(page)
    expect(saved).toMatchObject({ kind: 'task', name: 'C779 study block' })
    expect(saved?.payload.tasks).toHaveLength(2)

    // Settings: it is listed, can be renamed in place and deleted, each with Undo.
    await page.goto('/settings/routines')
    const row = page.getByTestId('routine-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('C779 study block')
    await row.getByRole('button', { name: 'Rename C779 study block' }).click()
    const field = page.getByRole('textbox', { name: 'Rename C779 study block' })
    await field.fill('C779 deep work')
    await field.press('Enter')
    await expect(row).toContainText('C779 deep work')
    await expect(toasts(page)).toContainText('Renamed to “C779 deep work”')
    await toastFor(page, 'Renamed to').getByRole('button', { name: 'Undo' }).click()
    await expect(row).toContainText('C779 study block')

    await row.getByRole('button', { name: 'Delete C779 study block' }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByText('Nothing saved yet.')).toBeVisible()
    await toastFor(page, 'Deleted').getByRole('button', { name: 'Undo' }).click()
    await expect(row).toHaveCount(1)
    expect(await templates(page)).toHaveLength(1)
  })
})

test.describe('Reflections on Progress', () => {
  test('lists the one-line reflections, collapsed until opened', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    const evenings = [
      ['2026-09-28', 'Read two units of C182. Slow start, strong finish.'],
      ['2026-09-27', 'Rest day. Planned the week for C779 and D278.'],
      ['2026-09-26', ''],
    ] as const
    await putRows(
      page,
      'rituals',
      evenings.map(([day, reflection]) => ({
        id: `evening:${day}`,
        createdAt: 1,
        updatedAt: 1,
        day,
        kind: 'evening',
        top3: [],
        reflection,
        completedAt: 1,
      })),
    )
    await page.goto('/progress')
    const section = page.getByTestId('reflections')
    const toggle = section.getByRole('button', { name: 'Reflections (2)' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(section.getByText('Slow start, strong finish.')).toBeHidden()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = section.getByRole('list', { name: 'Reflections, newest first' })
    await expect(list.getByRole('listitem')).toHaveText([
      /Mon, Sep 28.*Slow start, strong finish\./,
      /Sun, Sep 27.*Planned the week/,
    ])
  })
})

test.describe('Settings', () => {
  test('the times are settings, and the morning card follows them', async ({ page }) => {
    await gotoApp(page, '/settings/rituals', 'wgu')
    const morningField = page.getByLabel('Morning plan until')
    await expect(morningField).toHaveValue('12:00')
    await morningField.fill('09:00')
    await morningField.blur()
    await expect(page.getByText('Saved.')).toBeVisible()
    // The evening must start after the morning ends.
    const eveningField = page.getByLabel('Evening shutdown from')
    await eveningField.fill('08:00')
    await eveningField.blur()
    await expect(
      page.getByText('The evening shutdown should start after the morning plan ends.'),
    ).toBeVisible()
    // The value that was not accepted goes back to what is saved.
    await expect(eveningField).toHaveValue('17:00')
    await page.goto('/')
    // 09:30 is now past the morning window.
    await expect(page.getByRole('progressbar', { name: 'Daily goal' })).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
  })
})
