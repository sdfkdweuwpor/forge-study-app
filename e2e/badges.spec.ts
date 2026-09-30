import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { putRows } from './idb'

/**
 * Phase 6C: badges end to end. The grid lives on the Rewards page's Badges tab (`/rewards/badges`).
 * The clock is frozen at Tue 2026-09-29 09:30 EDT (the fixture's), so "Unlocked Sep 29" is stable.
 */

const card = (page: Page, id: string) => page.locator(`[data-badge="${id}"]`)
const count = (page: Page) => page.getByTestId('badges-count')

/** A finished, counted 25-minute focus session that began at `iso`. */
function countedSession(id: string, iso: string): Record<string, unknown> {
  const startedAt = new Date(iso).getTime()
  const day = iso.slice(0, 10)
  return {
    id,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day,
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
  }
}

test.describe('Badges', () => {
  test('a counted 7:30 session unlocks Early Bird with its date, and locked cards show a hint', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await putRows(page, 'sessions', [countedSession('early-1', '2026-09-29T07:30:00-04:00')])

    // A fresh load reconciles the history at app start, silently (no toast for old history).
    await page.goto('/rewards/badges')
    await expect(page.getByRole('heading', { name: 'Rewards' })).toBeVisible()

    const early = card(page, 'early-bird')
    await expect(early).toContainText('Early Bird')
    await expect(early).toContainText('Started a focus session before 8 a.m.')
    await expect(early).toContainText('Unlocked Sep 29')
    await expect(early).toHaveAttribute('data-state', 'unlocked')
    await expect(card(page, 'first-focus')).toContainText('Unlocked Sep 29')
    await expect(count(page)).toHaveText('2 of 11 unlocked')
    // Crediting old history at start-up is quiet: no "Badge unlocked" toast.
    await expect(page.getByRole('region', { name: 'Notifications' })).not.toContainText('unlocked')

    // Locked: grayscale emoji, a muted title, the hint, and no date.
    const owl = card(page, 'night-owl')
    await expect(owl).toHaveAttribute('data-state', 'locked')
    await expect(owl).toContainText('Night Owl')
    await expect(owl).toContainText('Start a session between 10 p.m. and 4 a.m.')
    await expect(owl).toContainText('Locked')
    await expect(owl).not.toContainText('Unlocked')
    await expect(owl.locator('span[aria-hidden="true"]').first()).toHaveCSS(
      'filter',
      'grayscale(1)',
    )
    await expect(early.locator('span[aria-hidden="true"]').first()).toHaveCSS('filter', 'none')

    // All eleven are always listed, in the brief's order, and none of the hints scolds.
    await expect(page.locator('[data-badge]')).toHaveCount(11)
    await expect(page.locator('[data-badge]').first()).toHaveAttribute('data-badge', 'first-focus')
    await expect(page.locator('[data-badge]').last()).toHaveAttribute('data-badge', 'comeback')
    await expect(page.getByRole('status', { name: 'Loading badges' })).toHaveCount(0)
  })

  test('cards take keyboard focus and explain themselves in a tooltip', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await putRows(page, 'sessions', [countedSession('early-2', '2026-09-29T07:30:00-04:00')])
    await page.goto('/rewards/badges')
    await expect(count(page)).toHaveText('2 of 11 unlocked')

    const early = card(page, 'early-bird')
    await early.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText('Unlocked Tuesday, September 29, 2026')
    await expect(tip).toContainText('Started at 07:30')

    await page.mouse.move(0, 0)
    await expect(tip).toHaveCount(0)
    await card(page, 'first-focus').focus()
    await page.keyboard.press('Tab')
    await expect(early).toBeFocused()
    await expect(page.getByRole('tooltip')).toContainText('Unlocked Tuesday, September 29, 2026')

    await page.keyboard.press('Tab') // night owl, locked
    await expect(page.getByRole('tooltip')).toContainText(
      'Locked · Start a session between 10 p.m.',
    )
  })

  test('with no history, every badge is locked and the page says how to start', async ({
    page,
  }) => {
    await gotoApp(page, '/rewards/badges', 'empty')
    await expect(count(page)).toHaveText('0 of 11 unlocked')
    await expect(page.getByText('Finish a focus session to earn your first badge.')).toBeVisible()
    await expect(page.locator('[data-badge][data-state="locked"]')).toHaveCount(11)
  })

  test('the palette has "Go to Badges"', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('badges')
    await page.getByRole('option', { name: /Go to Badges/ }).click()
    await expect(page).toHaveURL(/\/rewards\/badges$/)
    await expect(count(page)).toHaveText('0 of 11 unlocked')
  })

  test('the sample data already earned First Course Complete (C182 is done)', async ({ page }) => {
    await gotoApp(page, '/rewards/badges', 'wgu')
    const first = card(page, 'first-course')
    await expect(first).toHaveAttribute('data-state', 'unlocked')
    await expect(first).toContainText('Completed your first course.')
  })
})

test.describe('Badges: unlocking live', () => {
  // A running timer needs page.clock, not the fixture's frozen time (see focus.spec.ts).
  test.use({ fixedClock: false })

  test('finishing a first focus session pops a gentle toast and fills the card', async ({
    page,
  }) => {
    await page.clock.install({ time: FIXED_NOW })
    await gotoApp(page, '/focus', 'empty')
    await expect(page.getByTestId('timer-display')).toBeVisible()
    await page.clock.setSystemTime(FIXED_NOW)

    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    await page.clock.fastForward('25:00')

    const toasts = page.getByRole('region', { name: 'Notifications' })
    await expect(toasts).toContainText('Badge unlocked · First Focus 🌱')
    await expect(toasts).toContainText('Finished your first focus session.')

    await page.goto('/rewards/badges')
    await expect(card(page, 'first-focus')).toHaveAttribute('data-state', 'unlocked')
    await expect(count(page)).toHaveText('1 of 11 unlocked')
  })
})
