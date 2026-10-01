import type { Page } from '@playwright/test'
import { FIXED_NOW } from '../../e2e/fixtures'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

const COUNT = '[data-testid="streak-count"]'
const FLAME = '[data-testid="streak-flame"]'

/** A finished, counted 25-minute focus session `offset` days from the frozen "today" (Tue 2026-09-29). */
function session(offset: number, i: number): Record<string, unknown> {
  const day = new Date(FIXED_NOW.getTime() + offset * 86_400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const iso = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const startedAt = new Date(`${iso}T08:00:00-04:00`).getTime() + i * 35 * 60_000
  return {
    id: `shot-streak-${offset}-${i}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day: iso,
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: i + 1,
    interrupted: false,
    counted: true,
    note: null,
  }
}

/**
 * Pomodoros per day, oldest first. Monday 21 September (-8) is a day off between two runs, so the weekly
 * freeze covers it and the streak carries on; today is still open.
 */
const POMODOROS: Record<number, number> = {
  [-13]: 2,
  [-12]: 1,
  [-11]: 3,
  [-10]: 2,
  [-9]: 4,
  [-7]: 2,
  [-6]: 3,
  [-5]: 5,
  [-4]: 2,
  [-3]: 4,
  [-2]: 3,
  [-1]: 6,
}

/** Twelve days of focus around one frozen day. The rows go in through IndexedDB; a reload builds the days. */
async function seedStreak(page: Page): Promise<void> {
  const rows: Record<string, unknown>[] = []
  for (const [offset, count] of Object.entries(POMODOROS)) {
    for (let i = 0; i < count; i++) rows.push(session(Number(offset), i))
  }
  await putRows(page, 'sessions', rows)
  await page.goto('/')
  // Today's stat is on every viewport (the sidebar flame is not on a phone).
  await page.getByText('day streak').locator('..').filter({ hasText: '12' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

/** Streaks (Phase 7A): the sidebar flame, Today's streak stat and the 14-day heatmap with its ❄️. */
const list: ShotList = {
  feature: 'streaks',
  shots: [
    {
      name: 'today',
      path: '/?seed=wgu',
      waitFor: '#now-title',
      prepare: seedStreak,
    },
    {
      name: 'flame-tooltip',
      path: '/?seed=wgu',
      waitFor: '#now-title',
      prepare: async (page) => {
        await seedStreak(page)
        // Phones have no sidebar footer, so there is nothing to hover there.
        if ((page.viewportSize()?.width ?? 0) > 900) {
          await page.locator(FLAME).hover()
          await page.getByRole('tooltip').waitFor()
        }
      },
    },
    {
      name: 'milestone-toast',
      path: '/focus?seed=empty',
      waitFor: '[data-testid="timer-display"]',
      prepare: async (page) => {
        // Six days in a row already; a seventh session is finished the way the app does it: start the
        // timer, then move the frozen clock 25 minutes on so the running timer ends.
        const rows: Record<string, unknown>[] = []
        for (let offset = -6; offset <= -1; offset++) rows.push(session(offset, 0))
        await putRows(page, 'sessions', rows)
        await page.goto('/focus')
        await page.getByTestId('timer-start').click()
        await page.getByTestId('timer-toggle').filter({ hasText: 'Pause' }).waitFor()
        await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 25 * 60_000))
        await page
          .getByRole('region', { name: 'Notifications' })
          .filter({ hasText: '7-day streak' })
          .waitFor()
        await page.evaluate(() => document.fonts.ready)
        await page.mouse.move(0, 0)
      },
    },
    {
      name: 'empty',
      path: '/?seed=empty',
      prepare: async (page) => {
        // Phones have no sidebar footer, so there is nothing to hover there.
        if ((page.viewportSize()?.width ?? 0) > 900) {
          await page.locator(COUNT).waitFor()
          await page.locator(FLAME).hover()
          await page.getByRole('tooltip').waitFor()
        }
      },
    },
  ],
}

export default list
