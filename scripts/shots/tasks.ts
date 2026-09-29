import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Waits for finite animations and transitions to end so the capture is the settled state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

const ROWS = 'main ul li'

// Tasks (Phase 3A). Sample data comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'tasks',
  shots: [
    { name: 'inbox', path: '/tasks/inbox?seed=wgu', waitFor: ROWS },
    { name: 'all-by-date', path: '/tasks/all?seed=wgu', waitFor: ROWS, fullPage: true },
    { name: 'all-by-project', path: '/tasks/all?seed=wgu&group=project', waitFor: ROWS },
    { name: 'upcoming', path: '/tasks/upcoming?seed=wgu', waitFor: ROWS },
    // The side peek on a wide screen; below 640 px it opens as the task page instead.
    {
      name: 'peek',
      path: '/tasks/inbox?seed=wgu&peek=task-email-mentor',
      waitFor: '[aria-label="Task details"], main h1',
      prepare: settle,
    },
    { name: 'task-page', path: '/task/task-c779-u3-2?seed=wgu', waitFor: 'main h1', prepare: settle },
    { name: 'completed', path: '/tasks/completed?seed=wgu', waitFor: ROWS, fullPage: true },
    {
      name: 'filters',
      path: '/tasks/all?seed=wgu&priority=3,4',
      waitFor: ROWS,
    },
    {
      name: 'row-menu',
      path: '/tasks/inbox?seed=wgu',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.locator(ROWS).first().hover()
        await page.getByRole('button', { name: 'More actions' }).first().click()
        await page.getByRole('menu').waitFor()
        await settle(page)
      },
    },
    { name: 'empty-inbox', path: '/tasks/inbox?seed=empty', waitFor: 'main h1', prepare: settle },
  ],
}

export default list
