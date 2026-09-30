import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { focusSession, putRows } from './idb'

/**
 * Phase 7A: streaks end to end. The clock is frozen at Tue 2026-09-29 09:30 EDT (the fixture's), so
 * "today" is Tuesday the 29th and its week (Monday first) runs 28 Sep to 4 Oct. History goes in as
 * finished, counted focus sessions through IndexedDB; a reload builds the day rows at app start. Tests that
 * read Today's stat row and heatmap use the WGU sample: an empty database shows Today's brand-new state.
 */

const flame = (page: Page) => page.getByTestId('streak-flame')
const count = (page: Page) => page.getByTestId('streak-count')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const heatmap = (page: Page) => page.getByRole('region', { name: 'Last 14 days' })

/** One counted session on each of the given days. */
function sessionsOn(...days: string[]): Record<string, unknown>[] {
  return days.map((day) => focusSession(`streak-${day}`, day, null, 25))
}

test.describe('Streaks', () => {
  test('a new user sees a neutral flame; the tooltip only invites', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await expect(count(page)).toHaveText('0')
    await flame(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Start a streak today')
    // Nothing about the streak scolds: no "lost", "broken" or "missed" in the flame or the header stat.
    await expect(flame(page)).not.toContainText(/lost|broke|miss/i)
  })

  test('six days in a row make a streak of six, with the best and the freeze in the tooltip', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await putRows(
      page,
      'sessions',
      sessionsOn(
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
        '2026-09-28',
      ),
    )
    await page.goto('/')

    await expect(count(page)).toHaveText('6')
    // Today is still open: the run through yesterday stands, and the Today stat agrees.
    await expect(page.getByText('day streak').locator('..')).toContainText('6')
    await flame(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Best: 6 · Freeze ready ❄️')
    // Crediting old history is quiet: no toast, and no 7-day XP yet.
    await expect(toasts(page)).not.toContainText('streak')
  })

  test('history that already holds a 7-day streak is credited quietly at start, badge included', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'empty')
    await putRows(
      page,
      'sessions',
      sessionsOn(
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
        '2026-09-28',
      ),
    )
    await page.goto('/rewards/badges')

    await expect(page.locator('[data-badge="streak-7"]')).toHaveAttribute('data-state', 'unlocked')
    await expect(count(page)).toHaveText('8')
    // Old history is not news: no streak toast and no badge toast.
    await expect(toasts(page)).not.toContainText(/streak|unlocked/i)
  })

  test('a day off covered by the weekly freeze shows ❄️ in the mini heatmap and the streak goes on', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    // Fri, Sat, (Sunday off), Mon: last week's freeze covers Sunday.
    await putRows(page, 'sessions', sessionsOn('2026-09-25', '2026-09-26', '2026-09-28'))
    await page.goto('/')

    await expect(count(page)).toHaveText('3')
    await expect(page.getByText('day streak').locator('..')).toContainText('3')

    const frozen = heatmap(page).locator('[data-frozen]')
    await expect(frozen).toHaveCount(1)
    await expect(frozen).toHaveText('❄️')
    await expect(frozen).toHaveAttribute('aria-label', /Sun, Sep 27: streak freeze/)
    // This week's own freeze is still there, and the heatmap explains the snowflake.
    await flame(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Best: 3 · Freeze ready ❄️')
    await expect(heatmap(page)).toContainText('Streak freeze')
    await expect(heatmap(page)).not.toContainText(/lost|broke|miss/i)
  })

  test('a second day off in one week just starts a new run: only one snowflake, and no scolding', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    // Mon Q, Tue Q, Wed off (frozen), Thu Q, Fri off (the week's freeze is spent), then Sat, Sun, Mon Q.
    await putRows(
      page,
      'sessions',
      sessionsOn(
        '2026-09-21',
        '2026-09-22',
        '2026-09-24',
        '2026-09-26',
        '2026-09-27',
        '2026-09-28',
      ),
    )
    await page.goto('/')

    await expect(count(page)).toHaveText('3')
    await expect(heatmap(page).locator('[data-frozen]')).toHaveCount(1)
    await expect(heatmap(page).locator('[data-frozen]')).toHaveAttribute(
      'aria-label',
      /Wed, Sep 23: streak freeze/,
    )
    await flame(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Best: 3 · Freeze ready ❄️')
    await expect(page.locator('body')).not.toContainText(/lost|broke|missed/i)
  })

  test('the palette has "Show streak"', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('streak')
    await page.getByRole('option', { name: /Show streak/ }).click()
    await expect(page).toHaveURL(/\/progress$/)
  })
})

test.describe('Streaks: reaching a milestone live', () => {
  // A running timer needs page.clock, not the fixture's frozen time (see focus.spec.ts).
  test.use({ fixedClock: false })

  test('a session that makes the 7th day lights the flame to 7 and pops a gentle toast', async ({
    page,
  }) => {
    await page.clock.install({ time: FIXED_NOW })
    await gotoApp(page, '/focus', 'empty')
    await putRows(
      page,
      'sessions',
      sessionsOn(
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
        '2026-09-28',
      ),
    )
    await page.goto('/focus')
    await expect(page.getByTestId('timer-display')).toBeVisible()
    await page.clock.setSystemTime(FIXED_NOW)
    await expect(count(page)).toHaveText('6')

    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    await page.clock.fastForward('25:00')

    // The milestone's XP and its badge are one toast, not two (the queue merges what arrives together).
    await expect(toasts(page)).toContainText('7-day streak · +100 XP 🔥 · Badge unlocked')
    await expect(toasts(page).getByRole('status').getByText(/streak/)).toHaveCount(1)
    await expect(toasts(page)).not.toContainText('Badge unlocked · 7-Day Streak')
    await expect(count(page)).toHaveText('7')

    // Once only: reloading credits nothing again and says nothing.
    await page.goto('/focus')
    await expect(count(page)).toHaveText('7')
    await expect(toasts(page)).not.toContainText('7-day streak')
  })
})
