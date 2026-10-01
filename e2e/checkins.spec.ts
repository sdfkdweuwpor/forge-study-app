import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { readTable } from './idb'

/**
 * Phase 11b: the focus check-in. After a session the end dialog asks "How was your focus?" (1 to 5, an
 * optional mood); Progress shows "When you focus best" once an hour has three ratings, and the best hour
 * is written to `settings.scheduling.bestHour`. Runs on `page.clock` like focus.spec.ts.
 */

test.use({ fixedClock: false })

const MENTOR = 'Email mentor about term plan'
const DAY_MS = 24 * 60 * 60 * 1000

// "Done with this task?" while a task is linked, "Session complete" when there is none to finish.
const endDialog = (page: Page) =>
  page.getByRole('dialog', { name: /^(Done with this task\?|Session complete)$/ })
const rating = (page: Page) =>
  endDialog(page).getByRole('radiogroup', { name: 'How was your focus?' })
const card = (page: Page) => page.getByTestId('best-hours')

interface StoredCheckIn {
  id: string
  sessionId: string | null
  day: string
  hour: number
  weekday: number
  focus: number
  mood: string | null
}
interface StoredSettings {
  id: string
  scheduling: { bestHour: number | null }
}

const checkIns = (page: Page) => readTable<StoredCheckIn>(page, 'checkIns')
const bestHour = async (page: Page) =>
  (await readTable<StoredSettings>(page, 'settings')).find((s) => s.id === 'app')?.scheduling
    .bestHour

async function openApp(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await gotoApp(page, '/focus', 'wgu')
  await expect(page.getByTestId('timer-display')).toBeVisible()
  await page.clock.setSystemTime(FIXED_NOW)
}

/** Links the task and starts a pomodoro, then jumps to its end: the dialog is up. */
async function runFirstRound(page: Page): Promise<void> {
  await page.getByTestId('task-picker').click()
  await page.getByRole('combobox', { name: 'Search open tasks' }).fill(MENTOR)
  await page.getByRole('option', { name: MENTOR }).first().click()
  await page.getByTestId('timer-start').click()
  await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
  await page.clock.fastForward('25:00')
  await expect(endDialog(page)).toBeVisible()
}

async function goToProgress(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Progress' })
    .click()
  await expect(page).toHaveURL(/\/progress$/)
}

test.describe('Focus check-in', () => {
  test('the end dialog asks once, saves at once, and skipping it costs nothing', async ({
    page,
  }) => {
    await openApp(page)
    await runFirstRound(page)

    const group = rating(page)
    await expect(group).toBeVisible()
    await expect(group.getByRole('radio')).toHaveCount(5)
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0)
    await expect(endDialog(page)).toContainText('Optional. 1 is scattered, 5 is fully in the zone.')
    // No mood until there is a rating, and nothing was saved yet.
    await expect(endDialog(page).getByRole('group', { name: 'Mood, optional' })).toHaveCount(0)
    expect(await checkIns(page)).toHaveLength(0)

    await group.getByRole('radio', { name: '4 of 5' }).click()
    await expect(group.getByRole('radio', { name: '4 of 5' })).toBeChecked()
    await expect(endDialog(page)).toContainText('Saved.')
    await expect.poll(async () => (await checkIns(page)).length).toBe(1)
    const [saved] = await checkIns(page)
    const [session] = await readTable<{ id: string }>(page, 'sessions')
    expect(saved).toMatchObject({
      sessionId: session?.id,
      day: '2026-09-29',
      hour: 9,
      weekday: 2,
      focus: 4,
      mood: null,
    })

    // Changing your mind replaces the rating instead of adding a second one.
    await group.getByRole('radio', { name: '2 of 5' }).click()
    await expect.poll(async () => (await checkIns(page)).map((c) => c.focus)).toEqual([2])

    // Mood is optional, and a chip toggles off again.
    const moods = endDialog(page).getByRole('group', { name: 'Mood, optional' })
    await expect(moods.getByRole('button')).toHaveCount(5)
    await moods.getByRole('button', { name: 'Calm' }).click()
    await expect(moods.getByRole('button', { name: 'Calm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect.poll(async () => (await checkIns(page))[0]?.mood).toBe('😌')
    await moods.getByRole('button', { name: 'Calm' }).click()
    await expect.poll(async () => (await checkIns(page))[0]?.mood).toBeNull()
  })

  test('keys 1 to 5 rate while the dialog is open, and do nothing while typing a note', async ({
    page,
  }) => {
    await openApp(page)
    await runFirstRound(page)

    await page.keyboard.press('5')
    await expect(rating(page).getByRole('radio', { name: '5 of 5' })).toBeChecked()
    await expect.poll(async () => (await checkIns(page)).map((c) => c.focus)).toEqual([5])
    await page.keyboard.press('3')
    await expect.poll(async () => (await checkIns(page)).map((c) => c.focus)).toEqual([3])

    await endDialog(page).getByRole('button', { name: 'Add note' }).click()
    await page.getByRole('textbox', { name: 'Note' }).fill('Covered units 1')
    await page.keyboard.type('2')
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('Covered units 12')
    expect((await checkIns(page)).map((c) => c.focus)).toEqual([3])
  })

  test('arrow keys move through the ratings like any radio group', async ({ page }) => {
    await openApp(page)
    await runFirstRound(page)
    await rating(page).getByRole('radio', { name: '1 of 5' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(rating(page).getByRole('radio', { name: '2 of 5' })).toBeChecked()
    await expect.poll(async () => (await checkIns(page)).map((c) => c.focus)).toEqual([2])
  })

  test('skipping it saves nothing and Progress stays quiet about it', async ({ page }) => {
    await openApp(page)
    await runFirstRound(page)
    await endDialog(page).getByRole('button', { name: 'Yes' }).click()
    await expect(endDialog(page)).toBeHidden()
    expect(await checkIns(page)).toHaveLength(0)
    await goToProgress(page)
    await expect(card(page)).toContainText('Rate a few sessions to see your best hours.')
    expect(await bestHour(page)).toBeNull()
  })

  test('the Progress card appears after three check-ins, and the best hour is stored', async ({
    page,
  }) => {
    await openApp(page)
    await runFirstRound(page)
    await rating(page).getByRole('radio', { name: '4 of 5' }).click()
    await expect.poll(async () => (await checkIns(page)).length).toBe(1)

    // Round 2, straight after: 9:55.
    await endDialog(page).getByRole('button', { name: 'Keep going' }).click()
    await expect(endDialog(page)).toBeHidden()
    await page.clock.fastForward('25:00')
    await expect(endDialog(page)).toBeVisible()
    await page.keyboard.press('4')
    await expect.poll(async () => (await checkIns(page)).length).toBe(2)
    await page.keyboard.press('Escape')
    await expect(endDialog(page)).toBeHidden()

    // Two ratings are not enough to say anything.
    await goToProgress(page)
    await expect(card(page)).toContainText('When you focus best')
    await expect(card(page)).toContainText('Rate a few sessions to see your best hours.')
    expect(await bestHour(page)).toBeNull()

    // Round 3 on the next morning at 9:30.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Focus' })
      .click()
    await page.getByTestId('timer-skip-break').click()
    await page.clock.setSystemTime(new Date(FIXED_NOW.getTime() + DAY_MS))
    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    await page.clock.fastForward('25:00')
    await expect(endDialog(page)).toBeVisible()
    await rating(page).getByRole('radio', { name: '4 of 5' }).click()
    await expect.poll(async () => (await checkIns(page)).length).toBe(3)
    await page.keyboard.press('Escape')
    await expect(endDialog(page)).toBeHidden()

    expect((await checkIns(page)).map((c) => [c.hour, c.focus])).toEqual([
      [9, 4],
      [9, 4],
      [9, 4],
    ])
    expect(await bestHour(page)).toBe(9)

    await goToProgress(page)
    await expect(card(page)).toContainText('When you focus best')
    await expect(card(page)).not.toContainText('Rate a few sessions')
    await expect(card(page)).toContainText('3 check-ins')
    const hours = card(page).getByRole('figure', { name: /Best hours/ })
    await expect(hours).toContainText('9 AM')
    await expect(hours).toContainText('4.0 of 5')
    await expect(card(page)).toContainText('starts the day around 9 AM')
  })

  test('the Progress card at 375 px fits without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.clock.install({ time: FIXED_NOW })
    await gotoApp(page, '/progress', 'wgu')
    await page.clock.setSystemTime(FIXED_NOW)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
