import type { Page } from '@playwright/test'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

const COUNT = '[data-testid="badges-count"]'

/** A finished, counted 25-minute focus session that began at `iso` (New York time). */
function session(id: string, iso: string): Record<string, unknown> {
  const startedAt = new Date(iso).getTime()
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
    day: iso.slice(0, 10),
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

/** A streak row for `day`, qualified. */
function streakDay(day: string): Record<string, unknown> {
  return {
    id: day,
    createdAt: 1,
    updatedAt: 1,
    day,
    focusMinutes: 25,
    focusSessions: 1,
    pomodoros: 1,
    tasksDone: 0,
    dailyGoalTarget: 4,
    dailyGoalHit: false,
    qualified: true,
    xp: 25,
  }
}

const STREAK_DAYS = [
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-09-28',
  '2026-09-29',
]

/**
 * History that earns six of the eleven: First Focus, Early Bird (Tue 7:30), Night Owl (Sun 23:10), Deep Work
 * (four on Fri), 7-Day Streak (23rd to 29th) and First Course Complete (C182 is done in the WGU sample).
 * The rows go in through IndexedDB and a reload reconciles them at app start.
 */
async function earnSix(page: Page): Promise<void> {
  await putRows(page, 'sessions', [
    session('shot-early', '2026-09-29T07:30:00-04:00'),
    session('shot-owl', '2026-09-27T23:10:00-04:00'),
    session('shot-deep-1', '2026-09-25T09:00:00-04:00'),
    session('shot-deep-2', '2026-09-25T11:00:00-04:00'),
    session('shot-deep-3', '2026-09-25T13:00:00-04:00'),
    session('shot-deep-4', '2026-09-25T15:00:00-04:00'),
  ])
  await putRows(page, 'streakDays', STREAK_DAYS.map(streakDay))
  await page.goto('/rewards/badges')
  await page.locator(COUNT).filter({ hasText: '6 of 11 unlocked' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

/** Badges (Phase 6C): the grid on the Rewards page's Badges tab. The clock is frozen at Tue 2026-09-29 09:30. */
const list: ShotList = {
  feature: 'badges',
  shots: [
    {
      name: 'grid',
      path: '/rewards/badges?seed=wgu',
      waitFor: COUNT,
      prepare: earnSix,
      fullPage: true,
    },
    { name: 'empty', path: '/rewards/badges?seed=empty', waitFor: COUNT },
    {
      name: 'tooltip',
      path: '/rewards/badges?seed=wgu',
      waitFor: COUNT,
      prepare: async (page) => {
        await earnSix(page)
        await page.locator('[data-badge="early-bird"]').hover()
        await page.getByRole('tooltip').waitFor()
      },
    },
  ],
}

export default list
